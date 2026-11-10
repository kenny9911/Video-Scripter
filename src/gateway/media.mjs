// Image and video generation for a gateway, over the OpenAI-compatible media endpoints:
//   image: POST {base}/images/generations                      -> { data: [{ b64_json | url }] }
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

/**
 * Returns { url }: a data: URI when the provider sends base64, otherwise the provider's URL.
 * `aspectRatio` turns the gateway's Size setting to the shape of the video (see sizeFor).
 */
export async function generateImage(config, { prompt, aspectRatio, signal }) {
  const t = target(config, 'image');
  if (t.demo) return { url: demoImage(aspectRatio), usage: null };
  const size = sizeFor(t.size, aspectRatio);
  const body = { model: t.model, prompt, n: 1, ...(size && { size }) };
  const res = await request(`${t.base.replace(/\/images\/generations$/, '')}/images/generations`, {
    method: 'POST',
    headers: { ...t.headers, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const reply = await json(res, 'an image');
  const item = reply.data?.[0];
  const usage = reply.usage ? { inputTokens: reply.usage.input_tokens ?? reply.usage.prompt_tokens, outputTokens: reply.usage.output_tokens ?? reply.usage.completion_tokens } : null;
  if (item?.b64_json) return { url: `data:image/png;base64,${item.b64_json}`, usage };
  if (typeof item?.url === 'string' && /^https?:\/\//.test(item.url)) return { url: item.url, usage };
  throw new GatewayError(`${new URL(res.url).host} did not return an image`, 502);
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
