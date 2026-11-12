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

function buildRequest(protocol, config, { system, user, maxTokens }, withUsage = true) {
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
    // Ask for token counts in the last chunk. A few vendors reject the option; streamChat retries without it.
    ...(withUsage && { stream_options: { include_usage: true } }),
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

/** Token counts from a stream event, when it carries any: { inputTokens, outputTokens } (either may be absent). */
function usageOf(protocol, evt) {
  if (protocol === 'anthropic') {
    const u = evt.message?.usage || evt.usage;
    if (!u) return null;
    return { ...(u.input_tokens != null && { inputTokens: u.input_tokens }), ...(u.output_tokens != null && { outputTokens: u.output_tokens }) };
  }
  const u = evt.usage;
  if (!u) return null;
  return { inputTokens: u.prompt_tokens ?? u.input_tokens, outputTokens: u.completion_tokens ?? u.output_tokens };
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

/**
 * fetch() that turns network failures and non-2xx replies into readable GatewayErrors. Each says where it
 * came from (`host`, and `unreachable` or `upstream`), which is what src/errors.mjs reads the cause from.
 */
export async function request(url, init) {
  const host = new URL(url).host;
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') throw err;
    throw Object.assign(new GatewayError(`Could not reach ${host}: ${err.cause?.message || err.message}`, 502), { host, unreachable: true });
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 600);
    let detail = text;
    try {
      const j = JSON.parse(text);
      detail = j.error?.message || j.message || text;
    } catch {}
    throw Object.assign(new GatewayError(`${host} responded ${res.status}: ${detail || res.statusText}`, res.status), { host, upstream: true });
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

/**
 * Yields the reply as text chunks. `onUsage({ inputTokens, outputTokens })` is called once at the end
 * when the provider reported token counts (not all do).
 */
export async function* streamChat(config, { system, user, signal, maxTokens, meta, onUsage }) {
  const invalid = validateConfig(config);
  if (invalid) throw new GatewayError(invalid, 400);
  const { protocol } = getProvider(config.provider);

  if (protocol === 'mock') {
    yield* mockStream({ signal, meta });
    return;
  }

  const url = endpointFor(protocol, config.baseUrl);
  const send = (withUsage) => {
    const { headers, body } = buildRequest(protocol, config, { system, user, maxTokens }, withUsage);
    return request(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  };
  let res;
  try {
    res = await send(true);
  } catch (err) {
    if (protocol !== 'openai' || err.status !== 400 || !/stream_options|include_usage|unrecognized|unknown|extra/i.test(err.message)) throw err;
    res = await send(false);
  }

  const usage = {};
  for await (const data of sseData(res.body)) {
    if (!data || data === '[DONE]') continue;
    let evt;
    try {
      evt = JSON.parse(data);
    } catch {
      continue;
    }
    const u = usageOf(protocol, evt);
    if (u) for (const [k, v] of Object.entries(u)) if (Number.isFinite(v)) usage[k] = v;
    let text;
    try {
      text = deltaText(protocol, evt);
    } catch (err) {
      throw Object.assign(err, { host: new URL(url).host, upstream: true }); // the provider broke off mid-reply
    }
    if (text) yield text;
  }
  if (onUsage && (usage.inputTokens != null || usage.outputTokens != null)) onUsage(usage);
}

export async function completeChat(config, opts) {
  let out = '';
  for await (const t of streamChat(config, opts)) out += t;
  return out;
}
