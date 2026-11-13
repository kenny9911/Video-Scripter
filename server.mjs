// Video Scripter server: static UI + JSON API + LLM gateway.
// Every API route except sign-up and log-in needs a signed-in user; gateway settings and
// user management need an administrator. Runs as a plain Node server (npm start) or as one
// serverless function (api/index.mjs imports `handler`).

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

import { PLATFORMS } from './src/platforms.mjs';
import { FRAMEWORKS, FRAMEWORK_GROUPS } from './src/frameworks.mjs';
import { PROVIDERS, getProvider } from './src/gateway/providers.mjs';
import { STYLES, STYLE_GROUPS, MAX_STYLES } from './src/styles.mjs';
import { publicPresets, hostSetting, normalizeCast, onFrame, MAX_HOST_LOOK } from './src/cast.mjs';
import { suggestStyles, buildStylePrompts, parseStylePick } from './src/suggest.mjs';
import { IMAGE_MODES, SHOT_LABELS, MAX_IMAGES, planShots } from './src/shots.mjs';
import { ASPECTS } from './src/aspects.mjs';
import { loadStore, loadConfig, saveStore, mergeConfig, publicStore, validateConfig, enabledModels, mediaTarget } from './src/gateway/config.mjs';
import { fetchPriceList } from './src/gateway/prices.mjs';
import { streamChat, completeChat, listModels, endpointOf, request, cutShort, GatewayError } from './src/gateway/client.mjs';
import { generateImage, createVideo, videoStatus, videoContent, clipSeconds } from './src/gateway/media.mjs';
import { listHistory, getHistory, addHistory, newHistoryId, saveMedia, linkMedia, serveMedia, mediaOwner, readMedia, deleteUserHistory, transferHistory } from './src/store.mjs';
import { buildPackage } from './src/package.mjs';
import { postFormat, publicFormat, buildPostPrompts, parsePost, postFromScript, normalizePost } from './src/post.mjs';
import { loadSpeech, saveSpeech, mergeSpeech, validateSpeech, publicSpeech, getSpeechProvider, voiceScene, synthesize, wavOf } from './src/speech.mjs';
import * as publishing from './src/publish.mjs';
import * as youtube from './src/youtube.mjs';
import { buildPlan, planSummary, buildPrompts, parseScript, settleScript, buildVisualPrompt, buildHostPrompt, showsHost, buildNarrationPrompts, parseNarration, buildRefinePrompts, parseRefined, REFINE_PRESETS } from './src/prompt.mjs';
import { PACE, MIN_DURATION, MAX_DURATION, normalizeNarration, lockNarration } from './src/narration.mjs';
import { writeNarration, reviseNarration, checkNarration, AGENT_STEPS } from './src/agent/narrator.mjs';
import { normalizeCard } from './src/agent/card.mjs';
import { SKILLS, publicSkill } from './src/agent/skills.mjs';
import { errorBody, causeLine } from './src/errors.mjs';
import { workBudgetMs, outOfTime, MAX_PARTS } from './src/limits.mjs';
import { db, storage } from './src/db.mjs';
import { AuthError, authenticate, checkLogin, createUser, startSession, endSession, endAllSessions, ensureAdmin, publicUser, signupOpen, verifyPassword, setPassword, updateProfile, countSessions, activeAdmins, deleteUser } from './src/auth.mjs';
import { recordUsage, logActivity, summarizeUsage, listActivity, estimateTokens } from './src/audit.mjs';
import { SITE_TOKEN, configuredSiteUrl, requestSiteUrl, stamp } from './src/site.mjs';
import { trackVisit, markSignup, markLogin, markFirstScript, summarizeVisitors } from './src/visitors.mjs';
import { listAssets, addAsset, addTextAsset, addPart, takeParts, updateAsset, deleteAsset, deleteUserAssets, ownedAsset, materialsFor, assetBytes, assetFileOwner, isAssetFile, keepInLibrary, maxAssetBytes, maxDocumentBytes, maxBodyBytes, partBytes, MAX_ASSETS, ASSET_EXTENSIONS, ASSET_KINDS } from './src/assets.mjs';
import { MAX_MATERIALS } from './src/materials.mjs';
import { describePicture, readScan, lookLimit } from './src/vision.mjs';
import { chatRoutes } from './src/chat/routes.mjs';
import { isChatFile, chatFileOwner, deleteUserChats } from './src/chat/store.mjs';
import { deleteUserSkills } from './src/chat/skills.mjs';
import { webRoutes, briefWeb } from './src/web/routes.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = Number(process.env.PORT) || 3789;
const HOST = process.env.HOST || '127.0.0.1';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
// Text files that may carry the site-address token (see src/site.mjs).
const STAMPED = new Set(['.html', '.xml', '.txt']);

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
};

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(c);
  }
  if (!chunks.length) {
    // Some serverless runtimes read the body before the handler runs and hand it over already parsed.
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON body'), { status: 400 });
  }
}

/** The body of an upload as it was sent, up to `max` bytes. */
async function readBytes(req, max) {
  const tooLarge = () => Object.assign(new Error(`The file is larger than ${Math.round(max / 1048576)} MB`), { status: 413 });
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > max) throw tooLarge();
    chunks.push(c);
  }
  // Some serverless runtimes read the body before the handler runs and hand it over as a buffer.
  if (!chunks.length && Buffer.isBuffer(req.body)) {
    if (req.body.length > max) throw tooLarge();
    return req.body;
  }
  return Buffer.concat(chunks);
}

/** A header that carries text the browser had to encode (a file name in any language). */
function headerText(req, name) {
  const raw = String(req.headers[name] || '');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// Reject cross-site requests: another web page must not be able to act with a visitor's session.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === (req.headers['x-forwarded-host'] || req.headers.host);
  } catch {
    return false;
  }
}

const isAdmin = (user) => user?.role === 'admin';
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

// Test API (LLM settings): how much of a prompt is sent and how much of the reply is shown.
const TEST_PROMPT_MAX = 2000;
const TEST_REPLY_MAX = 4000;
const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

/**
 * What a route answers a failure with: the message and whose end it is on (src/errors.mjs). A failure with
 * a cause is also written to the server log; one without is the user's own (no topic, a wrong password).
 */
function failure(req, err, message = err.message) {
  const body = errorBody(err, message);
  if (body.cause && !process.env.NODE_TEST_CONTEXT) console.warn(`[error] ${req.method} ${req.url.split('?')[0]} ${causeLine(body.cause)}: ${message}`);
  if (body.cause?.code === 'bug') console.error(err);
  return body;
}

const storeView = (store, user) => publicStore(store, { admin: isAdmin(user) });

/** Unsaved form values merged over the saved gateway they belong to, if any. */
async function draftConfig(body) {
  const store = await loadStore();
  return mergeConfig(body, store.profiles.find((p) => p.id === body.id));
}

/**
 * The page a YouTube sign-in ends on. It was opened in its own small window, which closes itself; opened
 * any other way, it goes back to the app.
 */
function youtubePage(res, ok, message) {
  const text = String(message).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>YouTube</title></head><body style="font:16px/1.5 system-ui,sans-serif;padding:48px 24px;text-align:center;color-scheme:light dark"><p>${text}</p><p style="opacity:.65">${ok ? 'This window closes by itself. 此窗口会自动关闭。' : 'Close this window and try again. 请关闭此窗口后重试。'}</p><script>setTimeout(function(){ if (window.opener) window.close(); else location.replace('/app.html'); }, ${ok ? 700 : 6000});</script></body></html>`);
}

/** A script the user may touch: their own (administrators may open anyone's). Throws 404 otherwise. */
async function ownedHistory(user, id) {
  const entry = id ? await getHistory(id) : null;
  if (!entry || (entry.userId !== user.id && !isAdmin(user))) throw fail('That script is no longer in the history', 404);
  return entry;
}

/**
 * Save a generated file and answer with its local URL. A provider-hosted URL is downloaded first;
 * if that fails the provider's URL is passed through so the result is still shown.
 */
async function keep({ historyId, sceneId }, kind, source, { demo = false, link = true, userId } = {}) {
  let remote = '';
  try {
    if (typeof source === 'string' && /^https?:/.test(source)) {
      remote = source;
      source = await request(source, { signal: AbortSignal.timeout(300_000) });
    }
    const saved = await saveMedia({ historyId, sceneId, kind, source, demo, link, userId });
    if (saved) return { ...saved, saved: true };
  } catch (err) {
    console.warn(`[media] could not save the ${kind}: ${err.message}`);
  }
  return { url: remote || (typeof source === 'string' ? source : ''), saved: false };
}

/**
 * The saved portraits of the hosts a scene shows, as reference pictures for its image: [{ id, bytes, type }].
 * Only a script in the history has portraits, and only a real picture counts (not the demo placeholder).
 */
async function hostPortraits(entry, scene) {
  if (!entry) return [];
  const ids = normalizeCast(scene.cast).filter((c) => c.look).map((c) => c.id);
  const found = [];
  for (const id of onFrame(scene.host, ids)) {
    const stored = /^\/media\/([\w-]+\.(png|jpg|webp))$/.exec(entry.media?.[`host${id}`]?.image?.url || '');
    const bytes = stored && (await readMedia(stored[1]).catch(() => null));
    if (bytes) found.push({ id, bytes, type: `image/${stored[2] === 'jpg' ? 'jpeg' : stored[2]}` });
  }
  return found;
}

/**
 * A brief with the files it names from the creator's library (`assetIds`) looked up: they ride along as
 * `materials`, which is what the prompts read (src/materials.mjs). Only the user's own files are found.
 */
async function withMaterials(user, brief) {
  const { materials: _, web: _web, ...rest } = brief;
  const found = await materialsFor(user.id, brief.assetIds);
  return found.length ? { ...rest, materials: found } : rest;
}

/**
 * The plan of a brief again, with what the web says about it (src/web/routes.mjs): the links in the brief and
 * in its documents are read, and its topic is searched for when the brief asks. `sourced` is the brief as
 * withMaterials left it. The plan comes back as it was when the brief has no links and asks for no search.
 * With `send` the page hears what is being read; `cachedOnly` uses what was read before and asks nobody.
 */
async function withWeb(req, user, sourced, plan, opts) {
  const web = await briefWeb(req, user, sourced, opts);
  return web ? buildPlan({ ...sourced, web }) : plan;
}

/** Put a picture or a clip from the library into a scene of a script, as that scene's image or clip. */
async function placeAsset(user, { historyId, sceneId }, asset) {
  if (asset.kind !== 'image' && asset.kind !== 'video') throw fail('Only a picture or a clip can be placed in a scene');
  const { bytes, type } = await assetBytes(asset);
  const saved = await saveMedia({ historyId, sceneId, kind: asset.kind, source: new Response(bytes, { headers: { 'content-type': type } }), link: false, userId: user.id });
  if (!saved) throw fail('This file cannot be used in a scene');
  const media = { url: saved.url, urls: [saved.url], shots: ['library'] };
  await linkMedia({ historyId, sceneId, kind: asset.kind, urls: media.urls, shots: media.shots });
  return { kind: asset.kind, ...media };
}

/**
 * A new script whose scenes name the creator's own pictures and clips gets them placed straight away:
 * the scene shows the real thing, and nothing has to be generated for it. Returns the entry as it is then.
 */
async function placeSceneAssets(user, entry) {
  const scenes = entry.script.scenes.filter((sc) => sc.asset?.id);
  for (const sc of scenes) {
    try {
      await placeAsset(user, { historyId: entry.id, sceneId: sc.id }, await ownedAsset(user.id, sc.asset.id));
    } catch (err) {
      console.warn(`[library] could not place "${sc.asset.name}" in scene ${sc.id}: ${err.message}`);
    }
  }
  return scenes.length ? (await getHistory(entry.id)) || entry : entry;
}

const HEARTBEAT_MS = Number(process.env.STREAM_HEARTBEAT_MS) || 15_000; // how often a quiet event stream says it is still there (the tests make it short)

/**
 * Start a Server-Sent Events reply: `send(event, data)` writes one event. `signal` fires when the browser goes
 * away (an AbortError), and when the time the host gives one request is nearly up (a TimeoutError, see
 * src/limits.mjs): whatever is running then stops while there is still time to tell the page what happened.
 */
function eventStream(req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  const abort = new AbortController();
  const budget = workBudgetMs();
  const timer = budget ? setTimeout(() => abort.abort(outOfTime()), Math.max(0, (req.started || Date.now()) + budget - Date.now())) : null;
  // A model may think for minutes before it writes a word, and a proxy on the way to the browser drops a
  // connection that carries nothing for that long. A comment line every so often keeps it open; the page skips it.
  const beat = setInterval(() => res.write(': waiting\n\n'), HEARTBEAT_MS);
  res.on('close', () => {
    clearTimeout(timer);
    clearInterval(beat);
    abort.abort();
  });
  return { send: (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`), signal: abort.signal };
}

// The least a request must have added to a script for the rest to be worth asking for in another one.
const HANDOVER_MIN = 16;

/** What an earlier request wrote of the reply this one is to finish: { text, part }. `part` counts requests, from 1. */
function resumeOf(input) {
  const text = typeof input?.text === 'string' ? input.text : '';
  if (!text) return { text: '', part: 1 };
  const part = Math.max(2, Math.floor(Number(input.part)) || 2);
  if (part > MAX_PARTS) throw fail(`This script was carried over ${MAX_PARTS} times and is still not finished. Start it again.`);
  return { text, part };
}

// A review takes a second, narrower pass when measured errors are left, but only while the request is still young:
// a model that reasons for minutes per call must not push one request past a serverless host's time limit.
const REVIEW_SECOND_PASS_MS = 100_000;

// Each route says who may call it: 'public', 'user' (signed in) or 'admin'.
const route = (access, run) => ({ access, run });

const routes = {
  // ---------- Accounts ----------

  'GET /api/auth/me': route('public', async (req, res, user) => {
    json(res, 200, { user: publicUser(user), signupOpen: signupOpen(), storage: isAdmin(user) ? storage : undefined });
  }),

  'POST /api/auth/signup': route('public', async (req, res) => {
    if (!signupOpen()) throw fail('Sign-up is closed. Ask the administrator for an account.', 403);
    const body = await readJson(req);
    const user = await createUser({ email: body.email, password: body.password, name: body.name });
    await logActivity(req, user, 'auth.signup');
    const visitor = await markSignup(req, user);
    json(res, 200, { user: publicUser(user) }, { 'set-cookie': [await startSession(req, user), visitor].filter(Boolean) });
  }),

  'POST /api/auth/login': route('public', async (req, res) => {
    const body = await readJson(req);
    try {
      const user = await checkLogin(body.email, body.password);
      await logActivity(req, user, 'auth.login');
      await markLogin(req, user);
      json(res, 200, { user: publicUser(user) }, { 'set-cookie': await startSession(req, user) });
    } catch (err) {
      if (err instanceof AuthError) await logActivity(req, null, 'auth.login_failed', { email: String(body.email || '').slice(0, 254), reason: err.message });
      throw err;
    }
  }),

  'POST /api/auth/logout': route('public', async (req, res, user) => {
    if (user) await logActivity(req, user, 'auth.logout');
    json(res, 200, { ok: true }, { 'set-cookie': await endSession(req) });
  }),

  // Change your own display name.
  'POST /api/auth/profile': route('user', async (req, res, user) => {
    const { name } = await readJson(req);
    const next = await updateProfile(user.id, { name });
    await logActivity(req, next, 'auth.profile_update');
    json(res, 200, { user: publicUser(next) });
  }),

  // Remember a choice on the user's account, so it follows them to any browser.
  'POST /api/auth/prefs': route('user', async (req, res, user) => {
    const { autoImages } = await readJson(req);
    const next = await db.update('users', user.id, (u) => {
      if (typeof autoImages === 'boolean') u.prefs = { ...u.prefs, autoImages };
    });
    json(res, 200, { prefs: next.prefs || {} });
  }),

  // Change your own password. Every other session of yours ends; this one is renewed.
  'POST /api/auth/password': route('user', async (req, res, user) => {
    const { current, password } = await readJson(req);
    if (!(await verifyPassword(String(current || ''), user.passwordHash))) throw fail('The current password is wrong');
    const next = await setPassword(user.id, password);
    await logActivity(req, next, 'auth.password_change');
    json(res, 200, { ok: true }, { 'set-cookie': await startSession(req, next) });
  }),

  // ---------- Usage and activity ----------

  // scope=all (administrators only) covers every user; otherwise the caller's own.
  'GET /api/usage': route('user', async (req, res, user, query) => {
    const all = query.get('scope') === 'all' && isAdmin(user);
    json(res, 200, { scope: all ? 'all' : 'me', ...(await summarizeUsage({ userId: all ? undefined : user.id, days: Number(query.get('days') ?? 30), costs: isAdmin(user) })) });
  }),

  'GET /api/activity': route('user', async (req, res, user, query) => {
    const all = query.get('scope') === 'all' && isAdmin(user);
    json(res, 200, { scope: all ? 'all' : 'me', items: await listActivity({ userId: all ? undefined : user.id, limit: query.get('limit') }) });
  }),

  // ---------- Visitors ----------

  // The beacon on the home pages and the app (public/track.js): a page view or a click on a button to the app.
  'POST /api/track': route('public', async (req, res, user) => {
    const cookie = await trackVisit(req, await readJson(req), user);
    json(res, 200, { ok: true }, cookie ? { 'set-cookie': cookie } : {});
  }),

  // The sign-up funnel for visitors first seen in the last `days` (0 = all time).
  'GET /api/admin/visitors': route('admin', async (req, res, user, query) => {
    json(res, 200, await summarizeVisitors({ days: Number(query.get('days') ?? 30) }));
  }),

  // ---------- Administration ----------

  'GET /api/admin/users': route('admin', async (req, res) => {
    const usage = new Map((await summarizeUsage({ days: 0 })).byUser.map((u) => [u.key, u]));
    const scripts = new Map();
    for (const e of await db.list('history')) scripts.set(e.userId, (scripts.get(e.userId) || 0) + 1);
    const sessions = new Map();
    for (const x of await db.list('sessions')) if (x.expires > Date.now()) sessions.set(x.userId, (sessions.get(x.userId) || 0) + 1);
    json(res, 200, { users: (await db.list('users')).map((u) => ({ ...publicUser(u), scripts: scripts.get(u.id) || 0, sessions: sessions.get(u.id) || 0, usage: usage.get(u.id) || null })) });
  }),

  // One user in full: profile, sessions, all-time usage and their latest activity.
  'GET /api/admin/users/detail': route('admin', async (req, res, user, query) => {
    const target = await db.get('users', query.get('id') || '');
    if (!target) throw fail('That user no longer exists', 404);
    const usage = await summarizeUsage({ userId: target.id, days: 0 });
    json(res, 200, {
      user: publicUser(target),
      sessions: await countSessions(target.id),
      scripts: (await listHistory(target.id)).length,
      usage: { total: usage.total, byKind: usage.byKind },
      activity: await listActivity({ userId: target.id, limit: 15 }),
    });
  }),

  'POST /api/admin/users/create': route('admin', async (req, res, user) => {
    const { email, password, name, role } = await readJson(req);
    const created = await createUser({ email, password, name, role });
    await logActivity(req, user, 'admin.user_create', { target: created.email, role: created.role });
    json(res, 200, { user: publicUser(created) });
  }),

  // Change name, email, role or status. The app always keeps at least one active administrator.
  'POST /api/admin/users/update': route('admin', async (req, res, user) => {
    const { id, name, email, role, disabled } = await readJson(req);
    const before = await db.get('users', String(id || ''));
    if (!before) throw fail('That user no longer exists', 404);
    const demotes = (role === 'user' && before.role === 'admin') || (disabled === true && !before.disabled);
    if (demotes && before.id === user.id) throw fail('You cannot change your own role or disable your own account');
    if (demotes && before.role === 'admin' && !before.disabled && (await activeAdmins()).length < 2) throw fail('There must be at least one active administrator');
    if (name !== undefined || email !== undefined) await updateProfile(before.id, { name, email });
    const target = await db.update('users', before.id, (u) => {
      if (role === 'admin' || role === 'user') u.role = role;
      if (typeof disabled === 'boolean') u.disabled = disabled;
    });
    if (target.disabled) await endAllSessions(target.id);
    await logActivity(req, user, 'admin.user_update', { target: target.email, role: target.role, disabled: Boolean(target.disabled), ...(before.email !== target.email && { was: before.email }) });
    json(res, 200, { user: publicUser(target) });
  }),

  // Set a new password for someone who lost theirs. They are logged out everywhere.
  'POST /api/admin/users/password': route('admin', async (req, res, user) => {
    const { id, password } = await readJson(req);
    const target = await setPassword(String(id || ''), password);
    if (!target) throw fail('That user no longer exists', 404);
    await logActivity(req, user, 'admin.user_password', { target: target.email });
    // The administrator's own session ended with the rest: renew it.
    json(res, 200, { ok: true }, target.id === user.id ? { 'set-cookie': await startSession(req, target) } : {});
  }),

  // End every session of a user (a lost device, a shared computer).
  'POST /api/admin/users/logout': route('admin', async (req, res, user) => {
    const target = await db.get('users', String((await readJson(req)).id || ''));
    if (!target) throw fail('That user no longer exists', 404);
    await endAllSessions(target.id);
    await logActivity(req, user, 'admin.user_logout', { target: target.email });
    json(res, 200, { ok: true }, target.id === user.id ? { 'set-cookie': await startSession(req, target) } : {});
  }),

  // Delete an account. `scripts: "transfer"` moves their scripts and media to the administrator;
  // anything else deletes them. Usage and activity records are kept as the audit trail.
  'POST /api/admin/users/delete': route('admin', async (req, res, user) => {
    const { id, scripts } = await readJson(req);
    const target = await db.get('users', String(id || ''));
    if (!target) throw fail('That user no longer exists', 404);
    if (target.id === user.id) throw fail('You cannot delete your own account');
    const moved = scripts === 'transfer';
    const count = moved ? await transferHistory(target.id, user.id) : await deleteUserHistory(target.id);
    const files = await deleteUserAssets(target.id); // the library is theirs alone: it goes with the account
    await deleteUserChats(target.id); // and so do their conversations and the skills they wrote
    await deleteUserSkills(target.id);
    await deleteUser(target.id);
    await logActivity(req, user, 'admin.user_delete', { target: target.email, scripts: count, kept: moved, files });
    json(res, 200, { ok: true, scripts: count, transferred: moved });
  }),

  // ---------- Reference data and gateways ----------

  'GET /api/meta': route('user', async (req, res) => {
    json(res, 200, {
      platforms: PLATFORMS.map(({ id, name, nameEn, lang, defaultDuration, durations, banned = [] }) => ({ id, name, nameEn, lang, defaultDuration, durations, banned, post: publicFormat(postFormat(id)) })),
      frameworkGroups: FRAMEWORK_GROUPS,
      frameworks: FRAMEWORKS.map(({ id, group = 'general', name, blurb, topics, needsReference = false, pace, length, board = false, speakers = 1, hosted = false }) => ({ id, group, name, blurb, topics, needsReference, pace, length, board, speakers, hosted })),
      pace: PACE,
      duration: { min: MIN_DURATION, max: MAX_DURATION },
      refinePresets: REFINE_PRESETS,
      skills: SKILLS.map(publicSkill),
      agentSteps: AGENT_STEPS,
      providers: PROVIDERS,
      styleGroups: STYLE_GROUPS,
      styles: STYLES.map(({ id, group, name, blurb }) => ({ id, group, name, blurb })),
      maxStyles: MAX_STYLES,
      hostPresets: publicPresets(),
      maxHostLook: MAX_HOST_LOOK,
      imageModes: IMAGE_MODES,
      shotLabels: SHOT_LABELS,
      maxImages: MAX_IMAGES,
      aspects: ASPECTS.map(({ id, w, h, name }) => ({ id, w, h, name })),
      library: { maxBytes: maxAssetBytes(), maxDocumentBytes: maxDocumentBytes(), bodyBytes: maxBodyBytes(), partBytes: partBytes(), maxFiles: MAX_ASSETS, maxPerBrief: MAX_MATERIALS, extensions: ASSET_EXTENSIONS, kinds: ASSET_KINDS },
    });
  }),

  // The saved gateways. Administrators see them all, with addresses and masked keys; everyone else only the name and model in use.
  'GET /api/gateway/config': route('user', async (req, res, user) => {
    json(res, 200, storeView(await loadStore(), user));
  }),

  // Create a gateway (no id) or update one (id). `activate: true` also puts it in use for everyone.
  'PUT /api/gateway/config': route('admin', async (req, res, user) => {
    const body = await readJson(req);
    const store = await loadStore();
    const index = body.id ? store.profiles.findIndex((p) => p.id === body.id) : -1;
    if (body.id && index < 0) return json(res, 404, { error: 'That gateway no longer exists' });
    const config = mergeConfig(body, store.profiles[index]);
    const invalid = validateConfig(config);
    if (invalid) return json(res, 400, { error: invalid });
    if (index < 0) store.profiles.push({ ...config, id: randomUUID().slice(0, 8) });
    else store.profiles[index] = config;
    const saved = store.profiles[index < 0 ? store.profiles.length - 1 : index];
    if (body.activate) store.activeId = saved.id;
    await saveStore(store);
    await logActivity(req, user, index < 0 ? 'gateway.create' : 'gateway.update', { gateway: saved.name, model: saved.model, default: Boolean(body.activate) });
    json(res, 200, { ...storeView(store, user), savedId: saved.id });
  }),

  // The administrator picks the gateway and model that everyone writes with.
  'POST /api/gateway/select': route('admin', async (req, res, user) => {
    const { id, model } = await readJson(req);
    const store = await loadStore();
    const profile = store.profiles.find((p) => p.id === id);
    if (!profile) return json(res, 404, { error: 'That gateway no longer exists' });
    if (model && !enabledModels(profile).includes(model)) return json(res, 400, { error: `Model "${model}" is not enabled for ${profile.name}` });
    if (model && model !== profile.model) Object.assign(profile, { models: enabledModels(profile), model }); // the old default stays in the picker
    store.activeId = profile.id;
    await saveStore(store);
    await logActivity(req, user, 'gateway.select', { gateway: profile.name, model: profile.model });
    json(res, 200, storeView(store, user));
  }),

  'POST /api/gateway/delete': route('admin', async (req, res, user) => {
    const { id } = await readJson(req);
    const store = await loadStore();
    const gone = store.profiles.find((p) => p.id === id);
    store.profiles = store.profiles.filter((p) => p.id !== id);
    if (store.activeId === id) store.activeId = store.profiles[0]?.id;
    await saveStore(store);
    if (gone) await logActivity(req, user, 'gateway.delete', { gateway: gone.name });
    json(res, 200, storeView(await loadStore(), user)); // reload: an empty list falls back to the env/demo gateway
  }),

  // Tests the form values in the request body without saving; `id` lets a blank key fall back to the saved one.
  // With no `prompt` it is a connectivity check. With one (Test API) the prompt is sent as it is and the
  // model's reply comes back, with how long it took and what it cost: an empty reply counts as a failure.
  // A failure carries `endpoint`: the address called, its HTTP status and the body it answered with, as sent.
  // A success carries `via`: the address that answered, which for a Gemini model on a gateway is its Gemini door.
  'POST /api/gateway/test': route('admin', async (req, res, user) => {
    const body = await readJson(req);
    const config = await draftConfig(body);
    const asked = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, TEST_PROMPT_MAX) : '';
    const started = Date.now();
    const prompts = asked ? { system: 'You are a helpful assistant. Answer briefly.', user: asked } : { system: 'You are a connectivity check.', user: 'Reply with the single word OK.' };
    const seconds = 60; // a model that thinks first can take half a minute over one word
    let usage = null;
    try {
      const reply = (await completeChat(config, { ...prompts, maxTokens: asked ? 1024 : 256, signal: AbortSignal.timeout(seconds * 1000), onUsage: (u) => (usage = u) })).trim();
      if (asked && !reply) throw Object.assign(new GatewayError('The model answered with an empty reply', 502), { host: hostOf(config.baseUrl) });
      const spent = tokens(usage, prompts, reply);
      const used = await recordUsage({ user, kind: 'test', config, ...spent, ms: Date.now() - started });
      const shownReply = reply.slice(0, asked ? TEST_REPLY_MAX : 120);
      const via = (await endpointOf(config).catch(() => null))?.url;
      json(res, 200, { ok: true, ms: Date.now() - started, model: config.model, reply: shownReply, ...(via && { via }), ...(asked && { ...spent, truncated: shownReply.length < reply.length, ...(used.priced && { cost: used.cost, currency: used.currency }) }) });
    } catch (err) {
      const error = err.name === 'TimeoutError' ? `Timed out after ${seconds}s` : err.message;
      await recordUsage({ user, kind: 'test', config, ok: false, error, ms: Date.now() - started });
      json(res, 200, { ok: false, ms: Date.now() - started, ...failure(req, err, error), ...(err.endpoint && { endpoint: err.endpoint }) }); // what the endpoint itself said, unedited
    }
  }),

  // The provider's own published prices for the address in the form, by key group, when it has a list this
  // app can read. No key is sent: the list is public.
  'POST /api/gateway/prices': route('admin', async (req, res) => {
    const body = await readJson(req);
    try {
      json(res, 200, { ok: true, ...(await fetchPriceList(body.baseUrl, { signal: AbortSignal.timeout(20_000) })) });
    } catch (err) {
      json(res, 200, { ok: false, error: err.name === 'TimeoutError' ? 'Timed out after 20s' : err.message });
    }
  }),

  // Lists the models the provider offers for the form values in the request body (unsaved).
  'POST /api/gateway/models': route('admin', async (req, res) => {
    const body = await readJson(req);
    let config = await draftConfig(body);
    if (body.kind === 'image' || body.kind === 'video') {
      // Ask at the image / video address, with the key that kind would use.
      const t = mediaTarget(config, body.kind);
      if (t.demo) return json(res, 200, { ok: false, error: `Demo mode has no ${body.kind} models. Set a BASE_URL_API for ${body.kind}s first.` });
      const openai = config[body.kind].baseUrl || PROVIDERS.find((p) => p.id === config.provider)?.protocol === 'openai';
      if (!openai) return json(res, 200, { ok: false, error: `Set a ${body.kind} BASE_URL_API first: this gateway's provider has no ${body.kind} models.` });
      config = { provider: 'custom', baseUrl: t.baseUrl, apiKey: t.apiKey, model: '' };
    }
    try {
      json(res, 200, { ok: true, models: await listModels(config, { signal: AbortSignal.timeout(20_000) }) });
    } catch (err) {
      json(res, 200, { ok: false, ...failure(req, err, err.name === 'TimeoutError' ? 'Timed out after 20s' : err.message) });
    }
  }),

  // ---------- The asset library (素材库) ----------

  // Each user has a library of their own: every route here works on the files of the signed-in user and no one else's.
  // The signed-in user's files, newest first. A document comes with how it starts, never its whole text.
  'GET /api/assets': route('user', async (req, res, user) => {
    json(res, 200, { items: await listAssets(user.id) });
  }),

  // Upload one file: the body is the file itself, its name rides in the x-file-name header (URI-encoded).
  // A file too large for one request was sent in parts first (below): then the body is empty, and the
  // x-upload-id and x-parts headers say which parts make it up.
  // With a JSON body instead ({ name, text, note }) it adds text that was pasted or written.
  'POST /api/assets': route('user', async (req, res, user) => {
    let added;
    if (/^application\/json/.test(req.headers['content-type'] || '')) {
      const { name, text, note } = await readJson(req);
      added = await addTextAsset({ userId: user.id, name, text, note });
    } else {
      const upload = req.headers['x-upload-id'];
      const bytes = upload ? await takeParts({ userId: user.id, upload, count: Number(req.headers['x-parts']) }) : await readBytes(req, maxBodyBytes());
      // A scanned PDF has no text of its own: the model in use reads its pages, when there is one.
      const config = await loadConfig();
      const until = Date.now() + (workBudgetMs() || 15 * 60_000) - 10_000;
      const scan = validateConfig(config) ? null : ({ pictures, name }) => readScan({ config, pictures, name, until, onCall: usageRecorder(user, config, 'read') });
      added = await addAsset({ userId: user.id, name: headerText(req, 'x-file-name'), bytes, readScan: scan, lookBytes: lookLimit(config) });
    }
    await logActivity(req, user, 'asset.add', { file: added.name, kind: added.kind, size: added.size, ...(added.scanned && { scanned: true, pages: added.pages }) });
    json(res, 200, { asset: added });
  }),

  // One part of a file that is too large for a single request: the body is the part, x-upload-id names the
  // upload (the page makes it up) and x-part is the part's place, from 0.
  'POST /api/assets/part': route('user', async (req, res, user) => {
    await addPart({ userId: user.id, upload: req.headers['x-upload-id'], n: Number(req.headers['x-part']), bytes: await readBytes(req, partBytes()) });
    json(res, 200, { ok: true });
  }),

  // The whole text of a document, to read it before using it.
  'GET /api/assets/text': route('user', async (req, res, user, query) => {
    const asset = await ownedAsset(user.id, query.get('id'));
    if (asset.kind !== 'document') throw fail('This file has no text');
    json(res, 200, { id: asset.id, name: asset.name, text: asset.text, cut: Boolean(asset.cut), partial: Boolean(asset.partial), scanned: Boolean(asset.scanned) });
  }),

  // Have the model in use look at a picture and write its note: `{ id, lang?, preview? }`. `preview` is a small
  // copy of the picture as the page made it (a data: URI), which is what the model is shown; without one it is
  // shown the stored picture. The note is saved, and the file comes back with it.
  'POST /api/assets/describe': route('user', async (req, res, user) => {
    const { id, lang, preview } = await readJson(req);
    const asset = await ownedAsset(user.id, id);
    if (asset.kind !== 'image') throw fail('Only a picture can be described');
    const config = await loadConfig();
    const invalid = validateConfig(config);
    if (invalid) throw fail(invalid);
    const picture = previewPicture(preview) || (await assetBytes(asset));
    if (picture.bytes.length > lookLimit(config)) throw fail('This picture is too large for the model to look at');
    let note;
    try {
      note = await describePicture({ config, picture, name: asset.name, lang: lang === 'zh' ? 'zh' : 'en', signal: AbortSignal.timeout(90_000), onCall: usageRecorder(user, config, 'read') });
    } catch (err) {
      return json(res, 502, failure(req, err, err.name === 'TimeoutError' ? 'Timed out after 90s' : err.message));
    }
    const next = await updateAsset(user.id, asset.id, { note });
    await logActivity(req, user, 'asset.describe', { file: asset.name, model: config.model || config.name });
    json(res, 200, { asset: next });
  }),

  // Rename a file or change its note (what the scriptwriter is told about a picture it cannot see).
  'POST /api/assets/update': route('user', async (req, res, user) => {
    const { id, name, note } = await readJson(req);
    json(res, 200, { asset: await updateAsset(user.id, id, { name, note }) });
  }),

  // Scripts that already used the file keep their own copy of it.
  'POST /api/assets/delete': route('user', async (req, res, user) => {
    const { id } = await readJson(req);
    const asset = await ownedAsset(user.id, id);
    await deleteAsset(user.id, asset.id);
    await logActivity(req, user, 'asset.delete', { file: asset.name, kind: asset.kind });
    json(res, 200, { ok: true });
  }),

  // Save a generated image or clip (`url`, one of the user's own media files) to the library, for other scripts.
  'POST /api/assets/keep': route('user', async (req, res, user) => {
    const { url, name, note } = await readJson(req);
    const file = /^\/media\/([\w-]+\.\w+)$/.exec(String(url || ''))?.[1];
    if (!file || isAssetFile(file)) throw fail('That file cannot be saved to the library');
    const owner = mediaOwner(file);
    if (owner) await ownedHistory(user, owner);
    const bytes = await readMedia(file);
    if (!bytes) throw fail('That file is no longer stored', 404);
    const added = await keepInLibrary({ userId: user.id, file, bytes, name, note });
    await logActivity(req, user, 'asset.add', { file: added.name, kind: added.kind, size: added.size, from: 'script' });
    json(res, 200, { asset: added });
  }),

  // Use a picture or a clip from the library as a scene's image or clip, as it is. The script keeps its own copy.
  'POST /api/media/asset': route('user', async (req, res, user) => {
    const { historyId, sceneId, assetId } = await readJson(req);
    if (historyId) await ownedHistory(user, historyId);
    const asset = await ownedAsset(user.id, assetId);
    const placed = await placeAsset(user, { historyId, sceneId }, asset);
    await logActivity(req, user, 'asset.use', { taskId: historyId, scene: sceneId, file: asset.name, kind: asset.kind });
    json(res, 200, placed);
  }),

  // ---------- Scripts ----------

  // The signed-in user's scripts, newest first; generated media is linked from each entry.
  'GET /api/history': route('user', async (req, res, user) => {
    json(res, 200, await listHistory(user.id));
  }),

  // Import a script made elsewhere (older versions kept history in the browser).
  'POST /api/history': route('user', async (req, res, user) => {
    const { platformId, brief, plan, script, ts } = await readJson(req);
    json(res, 200, await addHistory({ userId: user.id, platformId, brief, plan, script, ts }));
  }),

  // One script with all its generated media, as a .zip. The page sends the Markdown it renders.
  'POST /api/history/package': route('user', async (req, res, user) => {
    const { id, markdown, lang } = await readJson(req);
    const entry = await ownedHistory(user, id);
    const pkg = await buildPackage(entry, { markdown, lang });
    await logActivity(req, user, 'script.download', { taskId: entry.id, title: entry.script.title, files: pkg.files.length });
    res.writeHead(200, {
      'content-type': 'application/zip',
      'content-length': pkg.buffer.length,
      'content-disposition': `attachment; filename="package.zip"; filename*=UTF-8''${encodeURIComponent(pkg.name)}`,
      'cache-control': 'no-store',
    });
    res.end(pkg.buffer);
  }),

  // ---------- Image posts (图文) ----------

  // Writes the image post of a script: cards and the note under them, for the platform the script was written
  // for (src/post.mjs). The post is kept on the script, replacing the one before it; the look the creator chose
  // (theme, size, footer) carries over. Demo mode drafts it from the script's own on-screen text, with no model.
  'POST /api/post/generate': route('user', async (req, res, user) => {
    const { historyId, instruction } = await readJson(req);
    const entry = await ownedHistory(user, historyId);
    const format = postFormat(entry.platformId);
    if (!format) throw fail('That platform has no image-post format');
    const config = await loadConfig();
    const demo = getProvider(config.provider)?.protocol === 'mock';
    const invalid = !demo && validateConfig(config);
    if (invalid) return json(res, 400, { error: `LLM gateway is not configured: ${invalid}` });
    const look = entry.post ? { theme: entry.post.theme, size: entry.post.size, footer: entry.post.footer } : {};
    const save = async (post, by) => {
      const saved = { ...normalizePost({ ...post, ...look }, format), ts: Date.now(), by };
      await db.update('history', entry.id, (e) => Object.assign(e, { post: saved }));
      await logActivity(req, user, 'post.write', { taskId: entry.id, title: entry.script.title, platform: entry.platformId, cards: saved.cards.length, model: by });
      json(res, 200, { post: saved });
    };
    if (demo) return save(postFromScript(entry, format), 'demo');

    const prompts = buildPostPrompts(entry, format, { instruction: String(instruction || '') });
    const started = Date.now();
    let raw = '';
    let usage = null;
    const record = (extra) => recordUsage({ user, taskId: entry.id, kind: 'post', config, ...tokens(usage, prompts, raw), ms: Date.now() - started, ...extra });
    try {
      raw = await completeChat(config, { ...prompts, signal: AbortSignal.timeout(280_000), onUsage: (u) => (usage = u) });
      const post = parsePost(raw, format);
      await record({});
      await save(post, config.model || config.name);
    } catch (err) {
      const error = err.name === 'TimeoutError' ? 'Timed out after 280s' : err instanceof GatewayError ? err.message : `The model's reply could not be read as an image post: ${err.message}`;
      await record({ ok: false, error });
      json(res, 502, failure(req, err, error));
    }
  }),

  // Keeps the creator's edits to a post: its text, its cards and how they look.
  'POST /api/post/save': route('user', async (req, res, user) => {
    const { historyId, post } = await readJson(req);
    const entry = await ownedHistory(user, historyId);
    const format = postFormat(entry.platformId);
    if (!format) throw fail('That platform has no image-post format');
    const saved = { ...normalizePost(post, format), ts: Date.now(), by: entry.post?.by || '' };
    await db.update('history', entry.id, (e) => Object.assign(e, { post: saved }));
    json(res, 200, { post: saved });
  }),

  // ---------- The voice of a video (src/speech.mjs) ----------

  // The voice provider in use. Everyone learns whether there is one and which voices it offers; an
  // administrator also sees its address and a masked key.
  'GET /api/speech/config': route('user', async (req, res, user) => {
    const demo = getProvider((await loadConfig()).provider)?.protocol === 'mock';
    json(res, 200, publicSpeech(await loadSpeech(), { admin: isAdmin(user), demo }));
  }),

  // Connect, change or (with an empty `provider`) disconnect the voice provider.
  'PUT /api/speech/config': route('admin', async (req, res, user) => {
    const merged = mergeSpeech(await readJson(req), await loadSpeech());
    const invalid = merged.provider && validateSpeech(merged);
    if (invalid) return json(res, 400, { error: invalid });
    await saveSpeech(merged);
    await logActivity(req, user, 'speech.update', { gateway: getSpeechProvider(merged.provider)?.label || 'off', model: merged.model });
    json(res, 200, publicSpeech(merged, { admin: true }));
  }),

  // Hear the settings in the form before saving them: one short sentence, as a WAV in a data: URI.
  'POST /api/speech/test': route('admin', async (req, res) => {
    const body = await readJson(req);
    const merged = mergeSpeech(body, await loadSpeech());
    const invalid = validateSpeech(merged);
    if (invalid) return json(res, 400, { error: invalid });
    const zh = body.lang !== 'en';
    try {
      const { pcm } = await synthesize(merged, { text: String(body.text || '').trim().slice(0, 80) || (zh ? '你好，这是这个声音的试听。' : 'Hello, this is how this voice sounds.'), voice: String(body.voice || '').trim() || merged.voice, lang: zh ? 'zh' : 'en', signal: AbortSignal.timeout(60_000) });
      json(res, 200, { seconds: pcm.length / 2 / 24000, audio: `data:audio/wav;base64,${wavOf(pcm).toString('base64')}` });
    } catch (err) {
      json(res, 502, failure(req, err, err.name === 'TimeoutError' ? 'Timed out after 60s' : err.message));
    }
  }),

  // Speaks one scene of a script and keeps the sound with the script. The page asks scene by scene, so a long
  // script never outlasts a request and a failed scene is asked again by itself. `done` marks the last one.
  // `text` is said in place of the scene's voiceover, for a line that has to be read differently than it is written.
  'POST /api/voice/scene': route('user', async (req, res, user) => {
    const { historyId, sceneId, voice, voiceB, speed, text, done } = await readJson(req);
    const entry = await ownedHistory(user, historyId);
    const scene = entry.script.scenes.find((sc) => String(sc.id) === String(sceneId));
    if (!scene) throw fail('That scene is not in the script', 404);
    const speech = await loadSpeech();
    const ready = !validateSpeech(speech);
    const demo = !ready && getProvider((await loadConfig()).provider)?.protocol === 'mock';
    if (!ready && !demo) throw fail('No voice provider is connected yet. An administrator connects one under Voice settings.');
    const lang = entry.plan?.lang || entry.plan?.brief?.lang || PLATFORMS.find((p) => p.id === entry.platformId)?.lang || 'zh';
    const voices = { A: String(voice || '').trim().slice(0, 120), B: String(voiceB || '').trim().slice(0, 120) };
    const pace = Math.min(1.6, Math.max(0.7, Number(speed) || 1));
    const say = String(text || '').trim().slice(0, 600); // how the creator wants this line read, where the script's own words come out wrong
    const model = demo ? 'demo' : speech.model;
    const about = { id: 'speech', name: demo ? 'Demo voice' : getSpeechProvider(speech.provider).label, provider: demo ? 'mock' : speech.provider };
    const started = Date.now();
    try {
      const made = await voiceScene(speech, say || scene.voiceover, { voices, speed: pace, lang, demo, signal: AbortSignal.timeout(120_000) });
      const name = `${entry.id}-s${String(scene.id).replace(/[^\w-]/g, '')}-voice-${Date.now().toString(36)}.wav`;
      await db.putBlob(name, { userId: entry.userId, type: 'audio/wav', bytes: made.wav });
      const seconds = Math.round(made.seconds * 1000) / 1000;
      await db.update('history', entry.id, (e) => {
        e.voice = { ...e.voice, provider: about.provider, voice: voices.A || speech.voice, voiceB: voices.B || speech.voiceB, speed: pace, ts: Date.now(), scenes: { ...e.voice?.scenes, [scene.id]: { name, seconds, ...(say && { say }) } } };
      });
      await recordUsage({ user, taskId: entry.id, kind: 'voice', config: about, model, ms: Date.now() - started });
      if (done) await logActivity(req, user, 'voice.generate', { taskId: entry.id, title: entry.script.title, model, seconds: Math.round(Object.values({ ...entry.voice?.scenes, [scene.id]: { seconds } }).reduce((n, v) => n + v.seconds, 0)) });
      json(res, 200, { sceneId: scene.id, url: `/api/voice/file?id=${entry.id}&name=${name}`, seconds, demo });
    } catch (err) {
      const error = err.name === 'TimeoutError' ? 'Timed out after 120s' : err.message;
      await recordUsage({ user, taskId: entry.id, kind: 'voice', config: about, model, ms: Date.now() - started, ok: false, error });
      json(res, 502, failure(req, err, error));
    }
  }),

  // The sound of one scene, for its owner.
  'GET /api/voice/file': route('user', async (req, res, user, query) => {
    const entry = await ownedHistory(user, query.get('id'));
    const name = String(query.get('name') || '');
    const blob = name.startsWith(`${entry.id}-s`) && /^[\w-]+-voice-\w+\.wav$/.test(name) ? await db.getBlob(name) : null;
    if (!blob) throw fail('That recording is no longer stored', 404);
    const bytes = await blob.bytes();
    res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': bytes.length, 'cache-control': 'private, max-age=31536000, immutable', vary: 'cookie', 'x-content-type-options': 'nosniff' });
    res.end(bytes);
  }),

  // ---------- Publishing through Postiz (src/publish.mjs) ----------

  // Whether the signed-in person has connected Postiz, and the channels their key reaches.
  'GET /api/publish/status': route('user', async (req, res, user) => {
    const conn = await publishing.connection(user.id);
    if (!conn) return json(res, 200, publishing.publicConnection(null));
    try {
      json(res, 200, { ...publishing.publicConnection(conn), channels: await publishing.listChannels(conn) });
    } catch (err) {
      json(res, 200, { ...publishing.publicConnection(conn), channels: [], error: err.message });
    }
  }),

  // Connect with `{ apiKey }` (kept only once Postiz has answered to it), or disconnect with `{ disconnect: true }`.
  'POST /api/publish/connect': route('user', async (req, res, user) => {
    const { apiKey, disconnect } = await readJson(req);
    if (disconnect) {
      await publishing.disconnect(user.id);
      await logActivity(req, user, 'publish.disconnect', {});
      return json(res, 200, publishing.publicConnection(null));
    }
    try {
      const channels = await publishing.connect(user.id, apiKey);
      await logActivity(req, user, 'publish.connect', { channels: channels.length });
      json(res, 200, { ...publishing.publicConnection(await publishing.connection(user.id)), channels });
    } catch (err) {
      json(res, err.status === 400 || err.status === 429 ? err.status : 502, failure(req, err));
    }
  }),

  // One piece of a file too large for a single request (a video): the body is the piece, x-upload-id names
  // the upload and x-part its place, from 0.
  'POST /api/publish/part': route('user', async (req, res, user) => {
    await publishing.addPart({ userId: user.id, upload: req.headers['x-upload-id'], n: Number(req.headers['x-part']), bytes: await readBytes(req, publishing.partBytes()) });
    json(res, 200, { ok: true });
  }),

  // Passes one file on to the person's Postiz media library: the body is the file, or `x-upload-id` and
  // `x-parts` name the pieces sent before. Answers `{ id, path }`, which a post is then made from.
  'POST /api/publish/media': route('user', async (req, res, user) => {
    const conn = await publishing.connection(user.id);
    if (!conn) throw fail('Connect Postiz first');
    const upload = req.headers['x-upload-id'];
    const bytes = upload ? await publishing.takeParts({ userId: user.id, upload, count: Number(req.headers['x-parts']) }) : await readBytes(req, publishing.partBytes() + 1024);
    if (bytes.length > publishing.MAX_MEDIA_BYTES) throw fail('The file is too large to publish', 413);
    try {
      json(res, 200, await publishing.uploadMedia(conn, { bytes, name: headerText(req, 'x-file-name') }));
    } catch (err) {
      json(res, err.status === 400 || err.status === 429 ? err.status : 502, failure(req, err));
    }
  }),

  // Makes the post: the image post or the video of a script, to the channels picked, now, at a time, or as a
  // draft in Postiz. What was sent is noted on the script.
  'POST /api/publish/post': route('user', async (req, res, user) => {
    const { historyId, kind, channelIds, when, text, title, hashtags, visibility, ai, media } = await readJson(req);
    const entry = await ownedHistory(user, historyId);
    const conn = await publishing.connection(user.id);
    if (!conn) throw fail('Connect Postiz first');
    try {
      const all = await publishing.listChannels(conn);
      const channels = all.filter((c) => !c.disabled && (Array.isArray(channelIds) ? channelIds : []).includes(c.id));
      const made = await publishing.createPost(conn, { when: String(when || 'now'), channels, text: String(text || '').slice(0, 8000), title: String(title || ''), hashtags: Array.isArray(hashtags) ? hashtags.map(String).slice(0, 30) : [], visibility, ai: Boolean(ai), kind: kind === 'video' ? 'video' : 'images', media: Array.isArray(media) ? media.slice(0, 40) : [] });
      const sent = { ts: Date.now(), kind: kind === 'video' ? 'video' : 'images', when: String(when || 'now'), channels: channels.map((c) => ({ name: c.name, identifier: c.identifier })), posts: made.map((m) => String(m.postId || m.id || '')).filter(Boolean) };
      await db.update('history', entry.id, (e) => Object.assign(e, { published: [...(e.published || []), sent].slice(-20) }));
      await logActivity(req, user, 'publish.post', { taskId: entry.id, title: entry.script.title, file: channels.map((c) => `${c.identifier}: ${c.name}`).join(', '), model: sent.when === 'now' ? 'now' : sent.when === 'draft' ? 'draft' : 'scheduled' });
      json(res, 200, { sent });
    } catch (err) {
      json(res, err.status === 400 || err.status === 429 ? err.status : 502, failure(req, err));
    }
  }),

  // ---------- YouTube, connected directly (src/youtube.mjs) ----------

  // Whether this deployment can sign people in to YouTube, and whether the signed-in person has. An
  // administrator also sees the OAuth client (its secret masked) and the address to register at Google.
  'GET /api/youtube/status': route('user', async (req, res, user) => {
    const admin = isAdmin(user);
    json(res, 200, { ...youtube.publicClient(await youtube.loadClient(), { admin }), ...(await youtube.connection(user.id)), partBytes: youtube.partBytes(), ...(admin && { redirectUri: `${requestSiteUrl(req)}/api/youtube/callback` }) });
  }),

  // The Google OAuth client everyone signs in through: `{ clientId, clientSecret }`, or an empty id to remove it.
  'PUT /api/youtube/config': route('admin', async (req, res, user) => {
    const client = await youtube.saveClient(await readJson(req));
    await logActivity(req, user, 'youtube.config', { gateway: client ? 'set' : 'removed' });
    json(res, 200, youtube.publicClient(client, { admin: true }));
  }),

  // Sends the person to Google to allow uploads to their channel. Google sends them back to the callback below.
  'GET /api/youtube/connect': route('user', async (req, res, user) => {
    const client = await youtube.loadClient();
    if (!client) return youtubePage(res, false, 'YouTube sign-in is not set up on this site yet.');
    res.writeHead(302, { location: await youtube.authUrl(client, { userId: user.id, redirectUri: `${requestSiteUrl(req)}/api/youtube/callback` }), 'cache-control': 'no-store' }).end();
  }),

  'GET /api/youtube/callback': route('user', async (req, res, user, query) => {
    if (query.get('error')) return youtubePage(res, false, query.get('error') === 'access_denied' ? 'YouTube was not connected: the request was declined.' : `YouTube was not connected: ${query.get('error')}`);
    try {
      const client = await youtube.loadClient();
      if (!client) throw fail('YouTube sign-in is not set up on this site yet.');
      await youtube.connectWithCode(client, { userId: user.id, code: query.get('code'), state: query.get('state') });
      await logActivity(req, user, 'youtube.connect', {});
      youtubePage(res, true, 'YouTube is connected.');
    } catch (err) {
      youtubePage(res, false, err.message);
    }
  }),

  'POST /api/youtube/disconnect': route('user', async (req, res, user) => {
    await youtube.disconnect(user.id);
    await logActivity(req, user, 'youtube.disconnect', {});
    json(res, 200, await youtube.connection(user.id));
  }),

  // Opens an upload at YouTube for the video of a script: `{ historyId, size, title, description, tags,
  // visibility, ai, publishAt? }`. Answers `{ uploadId, partBytes }`; the file then follows in pieces.
  'POST /api/youtube/upload': route('user', async (req, res, user) => {
    const { historyId, size, title, description, tags, visibility, ai, publishAt } = await readJson(req);
    await ownedHistory(user, historyId);
    const client = await youtube.loadClient();
    if (!client) throw fail('YouTube sign-in is not set up on this site yet.');
    try {
      json(res, 200, await youtube.startUpload(client, { userId: user.id, size, video: { title, description, tags: Array.isArray(tags) ? tags.slice(0, 40) : [], visibility, ai, publishAt } }));
    } catch (err) {
      json(res, err.status === 400 || err.status === 413 ? err.status : 502, failure(req, err));
    }
  }),

  // One piece of the video: the body is the piece, x-upload-id names the upload, x-offset says where the
  // piece starts and x-history-id which script it is the video of. The last piece answers with the video.
  'POST /api/youtube/part': route('user', async (req, res, user) => {
    const entry = await ownedHistory(user, req.headers['x-history-id']);
    try {
      const sent = await youtube.sendPart({ userId: user.id, uploadId: req.headers['x-upload-id'], offset: Number(req.headers['x-offset']), bytes: await readBytes(req, youtube.partBytes()) });
      if (sent.done) {
        const note = { ts: Date.now(), kind: 'video', when: 'now', channels: [{ name: sent.channel || 'YouTube', identifier: 'youtube' }], url: sent.url, direct: true };
        await db.update('history', entry.id, (e) => Object.assign(e, { published: [...(e.published || []), note].slice(-20) }));
        await logActivity(req, user, 'youtube.upload', { taskId: entry.id, title: entry.script.title, file: sent.url });
      }
      json(res, 200, sent);
    } catch (err) {
      json(res, [400, 404, 413].includes(err.status) ? err.status : 502, failure(req, err));
    }
  }),

  // Media for one scene, made with the image / video settings of the user's gateway,
  // then stored and linked from the script `historyId`. The scene carries the `aspectRatio` of its script.
  'POST /api/media/image': route('user', async (req, res, user) => {
    const scene = await readJson(req);
    const entry = scene.historyId ? await ownedHistory(user, scene.historyId) : null;
    if (entry?.script?.cast) scene.cast = entry.script.cast; // the saved script says who the hosts are
    const config = await loadConfig();
    const target = mediaTarget(config, 'image');
    // `count` (1-3) images, related to each other as `mode` says (see src/shots.mjs). Each image is its own
    // request, since many image models only return one, and each shot has its own prompt.
    const shots = planShots(scene.mode, scene.count, scene.styleIds);
    // A host in frame is drawn from their portrait when there is one, so it is the same face in every scene.
    const portraits = await hostPortraits(entry, scene);
    // `assetId`: a picture from the creator's library the image is drawn from, together with the scene as written.
    const asset = scene.assetId ? await ownedAsset(user.id, scene.assetId) : null;
    if (asset && asset.kind !== 'image') throw fail('Only a picture from the library can be drawn from');
    const picture = asset && (await assetBytes(asset));
    const about = asset ? { asset: { name: asset.name, note: asset.note } } : {};
    const prompts = shots.map((shot) => {
      const hosts = showsHost(shot) ? portraits : [];
      const references = picture ? [...hosts, picture] : hosts;
      // throws on a scene with no visual
      return { prompt: buildVisualPrompt(scene, 'image', scene.styleIds, shot, about), references, referencePrompt: references.length ? buildVisualPrompt(scene, 'image', scene.styleIds, shot, { referenced: hosts.map((r) => r.id), ...about, assetAttached: Boolean(picture) }) : undefined };
    });
    let referenced = false;
    const results = await Promise.allSettled(
      prompts.map(async ({ prompt, references, referencePrompt }) => {
        const started = Date.now();
        const usage = { user, taskId: scene.historyId, kind: 'image', config, model: target.model || 'demo' };
        try {
          const made = await generateImage(config, { prompt, references, referencePrompt, aspectRatio: scene.aspectRatio, signal: AbortSignal.timeout(180_000) });
          referenced ||= Boolean(made.referenced);
          await recordUsage({ ...usage, images: 1, inputTokens: made.usage?.inputTokens ?? estimateTokens(prompt), outputTokens: made.usage?.outputTokens, estimated: !made.usage, ms: Date.now() - started });
          return keep(scene, 'image', made.url, { demo: target.demo, link: false, userId: user.id });
        } catch (err) {
          await recordUsage({ ...usage, ok: false, error: err.message, ms: Date.now() - started });
          throw err;
        }
      }),
    );
    const done = results.map((r, i) => (r.status === 'fulfilled' && r.value.url ? { ...r.value, shot: shots[i].id } : null)).filter(Boolean);
    const failed = results.find((r) => r.status === 'rejected');
    await logActivity(req, user, 'image.generate', { taskId: scene.historyId, scene: scene.sceneId, requested: shots.length, made: done.length, mode: scene.mode || 'variations', model: target.model || 'demo', ...(asset && { from: asset.name }), ...(failed && { error: failed.reason.message.slice(0, 200) }) });
    if (!done.length) throw failed?.reason || new Error('The provider returned no image');
    const urls = done.map((d) => d.url);
    const labels = done.map((d) => d.shot);
    if (done.every((d) => d.saved)) await linkMedia({ historyId: scene.historyId, sceneId: scene.sceneId, kind: 'image', urls, shots: labels });
    json(res, 200, { url: urls[0], urls, shots: labels, requested: shots.length, ...(referenced && { referenced: true }), ...(asset && { from: asset.name }), ...(failed && { warning: failed.reason.message }) });
  }),

  // The reference portrait of a host of a script (`hostId`: "A" or "B"), in the frame and the style of the
  // video. It is stored with the script like a scene image, and every scene that host is in is then drawn from it.
  'POST /api/media/host': route('user', async (req, res, user) => {
    const body = await readJson(req);
    const entry = body.historyId ? await ownedHistory(user, body.historyId) : null;
    const id = String(body.hostId || 'A').toUpperCase();
    const host = normalizeCast(entry?.script?.cast || body.cast).find((c) => c.id === id);
    if (!host?.look) throw fail('This host has no look to draw a portrait from');
    const prompt = buildHostPrompt(host, { aspectRatio: body.aspectRatio, styleIds: body.styleIds });
    const config = await loadConfig();
    const target = mediaTarget(config, 'image');
    const usage = { user, taskId: body.historyId, kind: 'image', config, model: target.model || 'demo' };
    const started = Date.now();
    try {
      const made = await generateImage(config, { prompt, aspectRatio: body.aspectRatio, signal: AbortSignal.timeout(180_000) });
      await recordUsage({ ...usage, images: 1, inputTokens: made.usage?.inputTokens ?? estimateTokens(prompt), outputTokens: made.usage?.outputTokens, estimated: !made.usage, ms: Date.now() - started });
      const saved = await keep({ historyId: body.historyId, sceneId: `host${id}` }, 'image', made.url, { demo: target.demo, userId: user.id });
      await logActivity(req, user, 'image.generate', { taskId: body.historyId, scene: `host ${id}`, requested: 1, made: saved.url ? 1 : 0, mode: 'portrait', model: target.model || 'demo' });
      if (!saved.url) throw new Error('The provider returned no image');
      json(res, 200, { url: saved.url });
    } catch (err) {
      if (!err.message.startsWith('The provider returned no image')) await recordUsage({ ...usage, ok: false, error: err.message, ms: Date.now() - started });
      throw err;
    }
  }),

  // Videos take minutes: this starts the job and the page polls /status, which saves the file once it is ready.
  'POST /api/media/video': route('user', async (req, res, user) => {
    const scene = await readJson(req);
    const entry = scene.historyId ? await ownedHistory(user, scene.historyId) : null;
    if (entry?.script?.cast) scene.cast = entry.script.cast;
    const prompt = buildVisualPrompt(scene, 'video');
    const seconds = Number(scene.end) - Number(scene.start);
    const config = await loadConfig();
    const usage = { user, taskId: scene.historyId, kind: 'video', config, model: mediaTarget(config, 'video').model, inputTokens: estimateTokens(prompt), estimated: true };
    const started = Date.now();
    try {
      const job = await createVideo(config, { prompt, seconds, aspectRatio: scene.aspectRatio, signal: AbortSignal.timeout(60_000) });
      await recordUsage({ ...usage, videoSeconds: clipSeconds(seconds || 4), ms: Date.now() - started });
      await logActivity(req, user, 'video.generate', { taskId: scene.historyId, scene: scene.sceneId, seconds: clipSeconds(seconds || 4), model: usage.model });
      json(res, 200, job);
    } catch (err) {
      await recordUsage({ ...usage, ok: false, error: err.message, ms: Date.now() - started });
      throw err;
    }
  }),

  'POST /api/media/video/status': route('user', async (req, res, user) => {
    const body = await readJson(req);
    if (body.historyId) await ownedHistory(user, body.historyId);
    const config = await loadConfig();
    const job = await videoStatus(config, String(body.id || ''), { signal: AbortSignal.timeout(30_000) });
    if (job.status !== 'done') return json(res, 200, job);
    const source = job.url || (await videoContent(config, job.id, { signal: AbortSignal.timeout(300_000) }));
    json(res, 200, { ...job, ...(await keep(body, 'video', source, { userId: user.id })) });
  }),

  // ---------- The look, picked for the brief ----------

  // Suggests the visual style for a brief: one to lead, perhaps a second for its tone, a few alternatives and
  // a sentence on why. By rule it is instant and calls no model; `by: "model"` puts the same question to the
  // model in use (in demo mode, and when the model's answer cannot be used, the rules answer instead).
  'POST /api/styles/suggest': route('user', async (req, res, user) => {
    const { by, lang, ...brief } = await readJson(req);
    const language = lang === 'zh' ? 'zh' : 'en';
    if (!String(brief.topic || '').trim()) throw fail('Topic is required');
    const rules = suggestStyles(brief, language);
    if (by !== 'model') return json(res, 200, rules);
    const config = await loadConfig();
    if (validateConfig(config) || getProvider(config.provider)?.protocol === 'mock') return json(res, 200, rules);
    const prompts = buildStylePrompts(brief, language);
    const started = Date.now();
    let raw = '';
    let usage = null;
    const record = (extra) => recordUsage({ user, kind: 'style', config, ...tokens(usage, prompts, raw), ms: Date.now() - started, ...extra });
    try {
      raw = await completeChat(config, { ...prompts, signal: AbortSignal.timeout(90_000), onUsage: (u) => (usage = u) });
      const pick = parseStylePick(raw);
      await record(pick ? {} : { ok: false, error: 'Unreadable reply' });
      if (pick) await logActivity(req, user, 'style.suggest', { topic: String(brief.topic).slice(0, 120), styles: pick.styleIds.join(' + '), model: config.model || config.name });
      json(res, 200, pick ? { ...pick, model: config.model || config.name } : rules);
    } catch (err) {
      const error = err.name === 'TimeoutError' ? 'Timed out after 90s' : err.message;
      await record({ ok: false, error });
      json(res, 502, failure(req, err, error));
    }
  }),

  // ---------- Narration first ----------

  // The plan for a brief, without writing anything: the story line with its times, the length, the
  // voiceover budget and the skills that apply. The narration editor shows it as what there is room for.
  'POST /api/plan': route('user', async (req, res, user) => {
    const { narration, ...brief } = await readJson(req);
    const sourced = await withMaterials(user, brief);
    json(res, 200, planSummary(await withWeb(req, user, sourced, buildPlan(sourced), { cachedOnly: true }))); // a plan does not wait for the web
  }),

  // Writes the narration alone, one beat per stage, for the editor. Nothing is saved here: it becomes a
  // script, and a history entry, when /api/generate is called with the narration as the creator left it.
  // The narration agent plans and writes it (the viewpoint card, then the narration, with the skills that
  // apply) unless the brief says `agent: false`, which asks for a plain quick draft. The agent's review is a
  // request of its own, /api/narration/review, so that no request carries two long model calls.
  'POST /api/narration/draft': route('user', async (req, res, user) => {
    const { narration, agent, card: _card, ...brief } = await readJson(req);
    const sourced = await withMaterials(user, brief);
    let plan = buildPlan(sourced); // throws on a bad brief -> 400 below
    const config = await loadConfig();
    const invalid = validateConfig(config);
    if (invalid) return json(res, 400, { error: `LLM gateway is not configured: ${invalid}` });

    const { send, signal } = eventStream(req, res);
    plan = await withWeb(req, user, sourced, plan, { send, signal }); // the links in the brief are read before a word is written
    const model = config.model || config.name;
    const useAgent = agent !== false;
    const about = { platform: plan.brief.platform.id, topic: plan.brief.topic.slice(0, 120), model };
    send('plan', { ...planSummary(plan), model, provider: config.provider, ...(useAgent && { agent: true }) });

    if (useAgent) {
      try {
        const written = await writeNarration({ config, plan, signal, emit: send, onCall: usageRecorder(user, config) });
        await logActivity(req, user, 'narration.draft', { ...about, beats: written.beats.length, agent: true, skills: plan.skills.length, errors: written.report.errors, warns: written.report.warns });
        send('done', { narration: { title: written.title, beats: written.beats }, card: written.card, report: written.report });
      } catch (err) {
        if (err.name !== 'AbortError') {
          await logActivity(req, user, 'narration.failed', { ...about, agent: true, error: err.message.slice(0, 200), ...(err.unreadable && { reply: String(err.raw || '').slice(0, 300) }) });
          if (err.unreadable) send('done', { narration: null, raw: err.raw, parseError: err.message });
          else send('error', failure(req, err));
        }
      }
      return res.end();
    }

    const started = Date.now();
    const prompts = buildNarrationPrompts(plan);
    let raw = '';
    let usage = null;
    const record = (extra) => recordUsage({ user, kind: 'narration', config, ...tokens(usage, prompts, raw), ms: Date.now() - started, ...extra });
    try {
      for await (const text of streamChat(config, { ...prompts, signal, meta: { plan, kind: 'narration' }, onUsage: (u) => (usage = u), onRetry: (info) => send('retry', info) })) {
        raw += text;
        send('delta', { text });
      }
      let drafted = null;
      let parseError = '';
      try {
        drafted = parseNarration(raw);
      } catch (err) {
        parseError = err.message;
      }
      await record(drafted ? {} : { ok: false, error: `Unreadable reply: ${parseError}` });
      await logActivity(req, user, drafted ? 'narration.draft' : 'narration.failed', { ...about, ...(drafted ? { beats: drafted.beats.length } : { error: parseError }) });
      send('done', drafted ? { narration: drafted, report: checkNarration(plan, drafted.beats) } : { narration: null, raw, parseError });
    } catch (err) {
      const stopped = err.name === 'AbortError';
      await record({ ok: false, error: stopped ? 'Stopped by the user' : err.message });
      if (!stopped) {
        await logActivity(req, user, 'narration.failed', { ...about, error: err.message.slice(0, 200) });
        send('error', failure(req, err));
      }
    }
    res.end();
  }),

  // Measures a narration against its brief: length, breath-length sentences, wrap-up phrases, throttled
  // words, missing names, rhythm, the balance of the viewpoint card. No model is called and nothing is changed.
  'POST /api/narration/check': route('user', async (req, res, user) => {
    const { narration, card, agent, ...brief } = await readJson(req);
    const sourced = await withMaterials(user, brief);
    const plan = await withWeb(req, user, sourced, buildPlan(sourced), { cachedOnly: true });
    json(res, 200, checkNarration(plan, normalizeNarration(narration), normalizeCard(card, plan.timeline.map((s) => s.key))));
  }),

  // The agent's review of a narration: the measured findings go to an editor with the skills and the card,
  // and the corrected narration comes back with what is still left. Streams its progress like a draft does.
  'POST /api/narration/review': route('user', async (req, res, user) => {
    const { narration, card, agent, ...brief } = await readJson(req);
    const sourced = await withMaterials(user, brief);
    let plan = buildPlan(sourced);
    const beats = normalizeNarration(narration);
    if (!beats.length) throw fail('There is no narration to review');
    const config = await loadConfig();
    const invalid = validateConfig(config);
    if (invalid) return json(res, 400, { error: `LLM gateway is not configured: ${invalid}` });

    const { send, signal } = eventStream(req, res);
    plan = await withWeb(req, user, sourced, plan, { send, signal });
    const model = config.model || config.name;
    const about = { platform: plan.brief.platform.id, topic: plan.brief.topic.slice(0, 120), model };
    send('plan', { ...planSummary(plan), model, provider: config.provider, agent: true });
    try {
      const revised = await reviseNarration({ config, plan, beats, card: normalizeCard(card, plan.timeline.map((s) => s.key)), signal, emit: send, onCall: usageRecorder(user, config), until: Date.now() + REVIEW_SECOND_PASS_MS });
      await logActivity(req, user, 'narration.refine', { ...about, beat: 'all', change: 'review', errors: revised.report.errors, warns: revised.report.warns });
      send('done', revised);
    } catch (err) {
      if (err.name !== 'AbortError') send('error', failure(req, err));
    }
    res.end();
  }),

  // Rewrites one beat (`index`) or the whole narration: as a `preset` asks, as the creator's own
  // `instruction` asks, or both. Answers { text } for a beat and { beats } for the whole narration.
  // The "review" preset is the agent's review step: it answers { beats, report }.
  'POST /api/narration/refine': route('user', async (req, res, user) => {
    const { narration, index, preset, instruction, target, card, agent, ...brief } = await readJson(req);
    const sourced = await withMaterials(user, brief);
    let plan = buildPlan(sourced);
    const beats = normalizeNarration(narration);
    const at = Number.isInteger(index) ? index : null;
    const agentReview = preset === 'review' && at == null;
    if (agentReview && !beats.length) throw fail('There is no narration to refine');
    if (!agentReview) buildRefinePrompts(plan, beats, { index: at, preset, instruction, target }); // throws when there is nothing to do -> 400
    const config = await loadConfig();
    const invalid = validateConfig(config);
    if (invalid) return json(res, 400, { error: `LLM gateway is not configured: ${invalid}` });
    plan = await withWeb(req, user, sourced, plan, { signal: AbortSignal.timeout(60_000) }); // the pages the narration was written from, so a rewrite keeps to them
    const prompts = agentReview ? null : buildRefinePrompts(plan, beats, { index: at, preset, instruction, target });
    const about = { platform: plan.brief.platform.id, topic: plan.brief.topic.slice(0, 120), model: config.model || config.name };

    if (agentReview) {
      try {
        const revised = await reviseNarration({ config, plan, beats, card: normalizeCard(card, plan.timeline.map((s) => s.key)), signal: AbortSignal.timeout(280_000), onCall: usageRecorder(user, config), until: Date.now() + REVIEW_SECOND_PASS_MS });
        await logActivity(req, user, 'narration.refine', { ...about, beat: 'all', change: 'review', errors: revised.report.errors, warns: revised.report.warns });
        return json(res, 200, revised);
      } catch (err) {
        return json(res, 502, { error: err.name === 'TimeoutError' ? 'Timed out after 280s' : err.message });
      }
    }

    const started = Date.now();
    let raw = '';
    let usage = null;
    const record = (extra) => recordUsage({ user, kind: 'narration', config, ...tokens(usage, prompts, raw), ms: Date.now() - started, ...extra });
    try {
      raw = await completeChat(config, { ...prompts, signal: AbortSignal.timeout(120_000), meta: { plan, kind: 'refine', beats, index: at }, onUsage: (u) => (usage = u) });
      const refined = parseRefined(raw, { index: at });
      await record({});
      await logActivity(req, user, 'narration.refine', { ...about, beat: at == null ? 'all' : at + 1, change: REFINE_PRESETS.some((p) => p.id === preset) ? preset : 'custom' });
      json(res, 200, refined);
    } catch (err) {
      const error = err.name === 'TimeoutError' ? 'Timed out after 120s' : err.message;
      await record({ ok: false, error });
      json(res, 502, failure(req, err, error));
    }
  }),

  // Writes one script. The server saves it to the user's history and records the model call,
  // so the task exists even if the browser tab closes before the reply ends.
  // A brief with a `narration` ([{ stage, text }]) gets a script built around those words as they are: the
  // video runs as long as they take, and the scenes carry them word for word. The narration comes from the
  // editor, or straight from the narration agent when the page chains a draft into a script (`narrationBy:
  // "agent"`); its viewpoint `card`, when there is one, is kept with the script.
  // A script that takes longer than the host lets one request run is written in parts (src/limits.mjs): the
  // reply ends with a `handover` event instead of `done`, and the page asks again with the same brief and
  // `resume: { text, part }`, the reply so far. The model then carries on from the last character of it.
  'POST /api/generate': route('user', async (req, res, user) => {
    const { agent, narrationBy, resume, ...brief } = await readJson(req);
    const sourced = await withMaterials(user, brief);
    let plan = buildPlan(sourced); // throws on a bad brief -> 400 below
    const given = resumeOf(resume);
    const config = await loadConfig();
    const invalid = validateConfig(config);
    if (invalid) return json(res, 400, { error: `LLM gateway is not configured: ${invalid}` });

    const { send, signal } = eventStream(req, res);
    plan = await withWeb(req, user, sourced, plan, { send, signal }); // the links in the brief are read, and the topic searched for, before the script is written
    const taskId = newHistoryId();
    const planInfo = { ...planSummary(plan), model: config.model || config.name, provider: config.provider };
    const about = { taskId, platform: plan.brief.platform.id, topic: plan.brief.topic.slice(0, 120), model: planInfo.model };
    send('plan', { ...planInfo, taskId, ...(given.part > 1 && { part: given.part }) });
    const started = Date.now();
    const prompts = buildPrompts(plan);
    let raw = given.text;
    let usage = null;
    let asked = false; // whether the model was called in this request
    const fresh = () => raw.slice(given.text.length); // what this request added
    // A request that carries a reply on also sends what was written so far: that is input the model reads again.
    const record = (extra) => (asked ? recordUsage({ user, taskId, kind: 'script', config, ...tokens(usage, { ...prompts, user: prompts.user + given.text }, fresh()), ms: Date.now() - started, ...extra }) : null);
    try {
      // A reply that is already whole only needs reading: the page lost the connection before it heard so.
      if (!given.text || cutShort(given.text)) {
        asked = true;
        for await (const text of streamChat(config, { ...prompts, signal, partial: given.text, meta: { plan }, onUsage: (u) => (usage = u), onRetry: (info) => send('retry', info) })) {
          raw += text;
          send('delta', { text });
        }
      }
      let script = null;
      let parseError = '';
      let parseNear = ''; // the reply around the place it stopped being JSON, for the log
      try {
        script = parseScript(raw);
      } catch (err) {
        parseError = err.message;
        parseNear = err.near || '';
      }
      await record(script ? {} : { ok: false, error: `Unreadable reply: ${parseError}` });
      if (script) {
        const { platformId, narration, card, host, assetIds: _ids, materials: _materials, web: _web, ...rest } = brief;
        // The library files the script was written from, by id: the form can pick them again, and their text is not kept twice.
        if (plan.brief.materials.ids.length) rest.assetIds = plan.brief.materials.ids;
        rest.aspectRatio = plan.brief.aspect.id; // always recorded, so the script keeps its shape if the default ever changes
        if (hostSetting(host)) rest.host = hostSetting(host); // the host as the creator asked for it, so the form can be put back
        // A script built around a final narration carries it word for word, whatever the model did with it.
        if (plan.brief.narration.length) {
          const byAgent = narrationBy === 'agent';
          const locked = lockNarration(script.scenes, plan.brief.narration, plan.brief.lang);
          script.scenes = locked.scenes;
          planInfo.narration = { locked: true, repaired: locked.repaired, ...(byAgent && { agent: true }) };
          rest.narration = plan.brief.narration;
          // The viewpoint card the narration was written to stays with the script: it is the first page of the package.
          if (plan.brief.card) script.card = plan.brief.card;
        }
        // Who is in the video: the hosts keep the look the creator fixed, and each scene says who is in frame.
        script = settleScript(script, plan.brief);
        const saved = await addHistory({ id: taskId, userId: user.id, platformId: plan.brief.platform.id, brief: rest, plan: planInfo, script });
        const entry = await placeSceneAssets(user, saved); // a scene that shows the creator's own picture or clip has it from the start
        await logActivity(req, user, 'script.generate', { ...about, title: script.title, scenes: script.scenes.length, ...(planInfo.narration && { narration: planInfo.narration.agent ? 'agent' : planInfo.narration.repaired ? 'restored' : 'kept' }) });
        await markFirstScript(user);
        send('done', { script, historyId: entry.id, entry });
      } else {
        await logActivity(req, user, 'script.failed', { ...about, error: parseError, ...(parseNear && { near: parseNear }) });
        send('done', { script: null, raw, parseError });
      }
    } catch (err) {
      // Out of time with the reply under way: its words are kept, and the page asks for the rest.
      if (err.name === 'TimeoutError' && fresh().length >= HANDOVER_MIN && given.part < MAX_PARTS) {
        await record({});
        send('handover', { part: given.part, written: raw.length });
        return res.end();
      }
      const stopped = err.name === 'AbortError';
      await record({ ok: false, error: stopped ? 'Stopped by the user' : err.message });
      await logActivity(req, user, stopped ? 'script.stopped' : 'script.failed', { ...about, ...(!stopped && { error: err.message.slice(0, 200) }) });
      if (!stopped) send('error', failure(req, err));
    }
    res.end();
  }),
};

// The chat (conversations, their pictures and clips, and skills) has its routes in a file of its own.
Object.assign(routes, chatRoutes({ route, json, readJson, eventStream, fail, failure, tokens }));
// So do the web settings: the Tavily and Firecrawl keys that let a brief and a conversation read the web.
Object.assign(routes, webRoutes({ route, json, readJson, failure }));

/** A recorder for work that makes several model calls: one usage record per call, as "narration" (the narration agent) or "read" (looking at pictures). */
function usageRecorder(user, config, kind = 'narration') {
  return ({ prompts, raw, usage, ms, ok, error }) => recordUsage({ user, kind, config, ...tokens(usage, prompts, raw), ms, ...(!ok && { ok: false, error }) });
}

/** A preview of a picture as the page sends it (a data: URI of a small JPEG, PNG or WebP): { type, bytes }, or null. */
function previewPicture(uri) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(uri || ''));
  if (!m) return null;
  const bytes = Buffer.from(m[2], 'base64');
  const real = { 'image/jpeg': bytes[0] === 0xff && bytes[1] === 0xd8, 'image/png': bytes.readUInt32BE?.(0) === 0x89504e47, 'image/webp': bytes.toString('latin1', 8, 12) === 'WEBP' }[m[1]];
  return real && bytes.length > 100 ? { type: m[1], bytes } : null;
}

/** Token counts for a usage record: the provider's when it reported them, otherwise an estimate from the text. */
function tokens(usage, prompts, reply) {
  const estimated = usage?.inputTokens == null || usage?.outputTokens == null;
  return {
    inputTokens: usage?.inputTokens ?? estimateTokens(`${prompts.system}\n${prompts.user}`),
    outputTokens: usage?.outputTokens ?? estimateTokens(reply),
    estimated,
  };
}

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: 'Forbidden' });
  try {
    let data = await readFile(file);
    // The home pages, sitemap and robots.txt need the site's public address: the configured one,
    // or the address this request came in on.
    if (STAMPED.has(path.extname(file)) && data.includes(SITE_TOKEN)) data = Buffer.from(stamp(data.toString('utf8'), configuredSiteUrl() || requestSiteUrl(req)));
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin' });
    res.end(data);
  } catch {
    json(res, 404, { error: 'Not found' });
  }
}

/** The whole application as one request handler. */
export async function handler(req, res) {
  req.started = Date.now(); // the host's clock for this request starts here (src/limits.mjs)
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');
  try {
    if (pathname.startsWith('/api/')) {
      if (!sameOrigin(req)) return json(res, 403, { error: 'Cross-origin request refused' });
      const found = routes[`${req.method} ${pathname}`];
      if (!found) return json(res, 404, { error: 'Not found' });
      await ensureAdmin();
      const user = await authenticate(req);
      if (found.access !== 'public' && !user) return json(res, 401, { error: 'Sign in to continue' });
      if (found.access === 'admin' && !isAdmin(user)) return json(res, 403, { error: 'Only an administrator can do that' });
      return await found.run(req, res, user, searchParams);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
    if (pathname.startsWith('/media/')) {
      // Generated media is private: only its owner (or an administrator) can fetch it.
      const name = pathname.slice(7);
      const user = await authenticate(req);
      if (!user) return json(res, 401, { error: 'Sign in to continue' });
      if (isAssetFile(name)) {
        // A file in someone's library is theirs alone.
        if ((await assetFileOwner(name)) !== user.id) return json(res, 404, { error: 'Not found' });
      } else if (isChatFile(name)) {
        // So is a picture or a clip made in a conversation.
        if ((await chatFileOwner(name)) !== user.id) return json(res, 404, { error: 'Not found' });
      } else {
        const owner = mediaOwner(name);
        if (owner) await ownedHistory(user, owner);
      }
      if (await serveMedia(req, res, name)) return;
      return json(res, 404, { error: 'Not found' });
    }
    await serveStatic(req, res, pathname);
  } catch (err) {
    if (res.headersSent) return res.end();
    json(res, err.status || 400, failure(req, err));
  }
}

// Started directly (npm start): listen. Imported (serverless function, tests): only export the handler.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  http.createServer(handler).listen(PORT, HOST, () => {
    console.log(`Video Scripter running at http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`);
    if (!storage.durable) console.warn('Storage is temporary here: set DATABASE_URL to keep accounts and scripts.');
  });
}
