// Riding out a provider that wobbles: 502, 503, 504 and 529 before a reply starts, a stream that breaks in
// the middle of one, and a reply that ends before it is finished. All against a local fake provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { request, streamChat, completeChat, retryPolicy, isTransient, jsonOpen, cutShort, GatewayError } from '../src/gateway/client.mjs';
import { generateImage, createVideo } from '../src/gateway/media.mjs';
import { mergeConfig } from '../src/gateway/config.mjs';
import { causeOf } from '../src/errors.mjs';
import { parseScript } from '../src/prompt.mjs';

retryPolicy.baseMs = 2; // pauses of a few milliseconds: what is tested is that it tries again, not how long it waits

/**
 * A provider that answers each request with the next entry of `script`:
 *   { status, body, headers }           an error reply
 *   { sse: [...], done }                a stream of events (strings are sent as written); `done: false` ends without [DONE]
 *   { json }                            a JSON reply
 *   'drop'                              the connection is destroyed
 */
function fakeProvider(script) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body = null;
    try {
      body = JSON.parse(raw);
    } catch {}
    seen.push({ url: req.url, body });
    const step = script[Math.min(seen.length, script.length) - 1];
    if (step === 'drop') return req.socket.destroy();
    if (step.status) return res.writeHead(step.status, { 'content-type': 'application/json', ...step.headers }).end(JSON.stringify(step.body ?? { error: { message: 'No available accounts' } }));
    if (step.json) return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(step.json));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const e of step.sse) res.write(typeof e === 'string' ? e : `data: ${JSON.stringify(e)}\n\n`);
    if (step.done !== false) res.write('data: [DONE]\n\n');
    res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` })));
}

const delta = (content) => ({ choices: [{ delta: { content } }] });
const stop = (finish_reason = 'stop') => ({ choices: [{ delta: {}, finish_reason }] });
const block = (text) => ({ type: 'content_block_delta', delta: { type: 'text_delta', text } });
const openai = (base) => ({ provider: 'custom', baseUrl: `${base}/v1`, apiKey: 'k', model: 'm' });
const anthropic = (base) => ({ provider: 'custom-anthropic', baseUrl: base, apiKey: 'k', model: 'm' });
const up = async (t, script) => {
  const fake = await fakeProvider(script);
  t.after(() => fake.server.close());
  return fake;
};
const ask = async (config, extra = {}) => {
  const retries = [];
  let usage = null;
  const text = await completeChat(config, { system: 's', user: 'u', onRetry: (r) => retries.push(r), onUsage: (u) => (usage = u), ...extra });
  return { text, retries, usage };
};

test('a provider without capacity is asked again: 502, 503, 504 and 529, a rate limit, a dropped connection', async (t) => {
  for (const status of [502, 503, 504, 529, 500, 429]) {
    const fake = await up(t, [{ status }, { status }, { json: { ok: true } }]);
    const heard = [];
    const res = await request(`${fake.base}/x`, { method: 'POST', body: '{}' }, { onRetry: (r) => heard.push(r) });
    assert.deepEqual([await res.json(), fake.seen.length], [{ ok: true }, 3], String(status));
    assert.deepEqual(heard.map((r) => [r.attempt, r.of, r.status, r.resumed]), [[1, 3, status, false], [2, 3, status, false]]);
    assert.ok(heard.every((r) => r.host && r.waitMs >= 0 && r.reason.includes(String(status))));
  }
  const dropped = await up(t, ['drop', { json: { ok: true } }]);
  assert.deepEqual(await (await request(`${dropped.base}/x`, { method: 'POST', body: '{}' })).json(), { ok: true });

  // It gives up after three more tries, and the error says how often it was tried and whose end it is on.
  const down = await up(t, [{ status: 503 }]);
  const err = await request(`${down.base}/x`, {}).catch((e) => e);
  assert.deepEqual([down.seen.length, err.status, err.attempts], [4, 503, 4]);
  assert.deepEqual(causeOf(err), { side: 'provider', code: 'accounts', host: new URL(down.base).host, status: 503, attempts: 4 }); // the gateway said it has no account free: that is what the page is told
});

test('what asking again cannot fix is not asked again', async (t) => {
  for (const [status, message] of [[400, 'bad request'], [401, 'Invalid API key'], [403, 'forbidden'], [404, 'Model "x" is not supported'], [402, 'pay'], [429, 'You exceeded your current quota']]) {
    const fake = await up(t, [{ status, body: { error: { message } } }, { json: {} }]);
    const err = await request(`${fake.base}/x`, {}).catch((e) => e);
    assert.deepEqual([fake.seen.length, err.status, err.attempts], [1, status, undefined], String(status));
  }
  // A wrong address or a closed port is a setting to fix, not a moment to wait out.
  const real = globalThis.fetch;
  let calls = 0;
  try {
    for (const code of ['ENOTFOUND', 'ECONNREFUSED']) {
      calls = 0;
      globalThis.fetch = async () => {
        calls++;
        throw new TypeError('fetch failed', { cause: Object.assign(new Error(`${code} gw.test`), { code }) });
      };
      const err = await request('https://gw.test/v1', {}).catch((e) => e);
      assert.deepEqual([calls, err.unreachable, isTransient(err)], [1, true, false], code);
    }
    globalThis.fetch = async () => {
      if (calls++ < 2) throw new TypeError('fetch failed', { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) });
      return new Response('{}');
    };
    calls = 0;
    assert.equal((await request('https://gw.test/v1', {})).status, 200, 'a connection that was reset is tried again');
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(isTransient(Object.assign(new Error('x'), { name: 'AbortError' })), false);
  assert.equal(isTransient(new GatewayError('No image model is set', 400)), false);
});

test('a request that is stopped while it waits to try again stops at once', async (t) => {
  const fake = await up(t, [{ status: 503 }]);
  const before = retryPolicy.baseMs;
  retryPolicy.baseMs = 5000;
  t.after(() => (retryPolicy.baseMs = before));
  const abort = new AbortController();
  const started = Date.now();
  setTimeout(() => abort.abort(), 30);
  const err = await request(`${fake.base}/x`, { signal: abort.signal }).catch((e) => e);
  assert.equal(err.name, 'AbortError');
  assert.ok(Date.now() - started < 1000 && fake.seen.length === 1);
});

test('the provider may ask for a pause, which is kept within reason', async (t) => {
  const fake = await up(t, [{ status: 503, headers: { 'retry-after': '120' } }, { json: {} }]);
  const before = { ...retryPolicy };
  Object.assign(retryPolicy, { maxWaitMs: 40 });
  t.after(() => Object.assign(retryPolicy, before));
  const heard = [];
  const started = Date.now();
  await request(`${fake.base}/x`, {}, { onRetry: (r) => heard.push(r.waitMs) });
  assert.deepEqual(heard, [40], 'two minutes asked for, the cap kept');
  assert.ok(Date.now() - started < 1000);
});

test('a chat is asked again when the provider fails before the reply starts', async (t) => {
  const fake = await up(t, [{ status: 503 }, { status: 529, body: { error: { message: '上游暂时不可用' } } }, { sse: [delta('你好'), delta(' world'), stop()] }]);
  const { text, retries } = await ask(openai(fake.base));
  assert.equal(text, '你好 world');
  assert.deepEqual(retries.map((r) => [r.attempt, r.status, r.resumed]), [[1, 503, false], [2, 529, false]]);
  assert.equal(fake.seen.length, 3);
  assert.ok(fake.seen.every((r) => r.body.messages.length === 2), 'the same request each time');
});

const SCRIPT = JSON.stringify({ title: '本体是什么', scenes: [{ start: 0, end: 5, voiceover: '同一个“客户”，你们公司有五种说法。', visual: '五张名片' }, { start: 5, end: 10, voiceover: '本体就是统一的词典。', visual: '一本词典' }], publish: { titles: ['a'] } });

test('a reply that is cut off is picked up where it stopped, and reads as one reply', async (t) => {
  const cut = 70;
  // The stream ends with neither a finish reason nor [DONE]: the JSON is still open, so it was cut short.
  const fake = await up(t, [{ sse: [delta(SCRIPT.slice(0, 30)), delta(SCRIPT.slice(30, cut)), { choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } }], done: false }, { sse: [delta(SCRIPT.slice(cut, 120)), delta(SCRIPT.slice(120)), stop(), { choices: [], usage: { prompt_tokens: 130, completion_tokens: 40 } }] }]);
  const { text, retries, usage } = await ask(openai(fake.base));
  assert.equal(text, SCRIPT);
  assert.equal(parseScript(text).scenes.length, 2);
  assert.deepEqual(retries.map((r) => [r.attempt, r.of, r.resumed, r.cut, r.written]), [[1, 8, true, true, cut]]);
  assert.deepEqual(usage, { inputTokens: 230, outputTokens: 60 }, 'both attempts are counted');
  // The second request shows the model what it had written and asks for the rest.
  const [first, second] = fake.seen.map((r) => r.body.messages);
  assert.deepEqual(first.map((m) => m.role), ['system', 'user']);
  assert.deepEqual(second.map((m) => m.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(second[2].content, SCRIPT.slice(0, cut));
  assert.ok(second[3].content.includes('Continue from exactly the character after that') && second[3].content.includes(SCRIPT.slice(cut - 40, cut)));
});

test('a continuation that opens with a fence or repeats itself is joined cleanly', async (t) => {
  const cut = 90;
  const repeated = '```json\n' + SCRIPT.slice(cut - 25); // the model starts again a little before the place it stopped
  const fake = await up(t, [{ sse: [delta(SCRIPT.slice(0, cut))], done: false }, { sse: [delta(repeated.slice(0, 20)), delta(repeated.slice(20)), stop()] }]);
  assert.equal((await ask(openai(fake.base))).text, SCRIPT);
  // Running out of room is a cut too: the model said "length" with the JSON still open.
  const short = await up(t, [{ sse: [delta(SCRIPT.slice(0, cut)), stop('length')] }, { sse: [delta(SCRIPT.slice(cut)), stop()] }]);
  const out = await ask(openai(short.base));
  assert.deepEqual([out.text, out.retries.length, short.seen.length], [SCRIPT, 1, 2]);
});

test('Anthropic-style streams: an overloaded error or a cut in the middle is resumed, one at the start is asked again', async (t) => {
  const overloaded = { type: 'error', error: { type: 'overloaded_error', message: '上游暂时不可用（临时故障），请稍后重试。' } };
  const usage = (input_tokens, output_tokens) => [{ type: 'message_start', message: { usage: { input_tokens, output_tokens: 1 } } }, { type: 'message_delta', delta: {}, usage: { output_tokens } }];
  const end = [{ type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' }];
  // 1: an error before any text. 2: text, then an error. 3: the rest, then a stream that just ends. 4: the end of it.
  const fake = await up(t, [
    { sse: [{ type: 'message_start' }, overloaded], done: false },
    { sse: [...usage(50, 10), block(SCRIPT.slice(0, 60)), overloaded], done: false },
    { sse: [...usage(70, 12), block(SCRIPT.slice(60, 150))], done: false },
    { sse: [...usage(90, 14), block(SCRIPT.slice(150)), ...end], done: false },
  ]);
  const { text, retries, usage: total } = await ask(anthropic(fake.base));
  assert.equal(text, SCRIPT);
  assert.deepEqual(retries.map((r) => [r.attempt, r.resumed, Boolean(r.cut)]), [[1, false, false], [2, true, false], [3, true, true]]);
  assert.deepEqual(total, { inputTokens: 210, outputTokens: 36 });
  assert.deepEqual(fake.seen.map((r) => r.body.messages.map((m) => m.role).join(',')), ['user', 'user', 'user,assistant,user', 'user,assistant,user']);
  assert.equal(fake.seen[3].body.messages[1].content, SCRIPT.slice(0, 150));
  assert.equal(fake.seen[3].body.system, 's');
});

test('it gives up on a reply that keeps breaking, and never resumes what cannot be fixed by trying', async (t) => {
  // Nothing is added any more: after the request that brought something, an attempt that brings nothing is made four times.
  const broken = await up(t, [{ sse: [delta(SCRIPT.slice(0, 40))], done: false }, { sse: [], done: false }]);
  const err = await ask(openai(broken.base)).catch((e) => e);
  assert.ok(err instanceof GatewayError && err.cut && err.attempts === 5, err.message);
  assert.equal(broken.seen.length, 5);
  assert.match(err.message, /ended its reply before it was finished/);
  assert.deepEqual(causeOf(err), { side: 'provider', code: 'stream', host: new URL(broken.base).host, attempts: 5 });
  // A reply that never starts: the first request and three more.
  const mute = await up(t, [{ sse: [{ type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } }], done: false }]);
  const silent = await ask(anthropic(mute.base)).catch((e) => e);
  assert.deepEqual([mute.seen.length, silent.attempts, silent.message], [4, 4, 'overloaded']);
  // A gateway that stops every reply after a few seconds: each attempt adds a piece, so it is carried through.
  const pieces = Array.from({ length: 6 }, (_, i) => SCRIPT.slice(i * 30, i === 5 ? undefined : (i + 1) * 30));
  const choppy = await up(t, pieces.map((piece, i) => ({ sse: [delta(piece), ...(i === 5 ? [stop()] : [])], done: i === 5 })));
  const carried = await ask(openai(choppy.base));
  assert.deepEqual([carried.text, choppy.seen.length, carried.retries.map((r) => r.written)], [SCRIPT, 6, [30, 60, 90, 120, 150]]);
  // ... but not for ever: one reply is picked up eight times at most.
  const endless = await up(t, Array.from({ length: 12 }, (_, i) => ({ sse: [delta(`${i ? '' : '{"a":['}"piece number ${i} of a reply without end",`)], done: false })));
  const capped = await ask(openai(endless.base)).catch((e) => e);
  assert.deepEqual([endless.seen.length, capped.attempts], [9, 9]);
  // An attempt that adds a stray bracket and stops is not progress: it ends like one that adds nothing.
  const stray = await up(t, [{ sse: [delta(SCRIPT.slice(0, 40))], done: false }, { sse: [delta(' }')], done: false }]);
  assert.equal((await ask(openai(stray.base)).catch((e) => e)).attempts, 5);
  // The request for the rest is refused four times over (no capacity): what is in hand is kept, and it is asked for again.
  const refusedRest = await up(t, [{ sse: [delta(SCRIPT.slice(0, 40))], done: false }, { status: 503 }, { status: 503 }, { status: 503 }, { status: 503 }, { sse: [delta(SCRIPT.slice(40)), stop()] }]);
  const patient = await ask(openai(refusedRest.base));
  assert.deepEqual([patient.text, refusedRest.seen.length], [SCRIPT, 6]);
  // An error in the middle of a continuation does not lose what the continuation had brought.
  const lossy = await up(t, [{ sse: [delta(SCRIPT.slice(0, 40))], done: false }, { sse: [delta(SCRIPT.slice(40, 100)), { error: { message: 'upstream reset', type: 'server_error' } }], done: false }, { sse: [delta(SCRIPT.slice(100)), stop()] }]);
  const kept = await ask(openai(lossy.base));
  assert.deepEqual([kept.text, kept.retries.map((r) => r.written)], [SCRIPT, [40, 100]]);

  const refused = await up(t, [{ sse: [{ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }], done: false }]);
  const denied = await ask(anthropic(refused.base)).catch((e) => e);
  assert.deepEqual([refused.seen.length, denied.message], [1, 'invalid x-api-key']);

  // A reply that is complete is left alone: closed JSON with no end signal, or plain words with none.
  const closed = await up(t, [{ sse: [delta(SCRIPT)], done: false }]);
  assert.deepEqual([(await ask(openai(closed.base))).text, closed.seen.length], [SCRIPT, 1]);
  const words = await up(t, [{ sse: [delta('OK')], done: false }]);
  assert.deepEqual([(await ask(openai(words.base))).retries.length, words.seen.length], [0, 1]);
  // A gateway that stops a long reply closes the stream as if the model had finished: unfinished JSON is picked up all the same.
  const masked = await up(t, [{ sse: [delta(SCRIPT.slice(0, 50)), stop()] }, { sse: [delta(SCRIPT.slice(50)), stop()] }]);
  assert.deepEqual([(await ask(openai(masked.base))).text, masked.seen.length], [SCRIPT, 2]);
  const quiet = await up(t, [{ sse: [block(SCRIPT.slice(0, 50)), { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' }], done: false }, { sse: [block(SCRIPT.slice(50)), { type: 'message_stop' }], done: false }]);
  assert.deepEqual([(await ask(anthropic(quiet.base))).text, quiet.seen.length], [SCRIPT, 2]);
  // A reply the provider withheld on purpose is its answer, not a broken line.
  const withheld = await up(t, [{ sse: [delta(SCRIPT.slice(0, 50)), stop('content_filter')] }]);
  assert.deepEqual([(await ask(openai(withheld.base))).text, withheld.seen.length], [SCRIPT.slice(0, 50), 1]);

  // Stopping the request ends it, whatever state it is in.
  const slow = await up(t, [{ sse: [delta(SCRIPT.slice(0, 40))], done: false }]);
  const abort = new AbortController();
  const before = retryPolicy.baseMs;
  retryPolicy.baseMs = 5000;
  t.after(() => (retryPolicy.baseMs = before));
  setTimeout(() => abort.abort(), 40);
  const out = [];
  const halted = await (async () => {
    for await (const text of streamChat(openai(slow.base), { system: 's', user: 'u', signal: abort.signal })) out.push(text);
  })().catch((e) => e);
  assert.deepEqual([halted.name, out.join(''), slow.seen.length], ['AbortError', SCRIPT.slice(0, 40), 1]);
});

test('jsonOpen tells a reply that was cut short from one that is finished', () => {
  for (const [text, open] of [['OK', false], ['', false], ['{"a":1}', false], ['{"a":[1,{"b":"x}"', true], ['```json\n{"a":"}{","b":[1,2]}\n```', false], ['<think>{ hmm</think>{"a":1}', false], ['{"a":"he said \\"hi\\" {', true], ['{"scenes":[{"id":1},', true], ['{"a":1} and that is all', false]]) {
    assert.equal(jsonOpen(text), open, text);
  }
  // A whole reply with a slip the reader mends (an unescaped quotation mark) is not taken for a cut one.
  const slip = '{"a":"他说"本体{"是关键","b":[1,2]}';
  assert.deepEqual([jsonOpen(slip), cutShort(slip), cutShort('{"a":[1,{"b":"x}"'), cutShort('OK')], [true, false, true, false]);
});

test('images and video jobs: asked again when the provider has no capacity, but a timed-out job is not started twice', async (t) => {
  const image = { json: { data: [{ b64_json: 'QUJD' }] } };
  const media = (base) => mergeConfig({ provider: 'custom', baseUrl: 'https://text.example/v1', model: 'writer', image: { baseUrl: `${base}/v1`, model: 'painter' }, video: { baseUrl: `${base}/v1`, model: 'filmer' } });

  const busy = await up(t, [{ status: 502, body: { title: 'Error 502: Bad gateway', detail: 'origin' } }, { status: 503, body: { error: { message: 'No available compatible accounts' } } }, image]);
  assert.deepEqual(await generateImage(media(busy.base), { prompt: 'a cat' }), { url: 'data:image/png;base64,QUJD', usage: null });
  assert.equal(busy.seen.length, 3);

  // A gateway timeout may mean the picture is still being made: one more try, not three.
  const slow = await up(t, [{ status: 504, body: { error: { message: 'Gateway timeout' } } }]);
  const timedOut = await generateImage(media(slow.base), { prompt: 'a cat' }).catch((e) => e);
  assert.deepEqual([slow.seen.length, timedOut.status, timedOut.attempts], [2, 504, 2]);
  assert.match(timedOut.message, /responded 504: Gateway timeout/);
  const recovered = await up(t, [{ status: 504 }, image]);
  assert.equal((await generateImage(media(recovered.base), { prompt: 'a cat' })).url, 'data:image/png;base64,QUJD');

  // A reference picture goes through the same door.
  const edits = await up(t, [{ status: 503 }, image]);
  const made = await generateImage(media(edits.base), { prompt: 'p', references: [{ bytes: Buffer.from('x'), type: 'image/png' }] });
  assert.deepEqual([made.referenced, edits.seen.map((r) => r.url)], [true, ['/v1/images/edits', '/v1/images/edits']]);

  const jobs = await up(t, [{ status: 503 }, { json: { id: 'video_1', status: 'queued' } }]);
  assert.equal((await createVideo(media(jobs.base), { prompt: 'a cat walks', seconds: 4 })).id, 'video_1');
  const lost = await up(t, [{ status: 504 }, { json: { id: 'video_2', status: 'queued' } }]);
  const none = await createVideo(media(lost.base), { prompt: 'a cat walks', seconds: 4 }).catch((e) => e);
  assert.deepEqual([lost.seen.length, none.status], [1, 504], 'a video job is never asked for twice after a timeout');
});

// ---------- Through the real HTTP API, against a provider that fails first ----------

test('HTTP: a script arrives whole although the provider refused once and broke off once, and the page is told', async (t) => {
  const { spawn } = await import('node:child_process');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');

  const whole = JSON.stringify({ title: '本体', logline: 'x', hookOptions: [], scenes: [{ start: 0, end: 20, stage: 'hook', voiceover: '同一个客户，你们公司有五种说法。', visual: '五张名片' }, { start: 20, end: 45, stage: 'cta', voiceover: '本体就是统一的词典。', visual: '一本词典' }], publish: { titles: ['a'] }, productionNotes: [] });
  const fake = await up(t, [{ status: 503 }, { sse: [delta(whole.slice(0, 80))], done: false }, { sse: [delta(whole.slice(80)), stop()] }]);

  const port = 4500 + Math.floor(Math.random() * 90);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scripter-resilience-'));
  const admin = { email: 'steady@example.test', password: 'correct-horse-battery' };
  const env = { ...process.env, PORT: String(port), DATA_DIR: dir, GATEWAY_CONFIG_FILE: path.join(dir, 'none.json'), DATABASE_URL: '', POSTGRES_URL: '', LLM_PROVIDER: 'custom', BASE_URL_API: `${fake.base}/v1`, API_KEY: 'k', LLM_API_KEY: '', LLM_MODEL: 'm', GATEWAY_RETRY_BASE_MS: '5', ADMIN_EMAIL: admin.email, ADMIN_PASSWORD: admin.password };
  const child = spawn(process.execPath, ['server.mjs'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(async () => {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise((resolve) => child.stdout.once('data', resolve));

  const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(admin) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const res = await fetch(`http://127.0.0.1:${port}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ platformId: 'douyin', frameworkId: 'pas', topic: '什么是本体', duration: 45 }) });
  const events = (await res.text()).split('\n\n').filter(Boolean).map((b) => ({ event: /^event: (.*)$/m.exec(b)[1], data: JSON.parse(/^data: (.*)$/m.exec(b)[1]) }));

  assert.deepEqual([events[0].event, events.at(-1).event], ['plan', 'done']);
  assert.deepEqual(events.filter((e) => e.event === 'retry').map((e) => [e.data.attempt, e.data.of, e.data.status ?? null, e.data.resumed, Boolean(e.data.cut)]), [[1, 3, 503, false, false], [1, 8, null, true, true]]);
  assert.equal(events.filter((e) => e.event === 'delta').map((e) => e.data.text).join(''), whole, 'the page is sent one continuous reply');
  assert.deepEqual(events.at(-1).data.script.scenes.map((s) => s.voiceover), ['同一个客户，你们公司有五种说法。', '本体就是统一的词典。']);
  assert.equal(fake.seen.length, 3);
  const usage = await (await fetch(`http://127.0.0.1:${port}/api/usage?days=0`, { headers: { cookie } })).json();
  assert.deepEqual(usage.byKind.map((k) => [k.key, k.calls]), [['script', 1]], 'one script, however many tries it took');
});
