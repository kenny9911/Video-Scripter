// The time one request may run (src/limits.mjs): the server stops by itself before the host would cut it
// off, and a script that is not finished is carried on in the next request. Against a local fake provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';

import { timeLimitMs, workBudgetMs, outOfTime, VERCEL_MAX_DURATION, MAX_PARTS } from '../src/limits.mjs';
import { streamChat, completeChat } from '../src/gateway/client.mjs';
import { causeOf } from '../src/errors.mjs';
import { buildPlan } from '../src/prompt.mjs';

test('the limit is the host’s: 800 seconds on Vercel, none with npm start, and what the environment says anywhere', async () => {
  assert.equal(timeLimitMs({}), 0, 'a server of your own has no limit');
  assert.equal(workBudgetMs({}), 0);
  assert.equal(timeLimitMs({ VERCEL: '1' }), 800_000);
  assert.equal(workBudgetMs({ VERCEL: '1' }), 780_000, '20 seconds are kept back to record the call and tell the page');
  assert.equal(timeLimitMs({ VERCEL: '1', REQUEST_TIME_LIMIT_S: '300' }), 300_000, 'a plan that allows less says so');
  assert.equal(workBudgetMs({ REQUEST_TIME_LIMIT_S: '60' }), 54_000, 'a short limit keeps back a tenth');
  for (const bad of ['', '0', '-5', 'soon']) assert.equal(timeLimitMs({ REQUEST_TIME_LIMIT_S: bad }), 0, `"${bad}" is no limit`);

  // vercel.json is what the host goes by, and the server's own clock must not run past it.
  const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(vercel.functions['api/index.mjs'].maxDuration, VERCEL_MAX_DURATION);

  const err = outOfTime({ REQUEST_TIME_LIMIT_S: '300' });
  assert.equal(err.name, 'TimeoutError');
  assert.match(err.message, /300 seconds one request may run/);
  assert.deepEqual(causeOf(err), { side: 'provider', code: 'timeout' });
});

/**
 * A provider that answers each request with the next entry of `script`:
 *   { say, hang }   streams `say` in pieces; with `hang` it then stays silent with the stream open
 *   'rest'          streams what is left of `whole` after the unfinished reply the request carries
 */
function slowProvider(whole, script) {
  const seen = [];
  const open = new Set();
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    seen.push(body);
    const step = script[Math.min(seen.length, script.length) - 1];
    const partial = body.messages.find((m) => m.role === 'assistant')?.content || '';
    const say = step === 'rest' ? whole.slice(partial.length) : step.say;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (let i = 0; i < say.length; i += 40) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: say.slice(i, i + 40) } }] })}\n\n`);
    if (step.hang) return open.add(res);
    res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  });
  const close = () => {
    for (const res of open) res.destroy();
    server.close();
  };
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ seen, close, base: `http://127.0.0.1:${server.address().port}` })));
}

const WHOLE = JSON.stringify({ title: '本体', logline: 'x', hookOptions: [], scenes: [{ start: 0, end: 20, stage: 'hook', voiceover: '同一个客户，你们公司有五种说法。', visual: '五张名片' }, { start: 20, end: 45, stage: 'cta', voiceover: '本体就是统一的词典。', visual: '一本词典' }], publish: { titles: ['a'] }, productionNotes: [] });

test('a reply an earlier request began is carried on: the model is shown it, and only the rest comes back', async (t) => {
  const fake = await slowProvider(WHOLE, ['rest']);
  t.after(fake.close);
  const config = { provider: 'custom', baseUrl: `${fake.base}/v1`, apiKey: 'k', model: 'm' };
  const rest = await completeChat(config, { system: 's', user: 'u', partial: WHOLE.slice(0, 100) });
  assert.equal(WHOLE.slice(0, 100) + rest, WHOLE);
  const turns = fake.seen[0].messages;
  assert.deepEqual(turns.map((m) => m.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(turns[2].content, WHOLE.slice(0, 100), 'the unfinished reply is the model’s own turn');

  // A continuation holds its first stretch back to trim what the model repeats. When the time runs out in
  // the middle of that, what was held is passed on before it stops: the next request must start from all of it.
  const stalled = await slowProvider(WHOLE, [{ say: WHOLE.slice(100, 220), hang: true }]);
  t.after(stalled.close);
  const clock = new AbortController();
  setTimeout(() => clock.abort(outOfTime({ REQUEST_TIME_LIMIT_S: '1' })), 150);
  let got = '';
  const err = await (async () => {
    for await (const text of streamChat({ ...config, baseUrl: `${stalled.base}/v1` }, { system: 's', user: 'u', partial: WHOLE.slice(0, 100), signal: clock.signal })) got += text;
  })().catch((e) => e);
  assert.deepEqual([err?.name, got], ['TimeoutError', WHOLE.slice(100, 220)]);

  // Demo mode writes the same text every time, so it carries on from the same place too.
  const plan = buildPlan({ platformId: 'douyin', frameworkId: 'pas', topic: '什么是本体', duration: 45 });
  const demo = { provider: 'mock' };
  let all = '';
  for await (const text of streamChat(demo, { system: '', user: '', meta: { plan } })) all += text;
  const half = all.slice(0, Math.floor(all.length / 2));
  let second = '';
  for await (const text of streamChat(demo, { system: '', user: '', meta: { plan }, partial: half })) second += text;
  assert.equal(half + second, all);
});

test('HTTP: a script that outlasts one request is handed over and finished in the next; anything else says it ran out of time', async (t) => {
  const { spawn } = await import('node:child_process');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');

  // Request 1 writes 120 characters and goes silent; request 2 writes the rest; request 3 never says a word.
  const fake = await slowProvider(WHOLE, [{ say: WHOLE.slice(0, 120), hang: true }, 'rest', { say: '', hang: true }]);
  const port = 4600 + Math.floor(Math.random() * 90);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scripter-limits-'));
  const admin = { email: 'patient@example.test', password: 'correct-horse-battery' };
  const env = { ...process.env, PORT: String(port), DATA_DIR: dir, GATEWAY_CONFIG_FILE: path.join(dir, 'none.json'), DATABASE_URL: '', POSTGRES_URL: '', LLM_PROVIDER: 'custom', BASE_URL_API: `${fake.base}/v1`, API_KEY: 'k', LLM_API_KEY: '', LLM_MODEL: 'm', GATEWAY_RETRY_BASE_MS: '5', ADMIN_EMAIL: admin.email, ADMIN_PASSWORD: admin.password, REQUEST_TIME_LIMIT_S: '1' };
  const child = spawn(process.execPath, ['server.mjs'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(async () => {
    child.kill();
    fake.close();
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise((resolve) => child.stdout.once('data', resolve));

  const at = `http://127.0.0.1:${port}`;
  const login = await fetch(`${at}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(admin) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const post = (url, body) => fetch(`${at}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
  const events = async (res) => (await res.text()).split('\n\n').filter(Boolean).map((b) => ({ event: /^event: (.*)$/m.exec(b)[1], data: JSON.parse(/^data: (.*)$/m.exec(b)[1]) }));
  const text = (list) => list.filter((e) => e.event === 'delta').map((e) => e.data.text).join('');
  const brief = { platformId: 'douyin', frameworkId: 'pas', topic: '什么是本体', duration: 45 };

  // The first request runs out of time with the reply under way: it ends by itself, and says how far it got.
  const began = Date.now();
  const first = await events(await post('/api/generate', brief));
  const took = Date.now() - began;
  assert.ok(took >= 800 && took < 3000, `it stops at its own clock, a little before the host's second is up (${took} ms)`);
  assert.deepEqual([first[0].event, first.at(-1).event], ['plan', 'handover']);
  assert.equal(text(first), WHOLE.slice(0, 120));
  assert.deepEqual(first.at(-1).data, { part: 1, written: 120 });
  assert.ok(!first.some((e) => e.event === 'error' || e.event === 'done'));

  // The page asks again with what it has, and the script arrives whole.
  const second = await events(await post('/api/generate', { ...brief, resume: { text: text(first), part: 2 } }));
  assert.deepEqual([second[0].event, second[0].data.part, second.at(-1).event], ['plan', 2, 'done']);
  assert.equal(text(first) + text(second), WHOLE, 'the two requests make one reply');
  assert.deepEqual(second.at(-1).data.script.scenes.map((s) => s.voiceover), ['同一个客户，你们公司有五种说法。', '本体就是统一的词典。']);
  assert.equal(fake.seen[1].messages.find((m) => m.role === 'assistant').content, WHOLE.slice(0, 120), 'the model is shown what it had written');

  // One script in the history, two model calls on the record, and neither counts as a failure.
  const history = await (await fetch(`${at}/api/history`, { headers: { cookie } })).json();
  assert.equal(history.length, 1);
  const usage = await (await fetch(`${at}/api/usage?days=0`, { headers: { cookie } })).json();
  assert.deepEqual(usage.byKind.map((k) => [k.key, k.calls, k.failed || 0]), [['script', 2, 0]]);

  // A reply that is already whole only needs reading: the model is not asked again.
  const read = await events(await post('/api/generate', { ...brief, resume: { text: WHOLE, part: 3 } }));
  assert.deepEqual([read.at(-1).event, read.at(-1).data.script.title, fake.seen.length], ['done', '本体', 2]);

  // A script cannot be carried over for ever.
  const tooMany = await post('/api/generate', { ...brief, resume: { text: WHOLE.slice(0, 120), part: MAX_PARTS + 1 } });
  assert.equal(tooMany.status, 400);
  assert.match((await tooMany.json()).error, /carried over 8 times/);

  // Nothing written when the time is up: there is nothing to carry on, so the page is told what happened.
  const silent = await events(await post('/api/narration/draft', { ...brief, agent: false }));
  assert.equal(silent.at(-1).event, 'error');
  assert.match(silent.at(-1).data.error, /not finished within the 1 seconds one request may run/);
  assert.deepEqual([silent.at(-1).data.cause.side, silent.at(-1).data.cause.code], ['provider', 'timeout']);
});
