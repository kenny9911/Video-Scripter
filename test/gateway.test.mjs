// Exercises the gateway adapters against a local fake upstream, and the prompt/plan helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { completeChat, endpointFor, listModels, modelsEndpointFor, GatewayError } from '../src/gateway/client.mjs';
import { mergeConfig, publicConfig, validateConfig } from '../src/gateway/config.mjs';
import { buildPlan, buildPrompts, parseScript } from '../src/prompt.mjs';
import { PLATFORMS } from '../src/platforms.mjs';
import { FRAMEWORKS } from '../src/frameworks.mjs';

function fakeUpstream() {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    seen.push({ url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
    if (req.headers.authorization === 'Bearer bad' || req.headers['x-api-key'] === 'bad') {
      res.writeHead(401, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
    }
    if (req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'm2' }, { id: 'models/m1' }, { id: 'm2' }] }));
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (req.url.endsWith('/chat/completions')) {
      // Split one event across two TCP writes to check the SSE buffer handling.
      res.write('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\ndata: {"choices":[{"delta":{"con');
      res.write('tent":"你好"}}]}\n\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\ndata: [DONE]\n\n');
    } else {
      res.write('event: message_start\ndata: {"type":"message_start"}\n\n');
      res.write('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"你好"}}\n\n');
      res.write('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}}\n\n');
      res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    }
    res.end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` })));
}

test('endpointFor builds the right URL per protocol', () => {
  assert.equal(endpointFor('openai', 'https://x.test/v1/'), 'https://x.test/v1/chat/completions');
  assert.equal(endpointFor('openai', 'https://x.test/v1/chat/completions'), 'https://x.test/v1/chat/completions');
  assert.equal(endpointFor('anthropic', 'https://api.anthropic.com'), 'https://api.anthropic.com/v1/messages');
  assert.equal(endpointFor('anthropic', 'https://proxy.test/v1'), 'https://proxy.test/v1/messages');
});

test('OpenAI-compatible and Anthropic adapters stream text and send auth', async (t) => {
  const up = await fakeUpstream();
  t.after(() => up.server.close());

  const a = await completeChat({ provider: 'custom', baseUrl: `${up.base}/v1`, apiKey: 'k1', model: 'm1' }, { system: 'S', user: 'U' });
  assert.equal(a, '你好 world');
  assert.equal(up.seen[0].url, '/v1/chat/completions');
  assert.equal(up.seen[0].headers.authorization, 'Bearer k1');
  assert.deepEqual(up.seen[0].body.messages, [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }]);
  assert.equal(up.seen[0].body.model, 'm1');

  const b = await completeChat({ provider: 'custom-anthropic', baseUrl: up.base, apiKey: 'k2', model: 'm2' }, { system: 'S', user: 'U' });
  assert.equal(b, '你好 world');
  assert.equal(up.seen[1].url, '/v1/messages');
  assert.equal(up.seen[1].headers['x-api-key'], 'k2');
  assert.equal(up.seen[1].body.system, 'S');

  await assert.rejects(
    completeChat({ provider: 'custom', baseUrl: `${up.base}/v1`, apiKey: 'bad', model: 'm1' }, { system: 'S', user: 'U' }),
    (err) => err instanceof GatewayError && err.status === 401 && /Invalid API key/.test(err.message),
  );
});

test('listModels asks the right endpoint per protocol and returns sorted unique ids', async (t) => {
  const up = await fakeUpstream();
  t.after(() => up.server.close());
  assert.equal(modelsEndpointFor('openai', 'https://x.test/v1/'), 'https://x.test/v1/models');
  assert.equal(modelsEndpointFor('anthropic', 'https://api.anthropic.com/v1'), 'https://api.anthropic.com/v1/models?limit=1000');

  // No model is needed to list models.
  assert.deepEqual(await listModels({ provider: 'custom', baseUrl: `${up.base}/v1`, apiKey: 'k1', model: '' }), ['m1', 'm2']);
  assert.equal(up.seen[0].url, '/v1/models');
  assert.equal(up.seen[0].headers.authorization, 'Bearer k1');

  assert.deepEqual(await listModels({ provider: 'custom-anthropic', baseUrl: up.base, apiKey: 'k2', model: '' }), ['m1', 'm2']);
  assert.equal(up.seen[1].url, '/v1/models?limit=1000');
  assert.equal(up.seen[1].headers['x-api-key'], 'k2');

  assert.deepEqual(await listModels({ provider: 'mock' }), ['demo']);
  await assert.rejects(listModels({ provider: 'custom', baseUrl: `${up.base}/v1`, apiKey: 'bad' }), /401: Invalid API key/);
});

test('config: enabled models follow the gateway, default first', () => {
  const cur = { id: 'a', name: 'Mine', provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-secret-123456', model: 'gpt-4o', models: ['x', 'y'] };
  const same = mergeConfig({ provider: 'openai', baseUrl: cur.baseUrl, model: 'y', models: ['y', 'z', 'z', ' '] }, cur);
  assert.deepEqual([same.id, same.name, same.models], ['a', 'Mine', ['y', 'z']]);
  assert.deepEqual(publicConfig({ ...cur, model: 'q' }).models, ['q', 'x', 'y']);
  // A different provider starts with no models and no key; a new gateway is named after its provider.
  const fresh = mergeConfig({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }, cur);
  assert.deepEqual([fresh.models, fresh.apiKey], [[], '']);
  assert.equal(mergeConfig({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'm' }).name, 'DeepSeek');
});

test('config: key is kept only for the same provider and base URL, and is never exposed', async () => {
  const cur = { provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-secret-123456', model: 'gpt-4o' };
  assert.equal((await mergeConfig({ provider: 'openai', baseUrl: cur.baseUrl, model: 'x' }, cur)).apiKey, cur.apiKey);
  assert.equal((await mergeConfig({ provider: 'openai', baseUrl: 'https://evil.test/v1', model: 'x' }, cur)).apiKey, '');
  assert.equal((await mergeConfig({ provider: 'deepseek', baseUrl: cur.baseUrl, model: 'x' }, cur)).apiKey, '');
  const pub = publicConfig(cur);
  assert.equal(pub.apiKey, undefined);
  assert.ok(!JSON.stringify(pub).includes('secret'));
  assert.match(validateConfig({ provider: 'openai', baseUrl: cur.baseUrl, apiKey: '', model: 'gpt-4o' }), /API_KEY/);
  assert.equal(validateConfig({ provider: 'mock' }), null);
});

test('every platform x framework yields a continuous timeline and a prompt', () => {
  for (const p of PLATFORMS) {
    for (const f of FRAMEWORKS) {
      for (const duration of [15, p.defaultDuration, 180]) {
        const plan = buildPlan({ platformId: p.id, frameworkId: f.id, topic: 'test', duration });
        assert.equal(plan.timeline[0].start, 0);
        assert.equal(plan.timeline.at(-1).end, duration);
        plan.timeline.forEach((s, i) => {
          assert.ok(s.end > s.start, `${p.id}/${f.id}/${duration}: empty stage ${s.key}`);
          if (i) assert.equal(s.start, plan.timeline[i - 1].end);
        });
        const { system, user } = buildPrompts(plan);
        assert.ok(system.includes(p.name) && user.includes('test'));
      }
    }
  }
});

test('parseScript tolerates fences and normalises fields', () => {
  const raw = '```json\n{"title":"T","scenes":[{"start":0,"end":3,"voiceover":"hi"}],"publish":{"hashtags":["a","#b"],"titles":"one"}}\n```';
  const s = parseScript(raw);
  assert.equal(s.scenes[0].id, 1);
  assert.deepEqual(s.publish.hashtags, ['#a', '#b']);
  assert.deepEqual(s.publish.titles, ['one']);
  assert.throws(() => parseScript('sorry, no'), /JSON/);
});
