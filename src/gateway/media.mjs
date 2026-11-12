// Image and video generation for a gateway, over the OpenAI-compatible media endpoints:
//   image: POST {base}/images/generations                      -> { data: [{ b64_json | url }] }
//          POST {base}/images/edits (multipart, with reference images), where the provider has it
//   video: POST {base}/videos, GET {base}/videos/{id}, GET {base}/videos/{id}/content
// Each has its own base URL and model in the gateway settings (see mediaTarget in config.mjs).

import { getProvider } from './providers.mjs';
import { mediaTarget } from './config.mjs';
import { GatewayError, request } from './client.mjs';
import { getAspect, sizeFor } from '../aspects.mjs';

/** The demo provider's placeholder picture, in the shape asked for. */
function demoImage(aspectRatio) {
  const { id, w, h } = getAspect(aspectRatio);
  const k = 480 / Math.max(w, h);
  const [W, H] = [Math.round(w * k), Math.round(h * k)];
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#5b6cff"/><stop offset="1" stop-color="#19c3a6"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/><text x="${W / 2}" y="${H / 2}" fill="#fff" font-family="sans-serif" font-size="20" text-anchor="middle">Demo image</text><text x="${W / 2}" y="${H / 2 + 26}" fill="#fff" fill-opacity=".8" font-family="sans-serif" font-size="14" text-anchor="middle">${id}</text></svg>`,
  )}`;
}

function target(config, kind) {
  const t = mediaTarget(config, kind);
  if (t.demo) {
    if (kind === 'image') return t;
    throw new GatewayError('Demo mode cannot make videos. Set a video BASE_URL_API and model in LLM settings.', 400);
  }
  if (!t.model) throw new GatewayError(`No ${kind} model is set for "${config.name}". Add one under "Images and videos" in LLM settings.`, 400);
  if (!config[kind]?.baseUrl && getProvider(config.provider)?.protocol !== 'openai')
    throw new GatewayError(`Set a separate ${kind} BASE_URL_API for "${config.name}": its provider has no ${kind} endpoint.`, 400);
  if (!/^https?:\/\/[^\s/]+/.test(t.baseUrl)) throw new GatewayError(`The ${kind} BASE_URL_API is not a valid URL`, 400);
  const headers = { accept: 'application/json' };
  if (t.apiKey) headers.authorization = `Bearer ${t.apiKey}`;
  return { ...t, base: t.baseUrl.replace(/\/+$/, ''), headers };
}

async function json(res, what) {
  const body = await res.json().catch(() => null);
  if (!body || typeof body !== 'object') throw new GatewayError(`${new URL(res.url).host} did not return ${what}`, 502);
  return body;
}

/** The image in a provider's reply, as { url, usage }. */
async function imageOf(res) {
  const reply = await json(res, 'an image');
  const item = reply.data?.[0];
  const usage = reply.usage ? { inputTokens: reply.usage.input_tokens ?? reply.usage.prompt_tokens, outputTokens: reply.usage.output_tokens ?? reply.usage.completion_tokens } : null;
  if (item?.b64_json) return { url: `data:image/png;base64,${item.b64_json}`, usage };
  if (typeof item?.url === 'string' && /^https?:\/\//.test(item.url)) return { url: item.url, usage };
  throw new GatewayError(`${new URL(res.url).host} did not return an image`, 502);
}

// A provider and model that turned a reference image down, and how often. Not every image endpoint takes
// one: after two refusals in a row it is no longer asked, until the server restarts.
const refused = new Map();
const NO_ENDPOINT = new Set([404, 405, 501]);
const NOT_TAKEN = new Set([400, 415, 422]);

/** Whether this gateway's image model is still worth offering a reference image to. */
export function takesReference(config) {
  const t = mediaTarget(config, 'image');
  return !t.demo && (refused.get(`${t.baseUrl} ${t.model}`) || 0) < 2;
}

/**
 * Returns { url, usage }: a data: URI when the provider sends base64, otherwise the provider's URL.
 * `aspectRatio` turns the gateway's Size setting to the shape of the video (see sizeFor).
 * `references` ([{ bytes, type }]) are pictures the result has to match, such as a host's portrait: they go
 * to the provider's edits endpoint with `referencePrompt` (the prompt that mentions them). A provider that
 * has no such endpoint, or refuses the pictures, gets the plain `prompt` instead. The result says `referenced: true`
 * only when the pictures were used.
 */
export async function generateImage(config, { prompt, aspectRatio, signal, references = [], referencePrompt = prompt }) {
  const t = target(config, 'image');
  if (t.demo) return { url: demoImage(aspectRatio), usage: null };
  const size = sizeFor(t.size, aspectRatio);
  const root = t.base.replace(/\/images\/(?:generations|edits)$/, '');
  const key = `${t.baseUrl} ${t.model}`;

  if (references.length && takesReference(config)) {
    const form = new FormData();
    form.set('model', t.model);
    form.set('prompt', referencePrompt);
    form.set('n', '1');
    if (size) form.set('size', size);
    for (const [i, r] of references.entries()) form.append(references.length > 1 ? 'image[]' : 'image', new Blob([r.bytes], { type: r.type || 'image/png' }), `reference-${i + 1}.${(r.type || 'image/png').split('/')[1].replace('jpeg', 'jpg')}`);
    try {
      const made = await imageOf(await request(`${root}/images/edits`, { method: 'POST', headers: t.headers, body: form, signal }));
      refused.delete(key);
      return { ...made, referenced: true };
    } catch (err) {
      // No such endpoint: never ask again. The pictures were not taken: try without them, and stop asking after the second time.
      if (!err.upstream || !(NO_ENDPOINT.has(err.status) || NOT_TAKEN.has(err.status))) throw err;
      refused.set(key, NO_ENDPOINT.has(err.status) ? 2 : (refused.get(key) || 0) + 1);
    }
  }

  const body = { model: t.model, prompt, n: 1, ...(size && { size }) };
  const res = await request(`${root}/images/generations`, {
    method: 'POST',
    headers: { ...t.headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return imageOf(res);
}

const DONE = new Set(['completed', 'succeeded', 'success', 'done']);
const FAILED = new Set(['failed', 'error', 'cancelled', 'canceled', 'expired']);

function videoJob(j) {
  const id = String(j.id || j.task_id || '');
  if (!id) throw new GatewayError('The provider did not return a video job id', 502);
  const raw = String(j.status || '').toLowerCase();
  const url = [j.url, j.video_url, j.output?.url, j.data?.[0]?.url].find((u) => typeof u === 'string' && /^https?:\/\//.test(u));
  return {
    id,
    status: DONE.has(raw) || (url && !FAILED.has(raw)) ? 'done' : FAILED.has(raw) ? 'failed' : 'running',
    progress: Number(j.progress) || 0,
    error: FAILED.has(raw) ? j.error?.message || (typeof j.error === 'string' ? j.error : '') || `The provider reported "${raw}"` : '',
    url: url || '',
  };
}

/** The provider's clip lengths are fixed; pick the shortest one that covers the scene. */
export const clipSeconds = (seconds) => [4, 8, 12].find((s) => s >= seconds) || 12;

export async function createVideo(config, { prompt, seconds, aspectRatio, signal }) {
  const t = target(config, 'video');
  const size = sizeFor(t.size, aspectRatio);
  const body = { model: t.model, prompt, seconds: String(clipSeconds(Number(seconds) || 4)), ...(size && { size }) };
  const res = await request(`${t.base.replace(/\/videos$/, '')}/videos`, {
    method: 'POST',
    headers: { ...t.headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  return videoJob(await json(res, 'a video job'));
}

const jobUrl = (t, id) => `${t.base.replace(/\/videos$/, '')}/videos/${encodeURIComponent(id)}`;

export async function videoStatus(config, id, { signal } = {}) {
  const t = target(config, 'video');
  return videoJob(await json(await request(jobUrl(t, id), { headers: t.headers, signal }), 'a video job'));
}

/** The finished file, as a fetch Response to stream on. */
export async function videoContent(config, id, { signal } = {}) {
  const t = target(config, 'video');
  return request(`${jobUrl(t, id)}/content`, { headers: { ...t.headers, accept: '*/*' }, signal });
}
