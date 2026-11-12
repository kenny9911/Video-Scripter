// LLM gateway client: one streaming interface over several wire protocols.
//   for await (const text of streamChat(config, { system, user, signal })) { ... }
//
// A provider that wobbles is ridden out here, so nothing above this file has to care:
//   before a reply starts   502, 503, 504, 529, a rate limit or a dropped connection is asked again, a few
//                           times, with a growing pause (request)
//   in the middle of one    a stream that breaks, or ends before the reply is finished, is picked up where it
//                           stopped: the model is shown what it had written and asked for the rest (streamChat)
// `onRetry(info)` tells the caller each time, so the page can say what is going on.

import { getProvider } from './providers.mjs';
import { validateConfig } from './config.mjs';
import { mockStream } from './mock.mjs';
import { outOfCredit } from '../errors.mjs';
import { replyJson } from '../json.mjs';

export class GatewayError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
  }
}

const trimSlash = (s) => s.replace(/\/+$/, '');

/**
 * How hard a failing provider is tried again. `retries` before a reply starts. Once one has, it is picked up
 * for as long as each attempt adds to it: `resumes` attempts in a row that add nothing end it, and so do
 * `maxResumes` in all (a gateway that stops every reply after a minute needs several for a long script).
 * The pause grows from `baseMs` (GATEWAY_RETRY_BASE_MS in the environment, 900 ms otherwise) and never
 * exceeds `maxWaitMs`, even when the provider asks for longer. The tests make the pauses short.
 */
export const retryPolicy = { retries: 3, resumes: 3, maxResumes: 8, baseMs: Number(process.env.GATEWAY_RETRY_BASE_MS) || 900, maxWaitMs: 10_000 };

// Statuses that say "not now" rather than "not like this": a gateway without capacity, a timeout, an overloaded model.
const TRANSIENT = new Set([408, 425, 500, 502, 503, 504, 520, 521, 522, 523, 524, 529]);
// Of those, the ones that mean "it took too long": the work may still be going on at the provider.
const TIMED_OUT = new Set([408, 504, 524]);
// Network failures that will not get better by asking again: a wrong address, nothing listening, a bad certificate.
const HOPELESS = /ENOTFOUND|ECONNREFUSED|ERR_INVALID_URL|CERT_|SELF_SIGNED|ERR_TLS/i;
const isAbort = (err) => err?.name === 'AbortError' || err?.name === 'TimeoutError';

/** True when a failure is worth another try: the provider was reached, or nearly, and it is its moment that was wrong. */
export function isTransient(err) {
  if (!err || isAbort(err)) return false;
  if (err.unreachable) return !HOPELESS.test(`${err.code || ''} ${err.message}`);
  if (!err.upstream) return false;
  if (err.midstream) return !/authenti|permission|invalid_request|not_found|billing|quota|insufficient/i.test(`${err.kind || ''}`);
  return TRANSIENT.has(err.status) || (err.status === 429 && !outOfCredit(err.message));
}

/** How long to wait before try number `attempt` + 1: what the provider asked for, within reason, otherwise a growing pause. */
function pauseFor(err, attempt) {
  const asked = Number(err?.retryAfter) > 0 ? Number(err.retryAfter) * 1000 : 0;
  const grown = retryPolicy.baseMs * 2.5 ** attempt * (0.85 + Math.random() * 0.3);
  return Math.round(Math.min(retryPolicy.maxWaitMs, Math.max(asked, grown)));
}

/** A pause that ends early, with the signal's own error, when the request is stopped. */
const pause = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), { once: true });
  });

export function endpointFor(protocol, baseUrl) {
  const base = trimSlash(baseUrl);
  if (protocol === 'anthropic') {
    if (base.endsWith('/messages')) return base;
    return `${base.replace(/\/v1$/, '')}/v1/messages`;
  }
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
}

/**
 * What the model is told when its reply broke off: it sees what it had written (as its own turn) and is asked
 * for the rest. The last characters are quoted, so it knows the exact place.
 */
const continueFrom = (partial) =>
  `The connection dropped while you were writing, so your reply above stops in the middle. It ends with:\n<<<\n${partial.slice(-160)}\n>>>\nContinue from exactly the character after that. Write only what comes next: do not repeat anything that is already there, do not start again, and add no preamble, no apology and no markdown fence. The whole reply must read as if it had never been interrupted.`;

/** The user's turn with pictures to look at (`images`: [{ type, bytes }]), as each protocol takes them. */
function withImages(protocol, user, images) {
  if (!images?.length) return user;
  const data = (img) => Buffer.from(img.bytes).toString('base64');
  if (protocol === 'anthropic') return [...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.type, data: data(img) } })), { type: 'text', text: user }];
  return [{ type: 'text', text: user }, ...images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.type};base64,${data(img)}` } }))];
}

function buildRequest(protocol, config, { system, user, images, maxTokens, partial = '' }, withUsage = true) {
  const headers = { 'content-type': 'application/json', accept: 'text/event-stream' };
  // A reply that is being picked up: the model's own unfinished turn, then the request for the rest.
  const turns = [{ role: 'user', content: withImages(protocol, user, images) }, ...(partial ? [{ role: 'assistant', content: partial }, { role: 'user', content: continueFrom(partial) }] : [])];
  if (protocol === 'anthropic') {
    if (config.apiKey) headers['x-api-key'] = config.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    return {
      headers,
      body: { model: config.model, max_tokens: maxTokens || 8192, system, messages: turns, stream: true },
    };
  }
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  // Sampling params are deliberately left at vendor defaults: several vendors reject
  // temperature / max_tokens on their reasoning models.
  const body = {
    model: config.model,
    messages: [{ role: 'system', content: system }, ...turns],
    stream: true,
    // Ask for token counts in the last chunk. A few vendors reject the option; streamChat retries without it.
    ...(withUsage && { stream_options: { include_usage: true } }),
  };
  return { headers, body };
}

function deltaText(protocol, evt) {
  if (protocol === 'anthropic') {
    if (evt.type === 'error') throw Object.assign(new GatewayError(evt.error?.message || 'Upstream stream error'), { kind: evt.error?.type || '' });
    return evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' ? evt.delta.text : '';
  }
  if (evt.error) throw Object.assign(new GatewayError(evt.error.message || 'Upstream stream error'), { kind: `${evt.error.type || ''} ${evt.error.code || ''}` });
  return evt.choices?.[0]?.delta?.content || '';
}

/** Why the provider says a reply ended, when a stream event says so ('' otherwise): "stop", "end_turn", "length", "max_tokens"... */
function stopReason(protocol, evt) {
  if (protocol === 'anthropic') return evt.type === 'message_stop' ? 'stop' : (evt.type === 'message_delta' && evt.delta?.stop_reason) || '';
  return evt.choices?.[0]?.finish_reason || '';
}

/**
 * True when a reply holds a JSON object that was started and never closed: the mark of a reply cut short.
 * Every reply this app asks for is one JSON object; a reply with no object in it (a connection test) is never "open".
 */
export function jsonOpen(text) {
  const body = String(text || '').replace(/<think>[\s\S]*?<\/think>/g, '');
  let depth = 0;
  let inString = false;
  let seen = false;
  for (let i = body.indexOf('{'); i >= 0 && i < body.length; i++) {
    const c = body[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{' || c === '[') (depth++, (seen = true));
    else if (c === '}' || c === ']') {
      if (--depth === 0) return false;
    }
  }
  return seen;
}

/** True when a reply was cut short: its JSON is still open, and what there is cannot be read as it stands. */
export function cutShort(text) {
  if (!jsonOpen(text)) return false;
  try {
    replyJson(text);
    return false; // a slip the reader mends: the reply is all there
  } catch {
    return true;
  }
}

const PROGRESS = 16; // characters an attempt has to add to count as getting somewhere: a stray bracket does not
const SEAM = 1500; // how far back a model may reach when it repeats itself at the start of a continuation
const MIN_REPEAT = 8;

/**
 * Joins a continuation to what was already written. A model asked to carry on sometimes opens with a fence
 * or repeats the end of what it had; the first stretch of the continuation is held back until that can be
 * seen, and whatever it repeats is dropped. Returns feed(text) -> text to pass on, with feed.flush() for the end.
 */
function joiner(partial) {
  let held = '';
  let settled = false;
  const settle = () => {
    settled = true;
    const text = held.replace(/^\s*```(?:json)?[ \t]*\n?/i, '').replace(/^[\r\n]+/, '');
    const tail = partial.slice(-SEAM);
    for (let k = Math.min(text.length, tail.length); k >= MIN_REPEAT; k--) if (tail.endsWith(text.slice(0, k))) return text.slice(k);
    return text;
  };
  const feed = (text) => {
    if (settled) return text;
    held += text;
    return held.length >= SEAM ? settle() : '';
  };
  feed.flush = () => (settled ? '' : settle());
  return feed;
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

/** One fetch, with network failures and non-2xx replies turned into readable GatewayErrors that say where they came from. */
async function requestOnce(url, init) {
  const host = new URL(url).host;
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (isAbort(err)) throw err;
    throw Object.assign(new GatewayError(`Could not reach ${host}: ${err.cause?.message || err.message}`, 502), { host, unreachable: true, code: err.cause?.code || '' });
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 600);
    let detail = text;
    try {
      const j = JSON.parse(text);
      detail = j.error?.message || j.message || j.detail || j.title || text;
    } catch {}
    const retryAfter = Number(res.headers.get('retry-after')) || 0;
    throw Object.assign(new GatewayError(`${host} responded ${res.status}: ${detail || res.statusText}`, res.status), { host, upstream: true, ...(retryAfter && { retryAfter }) });
  }
  return res;
}

/**
 * fetch() that turns network failures and non-2xx replies into readable GatewayErrors. Each says where it
 * came from (`host`, and `unreachable` or `upstream`), which is what src/errors.mjs reads the cause from.
 * A failure that is the provider's moment rather than the request's (502, 503, 504, 529, a rate limit, a
 * dropped connection) is asked again up to `retries` times, with a growing pause; `onRetry` hears of each.
 * `timeouts` caps how often a gateway timeout (504, 524) is asked again: a request that makes something
 * costly, an image or a video, may still be running at the provider, and asking again makes a second one.
 * The error that is finally thrown says how many `attempts` were made.
 */
export async function request(url, init = {}, { retries = retryPolicy.retries, timeouts = retries, onRetry } = {}) {
  let timedOut = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      return await requestOnce(url, init);
    } catch (err) {
      const again = attempt < retries && isTransient(err) && !init.signal?.aborted && (!TIMED_OUT.has(err.status) || timedOut++ < timeouts);
      if (!again) throw attempt ? Object.assign(err, { attempts: attempt + 1 }) : err;
      const waitMs = pauseFor(err, attempt);
      onRetry?.({ attempt: attempt + 1, of: retries, status: err.status, host: err.host, waitMs, resumed: false, reason: err.message.slice(0, 200) });
      await pause(waitMs, init.signal);
    }
  }
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
 * One request for a reply, or for the rest of one (`partial` is what was already written). Yields text;
 * throws a GatewayError marked `midstream` when the stream breaks or ends before the reply is finished.
 * Token counts of the attempt are added to `usage` whichever way it ends.
 */
async function* streamOnce(protocol, url, config, { system, user, images, maxTokens, signal, onRetry, partial, usage }) {
  const host = new URL(url).host;
  const send = (withUsage) => {
    const { headers, body } = buildRequest(protocol, config, { system, user, images, maxTokens, partial }, withUsage);
    return request(url, { method: 'POST', headers, body: JSON.stringify(body), signal }, { onRetry });
  };
  let res;
  try {
    res = await send(true);
  } catch (err) {
    if (protocol !== 'openai' || err.status !== 400 || !/stream_options|include_usage|unrecognized|unknown|extra/i.test(err.message)) throw err;
    res = await send(false);
  }

  const mine = {};
  const join = partial ? joiner(partial) : null;
  let written = partial;
  let ended = ''; // why the provider says the reply ended; '' when it never said
  let broke = null; // the provider broke off mid-reply
  try {
    try {
      for await (const data of sseData(res.body)) {
        if (!data) continue;
        if (data === '[DONE]') {
          ended ||= 'stop';
          continue;
        }
        let evt;
        try {
          evt = JSON.parse(data);
        } catch {
          continue;
        }
        const u = usageOf(protocol, evt);
        if (u) for (const [k, v] of Object.entries(u)) if (Number.isFinite(v)) mine[k] = v;
        ended = stopReason(protocol, evt) || ended;
        let text = deltaText(protocol, evt);
        if (text && join) text = join(text);
        if (text) {
          written += text;
          yield text;
        }
      }
    } catch (err) {
      if (isAbort(err)) {
        // Out of time (src/limits.mjs): what a continuation was still holding back is written all the same,
        // so the request that carries the reply on starts from everything the model has said.
        const kept = err.name === 'TimeoutError' ? join?.flush() : '';
        if (kept) yield kept;
        throw err;
      }
      // With an error of its own, or by dropping the connection (which the body stream reports as a TypeError).
      broke = err instanceof GatewayError ? Object.assign(err, { host, upstream: true, midstream: true }) : Object.assign(new GatewayError(`${host} dropped the connection in the middle of its reply`), { host, upstream: true, midstream: true, cause: err });
    }
    // What a continuation was still holding back is passed on however it ended: it is progress all the same.
    const rest = join?.flush();
    if (rest) {
      written += rest;
      yield rest;
    }
  } finally {
    for (const [k, v] of Object.entries(mine)) usage[k] = (usage[k] || 0) + v;
  }
  if (broke) throw broke;
  // The stream is over. A JSON reply that is still open was cut short, whatever the provider says about how it
  // ended: a gateway that stops a long reply (after a minute, say) closes the stream as if the model had finished.
  // Only a reply the provider withheld on purpose is left as it is.
  if (cutShort(written) && !/filter|refus|safety|block/i.test(ended)) {
    throw Object.assign(new GatewayError(`${host} ended its reply before it was finished`), { host, upstream: true, midstream: true, cut: true, ended });
  }
}

/**
 * Yields the reply as text chunks. `onUsage({ inputTokens, outputTokens })` is called once at the end
 * when the provider reported token counts (not all do); the counts of every attempt are added up.
 * A reply that breaks off is picked up where it stopped, for as long as each attempt adds to it (see
 * retryPolicy): what is yielded is always one continuous reply. `onRetry(info)` hears of every new attempt: `info.resumed` says whether a
 * reply was under way (true) or had not begun (false).
 * `partial` is the start of this reply as an earlier request left it (one that ran out of time: src/limits.mjs).
 * The model is asked for the rest, and only the rest is yielded.
 * `images` ([{ type, bytes }]) are pictures the model is to look at with the user's turn (src/vision.mjs).
 */
export async function* streamChat(config, { system, user, images, signal, maxTokens, meta, onUsage, onRetry, partial = '' }) {
  const invalid = validateConfig(config);
  if (invalid) throw new GatewayError(invalid, 400);
  const { protocol } = getProvider(config.provider);

  if (protocol === 'mock') {
    yield* mockStream({ signal, meta, partial });
    return;
  }

  const url = endpointFor(protocol, config.baseUrl);
  const usage = {};
  let said = String(partial || '');
  let idle = 0; // attempts in a row that added nothing
  for (let resumes = 0; ; resumes++) {
    const had = said.length;
    try {
      for await (const text of streamOnce(protocol, url, config, { system, user, images, maxTokens, signal, onRetry, partial: said, usage })) {
        said += text;
        yield text;
      }
      break;
    } catch (err) {
      idle = said.length - had >= PROGRESS ? 0 : idle + 1;
      // Once part of a reply is in hand it is not given up lightly: a provider that refuses the request for the rest
      // (no capacity, again) is asked again like one that broke off, where a reply that never began would end here.
      const again = (err.midstream || said) && isTransient(err) && idle <= retryPolicy.resumes && resumes < retryPolicy.maxResumes && !signal?.aborted;
      if (!again) throw resumes ? Object.assign(err, { attempts: resumes + 1 }) : err;
      const waitMs = pauseFor(err, 0);
      onRetry?.({ attempt: resumes + 1, of: retryPolicy.maxResumes, host: err.host, waitMs, resumed: Boolean(said), cut: Boolean(err.cut), written: said.length, reason: err.message.slice(0, 200) });
      await pause(waitMs, signal);
    }
  }
  if (onUsage && (usage.inputTokens != null || usage.outputTokens != null)) onUsage(usage);
}

export async function completeChat(config, opts) {
  let out = '';
  for await (const t of streamChat(config, opts)) out += t;
  return out;
}
