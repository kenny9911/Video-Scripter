// Video Scripter server: static UI + JSON API + LLM gateway. No dependencies.
// Binds to localhost only, because it holds an API key and will call any BASE_URL_API it is given.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PLATFORMS } from './src/platforms.mjs';
import { FRAMEWORKS } from './src/frameworks.mjs';
import { PROVIDERS } from './src/gateway/providers.mjs';
import { STYLES, STYLE_GROUPS, MAX_STYLES } from './src/styles.mjs';
import { randomUUID } from 'node:crypto';
import { loadConfig, loadStore, saveStore, mergeConfig, publicStore, validateConfig, enabledModels, mediaTarget } from './src/gateway/config.mjs';
import { streamChat, completeChat, listModels, request } from './src/gateway/client.mjs';
import { generateImage, createVideo, videoStatus, videoContent } from './src/gateway/media.mjs';
import { listHistory, addHistory, saveMedia, linkMedia, serveMedia } from './src/store.mjs';
import { buildPackage } from './src/package.mjs';
import { buildPlan, buildPrompts, parseScript, buildVisualPrompt } from './src/prompt.mjs';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const PORT = Number(process.env.PORT) || 3789;
const HOST = process.env.HOST || '127.0.0.1';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
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
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON body'), { status: 400 });
  }
}

// Reject cross-site requests: another web page must not be able to drive this local server.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/** Unsaved form values merged over the saved gateway they belong to, if any. */
async function draftConfig(body) {
  const store = await loadStore();
  return mergeConfig(body, store.profiles.find((p) => p.id === body.id));
}

/**
 * Save a generated file and answer with its local URL. A provider-hosted URL is downloaded first;
 * if that fails the provider's URL is passed through so the result is still shown.
 */
async function keep({ historyId, sceneId }, kind, source, demo = false, link = true) {
  let remote = '';
  try {
    if (typeof source === 'string' && /^https?:/.test(source)) {
      remote = source;
      source = await request(source, { signal: AbortSignal.timeout(300_000) });
    }
    const saved = await saveMedia({ historyId, sceneId, kind, source, demo, link });
    if (saved) return { ...saved, saved: true };
  } catch (err) {
    console.warn(`[media] could not save the ${kind}: ${err.message}`);
  }
  return { url: remote || (typeof source === 'string' ? source : ''), saved: false };
}

const routes = {
  'GET /api/meta': async (req, res) => {
    json(res, 200, {
      platforms: PLATFORMS.map(({ id, name, nameEn, lang, defaultDuration, durations }) => ({ id, name, nameEn, lang, defaultDuration, durations })),
      frameworks: FRAMEWORKS.map(({ id, name, blurb }) => ({ id, name, blurb })),
      providers: PROVIDERS,
      styleGroups: STYLE_GROUPS,
      styles: STYLES.map(({ id, group, name, blurb }) => ({ id, group, name, blurb })),
      maxStyles: MAX_STYLES,
    });
  },

  // Every saved gateway (keys masked) and which one is in use.
  'GET /api/gateway/config': async (req, res) => {
    json(res, 200, publicStore(await loadStore()));
  },

  // Create a gateway (no id) or update one (id). `activate: true` also puts it in use.
  'PUT /api/gateway/config': async (req, res) => {
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
    json(res, 200, { ...publicStore(store), savedId: saved.id });
  },

  // Choose the gateway (and optionally which of its enabled models) that writes scripts.
  'POST /api/gateway/select': async (req, res) => {
    const { id, model } = await readJson(req);
    const store = await loadStore();
    const profile = store.profiles.find((p) => p.id === id);
    if (!profile) return json(res, 404, { error: 'That gateway no longer exists' });
    if (model && model !== profile.model) {
      if (!enabledModels(profile).includes(model)) return json(res, 400, { error: `Model "${model}" is not enabled for ${profile.name}` });
      profile.models = enabledModels(profile); // keep the previous default selectable
      profile.model = model;
    }
    store.activeId = profile.id;
    await saveStore(store);
    json(res, 200, publicStore(store));
  },

  'POST /api/gateway/delete': async (req, res) => {
    const { id } = await readJson(req);
    const store = await loadStore();
    store.profiles = store.profiles.filter((p) => p.id !== id);
    if (store.activeId === id) store.activeId = store.profiles[0]?.id;
    await saveStore(store);
    json(res, 200, publicStore(await loadStore())); // reload: an empty list falls back to the env/demo gateway
  },

  // Tests the form values in the request body without saving; `id` lets a blank key fall back to the saved one.
  'POST /api/gateway/test': async (req, res) => {
    const config = await draftConfig(await readJson(req));
    const started = Date.now();
    try {
      const reply = await completeChat(config, {
        system: 'You are a connectivity check.',
        user: 'Reply with the single word OK.',
        maxTokens: 256,
        signal: AbortSignal.timeout(30_000),
      });
      json(res, 200, { ok: true, ms: Date.now() - started, model: config.model, reply: reply.trim().slice(0, 120) });
    } catch (err) {
      json(res, 200, { ok: false, ms: Date.now() - started, error: err.name === 'TimeoutError' ? 'Timed out after 30s' : err.message });
    }
  },

  // Lists the models the provider offers for the form values in the request body (unsaved).
  'POST /api/gateway/models': async (req, res) => {
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
      json(res, 200, { ok: false, error: err.name === 'TimeoutError' ? 'Timed out after 20s' : err.message });
    }
  },

  // Every finished script is saved here; generated media is linked from its entry.
  'GET /api/history': async (req, res) => {
    json(res, 200, await listHistory());
  },

  'POST /api/history': async (req, res) => {
    json(res, 200, await addHistory(await readJson(req)));
  },

  // One script with all its generated media, as a .zip. The page sends the Markdown it renders.
  'POST /api/history/package': async (req, res) => {
    const { id, markdown } = await readJson(req);
    const entry = (await listHistory()).find((e) => e.id === id);
    if (!entry) return json(res, 404, { error: 'That script is no longer in the history' });
    const pkg = await buildPackage(entry, { markdown });
    res.writeHead(200, {
      'content-type': 'application/zip',
      'content-length': pkg.buffer.length,
      'content-disposition': `attachment; filename="package.zip"; filename*=UTF-8''${encodeURIComponent(pkg.name)}`,
      'cache-control': 'no-store',
    });
    res.end(pkg.buffer);
  },

  // Media for one scene, made with the image / video settings of the gateway in use,
  // then written to data/media and linked from the history entry `historyId`.
  'POST /api/media/image': async (req, res) => {
    const scene = await readJson(req);
    const prompt = buildVisualPrompt(scene, 'image');
    const config = await loadConfig();
    // `count` (1-3) asks for that many alternatives. Each is its own request, since many image models only return one.
    const count = Math.min(3, Math.max(1, Math.round(Number(scene.count)) || 1));
    const demo = mediaTarget(config, 'image').demo;
    const results = await Promise.allSettled(
      Array.from({ length: count }, async () => {
        const made = await generateImage(config, { prompt, signal: AbortSignal.timeout(180_000) });
        return keep(scene, 'image', made.url, demo, false);
      }),
    );
    const done = results.filter((r) => r.status === 'fulfilled' && r.value.url).map((r) => r.value);
    if (!done.length) throw results.find((r) => r.status === 'rejected')?.reason || new Error('The provider returned no image');
    const urls = done.map((d) => d.url);
    if (done.every((d) => d.saved)) await linkMedia({ historyId: scene.historyId, sceneId: scene.sceneId, kind: 'image', urls });
    const failed = results.find((r) => r.status === 'rejected');
    json(res, 200, { url: urls[0], urls, requested: count, ...(failed && { warning: failed.reason.message }) });
  },

  // Videos take minutes: this starts the job and the page polls /status, which saves the file once it is ready.
  'POST /api/media/video': async (req, res) => {
    const scene = await readJson(req);
    const prompt = buildVisualPrompt(scene, 'video');
    const seconds = Number(scene.end) - Number(scene.start);
    json(res, 200, await createVideo(await loadConfig(), { prompt, seconds, signal: AbortSignal.timeout(60_000) }));
  },

  'POST /api/media/video/status': async (req, res) => {
    const body = await readJson(req);
    const config = await loadConfig();
    const job = await videoStatus(config, String(body.id || ''), { signal: AbortSignal.timeout(30_000) });
    if (job.status !== 'done') return json(res, 200, job);
    const source = job.url || (await videoContent(config, job.id, { signal: AbortSignal.timeout(300_000) }));
    json(res, 200, { ...job, ...(await keep(body, 'video', source)) });
  },

  'POST /api/generate': async (req, res) => {
    const plan = buildPlan(await readJson(req)); // throws on a bad brief -> 400 below
    const config = await loadConfig();
    const invalid = validateConfig(config);
    if (invalid) return json(res, 400, { error: `LLM gateway is not configured: ${invalid}` });

    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const abort = new AbortController();
    res.on('close', () => abort.abort());

    send('plan', { timeline: plan.timeline, budget: plan.budget, unit: plan.unit, model: config.model || config.name, provider: config.provider });
    let raw = '';
    try {
      const prompts = buildPrompts(plan);
      for await (const text of streamChat(config, { ...prompts, signal: abort.signal, meta: { plan } })) {
        raw += text;
        send('delta', { text });
      }
      try {
        send('done', { script: parseScript(raw) });
      } catch (err) {
        send('done', { script: null, raw, parseError: err.message });
      }
    } catch (err) {
      if (err.name !== 'AbortError') send('error', { error: err.message });
    }
    res.end();
  },
};

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: 'Forbidden' });
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  } catch {
    json(res, 404, { error: 'Not found' });
  }
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    if (pathname.startsWith('/api/')) {
      if (!sameOrigin(req)) return json(res, 403, { error: 'Cross-origin request refused' });
      const handler = routes[`${req.method} ${pathname}`];
      if (!handler) return json(res, 404, { error: 'Not found' });
      return await handler(req, res);
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
    if (pathname.startsWith('/media/')) {
      if (await serveMedia(req, res, pathname.slice(7))) return;
      return json(res, 404, { error: 'Not found' });
    }
    await serveStatic(req, res, pathname);
  } catch (err) {
    if (res.headersSent) return res.end();
    json(res, err.status || 400, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Video Scripter running at http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`);
});
