// Which door of a gateway a model is called at, and the Gemini wire format.
//
// This file exists because of a failure that must not come back. A gateway that fronts several vendors
// (aigw.store runs Sub2API) serves each key in its upstream's own format. On 2026-11-13 a key of a Gemini
// group answered, at the same moment and for the same one-word question:
//
//   POST /v1/chat/completions                              429  Rate limit exceeded, please retry later
//   POST /v1/responses                                     429  Rate limit exceeded, please retry later
//   POST /v1/messages                                      400  This group does not allow cross-protocol conversion
//   POST /v1beta/openai/chat/completions                   404  404 page not found
//   POST /v1beta/models/{model}:generateContent            200  OK
//   POST /v1beta/models/{model}:streamGenerateContent      200  OK, streamed
//
// No rate limit was set on the key. The OpenAI-style door of that group is a conversion on the gateway's side
// with bad spells of its own: it answered 429 from 22:26 until at least 22:45 that evening, and 200 again by
// 23:05, while the Gemini door answered throughout. The app called the OpenAI-style door only, tried four
// times and reported a rate limit. The stand-in below answers each door with what the
// real one answered that day, and the tests hold the app to the door that works.
//
// The Gemini door has a habit of its own, found the same evening: it sends nothing, not even its headers,
// until the model has something to say, and gemini-4-carbon-high thought for 100 seconds about the narration
// agent's prompt. Cloudflare, in front of the gateway, gives up on a silent connection at about that point
// (524). Asked for its thoughts as well, the model starts streaming them after 18 seconds, which keeps the
// connection open; the thoughts are then left out of the reply. So every Gemini request asks for them.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { GatewayError, streamChat, completeChat, listModels, endpointFor, modelsEndpointFor, endpointOf, wireFor, geminiRoot, isGeminiModel, forgetDoors, retryPolicy, isTransient } from '../src/gateway/client.mjs';
import { getProvider } from '../src/gateway/providers.mjs';
import { validateConfig } from '../src/gateway/config.mjs';
import { causeOf } from '../src/errors.mjs';

retryPolicy.baseMs = 2; // what is tested is that it tries again, not how long it waits

const KEY = 'sk-gemini-group-key';
const MODELS = ['gemini-4-argon', 'gemini-4-argon-high', 'gemini-4-carbon', 'gemini-4-carbon-high'];
const RATE_LIMIT = { error: { message: 'Rate limit exceeded, please retry later', type: 'rate_limit_error' } };

// A reply as the Gemini door streams it: text in parts, the counts so far on every chunk, and a last chunk
// that carries only the signature of the model's thinking.
const chunk = (text, usage = {}) => ({ candidates: [{ content: { role: 'model', parts: [{ text }] } }], usageMetadata: { promptTokenCount: 280, thoughtsTokenCount: 466, ...usage }, modelVersion: 'gemini-4-carbon-high' });
const last = (usage = {}) => ({ candidates: [{ content: { role: 'model', parts: [{ thoughtSignature: 'EqIRCp8RAWkUfRP2Mh8F6PeC', text: '' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 316, thoughtsTokenCount: 466, ...usage } });
const REPLY = [chunk('{"lines":["每天背电脑', { candidatesTokenCount: 25 }), chunk('挤地铁"]}', { candidatesTokenCount: 49 }), last({ candidatesTokenCount: 92 })];

/**
 * A gateway like aigw.store, for a key of a Gemini group. `gemini` scripts its Gemini door, one entry per
 * request (the last one repeats): a list of chunks to stream, { status, body } to refuse, or 'drop' to break
 * off after the first chunk. `chat` does the same for the OpenAI-style door, which by default answers as the
 * real one did. `hasGeminiDoor: false` makes it an OpenAI-only gateway; `lists` is what its Gemini door says
 * it offers.
 */
async function gateway(t, { gemini = [REPLY], chat = [{ status: 429, body: RATE_LIMIT, headers: { 'retry-after': '0' } }], hasGeminiDoor = true, lists = MODELS, listStatus = 200, thinksMs = 0 } = {}) {
  const seen = [];
  const calls = { gemini: 0, chat: 0 };
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = null;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {}
    const url = new URL(req.url, 'http://gateway.test');
    seen.push({ method: req.method, path: url.pathname, query: url.search, headers: req.headers, body });
    const json = (status, data, headers = {}) => res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(data));
    const stream = (events, done) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const e of events) res.write(`data: ${JSON.stringify(e)}\n\n`);
      if (done) res.write('data: [DONE]\n\n');
      res.end();
    };
    const keyOk = req.headers['x-goog-api-key'] === KEY || req.headers.authorization === `Bearer ${KEY}`;

    if (url.pathname.startsWith('/v1beta/openai')) return res.writeHead(404, { 'content-type': 'text/plain' }).end('404 page not found');
    if (url.pathname.startsWith('/v1beta/') && !hasGeminiDoor) return res.writeHead(404, { 'content-type': 'text/plain' }).end('404 page not found');
    if (url.pathname.startsWith('/v1beta/') && !keyOk) return json(401, { error: { code: 401, message: 'API key is required', status: 'UNAUTHENTICATED' } });
    if (req.method === 'GET' && url.pathname === '/v1beta/models') {
      if (listStatus !== 200) return json(listStatus, { error: { code: listStatus, message: 'Service temporarily unavailable', status: 'UNAVAILABLE' } });
      return json(200, { models: [...lists.map((m) => ({ name: `models/${m}`, supportedGenerationMethods: ['generateContent', 'streamGenerateContent'] })), { name: 'models/gemini-embedding-9', supportedGenerationMethods: ['embedContent'] }] });
    }
    const native = /^\/v1beta\/models\/([^/:]+):streamGenerateContent$/.exec(url.pathname);
    if (req.method === 'POST' && native) {
      const step = gemini[Math.min(calls.gemini++, gemini.length - 1)];
      if (step === 'drop') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify(REPLY[0])}\n\n`);
        return setTimeout(() => req.socket.destroy(), 5);
      }
      if (step.status) return json(step.status, step.body, step.headers);
      if (thinksMs) await new Promise((resolve) => setTimeout(resolve, thinksMs)); // silent while it thinks, as the real door is
      return stream(step, false);
    }
    if (req.method === 'GET' && url.pathname === '/v1/models') return json(200, { object: 'list', data: MODELS.map((id) => ({ id, object: 'model' })) });
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
      const step = chat[Math.min(calls.chat++, chat.length - 1)];
      if (step.status) return json(step.status, step.body, step.headers);
      return stream(step, true);
    }
    if (req.method === 'POST' && url.pathname === '/v1/responses') return json(429, { error: { code: 'rate_limit_error', message: RATE_LIMIT.error.message } }, { 'retry-after': '5' });
    if (req.method === 'POST' && url.pathname === '/v1/messages') return json(400, { error: { message: 'This group does not allow cross-protocol conversion (Anthropic Messages <-> OpenAI Responses/Chat Completions).', type: 'invalid_request_error' } });
    res.writeHead(404, { 'content-type': 'text/plain' }).end('404 page not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  forgetDoors(); // every test starts with nothing known about any gateway
  const posts = () => seen.filter((r) => r.method === 'POST').map((r) => r.path);
  const asked = () => seen.filter((r) => r.method === 'GET' && r.path === '/v1beta/models').length;
  return { seen, posts, asked, base: `http://127.0.0.1:${server.address().port}` };
}

const saved = (base, extra = {}) => ({ provider: 'custom', baseUrl: base, apiKey: KEY, model: 'gemini-4-carbon-high', ...extra }); // as the gateway was saved in LLM settings
const openaiDelta = (content) => ({ choices: [{ delta: { content } }] });
const CHAT_REPLY = [openaiDelta('from the '), openaiDelta('chat door'), { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 9, completion_tokens: 4 } }];
const ask = async (config, extra = {}) => {
  const retries = [];
  let usage = null;
  const text = await completeChat(config, { system: 'You answer with JSON only.', user: 'Three opening lines.', onRetry: (r) => retries.push(r), onUsage: (u) => (usage = u), ...extra });
  return { text, retries, usage };
};
const NATIVE = '/v1beta/models/gemini-4-carbon-high:streamGenerateContent';

test('the Gemini door of a gateway is found from any address it may have been saved with', () => {
  for (const base of ['https://aigw.store', 'https://aigw.store/', 'https://aigw.store/v1', 'https://aigw.store/v1/', 'https://aigw.store/v1beta', 'https://aigw.store/v1beta/openai', 'https://aigw.store/v1/chat/completions']) {
    assert.equal(geminiRoot(base), 'https://aigw.store', base);
    assert.equal(endpointFor('gemini', base, 'gemini-4-carbon-high'), 'https://aigw.store/v1beta/models/gemini-4-carbon-high:streamGenerateContent?alt=sse', base);
    assert.equal(modelsEndpointFor('gemini', base), 'https://aigw.store/v1beta/models?pageSize=1000', base);
  }
  assert.equal(endpointFor('gemini', 'https://generativelanguage.googleapis.com', 'models/gemini-2.5-flash'), 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse');
  assert.equal(geminiRoot('https://proxy.example/google/v1beta'), 'https://proxy.example/google');
  // The other formats are where they were.
  assert.equal(endpointFor('openai', 'https://aigw.store'), 'https://aigw.store/v1/chat/completions');
  assert.equal(endpointFor('openai', 'https://aigw.store', 'gemini-4-carbon-high'), 'https://aigw.store/v1/chat/completions');
  assert.equal(endpointFor('anthropic', 'https://aigw.store'), 'https://aigw.store/v1/messages');
});

test('a model is Gemini\'s by its name; a route of an aggregator is not', () => {
  for (const m of ['gemini-4-carbon-high', 'gemini-4-argon', 'gemini-2.5-flash', 'models/gemini-2.5-pro', 'Gemini-3.8-flash-high', 'gemini_exp']) assert.equal(isGeminiModel(m), true, m);
  for (const m of ['google/gemini-2.5-pro', 'gpt-5.5', 'claude-sonnet-5-5', 'gemma-3', 'geminiish', 'my-gemini-4', '', undefined]) assert.equal(isGeminiModel(m), false, String(m));
});

test('a Gemini model on a gateway like aigw.store is called at its Gemini door, not at the one that answers 429', async (t) => {
  const gw = await gateway(t);
  const config = saved(gw.base); // provider "custom" (OpenAI-compatible), the bare host: exactly what was saved
  assert.deepEqual(await endpointOf(config), { protocol: 'gemini', url: `${gw.base}${NATIVE}` });

  const { text, retries, usage } = await ask(config);
  assert.equal(text, '{"lines":["每天背电脑挤地铁"]}'); // the parts joined; the signature-only part adds nothing
  assert.deepEqual(retries, []);
  assert.deepEqual(gw.posts(), [NATIVE]); // the OpenAI-style door was never knocked on
  // The request is Gemini's: the key in its header, the system text apart, the turns as contents, the model in the address.
  const sent = gw.seen.at(-1);
  assert.deepEqual([sent.query, sent.headers['x-goog-api-key'], sent.headers.authorization], ['?alt=sse', KEY, undefined]);
  // The thoughts are asked for too: they are what keeps a long-thinking reply from being cut off as silent.
  assert.deepEqual(sent.body, { systemInstruction: { parts: [{ text: 'You answer with JSON only.' }] }, contents: [{ role: 'user', parts: [{ text: 'Three opening lines.' }] }], generationConfig: { thinkingConfig: { includeThoughts: true } } });
  // Counts come from the last chunk, and what the model thought is output too.
  assert.deepEqual(usage, { inputTokens: 316, outputTokens: 92 + 466 });

  // The gateway is asked what it offers once, not before every call; the same holds however the address was written.
  await ask(config);
  await ask(saved(`${gw.base}/v1`));
  await ask(saved(`${gw.base}/v1/`, { provider: 'openai' }));
  assert.equal(gw.asked(), 1);
  assert.deepEqual(gw.posts(), [NATIVE, NATIVE, NATIVE, NATIVE]);
  // Another key may belong to another group: it is asked about on its own.
  await assert.rejects(ask(saved(gw.base, { apiKey: 'sk-other' })), /429: Rate limit exceeded/);
  assert.equal(gw.asked(), 2);
});

test('what failed on 2026-11-13 is still what the OpenAI-style door says, and it is told as the provider\'s rate limit', async (t) => {
  const gw = await gateway(t, { hasGeminiDoor: false });
  const err = await ask(saved(gw.base)).catch((e) => e);
  assert.match(err.message, /responded 429: Rate limit exceeded, please retry later/);
  assert.deepEqual([causeOf(err).side, causeOf(err).code, err.attempts], ['provider', 'busy', retryPolicy.retries + 1]);
  assert.ok(gw.posts().every((p) => p === '/v1/chat/completions'));
});

test('a conversation, a picture and a reply that is picked up all travel in Gemini\'s format', async (t) => {
  const gw = await gateway(t, { gemini: ['drop', [chunk('挤地铁"]}'), last()]] });
  const png = Buffer.from('not really a png');
  const { text, retries } = await ask(saved(gw.base), { history: [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi.' }], images: [{ type: 'image/png', bytes: png }] });
  assert.equal(text, '{"lines":["每天背电脑挤地铁"]}'); // one reply, though it came in two requests
  assert.deepEqual([retries.length, retries[0].resumed], [1, true]);
  const [first, second] = gw.seen.filter((r) => r.method === 'POST').map((r) => r.body.contents);
  assert.deepEqual(first, [
    { role: 'user', parts: [{ text: 'Hello' }] },
    { role: 'model', parts: [{ text: 'Hi.' }] },
    { role: 'user', parts: [{ text: 'Three opening lines.' }, { inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] },
  ]);
  // Picked up: the model is shown what it had written, as its own turn, and asked for the rest.
  assert.deepEqual([second.length, second[3].role, second[3].parts[0].text, second[4].role], [5, 'model', '{"lines":["每天背电脑', 'user']);
  assert.match(second[4].parts[0].text, /Continue from exactly the character after that/);
});

test('an error the Gemini door sends inside its stream is tried again when it may pass, and not when it will not', async (t) => {
  const busy = [{ error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED' } }];
  let gw = await gateway(t, { gemini: [busy, REPLY] });
  const again = await ask(saved(gw.base));
  assert.deepEqual([again.text, again.retries.length], ['{"lines":["每天背电脑挤地铁"]}', 1]);

  gw = await gateway(t, { gemini: [[{ error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } }]] });
  const err = await ask(saved(gw.base)).catch((e) => e);
  assert.match(err.message, /does not have permission/);
  assert.deepEqual([isTransient(err), gw.posts().length], [false, 1]);

  // A thought spoken aloud is not part of the reply, and a prompt the model would not take ends the reply without asking again.
  gw = await gateway(t, { gemini: [[{ candidates: [{ content: { parts: [{ text: 'Let me think.', thought: true }, { text: 'OK' }] }, finishReason: 'STOP' }] }]] });
  assert.equal((await ask(saved(gw.base))).text, 'OK');
  gw = await gateway(t, { gemini: [[{ promptFeedback: { blockReason: 'SAFETY' } }]] });
  assert.deepEqual([(await ask(saved(gw.base))).text, gw.posts().length], ['', 1]);
});

test('the thoughts that keep the stream alive are never part of the reply, and a model that cannot think is asked without them', async (t) => {
  // As the real door streamed it: thoughts first, for a long while, then the reply.
  const thinking = (text) => ({ candidates: [{ content: { role: 'model', parts: [{ text, thought: true }] } }], usageMetadata: { promptTokenCount: 4936 } });
  let gw = await gateway(t, { gemini: [[thinking("I'm thinking through how to approach this.\n\n"), thinking('The structure requires {"five": "segments"}.'), chunk('{"title":"本体库"', { thoughtsTokenCount: 8147, candidatesTokenCount: 300 }), chunk('}', { thoughtsTokenCount: 8147, candidatesTokenCount: 509 }), last({ thoughtsTokenCount: 8147, candidatesTokenCount: 509 })]] });
  const { text, usage } = await ask(saved(gw.base));
  assert.equal(text, '{"title":"本体库"}');
  assert.deepEqual(usage, { inputTokens: 316, outputTokens: 509 + 8147 }); // thinking is paid for, and counted

  const refused = { status: 400, body: { error: { code: 400, message: 'Unable to submit request because thinking is not supported by this model.', status: 'INVALID_ARGUMENT' } } };
  gw = await gateway(t, { gemini: [refused, REPLY] });
  const plain = await ask(saved(gw.base));
  assert.deepEqual([plain.text, plain.retries], ['{"lines":["每天背电脑挤地铁"]}', []]);
  const [first, second] = gw.seen.filter((r) => r.method === 'POST').map((r) => r.body);
  assert.deepEqual([first.generationConfig, second.generationConfig, second.contents], [{ thinkingConfig: { includeThoughts: true } }, undefined, first.contents]);
  // Any other refusal is the request's own fault and is told as it is.
  gw = await gateway(t, { gemini: [{ status: 400, body: { error: { code: 400, message: 'The input token count exceeds the maximum number of tokens allowed.', status: 'INVALID_ARGUMENT' } } }] });
  await assert.rejects(ask(saved(gw.base)), /responded 400: The input token count exceeds/);
  assert.equal(gw.posts().length, 1);
});

test('a gateway with no Gemini door is called as before, and is asked about it once', async (t) => {
  const gw = await gateway(t, { hasGeminiDoor: false, chat: [CHAT_REPLY] });
  assert.equal(await wireFor(saved(gw.base)), 'openai');
  assert.deepEqual([(await ask(saved(gw.base))).text, (await ask(saved(gw.base))).usage], ['from the chat door', { inputTokens: 9, outputTokens: 4 }]);
  assert.deepEqual([gw.asked(), gw.posts()], [1, ['/v1/chat/completions', '/v1/chat/completions']]);
  assert.equal(gw.seen.at(-1).headers.authorization, `Bearer ${KEY}`);
});

test('only a Gemini model is asked about, and an address that names the OpenAI-style door is taken at its word', async (t) => {
  const gw = await gateway(t, { chat: [CHAT_REPLY] });
  for (const model of ['gpt-5.5', 'claude-sonnet-5-5', 'google/gemini-2.5-pro']) assert.equal((await ask(saved(gw.base, { model }))).text, 'from the chat door', model);
  assert.equal((await ask(saved(`${gw.base}/v1/chat/completions`))).text, 'from the chat door');
  assert.equal(await wireFor(saved('https://generativelanguage.googleapis.com/v1beta/openai', { provider: 'gemini', model: 'gemini-2.5-flash' })), 'openai');
  assert.equal(gw.asked(), 0);
  // A model the Gemini door does not list for this key goes the OpenAI way too.
  assert.equal((await ask(saved(gw.base, { model: 'gemini-9-unlisted' }))).text, 'from the chat door');
  // Anthropic's format is never turned into anything else.
  assert.equal(await wireFor({ provider: 'custom-anthropic', baseUrl: gw.base, apiKey: KEY, model: 'gemini-4-carbon-high' }), 'anthropic');
});

test('a Gemini door that lists a model and then has no reply to give is left for the door the preset names', async (t) => {
  const gw = await gateway(t, { gemini: [{ status: 404, body: { error: { code: 404, message: 'models/gemini-4-carbon-high is not found for API version v1beta', status: 'NOT_FOUND' } } }], chat: [CHAT_REPLY] });
  const { text, retries } = await ask(saved(gw.base));
  assert.deepEqual([text, retries], ['from the chat door', []]);
  assert.deepEqual(gw.posts(), [NATIVE, '/v1/chat/completions']);
  // And it is not tried again on the next call.
  await ask(saved(gw.base));
  assert.deepEqual(gw.posts().slice(2), ['/v1/chat/completions']);
});

test('a Gemini door that is busy is waited for, not given up: a rate limit there is not "no such door"', async (t) => {
  const gw = await gateway(t, { gemini: [{ status: 429, body: { error: { code: 429, message: 'Resource exhausted', status: 'RESOURCE_EXHAUSTED' } }, headers: { 'retry-after': '0' } }, REPLY], chat: [CHAT_REPLY] });
  const { text, retries } = await ask(saved(gw.base));
  assert.deepEqual([text, retries.length, gw.posts()], ['{"lines":["每天背电脑挤地铁"]}', 1, [NATIVE, NATIVE]]);
});

test('when the Gemini door stays shut the other door is asked for that reply, and the Gemini door is still the first one next time', async (t) => {
  const shut = { status: 429, body: { error: { code: 429, message: 'Resource exhausted', status: 'RESOURCE_EXHAUSTED' } }, headers: { 'retry-after': '0' } };
  const gw = await gateway(t, { gemini: [shut, shut, shut, shut, REPLY], chat: [CHAT_REPLY] });
  const { text, retries } = await ask(saved(gw.base));
  assert.equal(text, 'from the chat door');
  assert.deepEqual(gw.posts(), [NATIVE, NATIVE, NATIVE, NATIVE, '/v1/chat/completions']); // every try at the first door, then the other
  assert.equal(retries.length, retryPolicy.retries + 1);
  assert.equal((await ask(saved(gw.base))).text, '{"lines":["每天背电脑挤地铁"]}');
  assert.equal(gw.posts().at(-1), NATIVE);
  // With both doors shut the failure is told as the last door told it, once.
  const both = await gateway(t, { gemini: [shut] });
  await assert.rejects(ask(saved(both.base)), /responded 429: Rate limit exceeded, please retry later/);
  assert.equal(both.posts().filter((p) => p === '/v1/chat/completions').length, retryPolicy.retries + 1);
});

test('a gateway that cannot say what it offers just now is asked again on the next call', async (t) => {
  const gw = await gateway(t, { listStatus: 503, chat: [CHAT_REPLY] });
  assert.equal((await ask(saved(gw.base))).text, 'from the chat door'); // nothing is concluded from a 503
  assert.equal((await ask(saved(gw.base))).text, 'from the chat door');
  assert.equal(gw.asked(), 2);
});

// 2026-11-14: every upstream account of the Gemini group was out. The list at the Gemini door answered 503, so
// the app went to the OpenAI-style door, which said only "Service temporarily unavailable"; the Gemini door,
// never asked, was saying what was wrong: "No available Gemini accounts".
const NO_ACCOUNTS = { status: 503, body: { error: { code: 503, message: 'No available Gemini accounts: no available accounts', status: 'UNAVAILABLE' } }, headers: { 'retry-after': '0' } };
const UNAVAILABLE = { status: 503, body: { error: { message: 'Service temporarily unavailable', type: 'api_error' } }, headers: { 'retry-after': '0' } };

test('a gateway that could not say what it offers is still asked at its Gemini door when the other door has no reply', async (t) => {
  const gw = await gateway(t, { listStatus: 503, chat: [UNAVAILABLE] });
  const { text, retries } = await ask(saved(gw.base));
  assert.equal(text, '{"lines":["每天背电脑挤地铁"]}');
  assert.deepEqual([...new Set(gw.posts())], ['/v1/chat/completions', NATIVE]); // the door the preset names first, then the Gemini door
  assert.ok(retries.length >= 1);
});

test('when no door has a reply, the failure says what the gateway said: it has no account free, which is not the key or its quota', async (t) => {
  const gw = await gateway(t, { listStatus: 503, chat: [UNAVAILABLE], gemini: [NO_ACCOUNTS] });
  const err = await ask(saved(gw.base)).catch((e) => e);
  assert.match(err.message, /responded 503: No available Gemini accounts/);
  assert.deepEqual([causeOf(err).side, causeOf(err).code], ['provider', 'accounts']);
  // A gateway with no Gemini door at all keeps the answer of the door it has.
  const plain = await gateway(t, { hasGeminiDoor: false, chat: [UNAVAILABLE] });
  const other = await ask(saved(plain.base)).catch((e) => e);
  assert.match(other.message, /responded 503: Service temporarily unavailable/);
  assert.deepEqual([causeOf(other).side, causeOf(other).code], ['provider', 'outage']);
  assert.ok(!plain.posts().includes(NATIVE)); // its list said 404: there is no door to ask
  // The same gateway, minutes later, answered 404 for the same model: no account of the group offered it. That is its end too, not a wrong model name.
  const dropped = Object.assign(new GatewayError('aigw.store responded 404: Model "gemini-4-carbon-high" is not supported by any configured account in this group', 404), { upstream: true, host: 'aigw.store' });
  assert.deepEqual([causeOf(dropped).side, causeOf(dropped).code], ['provider', 'accounts']);
  assert.deepEqual([causeOf(Object.assign(new GatewayError('x.test responded 404: model not found', 404), { upstream: true })).side, causeOf(Object.assign(new GatewayError('x.test responded 404: model not found', 404), { upstream: true })).code], ['settings', 'model']);
  for (const said of ['No available accounts: no available accounts', '当前分组无可用账号', 'no available channel for model x']) assert.equal(causeOf(Object.assign(new GatewayError(`gw.test responded 503: ${said}`, 503), { upstream: true, host: 'gw.test' })).code, 'accounts', said);
});

test('the Gemini-compatible preset speaks Gemini\'s format outright, and lists the models that can write', async (t) => {
  const gw = await gateway(t);
  const preset = getProvider('custom-gemini');
  assert.deepEqual([preset.protocol, validateConfig({ provider: 'custom-gemini', baseUrl: gw.base, apiKey: KEY, model: 'gemini-4-argon' })], ['gemini', null]);
  const config = { provider: 'custom-gemini', baseUrl: `${gw.base}/v1beta`, apiKey: KEY, model: 'gemini-4-argon' };
  let said = '';
  for await (const piece of streamChat(config, { system: 's', user: 'u' })) said += piece;
  assert.equal(said, '{"lines":["每天背电脑挤地铁"]}');
  assert.deepEqual([gw.asked(), gw.posts()], [0, ['/v1beta/models/gemini-4-argon:streamGenerateContent']]); // nothing to ask: the preset says so
  assert.deepEqual(await listModels({ ...config, model: '' }), MODELS); // the embedding model cannot write a script
  assert.equal(gw.seen.at(-1).headers['x-goog-api-key'], KEY);
  await assert.rejects(listModels({ ...config, apiKey: 'wrong' }), /401: API key is required/);
});

// ---------- The same through the app: the chat and the connection test of LLM settings ----------

test('through the API: a gateway saved as OpenAI-compatible answers a chat and a connection test at its Gemini door', async (t) => {
  const gw = await gateway(t, { gemini: [[chunk('It works.'), last({ candidatesTokenCount: 3 })]], thinksMs: 150 });
  const PORT = 4400 + Math.floor(Math.random() * 90);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scripter-gemini-'));
  const env = { ...process.env, PORT: String(PORT), DATA_DIR: dir, GATEWAY_CONFIG_FILE: path.join(dir, 'gateway.json'), DATABASE_URL: process.env.TEST_DATABASE_URL || '', POSTGRES_URL: '', LLM_PROVIDER: 'custom', BASE_URL_API: gw.base, API_KEY: KEY, LLM_MODEL: 'gemini-4-carbon-high', ADMIN_EMAIL: 'boss@example.test', ADMIN_PASSWORD: 'correct-horse-battery', VERCEL: '', REQUEST_TIME_LIMIT_S: '', GATEWAY_RETRY_BASE_MS: '2', STREAM_HEARTBEAT_MS: '40', TAVILY_API_KEY: '', TAVILY_MCP_URL: '', FIRECRAWL_API_KEY: '' };
  const child = spawn(process.execPath, ['server.mjs'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(async () => {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise((resolve) => child.stdout.once('data', resolve));
  let cookie = '';
  const post = async (url, body) => {
    const res = await fetch(`http://127.0.0.1:${PORT}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: JSON.stringify(body) });
    cookie = res.headers.get('set-cookie')?.split(';')[0] || cookie;
    return res;
  };
  assert.equal((await post('/api/auth/login', { email: 'boss@example.test', password: 'correct-horse-battery' })).status, 200);

  const tested = await (await post('/api/gateway/test', { id: 'default' })).json(); // the saved gateway, as Test connection sends it
  assert.deepEqual([tested.ok, tested.reply, tested.via], [true, 'It works.', `${gw.base}${NATIVE}`]);

  const sent = await (await post('/api/chat/send', { text: 'Does it work?' })).text();
  // While the model is silent the app's own stream is not: a line that carries nothing keeps the connection to the browser open.
  assert.ok(sent.includes('\n\n: waiting\n\n'));
  const events = sent.split('\n\n').filter((block) => block && !block.startsWith(':')).map((block) => ({ event: /^event: (.*)$/m.exec(block)?.[1], data: JSON.parse(/^data: (.*)$/m.exec(block)?.[1] || 'null') }));
  const reply = events.at(-1).data.message;
  assert.deepEqual([reply.content, reply.error, events.some((e) => e.event === 'retry')], ['It works.', undefined, false]);
  assert.deepEqual([...new Set(gw.posts())], [NATIVE]);
});
