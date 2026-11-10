// Image and video generation against a local fake of the OpenAI-compatible media endpoints.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { generateImage, createVideo, videoStatus, videoContent, clipSeconds } from '../src/gateway/media.mjs';
import { mergeConfig, publicConfig, mediaTarget, validateConfig } from '../src/gateway/config.mjs';
import { buildVisualPrompt } from '../src/prompt.mjs';

function fakeMedia() {
  const seen = [];
  let polls = 0;
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
    const send = (obj) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(obj));
    if (req.url === '/img/images/generations') return send({ data: [{ b64_json: 'QUJD' }] });
    if (req.url === '/vid/videos') return send({ id: 'video_1', status: 'queued' });
    if (req.url === '/vid/videos/video_1') return send(++polls < 2 ? { id: 'video_1', status: 'in_progress', progress: 40 } : { id: 'video_1', status: 'completed', progress: 100 });
    if (req.url === '/vid/videos/video_1/content') return res.writeHead(200, { 'content-type': 'video/mp4' }).end('MP4DATA');
    res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'no such route' } }));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` })));
}

test('images and videos go to their own base URL and model', async (t) => {
  const up = await fakeMedia();
  t.after(() => up.server.close());
  const config = mergeConfig({
    provider: 'custom',
    baseUrl: 'https://text.example/v1',
    apiKey: 'text-key',
    model: 'writer',
    image: { baseUrl: `${up.base}/img`, model: 'painter', size: '1024x1536' },
    video: { baseUrl: `${up.base}/vid/`, model: 'filmer', apiKey: 'video-key' },
  });

  assert.deepEqual(await generateImage(config, { prompt: 'a cat' }), { url: 'data:image/png;base64,QUJD' });
  assert.deepEqual(up.seen[0].body, { model: 'painter', prompt: 'a cat', n: 1, size: '1024x1536' });
  assert.equal(up.seen[0].auth, 'Bearer text-key'); // no image key: the gateway's is used

  const job = await createVideo(config, { prompt: 'a cat walks', seconds: 5 });
  assert.deepEqual([job.id, job.status], ['video_1', 'running']);
  assert.deepEqual(up.seen[1].body, { model: 'filmer', prompt: 'a cat walks', seconds: '8' }); // no size set: left to the provider
  assert.equal(up.seen[1].auth, 'Bearer video-key');
  assert.deepEqual([(await videoStatus(config, job.id)).progress, (await videoStatus(config, job.id)).status], [40, 'done']);
  assert.equal(await (await videoContent(config, job.id)).text(), 'MP4DATA');
  assert.deepEqual([clipSeconds(3), clipSeconds(8), clipSeconds(30)], [4, 8, 12]);
});

test('media settings: off until a model is set, keys masked and tied to their base URL', async () => {
  const text = { provider: 'custom', baseUrl: 'https://text.example/v1', model: 'writer' };
  const bare = mergeConfig(text);
  assert.deepEqual([publicConfig(bare).image.ready, publicConfig(bare).video.ready], [false, false]);
  await assert.rejects(generateImage(bare, { prompt: 'x' }), /No image model is set/);

  const saved = mergeConfig({ ...text, image: { baseUrl: 'https://img.example/v1', apiKey: 'img-secret-12345', model: 'painter' } });
  assert.ok(!JSON.stringify(publicConfig(saved)).includes('img-secret'));
  assert.deepEqual([publicConfig(saved).image.ready, publicConfig(saved).image.hasKey], [true, true]);
  // Editing without retyping the key keeps it; pointing at another address drops it.
  assert.equal(mergeConfig({ ...text, image: { baseUrl: 'https://img.example/v1', model: 'p2' } }, saved).image.apiKey, 'img-secret-12345');
  assert.equal(mergeConfig({ ...text, image: { baseUrl: 'https://other.example/v1', model: 'p2' } }, saved).image.apiKey, '');
  assert.equal(mergeConfig(text, saved).image.model, 'painter'); // a patch without media leaves it alone
  assert.match(validateConfig(mergeConfig({ ...text, video: { baseUrl: 'ftp://x', model: 'm' } })), /video BASE_URL_API/);

  // A blank base URL means the gateway's own, which only works for OpenAI-compatible providers.
  assert.equal(mediaTarget(mergeConfig({ ...text, image: { model: 'painter' } }), 'image').baseUrl, 'https://text.example/v1');
  const claude = mergeConfig({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'k', model: 'm', image: { model: 'painter' } });
  await assert.rejects(generateImage(claude, { prompt: 'x' }), /separate image BASE_URL_API/);

  // Demo mode draws a placeholder image and has no video.
  assert.match((await generateImage(mergeConfig({ provider: 'mock' }), { prompt: 'x' })).url, /^data:image\/svg/);
  await assert.rejects(createVideo(mergeConfig({ provider: 'mock' }), { prompt: 'x' }), /Demo mode cannot make videos/);
});

test('visual prompt is built from the scene', () => {
  const p = buildVisualPrompt({ visual: 'A founder at a desk', camera: 'slow push in' }, 'video');
  assert.match(p, /9:16 shot[\s\S]*A founder at a desk[\s\S]*Camera: slow push in/);
  assert.throws(() => buildVisualPrompt({ visual: ' ' }), /no visual description/);
});

test('visual styles: one or two, applied to the script brief and to media prompts', async () => {
  const { STYLES, STYLE_GROUPS, pickStyles, styleLook } = await import('../src/styles.mjs');
  const { buildPlan, buildPrompts } = await import('../src/prompt.mjs');
  assert.equal(new Set(STYLES.map((s) => s.id)).size, STYLES.length);
  for (const s of STYLES) assert.ok(STYLE_GROUPS.some((g) => g.id === s.group) && s.name.zh && s.name.en && s.look && s.brief && s.blurb, s.id);

  assert.deepEqual(pickStyles(['ink', 'nope', 'ink', 'clay', 'retro']).map((s) => s.id), ['ink', 'clay']); // unknown and extra ids dropped
  assert.equal(styleLook([]), '');
  const scene = { visual: 'A founder at a desk', camera: 'wide' };
  assert.ok(!buildVisualPrompt(scene).includes('Visual style'));
  assert.match(buildVisualPrompt({ ...scene, styleIds: ['clay'] }), /Visual style: clay stop-motion look/);
  assert.match(buildVisualPrompt(scene, 'video', ['ink', 'clay']), /blend of two styles\. Lead with chinese ink \(.*mix in claymation \(/);

  const plain = buildPrompts(buildPlan({ platformId: 'douyin', topic: 'x' })).system;
  const styled = buildPrompts(buildPlan({ platformId: 'douyin', topic: 'x', styleIds: ['ink', 'clay'] })).system;
  assert.ok(!plain.includes('# Visual style'));
  assert.match(styled, /# Visual style[\s\S]*国风水墨[\s\S]*黏土定格/);
});

test('package names are safe on every file system and keep Chinese titles', async () => {
  const { slug, packageName } = await import('../src/package.mjs');
  assert.equal(slug('  Why "most" people quit: week 3?  '), 'Why-most-people-quit-week-3');
  assert.equal(slug('为什么企业买了大模型，却用不起来？'), '为什么企业买了大模型-却用不起来');
  assert.equal(slug('../../etc/passwd'), 'etc-passwd');
  assert.equal(slug('???'), 'script');
  assert.ok([...slug('长'.repeat(80))].length === 40);
  const ts = new Date(2026, 10, 10, 9, 30).getTime();
  assert.equal(packageName({ ts, platformId: 'douyin', script: { title: 'AI 落地的三个坑' } }), '2026-11-10_douyin_AI-落地的三个坑');
});
