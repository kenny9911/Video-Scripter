// YouTube, connected directly: a person signs in to their own Google account and the app uploads a video
// to their channel. No scheduler in between and no account anywhere else. What it takes from the
// deployment is one Google OAuth client (an id and a secret), entered by an administrator or set in the
// environment.
//
//   loadClient / saveClient / publicClient    the deployment's OAuth client
//   authUrl(client, redirectUri, state)       where a person is sent to say yes
//   connectWithCode(...)                      the code Google sends back, exchanged for tokens and kept
//   connection(userId) / disconnect           a person's own connection: a refresh token, nothing else of theirs
//   startUpload(...) / sendPart(...)          a video sent to YouTube in pieces, through this server
//
// Only the one permission that uploading needs is asked for (youtube.upload). The app cannot read a
// person's channel, their videos or anything else of their account.
//
// A video goes up by YouTube's resumable upload: the server opens the session with the title and the rest,
// then passes on each piece the page sends, so no request carries more than a few megabytes and the
// person's token never reaches the browser.

import { randomBytes } from 'node:crypto';
import { db } from './db.mjs';
import { GatewayError } from './gateway/client.mjs';

const MB = 1024 * 1024;
const CHUNK = 256 * 1024; // YouTube takes pieces in multiples of this, except the last
export const SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
export const MAX_VIDEO_BYTES = 2048 * MB;
const env = () => process.env;
const AUTH_URL = () => env().GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = () => env().GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const REVOKE_URL = () => env().GOOGLE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke';
const UPLOAD_URL = () => env().YOUTUBE_UPLOAD_URL || 'https://www.googleapis.com/upload/youtube/v3/videos';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const mask = (key) => (!key ? '' : key.length <= 8 ? '••••' : `${key.slice(0, 3)}••••${key.slice(-4)}`);
const cut = (s, max) => [...String(s ?? '').trim()].slice(0, max).join('');

/** How large a piece of a video may be: what one request can carry, in whole multiples of what YouTube takes. */
export const partBytes = (e = process.env) => Math.max(CHUNK, Math.floor(((Number(e.ASSET_BODY_MB) > 0 ? Math.min(Number(e.ASSET_BODY_MB), 3.5) : 3.5) * MB) / CHUNK) * CHUNK);

// ---------- The deployment's OAuth client ----------

export async function loadClient() {
  const saved = await db.get('config', 'youtube');
  if (saved?.clientId && saved?.clientSecret) return { clientId: saved.clientId, clientSecret: saved.clientSecret };
  const e = env();
  return e.YOUTUBE_CLIENT_ID && e.YOUTUBE_CLIENT_SECRET ? { clientId: e.YOUTUBE_CLIENT_ID, clientSecret: e.YOUTUBE_CLIENT_SECRET } : null;
}

/** Save the client an administrator entered. A blank secret keeps the stored one while the id is the same. */
export async function saveClient(patch) {
  const clientId = String(patch?.clientId || '').trim();
  if (!clientId) {
    await db.del('config', 'youtube').catch(() => {});
    return null;
  }
  if (!/^[\w.-]{10,200}$/.test(clientId)) throw fail('That does not look like a Google OAuth client ID');
  const current = await db.get('config', 'youtube');
  const clientSecret = String(patch?.clientSecret || '').trim() || (current?.clientId === clientId ? current.clientSecret : '');
  if (!clientSecret) throw fail('The client secret is required');
  await db.put('config', { id: 'youtube', ts: Date.now(), clientId, clientSecret });
  return { clientId, clientSecret };
}

export const publicClient = (client, { admin = false } = {}) => ({ configured: Boolean(client), ...(admin && { clientId: client?.clientId || '', secretPreview: mask(client?.clientSecret) }) });

// ---------- Signing in ----------

/** Start a sign-in for a person: the address at Google they are sent to. The `state` ties the answer to them. */
export async function authUrl(client, { userId, redirectUri }) {
  const state = randomBytes(24).toString('hex');
  await db.put('oauth', { id: state, ts: Date.now(), userId, redirectUri });
  const q = new URLSearchParams({ client_id: client.clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', state });
  return `${AUTH_URL()}?${q}`;
}

async function token(body) {
  let res;
  try {
    res = await fetch(TOKEN_URL(), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(body), signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    throw new GatewayError(`Google could not be reached: ${err.message}`, 502);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw Object.assign(new GatewayError(`Google refused the sign-in: ${cut(data.error_description || data.error || `HTTP ${res.status}`, 200)}`, 502), { code: data.error || '' });
  return data;
}

/**
 * Finish a sign-in: `state` must be one this person started within the last ten minutes. The tokens are
 * kept; the page is told only that it worked.
 */
export async function connectWithCode(client, { userId, code, state }) {
  const started = /^[a-f0-9]{48}$/.test(String(state || '')) ? await db.get('oauth', state) : null;
  if (started) await db.del('oauth', state).catch(() => {});
  if (!started || started.userId !== userId || Date.now() - started.ts > 10 * 60_000) throw fail('This sign-in was not started here, or it took too long. Try again.');
  const got = await token({ code: String(code || ''), client_id: client.clientId, client_secret: client.clientSecret, redirect_uri: started.redirectUri, grant_type: 'authorization_code' });
  if (!String(got.scope || SCOPE).split(/\s+/).includes(SCOPE)) throw fail('The permission to upload videos was not given. Sign in again and leave it ticked.');
  // Google sends a refresh token the first time, and again whenever consent is asked for, which it always is here.
  const before = await db.get('youtube', userId);
  const refreshToken = got.refresh_token || before?.refreshToken;
  if (!refreshToken) throw fail('Google did not send what is needed to stay connected. Remove this app under your Google account’s third-party access, then connect again.');
  await db.put('youtube', { id: userId, ts: Date.now(), refreshToken, accessToken: got.access_token, expiresAt: Date.now() + (Number(got.expires_in) || 3600) * 1000, channel: before?.channel || '' });
}

/** A person's connection as the page may know it. */
export async function connection(userId) {
  const doc = await db.get('youtube', userId);
  return { connected: Boolean(doc?.refreshToken), channel: doc?.channel || '', since: doc?.ts || 0 };
}

export async function disconnect(userId) {
  const doc = await db.get('youtube', userId);
  await db.del('youtube', userId).catch(() => {});
  await db.delBlobs(`yt-${userId}-`).catch(() => {});
  // Tell Google too, so the app disappears from the person's account; if that fails they are disconnected here all the same.
  if (doc?.refreshToken) await fetch(`${REVOKE_URL()}?token=${encodeURIComponent(doc.refreshToken)}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10_000) }).catch(() => {});
}

/** A token that works now: the stored one while it lasts, otherwise a fresh one. */
async function accessToken(client, userId) {
  const doc = await db.get('youtube', userId);
  if (!doc?.refreshToken) throw fail('Connect YouTube first');
  if (doc.accessToken && doc.expiresAt - Date.now() > 60_000) return doc.accessToken;
  let got;
  try {
    got = await token({ client_id: client.clientId, client_secret: client.clientSecret, refresh_token: doc.refreshToken, grant_type: 'refresh_token' });
  } catch (err) {
    // The person took the permission back at Google, or it lapsed: they have to connect again.
    if (err.code === 'invalid_grant') {
      await db.del('youtube', userId).catch(() => {});
      throw fail('YouTube is no longer connected: the permission was withdrawn or has lapsed. Connect it again.');
    }
    throw err;
  }
  await db.update('youtube', userId, (d) => Object.assign(d, { accessToken: got.access_token, expiresAt: Date.now() + (Number(got.expires_in) || 3600) * 1000 }));
  return got.access_token;
}

// ---------- Uploading ----------

const VISIBILITY = ['public', 'unlisted', 'private'];

/** The video resource YouTube is given: its title, description and tags, who can see it, and what it declares. */
export function videoResource({ title, description = '', tags = [], visibility = 'public', ai = false, publishAt = '' }) {
  const name = cut(String(title || '').replace(/[<>]/g, ''), 100);
  if (!name) throw fail('A YouTube video needs a title');
  const words = [];
  let room = 480; // YouTube allows 500 characters of tags in all
  for (const t of tags) {
    const tag = String(t).replace(/^#+/, '').replace(/[<>,]/g, '').trim();
    if (!tag || tag.length + 1 > room) continue;
    words.push(tag);
    room -= tag.length + 1;
  }
  const at = publishAt ? new Date(publishAt) : null;
  if (at && (Number.isNaN(at.getTime()) || at.getTime() < Date.now() + 60_000)) throw fail('The time to publish at has to be in the future');
  return {
    snippet: { title: name, description: cut(String(description).replace(/[<>]/g, ''), 4900), tags: words, categoryId: '22' },
    // A video set to go out later waits as private: that is how YouTube schedules.
    status: { privacyStatus: at ? 'private' : VISIBILITY.includes(visibility) ? visibility : 'public', selfDeclaredMadeForKids: false, containsSyntheticMedia: Boolean(ai), ...(at && { publishAt: at.toISOString() }) },
  };
}

/**
 * Open an upload at YouTube for a video of `size` bytes and remember where its pieces go.
 * Returns { uploadId, partBytes }: the page then sends the file to sendPart, piece by piece, in order.
 */
export async function startUpload(client, { userId, size, video }) {
  const bytes = Number(size);
  if (!Number.isInteger(bytes) || bytes < 1) throw fail('The video is empty');
  if (bytes > MAX_VIDEO_BYTES) throw fail('The video is too large to upload', 413);
  const body = videoResource(video);
  const access = await accessToken(client, userId);
  let res;
  try {
    res = await fetch(`${UPLOAD_URL()}?uploadType=resumable&part=snippet,status`, { method: 'POST', headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-length': String(bytes), 'x-upload-content-type': 'video/mp4' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    throw new GatewayError(`YouTube could not be reached: ${err.message}`, 502);
  }
  const session = res.headers.get('location');
  if (!res.ok || !session) throw new GatewayError(await refusal(res), res.status === 401 || res.status === 403 ? 400 : 502);
  const uploadId = randomBytes(12).toString('hex');
  await db.put('uploads', { id: uploadId, ts: Date.now(), userId, session, size: bytes, sent: 0 });
  return { uploadId, partBytes: partBytes() };
}

/** What YouTube said when it would not take something, in words a person can act on. */
async function refusal(res) {
  const data = await res.json().catch(() => null);
  const reason = data?.error?.errors?.[0]?.reason || '';
  const told = cut(data?.error?.message || `HTTP ${res.status}`, 240);
  if (reason === 'youtubeSignupRequired') return 'This Google account has no YouTube channel yet. Create one at youtube.com, then try again.';
  if (reason === 'quotaExceeded' || reason === 'uploadLimitExceeded') return `YouTube is not taking more uploads from this app or this channel today: ${told}`;
  return `YouTube refused the upload: ${told}`;
}

/**
 * Pass one piece of the file on. Pieces come in order, `offset` being where the piece starts.
 * Returns { done: false, sent } until the last piece, then { done: true, id, url, channel }.
 */
export async function sendPart({ userId, uploadId, offset, bytes }) {
  const up = /^[a-f0-9]{24}$/.test(String(uploadId || '')) ? await db.get('uploads', uploadId) : null;
  if (!up || up.userId !== userId) throw fail('This upload cannot be followed. Start it again.', 404);
  const at = Number(offset);
  if (at !== up.sent) throw fail('A piece of the video arrived out of order. Start the upload again.');
  const end = at + bytes.length;
  const last = end === up.size;
  if (!bytes.length || end > up.size || (!last && bytes.length % CHUNK)) throw fail('A piece of the video has the wrong size. Start the upload again.');
  let res;
  try {
    res = await fetch(up.session, { method: 'PUT', headers: { 'content-length': String(bytes.length), 'content-range': `bytes ${at}-${end - 1}/${up.size}`, 'content-type': 'video/mp4' }, body: bytes, signal: AbortSignal.timeout(300_000) });
  } catch (err) {
    throw new GatewayError(`YouTube could not be reached: ${err.message}`, 502);
  }
  if (res.status === 308) {
    await db.update('uploads', uploadId, (d) => Object.assign(d, { sent: end }));
    return { done: false, sent: end };
  }
  if (!res.ok) {
    await db.del('uploads', uploadId).catch(() => {});
    throw new GatewayError(await refusal(res), 502);
  }
  const made = await res.json().catch(() => ({}));
  await db.del('uploads', uploadId).catch(() => {});
  if (!last || !made.id) throw new GatewayError('YouTube ended the upload without a video', 502);
  const channel = cut(made.snippet?.channelTitle, 100);
  if (channel) await db.update('youtube', userId, (d) => Object.assign(d, { channel })).catch(() => {});
  return { done: true, id: String(made.id), url: `https://youtu.be/${encodeURIComponent(made.id)}`, channel, visibility: made.status?.privacyStatus || '' };
}
