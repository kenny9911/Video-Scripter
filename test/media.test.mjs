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

  assert.deepEqual(await generateImage(config, { prompt: 'a cat' }), { url: 'data:image/png;base64,QUJD', usage: null });
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

test('every visual style has its own name in both languages and a translated note', async () => {
  const { STYLES } = await import('../src/styles.mjs');
  const { readFile } = await import('node:fs/promises');
  const i18n = await readFile(new URL('../public/i18n.js', import.meta.url), 'utf8');
  for (const lang of ['en', 'zh']) assert.equal(new Set(STYLES.map((s) => s.name[lang])).size, STYLES.length, `${lang} names must differ`);
  for (const s of STYLES) {
    assert.ok(i18n.includes(`'${s.blurb.replaceAll("'", "\\'")}': '`) || i18n.includes(`"${s.blurb}": '`), `${s.id}: its note has no Chinese translation in public/i18n.js`);
    assert.ok(s.look.length > 40 && s.brief.length > 20, `${s.id}: the look and the brief describe the style`);
  }
});

test('a custom style carries the creator\'s own words through the script and the media prompts', async () => {
  const { STYLE_GROUPS, MAX_CUSTOM_STYLE, customStyle, pickStyles, styleLook } = await import('../src/styles.mjs');
  const { buildPlan, buildPrompts } = await import('../src/prompt.mjs');
  const { planShots } = await import('../src/shots.mjs');
  const { shotTag } = await import('../src/package.mjs');

  // Every group takes one. A group that is a medium says so; a format or a tone (presenting, bright, mood) is the description alone.
  for (const g of STYLE_GROUPS) {
    const s = customStyle(`custom:${g.id}:warm crayon lines`);
    assert.deepEqual([s.id, s.group, s.custom], [`custom:${g.id}:warm crayon lines`, g.id, true]);
    assert.equal(s.look, g.medium ? `${g.medium}, warm crayon lines` : 'warm crayon lines');
  }
  assert.deepEqual(STYLE_GROUPS.filter((g) => !g.medium).map((g) => g.id), ['present', 'bright', 'mood']);

  // The description is put on one line, loses its closing punctuation, and is cut to length.
  assert.equal(customStyle('custom:illustration:  儿童蜡笔画，\n暖黄纸底。 ').blurb, '儿童蜡笔画， 暖黄纸底');
  assert.equal(customStyle('custom:mood:a: b').blurb, 'a: b', 'a colon in the description is kept');
  assert.equal([...customStyle(`custom:mood:${'字'.repeat(500)}`).blurb].length, MAX_CUSTOM_STYLE);
  for (const id of ['custom:nope:x', 'custom:mood:   ', 'custom:mood', 'custom:', 'flat', '', null]) assert.equal(customStyle(id), null, String(id));

  // It is picked like any other style: alone, blended with a listed one, or with another custom one.
  const custom = 'custom:illustration:儿童蜡笔画';
  assert.deepEqual(pickStyles([custom, 'clay', 'ink']).map((s) => s.id), [custom, 'clay']);
  assert.deepEqual(pickStyles([custom, `${custom} `, 'custom:nope:x', 'custom:mood:雨夜']).map((s) => s.id), [custom, 'custom:mood:雨夜']);
  assert.equal(styleLook(pickStyles([custom])), 'Visual style: illustration, 儿童蜡笔画.');
  const scene = { visual: 'A founder at a desk', camera: 'wide', styleIds: [custom, 'clay'] };
  const prompt = buildVisualPrompt(scene);
  assert.ok(prompt.includes('Lead with custom style (illustration, 儿童蜡笔画)') && prompt.includes('mix in claymation'));

  // The scriptwriter is told what the style is, in the creator's words.
  const { system } = buildPrompts(buildPlan({ platformId: 'douyin', topic: 'x', styleIds: [custom] }));
  assert.ok(system.includes('# Visual style') && system.includes('- 自定义风格: illustration, 儿童蜡笔画.'));

  // Comparing two styles side by side works with a custom one, and its image gets a plain file name.
  const shots = planShots('styles', 3, scene.styleIds);
  assert.deepEqual(shots.map((s) => s.id), [`style-${custom}`, 'style-clay', 'blend']);
  assert.ok(buildVisualPrompt(scene, 'image', scene.styleIds, shots[0]).includes('Visual style: illustration, 儿童蜡笔画.'));
  assert.deepEqual([`style-${custom}`, 'style-clay', 'wide', '', undefined].map(shotTag), ['custom-illustration', 'clay', 'wide', '', '']);
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

test('multi-image modes plan a distinct shot for each image', async () => {
  const { planShots, IMAGE_MODES, SHOT_LABELS } = await import('../src/shots.mjs');
  const ids = (mode, n, styles) => planShots(mode, n, styles).map((s) => s.id);
  assert.deepEqual(ids('sequence', 3), ['start', 'middle', 'end']);
  assert.deepEqual(ids('sequence', 2), ['start', 'end']);
  assert.deepEqual(ids('coverage', 3), ['wide', 'medium', 'close']);
  assert.deepEqual(ids('broll', 2), ['hero', 'detail']);
  assert.deepEqual(ids('variations', 3), ['', '', '']);
  assert.deepEqual(ids('coverage', 1), ['']); // one image is always the scene as written
  assert.deepEqual(ids('nonsense', 9), ['', '', '']); // capped at three
  assert.deepEqual(ids('styles', 3, ['ink', 'clay']), ['style-ink', 'style-clay', 'blend']);
  assert.deepEqual(ids('styles', 2, ['ink']), ['', '']); // needs two styles
  for (const m of IMAGE_MODES) for (const n of [2, 3]) for (const s of planShots(m.id, n, ['ink', 'clay'])) assert.ok(!s.id || s.id.startsWith('style-') || SHOT_LABELS[s.id], s.id);

  const scene = { visual: 'A barista pours milk', camera: 'handheld medium shot', styleIds: ['ink', 'clay'] };
  const [wide, , close] = planShots('coverage', 3).map((shot) => buildVisualPrompt(scene, 'image', scene.styleIds, shot));
  assert.ok(!wide.includes('handheld medium shot') && /wide establishing shot/.test(wide) && /Image 1 of a set of 3/.test(wide));
  assert.match(close, /tight close-up[\s\S]*Image 3 of a set of 3/);
  const [start] = planShots('sequence', 2).map((shot) => buildVisualPrompt(scene, 'image', scene.styleIds, shot));
  assert.ok(start.includes('handheld medium shot') && /first frame of this scene/.test(start)); // timing keeps the scene's camera
  const [a, , blend] = planShots('styles', 3, scene.styleIds).map((shot) => buildVisualPrompt(scene, 'image', scene.styleIds, shot));
  assert.ok(/Visual style: Chinese ink wash/.test(a) && !a.includes('clay') && /blend of two styles/.test(blend));
});

test('zip archives keep non-ASCII file names and plain file permissions when unpacked', async (t) => {
  const { zip } = await import('../src/zip.mjs');
  const { execFileSync } = await import('node:child_process');
  const { mkdtemp, writeFile, readFile, stat, rm } = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zip-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'a.zip'), zip([{ name: '脚本-落地的三个坑/script.md', data: '# 你好' }, { name: '脚本-落地的三个坑/images/scene-01.png', data: Buffer.from([1, 2, 3]), store: true }]));
  execFileSync('unzip', ['-q', 'a.zip'], { cwd: dir, env: { ...process.env, LC_ALL: 'en_US.UTF-8' } });
  assert.equal(await readFile(path.join(dir, '脚本-落地的三个坑', 'script.md'), 'utf8'), '# 你好');
  assert.equal((await stat(path.join(dir, '脚本-落地的三个坑', 'images', 'scene-01.png'))).mode & 0o777, 0o644);
});

test('aspect ratio: sets the frame of the script and the shape of scene images and clips', async (t) => {
  const { ASPECTS, getAspect, sizeFor } = await import('../src/aspects.mjs');
  const { buildPlan, buildPrompts } = await import('../src/prompt.mjs');
  assert.deepEqual(ASPECTS.map((a) => a.id), ['9:16', '16:9', '1:1', '3:4', '4:3']);
  assert.deepEqual([getAspect('16:9').id, getAspect().id, getAspect('7:3').id], ['16:9', '9:16', '9:16']); // unknown or missing: vertical

  // The gateway's Size names the model's two edges; the aspect ratio decides which way round they go.
  assert.deepEqual(['9:16', '16:9', '1:1', '3:4', '4:3'].map((a) => sizeFor('1024x1536', a)), ['1024x1536', '1536x1024', '1024x1024', '1024x1536', '1536x1024']);
  assert.deepEqual([sizeFor('1280x720', '9:16'), sizeFor(' 720 × 1280 ', '16:9'), sizeFor('1024x1536')], ['720x1280', '1280x720', '1024x1536']);
  assert.deepEqual([sizeFor('', '16:9'), sizeFor('auto', '16:9'), sizeFor('2K', '1:1')], ['', 'auto', '2K']); // blank or not WxH: sent as written

  const brief = { platformId: 'tiktok', topic: 'Coffee' };
  assert.match(buildPrompts(buildPlan(brief)).system, /# Format\nVertical 9:16 video, /);
  assert.match(buildPrompts(buildPlan({ ...brief, aspectRatio: '16:9' })).system, /# Format\nLandscape 16:9 video, /);
  assert.equal(buildPlan({ ...brief, aspectRatio: 'nope' }).brief.aspect.id, '9:16');

  const scene = { visual: 'A founder at a desk' };
  assert.match(buildVisualPrompt(scene), /^Vertical 9:16 still frame /);
  assert.match(buildVisualPrompt({ ...scene, aspectRatio: '16:9' }, 'video'), /^Landscape 16:9 shot for /);
  assert.match(buildVisualPrompt({ ...scene, aspectRatio: '1:1' }), /^Square 1:1 still frame /);
  assert.match(buildVisualPrompt({ ...scene, aspectRatio: '3:4' }), /^Portrait 3:4 still frame /);
  assert.match(buildVisualPrompt({ ...scene, aspectRatio: '4:3' }, 'video'), /^Landscape 4:3 shot for /);

  const up = await fakeMedia();
  t.after(() => up.server.close());
  const config = mergeConfig({
    provider: 'custom',
    baseUrl: 'https://text.example/v1',
    model: 'writer',
    image: { baseUrl: `${up.base}/img`, model: 'painter', size: '1024x1536' },
    video: { baseUrl: `${up.base}/vid`, model: 'filmer', size: '720x1280' },
  });
  await generateImage(config, { prompt: 'a cat', aspectRatio: '16:9' });
  await generateImage(config, { prompt: 'a cat', aspectRatio: '1:1' });
  await createVideo(config, { prompt: 'a cat walks', seconds: 4, aspectRatio: '16:9' });
  assert.deepEqual(up.seen.map((r) => r.body.size), ['1536x1024', '1024x1024', '1280x720']);

  // Demo mode draws its placeholder in the shape asked for.
  const demo = async (aspectRatio) => decodeURIComponent((await generateImage(mergeConfig({ provider: 'mock' }), { prompt: 'x', aspectRatio })).url);
  assert.match(await demo('16:9'), /viewBox="0 0 480 270"/);
  assert.match(await demo('3:4'), /viewBox="0 0 360 480"/);
  assert.match(await demo(), /viewBox="0 0 270 480"/);
});
