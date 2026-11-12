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
import { streamChat, completeChat, listModels, request, cutShort } from './src/gateway/client.mjs';
import { generateImage, createVideo, videoStatus, videoContent, clipSeconds } from './src/gateway/media.mjs';
import { listHistory, getHistory, addHistory, newHistoryId, saveMedia, linkMedia, serveMedia, mediaOwner, readMedia, deleteUserHistory, transferHistory } from './src/store.mjs';
import { buildPackage } from './src/package.mjs';
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
 * Start a Server-Sent Events reply: `send(event, data)` writes one event. `signal` fires when the browser goes
 * away (an AbortError), and when the time the host gives one request is nearly up (a TimeoutError, see
 * src/limits.mjs): whatever is running then stops while there is still time to tell the page what happened.
 */
function eventStream(req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  const abort = new AbortController();
  const budget = workBudgetMs();
  const timer = budget ? setTimeout(() => abort.abort(outOfTime()), Math.max(0, (req.started || Date.now()) + budget - Date.now())) : null;
  res.on('close', () => {
    clearTimeout(timer);
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
    json(res, 200, { scope: all ? 'all' : 'me', ...(await summarizeUsage({ userId: all ? undefined : user.id, days: Number(query.get('days') ?? 30) })) });
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
    await deleteUser(target.id);
    await logActivity(req, user, 'admin.user_delete', { target: target.email, scripts: count, kept: moved });
    json(res, 200, { ok: true, scripts: count, transferred: moved });
  }),

  // ---------- Reference data and gateways ----------

  'GET /api/meta': route('user', async (req, res) => {
    json(res, 200, {
      platforms: PLATFORMS.map(({ id, name, nameEn, lang, defaultDuration, durations }) => ({ id, name, nameEn, lang, defaultDuration, durations })),
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
  'POST /api/gateway/test': route('admin', async (req, res, user) => {
    const config = await draftConfig(await readJson(req));
    const started = Date.now();
    const prompts = { system: 'You are a connectivity check.', user: 'Reply with the single word OK.' };
    let usage = null;
    try {
      const reply = await completeChat(config, { ...prompts, maxTokens: 256, signal: AbortSignal.timeout(30_000), onUsage: (u) => (usage = u) });
      await recordUsage({ user, kind: 'test', config, ...tokens(usage, prompts, reply), ms: Date.now() - started });
      json(res, 200, { ok: true, ms: Date.now() - started, model: config.model, reply: reply.trim().slice(0, 120) });
    } catch (err) {
      const error = err.name === 'TimeoutError' ? 'Timed out after 30s' : err.message;
      await recordUsage({ user, kind: 'test', config, ok: false, error, ms: Date.now() - started });
      json(res, 200, { ok: false, ms: Date.now() - started, ...failure(req, err, error) });
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
    const prompts = shots.map((shot) => {
      const references = showsHost(shot) ? portraits : [];
      return { prompt: buildVisualPrompt(scene, 'image', scene.styleIds, shot), references, referencePrompt: references.length ? buildVisualPrompt(scene, 'image', scene.styleIds, shot, { referenced: references.map((r) => r.id) }) : undefined }; // throws on a scene with no visual
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
    await logActivity(req, user, 'image.generate', { taskId: scene.historyId, scene: scene.sceneId, requested: shots.length, made: done.length, mode: scene.mode || 'variations', model: target.model || 'demo', ...(failed && { error: failed.reason.message.slice(0, 200) }) });
    if (!done.length) throw failed?.reason || new Error('The provider returned no image');
    const urls = done.map((d) => d.url);
    const labels = done.map((d) => d.shot);
    if (done.every((d) => d.saved)) await linkMedia({ historyId: scene.historyId, sceneId: scene.sceneId, kind: 'image', urls, shots: labels });
    json(res, 200, { url: urls[0], urls, shots: labels, requested: shots.length, ...(referenced && { referenced: true }), ...(failed && { warning: failed.reason.message }) });
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
  'POST /api/plan': route('user', async (req, res) => {
    const { narration, ...brief } = await readJson(req);
    json(res, 200, planSummary(buildPlan(brief)));
  }),

  // Writes the narration alone, one beat per stage, for the editor. Nothing is saved here: it becomes a
  // script, and a history entry, when /api/generate is called with the narration as the creator left it.
  // The narration agent plans and writes it (the viewpoint card, then the narration, with the skills that
  // apply) unless the brief says `agent: false`, which asks for a plain quick draft. The agent's review is a
  // request of its own, /api/narration/review, so that no request carries two long model calls.
  'POST /api/narration/draft': route('user', async (req, res, user) => {
    const { narration, agent, card: _card, ...brief } = await readJson(req);
    const plan = buildPlan(brief); // throws on a bad brief -> 400 below
    const config = await loadConfig();
    const invalid = validateConfig(config);
    if (invalid) return json(res, 400, { error: `LLM gateway is not configured: ${invalid}` });

    const { send, signal } = eventStream(req, res);
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
  'POST /api/narration/check': route('user', async (req, res) => {
    const { narration, card, agent, ...brief } = await readJson(req);
    const plan = buildPlan(brief);
    json(res, 200, checkNarration(plan, normalizeNarration(narration), normalizeCard(card, plan.timeline.map((s) => s.key))));
  }),

  // The agent's review of a narration: the measured findings go to an editor with the skills and the card,
  // and the corrected narration comes back with what is still left. Streams its progress like a draft does.
  'POST /api/narration/review': route('user', async (req, res, user) => {
    const { narration, card, agent, ...brief } = await readJson(req);
    const plan = buildPlan(brief);
    const beats = normalizeNarration(narration);
    if (!beats.length) throw fail('There is no narration to review');
    const config = await loadConfig();
    const invalid = validateConfig(config);
    if (invalid) return json(res, 400, { error: `LLM gateway is not configured: ${invalid}` });

    const { send, signal } = eventStream(req, res);
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
    const plan = buildPlan(brief);
    const beats = normalizeNarration(narration);
    const at = Number.isInteger(index) ? index : null;
    const agentReview = preset === 'review' && at == null;
    if (agentReview && !beats.length) throw fail('There is no narration to refine');
    const prompts = agentReview ? null : buildRefinePrompts(plan, beats, { index: at, preset, instruction, target }); // throws when there is nothing to do -> 400
    const config = await loadConfig();
    const invalid = validateConfig(config);
    if (invalid) return json(res, 400, { error: `LLM gateway is not configured: ${invalid}` });
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
    const plan = buildPlan(brief); // throws on a bad brief -> 400 below
    const given = resumeOf(resume);
    const config = await loadConfig();
    const invalid = validateConfig(config);
    if (invalid) return json(res, 400, { error: `LLM gateway is not configured: ${invalid}` });

    const { send, signal } = eventStream(req, res);
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
        const { platformId, narration, card, host, ...rest } = brief;
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
        const entry = await addHistory({ id: taskId, userId: user.id, platformId: plan.brief.platform.id, brief: rest, plan: planInfo, script });
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

/** A recorder for the narration agent: one usage record per model call it makes, as "narration". */
function usageRecorder(user, config) {
  return ({ prompts, raw, usage, ms, ok, error }) => recordUsage({ user, kind: 'narration', config, ...tokens(usage, prompts, raw), ms, ...(!ok && { ok: false, error }) });
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
      const owner = mediaOwner(name);
      if (owner) await ownedHistory(user, owner);
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
