// LLM gateway client: one streaming interface over several wire protocols.
//   for await (const text of streamChat(config, { system, user, signal })) { ... }

import { getProvider } from './providers.mjs';
import { validateConfig } from './config.mjs';
import { mockStream } from './mock.mjs';

export class GatewayError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
  }
}

const trimSlash = (s) => s.replace(/\/+$/, '');

export function endpointFor(protocol, baseUrl) {
  const base = trimSlash(baseUrl);
  if (protocol === 'anthropic') {
    if (base.endsWith('/messages')) return base;
    return `${base.replace(/\/v1$/, '')}/v1/messages`;
  }
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

function buildRequest(protocol, config, { system, user, maxTokens }) {
  const headers = { 'content-type': 'application/json', accept: 'text/event-stream' };
  if (protocol === 'anthropic') {
    if (config.apiKey) headers['x-api-key'] = config.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    return {
      headers,
      body: { model: config.model, max_tokens: maxTokens || 8192, system, messages: [{ role: 'user', content: user }], stream: true },
    };
  }
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  // Sampling params are deliberately left at vendor defaults: several vendors reject
  // temperature / max_tokens on their reasoning models.
  const body = {
    model: config.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    stream: true,
  };
  return { headers, body };
}

function deltaText(protocol, evt) {
  if (protocol === 'anthropic') {
    if (evt.type === 'error') throw new GatewayError(evt.error?.message || 'Upstream stream error');
    return evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' ? evt.delta.text : '';
  }
  if (evt.error) throw new GatewayError(evt.error.message || 'Upstream stream error');
  return evt.choices?.[0]?.delta?.content || '';
}

/** Parse a fetch body as Server-Sent Events, yielding each `data:` payload. */
async function* sseData(body) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  const rest = buf.trim();
  if (rest.startsWith('data:')) yield rest.slice(5).trim();
}

/** fetch() that turns network failures and non-2xx replies into readable GatewayErrors. */
export async function request(url, init) {
  const host = new URL(url).host;
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') throw err;
    throw new GatewayError(`Could not reach ${host}: ${err.cause?.message || err.message}`, 502);
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 600);
    let detail = text;
    try {
      const j = JSON.parse(text);
      detail = j.error?.message || j.message || text;
    } catch {}
    throw new GatewayError(`${host} responded ${res.status}: ${detail || res.statusText}`, res.status);
  }
  return res;
}

export function modelsEndpointFor(protocol, baseUrl) {
  const base = trimSlash(baseUrl);
  if (protocol === 'anthropic') return `${base.replace(/\/messages$/, '').replace(/\/v1$/, '')}/v1/models?limit=1000`;
  return `${base.replace(/\/chat\/completions$/, '')}/models`;
}

/** Ask the provider which models this key can use. Returns a sorted list of model ids. */
export async function listModels(config, { signal } = {}) {
  const invalid = validateConfig(config, { requireModel: false });
  if (invalid) throw new GatewayError(invalid, 400);
  const { protocol } = getProvider(config.provider);
  if (protocol === 'mock') return ['demo'];

  const headers = { accept: 'application/json' };
  if (protocol === 'anthropic') {
    if (config.apiKey) headers['x-api-key'] = config.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;

  const url = modelsEndpointFor(protocol, config.baseUrl);
  const res = await request(url, { headers, signal });
  const body = await res.json().catch(() => null);
  const rows = Array.isArray(body) ? body : body?.data || body?.models;
  if (!Array.isArray(rows)) throw new GatewayError(`${new URL(url).host} did not return a model list`, 502);
  const ids = rows
    .map((m) => (typeof m === 'string' ? m : m?.id || m?.name || ''))
    .map((id) => String(id).replace(/^models\//, ''))
    .filter(Boolean);
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

export async function* streamChat(config, { system, user, signal, maxTokens, meta }) {
  const invalid = validateConfig(config);
  if (invalid) throw new GatewayError(invalid, 400);
  const { protocol } = getProvider(config.provider);

  if (protocol === 'mock') {
    yield* mockStream({ signal, meta });
    return;
  }

  const url = endpointFor(protocol, config.baseUrl);
  const { headers, body } = buildRequest(protocol, config, { system, user, maxTokens });
  const res = await request(url, { method: 'POST', headers, body: JSON.stringify(body), signal });

  for await (const data of sseData(res.body)) {
    if (!data || data === '[DONE]') continue;
    let evt;
    try {
      evt = JSON.parse(data);
    } catch {
      continue;
    }
    const text = deltaText(protocol, evt);
    if (text) yield text;
  }
}

export async function completeChat(config, opts) {
  let out = '';
  for await (const t of streamChat(config, opts)) out += t;
  return out;
}
