// Gateway configuration store.
// data/gateway.json holds any number of saved gateways ("profiles") and which one is in use:
//   { activeId, profiles: [{ id, name, provider, baseUrl, apiKey, model, models, image, video }] }
// `image` and `video` are optional { baseUrl, apiKey, model, size } targets for media generation;
// a blank baseUrl or apiKey there means "same as the gateway".
// Until something is saved, a single profile is built from environment variables (demo mode by default).
// API keys never leave the server: the UI only ever receives a masked preview.

import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getProvider } from './providers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = process.env.GATEWAY_CONFIG_FILE || path.join(ROOT, 'data', 'gateway.json');
const MEDIA_BLANK = { baseUrl: '', apiKey: '', model: '', size: '' };
const BLANK = { id: '', name: '', provider: '', baseUrl: '', apiKey: '', model: '', models: [], image: MEDIA_BLANK, video: MEDIA_BLANK };
export const MEDIA_KINDS = ['image', 'video'];
const withMedia = (p) => ({ ...p, image: { ...MEDIA_BLANK, ...p.image }, video: { ...MEDIA_BLANK, ...p.video } });

function envProfile() {
  const env = process.env;
  const preset = getProvider(env.LLM_PROVIDER || 'mock') || getProvider('custom');
  return {
    id: 'default',
    name: preset.label,
    provider: preset.id,
    baseUrl: env.BASE_URL_API || env.LLM_BASE_URL || preset.baseUrl,
    apiKey: env.API_KEY || env.LLM_API_KEY || '',
    model: env.LLM_MODEL || env.MODEL || preset.model,
    models: [],
    image: { ...MEDIA_BLANK, baseUrl: env.IMAGE_BASE_URL_API || '', apiKey: env.IMAGE_API_KEY || '', model: env.IMAGE_MODEL || '' },
    video: { ...MEDIA_BLANK, baseUrl: env.VIDEO_BASE_URL_API || '', apiKey: env.VIDEO_API_KEY || '', model: env.VIDEO_MODEL || '' },
  };
}

export async function loadStore() {
  let saved = null;
  try {
    saved = JSON.parse(await readFile(FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[gateway] could not read ${FILE}: ${err.message}`);
  }
  let profiles = [];
  if (Array.isArray(saved?.profiles)) {
    profiles = saved.profiles.filter((p) => p && p.id && getProvider(p.provider)).map((p) => ({ ...BLANK, ...p }));
  } else if (saved?.provider && getProvider(saved.provider)) {
    // Older single-gateway file: { provider, baseUrl, apiKey, model }
    profiles = [{ ...envProfile(), name: getProvider(saved.provider).label, ...saved, id: 'default' }];
  }
  if (!profiles.length) profiles = [envProfile()];
  const activeId = profiles.some((p) => p.id === saved?.activeId) ? saved.activeId : profiles[0].id;
  return { activeId, profiles: profiles.map(withMedia) };
}

export const activeProfile = (store) => store.profiles.find((p) => p.id === store.activeId) || store.profiles[0];

/** The gateway currently in use. */
export async function loadConfig() {
  return activeProfile(await loadStore());
}

export async function saveStore(store) {
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
  await chmod(FILE, 0o600);
  return store;
}

/**
 * Merge form values from the UI into a stored profile (or into nothing, for a new one).
 * An empty/absent apiKey keeps the stored key, unless clearKey is set or the provider or base URL
 * changed (a key for one vendor must never be sent to another vendor's endpoint).
 */
export function mergeConfig(patch, current) {
  const cur = current || BLANK;
  const provider = getProvider(patch.provider) ? patch.provider : cur.provider;
  const baseUrl = String(patch.baseUrl ?? cur.baseUrl ?? '').trim();
  const sameTarget = provider === cur.provider && baseUrl === cur.baseUrl;
  let apiKey = typeof patch.apiKey === 'string' ? patch.apiKey.trim() : '';
  if (!apiKey) apiKey = patch.clearKey || !sameTarget ? '' : cur.apiKey;

  // `models` is the set the user enabled for the model picker; `model` is the one used by default.
  const picked = Array.isArray(patch.models) ? patch.models : sameTarget ? cur.models || [] : [];
  const models = [...new Set(picked.map((m) => String(m).trim()).filter(Boolean))].slice(0, 200);
  const model = String(patch.model ?? cur.model ?? '').trim() || models[0] || '';
  const name = String(patch.name ?? cur.name ?? '').trim().slice(0, 60) || getProvider(provider)?.label || 'Gateway';
  return { id: cur.id, name, provider, baseUrl, apiKey, model, models, image: mergeMedia(patch.image, cur.image), video: mergeMedia(patch.video, cur.video) };
}

/** Same key rule as the gateway itself: a media key is kept only while its base URL is unchanged. */
function mergeMedia(patch, current) {
  const cur = { ...MEDIA_BLANK, ...current };
  if (!patch || typeof patch !== 'object') return cur;
  const baseUrl = String(patch.baseUrl ?? cur.baseUrl).trim();
  let apiKey = typeof patch.apiKey === 'string' ? patch.apiKey.trim() : '';
  if (!apiKey) apiKey = patch.clearKey || baseUrl !== cur.baseUrl ? '' : cur.apiKey;
  return { baseUrl, apiKey, model: String(patch.model ?? cur.model).trim(), size: String(patch.size ?? cur.size).trim().slice(0, 20) };
}

/**
 * Where image or video requests go for this gateway: its own base URL and key when set,
 * otherwise the gateway's. `ready` is false until a model is chosen (demo mode draws placeholder images).
 */
export function mediaTarget(config, kind) {
  const m = { ...MEDIA_BLANK, ...config[kind] };
  const demo = getProvider(config.provider)?.protocol === 'mock' && !m.baseUrl;
  return { baseUrl: m.baseUrl || config.baseUrl, apiKey: m.apiKey || config.apiKey, model: m.model, size: m.size, demo, ready: demo ? kind === 'image' : Boolean(m.model) };
}

/** The default model plus every enabled model, default first. */
export function enabledModels(config) {
  return [...new Set([config.model, ...(config.models || [])].filter(Boolean))];
}

export function maskKey(key) {
  if (!key) return '';
  return key.length <= 8 ? '••••' : `${key.slice(0, 3)}••••${key.slice(-4)}`;
}

export function publicConfig(config) {
  return {
    id: config.id,
    name: config.name,
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    models: enabledModels(config),
    hasKey: Boolean(config.apiKey),
    keyPreview: maskKey(config.apiKey),
    ...Object.fromEntries(
      MEDIA_KINDS.map((kind) => {
        const m = { ...MEDIA_BLANK, ...config[kind] };
        return [kind, { baseUrl: m.baseUrl, model: m.model, size: m.size, hasKey: Boolean(m.apiKey), keyPreview: maskKey(m.apiKey), ready: mediaTarget(config, kind).ready }];
      }),
    ),
  };
}

export const publicStore = (store) => ({ activeId: activeProfile(store).id, profiles: store.profiles.map(publicConfig) });

export function validateConfig(config, { requireModel = true } = {}) {
  const preset = getProvider(config.provider);
  if (!preset) return `Unknown provider "${config.provider}"`;
  for (const kind of MEDIA_KINDS) {
    const url = config[kind]?.baseUrl;
    if (url && !/^https?:\/\/[^\s/]+/.test(url)) return `The ${kind} BASE_URL_API must be an http(s) URL`;
  }
  if (preset.protocol === 'mock') return null;
  if (!config.baseUrl) return 'BASE_URL_API is required';
  try {
    const u = new URL(config.baseUrl);
    if (!/^https?:$/.test(u.protocol)) return 'BASE_URL_API must be http(s)';
  } catch {
    return 'BASE_URL_API is not a valid URL';
  }
  if (requireModel && !config.model) return 'Model is required';
  if (preset.needsKey && !config.apiKey) return 'API_KEY is required for this provider';
  return null;
}
