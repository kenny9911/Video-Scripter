// Publishing through Postiz (postiz.com, or a Postiz the deployment hosts itself): one API key reaches the
// channels a person connected there (YouTube, Instagram, TikTok, LinkedIn, X and more), so this app needs
// no developer app of its own at any of them.
//
//   connection(userId) / connect / disconnect   each person's own Postiz key, kept on the server
//   listChannels(conn)                          the channels that key can post to
//   uploadMedia(conn, file)                     a picture or a video, into Postiz's media library
//   createPost(conn, post)                      one post to several channels: now, at a time, or as a draft
//   settingsFor(identifier, post)               what each platform has to be told (a YouTube title, a TikTok privacy level)
//   addPart / takeParts                         a file too large for one request, sent in pieces first
//
// The Chinese platforms are not among Postiz's channels: 小红书, 抖音 and 视频号 let no outside service post for
// a person, so for those the page keeps its download and share buttons.
//
// Where Postiz lives is the deployment's choice (POSTIZ_API_URL), never a visitor's: a person only gives a key.

import { db } from './db.mjs';
import { GatewayError, request } from './gateway/client.mjs';

const MB = 1024 * 1024;
export const apiUrl = (env = process.env) => String(env.POSTIZ_API_URL || 'https://api.postiz.com').replace(/\/+$/, '');
/** The largest file that is passed on, and how large each piece of one may be. */
export const MAX_MEDIA_BYTES = 200 * MB;
export const partBytes = (env = process.env) => (Number(env.ASSET_BODY_MB) > 0 ? Math.min(Number(env.ASSET_BODY_MB) * MB, 3.5 * MB) : 3.5 * MB);

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const mask = (key) => (!key ? '' : key.length <= 8 ? '••••' : `${key.slice(0, 3)}••••${key.slice(-4)}`);

// ---------- A person's connection ----------

/** The Postiz key a person saved, or null. */
export async function connection(userId) {
  const doc = await db.get('publishing', userId);
  return doc?.apiKey ? { apiKey: doc.apiKey } : null;
}

export const publicConnection = (conn) => ({ connected: Boolean(conn), keyPreview: mask(conn?.apiKey), partBytes: partBytes(), maxBytes: MAX_MEDIA_BYTES });

/** Save a person's key, once Postiz has answered to it. Returns the channels it reaches. */
export async function connect(userId, apiKey) {
  const key = String(apiKey || '').trim();
  if (key.length < 8 || key.length > 400 || /\s/.test(key)) throw fail('That does not look like a Postiz API key');
  const channels = await listChannels({ apiKey: key });
  await db.put('publishing', { id: userId, ts: Date.now(), apiKey: key });
  return channels;
}

export async function disconnect(userId) {
  await db.del('publishing', userId).catch(() => {});
  await db.delBlobs(`pub-${userId}-`);
}

// ---------- Postiz ----------

// `once` is for a request that must not be sent twice: a post that was made and whose answer was lost would be made again.
async function postiz(conn, path, init = {}, { once = false } = {}) {
  try {
    const res = await request(`${apiUrl()}/public/v1${path}`, { ...init, headers: { accept: 'application/json', authorization: conn.apiKey, ...init.headers } }, { timeouts: 0, ...(once && { retries: 0 }) });
    return await res.json().catch(() => ({}));
  } catch (err) {
    if (err.status === 401 || err.status === 403) throw fail('Postiz did not accept the API key. Check it under Settings in Postiz, then connect again.', 400);
    if (err.status === 429) throw fail('Postiz is not taking more requests right now (its API allows a set number an hour). Try again later.', 429);
    throw err;
  }
}

/** The channels a key can post to: [{ id, name, identifier, picture, disabled }]. `identifier` is the platform ("youtube", "instagram"...). */
export async function listChannels(conn) {
  const rows = await postiz(conn, '/integrations');
  if (!Array.isArray(rows)) throw new GatewayError('Postiz did not return its channels', 502);
  return rows.map((c) => ({ id: String(c.id), name: String(c.name || c.profile || c.identifier || ''), identifier: String(c.identifier || ''), picture: typeof c.picture === 'string' && /^https:\/\//.test(c.picture) ? c.picture : '', disabled: Boolean(c.disabled) })).filter((c) => c.id && c.identifier);
}

const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4' };

/** Put a file in the person's Postiz media library: { id, path }. Only what this app makes is passed on. */
export async function uploadMedia(conn, { bytes, name }) {
  const ext = /\.(\w+)$/.exec(String(name || ''))?.[1].toLowerCase();
  if (!TYPES[ext]) throw fail('Only PNG, JPEG and WebP pictures and MP4 videos are published');
  if (!bytes?.length) throw fail('The file is empty');
  const form = new FormData();
  // A plain name: not every service reads one that is not ASCII the same way.
  const stem = String(name).slice(0, -ext.length - 1).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file';
  form.set('file', new Blob([bytes], { type: TYPES[ext] }), `${stem}.${ext}`);
  const made = await postiz(conn, '/upload', { method: 'POST', body: form, signal: AbortSignal.timeout(600_000) });
  if (typeof made?.path !== 'string' || !/^https?:\/\//.test(made.path)) throw new GatewayError('Postiz did not say where it put the file', 502);
  return { id: String(made.id || ''), path: made.path };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Text as Postiz keeps a post: one paragraph a line, so line breaks survive to the platform. */
export const contentOf = (text) => String(text ?? '').replace(/\r\n?/g, '\n').trim().split('\n').map((line) => `<p>${esc(line)}</p>`).join('');

const cut = (s, max) => [...String(s || '').trim()].slice(0, max).join('');
const VISIBILITY = ['public', 'unlisted', 'private'];

/**
 * What a platform has to be told beyond the text and the media. `post` is { kind: 'video' | 'images',
 * title, hashtags, visibility, ai }. A platform that needs nothing gets nothing.
 */
export function settingsFor(identifier, { kind, title = '', hashtags = [], visibility = 'public', ai = false }) {
  const seen = VISIBILITY.includes(visibility) ? visibility : 'public';
  if (identifier === 'youtube') {
    const tags = hashtags.map((h) => String(h).replace(/^#+/, '').trim()).filter(Boolean).slice(0, 15);
    return { title: cut(title, 100) || 'Untitled', type: seen, selfDeclaredMadeForKids: 'no', tags: tags.map((t) => ({ value: t, label: t })) };
  }
  if (identifier.startsWith('instagram')) return { post_type: 'post' };
  if (identifier === 'tiktok') {
    return {
      ...(cut(title, 90) && { title: cut(title, 90) }),
      privacy_level: seen === 'public' ? 'PUBLIC_TO_EVERYONE' : 'SELF_ONLY', // TikTok has nothing between everyone and yourself that a link reaches
      comment: true,
      brand_content_toggle: false,
      brand_organic_toggle: false,
      content_posting_method: 'DIRECT_POST', // "UPLOAD" only drops the file in the app's inbox and publishes nothing
      ...(kind === 'video' ? { duet: true, stitch: true, video_made_with_ai: Boolean(ai) } : { autoAddMusic: 'no' }),
    };
  }
  if (identifier.startsWith('linkedin') && kind === 'images') return { post_as_images_carousel: true, carousel_name: cut(title, 80) || 'Carousel' };
  if (identifier === 'x') return { who_can_reply_post: 'everyone' };
  return undefined;
}

/**
 * One post to several channels. `post` is
 *   { when: 'now' | 'draft' | ISO date, channels: [{ id, identifier }], text, media: [{ id, path }], kind, title, hashtags, visibility, ai }
 * Returns what Postiz answered: [{ postId, integration }].
 */
export async function createPost(conn, post) {
  const at = post.when === 'now' || post.when === 'draft' ? new Date() : new Date(post.when);
  if (Number.isNaN(at.getTime())) throw fail('The time to publish at is not a date');
  if (post.when !== 'now' && post.when !== 'draft' && at.getTime() < Date.now() - 60_000) throw fail('The time to publish at is in the past');
  if (!post.channels?.length) throw fail('Pick at least one channel');
  if (!post.media?.length) throw fail('There is nothing to publish');
  const media = post.media.map((m, i) => ({ id: String(m.id || `m${i}`), path: String(m.path) }));
  if (media.some((m) => !/^https?:\/\//.test(m.path))) throw fail('A file was not uploaded to Postiz first');
  const body = {
    type: post.when === 'now' ? 'now' : post.when === 'draft' ? 'draft' : 'schedule',
    date: at.toISOString(),
    shortLink: false,
    tags: [],
    posts: post.channels.map((c) => {
      const settings = settingsFor(c.identifier, post);
      return { integration: { id: c.id }, value: [{ content: contentOf(post.text), image: media }], ...(settings && { settings: { __type: c.identifier, ...settings } }) };
    }),
  };
  const made = await postiz(conn, '/posts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) }, { once: true });
  return Array.isArray(made) ? made : [];
}

// ---------- A large file, in pieces ----------

const partName = (userId, upload, n) => `pub-${userId}-${upload}-${n}`;
const cleanUpload = (id) => (/^[\w-]{8,64}$/.test(String(id || '')) ? String(id) : '');
const maxParts = () => Math.ceil(MAX_MEDIA_BYTES / partBytes()) + 1;

/** Keep piece `n` of the file being sent as `upload`. Starting a new file forgets the pieces of the one before. */
export async function addPart({ userId, upload, n, bytes }) {
  const id = cleanUpload(upload);
  const at = Number(n);
  if (!id || !Number.isInteger(at) || at < 0 || at >= maxParts()) throw fail('This upload cannot be followed. Try again.');
  if (!bytes?.length) throw fail('The file is empty');
  if (at === 0) await db.delBlobs(`pub-${userId}-`);
  await db.putBlob(partName(userId, id, at), { userId, type: 'application/octet-stream', bytes });
}

/** The file that was sent as `count` pieces, whole. The pieces are gone afterwards. */
export async function takeParts({ userId, upload, count }) {
  const id = cleanUpload(upload);
  const n = Number(count);
  if (!id || !Number.isInteger(n) || n < 1 || n > maxParts()) throw fail('This upload cannot be followed. Try again.');
  try {
    const parts = [];
    for (let i = 0; i < n; i++) {
      const blob = await db.getBlob(partName(userId, id, i));
      if (!blob) throw fail('The upload was interrupted. Try again.');
      parts.push(await blob.bytes());
    }
    return Buffer.concat(parts);
  } finally {
    await db.delBlobs(`pub-${userId}-${id}-`);
  }
}
