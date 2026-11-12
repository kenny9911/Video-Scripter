// The people of a video and its look: a narration for two voices, the on-screen host who stays the same
// person through a script, the visual style picked from the topic, and reference pictures for the image model.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { FRAMEWORKS } from '../src/frameworks.mjs';
import { STYLES } from '../src/styles.mjs';
import { HOST_PRESETS, MAX_HOST_LOOK, normalizeHosts, hostSetting, normalizeCast, settleCast, onFrame, inferHost, castLine } from '../src/cast.mjs';
import { buildPlan, buildPrompts, buildNarrationPrompts, buildRefinePrompts, parseScript, settleScript, buildVisualPrompt, buildHostPrompt } from '../src/prompt.mjs';
import { buildEditPrompts } from '../src/agent/prompts.mjs';
import { checkNarration } from '../src/agent/narrator.mjs';
import { lockNarration } from '../src/narration.mjs';
import { planShots } from '../src/shots.mjs';
import { suggestStyles, buildStylePrompts, parseStylePick, BY_FRAMEWORK, VOTED } from '../src/suggest.mjs';
import { generateImage, takesReference } from '../src/gateway/media.mjs';
import { mergeConfig } from '../src/gateway/config.mjs';

const duo = { platformId: 'wechat_channels', frameworkId: 'podcast_duo', topic: '企业到底该不该自己训练大模型', duration: 120 };
const talk = [{ stage: 'cold_open', text: 'A：为什么企业都在训练自己的模型？B：因为他们以为数据是护城河。' }, { stage: 'setup', text: 'A：等等，不是吗？B：数据是，模型不是。' }];

test('a two-voice style keeps its speaker labels wherever the narration is written, edited or built on', () => {
  assert.deepEqual(FRAMEWORKS.filter((f) => f.speakers === 2).map((f) => f.id), ['podcast_duo']);
  assert.deepEqual(FRAMEWORKS.filter((f) => f.hosted).map((f) => f.id), ['podcast_solo', 'podcast_duo']);

  const plan = buildPlan(duo);
  const label = '每句台词开头的“A：”“B：”标签必须保留';
  assert.ok(buildNarrationPrompts(plan).system.includes(label));
  assert.ok(buildRefinePrompts(plan, talk, { preset: 'spoken' }).system.includes(label));
  assert.ok(buildEditPrompts(plan, talk, checkNarration(plan, talk)).system.includes(label));
  assert.ok(buildPrompts(plan).system.includes(label));
  assert.ok(buildPrompts(buildPlan({ ...duo, narration: talk })).system.includes('标签是原文的一部分'), 'a locked conversation keeps its labels as written');
  assert.ok(!buildNarrationPrompts(buildPlan({ ...duo, frameworkId: 'podcast_solo' })).system.includes(label), 'one voice needs no labels');
  assert.ok(buildPrompts(buildPlan({ ...duo, platformId: 'tiktok' })).system.includes('keep the "A:" / "B:" label at the start of every line'));

  // Two voices and nobody on screen: the script names both, and nobody has a look.
  const { system } = buildPrompts(plan);
  assert.ok(system.includes('# Speakers\n') && system.includes('Nobody is on screen') && system.includes('"cast": ['));
  assert.ok(!system.includes('"host": "who is in frame'));

  // When a locked conversation has to be laid over the model's scenes again, no cut parts a speaker from their words.
  const scenes = [8, 20, 12, 8].map((n) => ({ voiceover: 'x'.repeat(n) }));
  assert.deepEqual(lockNarration(scenes, talk, 'zh').scenes.map((s) => s.voiceover), ['A：为什么企业都在训练自己的模型？', 'B：因为他们以为数据是护城河。', 'A：等等，不是吗？', 'B：数据是，模型不是。']);

  // The measured review knows a conversation: a beat nobody is named in, and a conversation with one voice.
  const rules = (beats) => checkNarration(plan, beats).findings.map((f) => f.rule);
  assert.ok(!rules(talk).some((r) => r.startsWith('speakers.')));
  assert.ok(rules([talk[0], { stage: 'setup', text: '数据是，模型不是。' }]).includes('speakers.label'));
  assert.ok(rules([{ stage: 'cold_open', text: 'A：为什么？A：因为数据。' }]).includes('speakers.voices'));
  assert.ok(!checkNarration(buildPlan({ ...duo, frameworkId: 'podcast_solo' }), [{ stage: 'cold_open', text: '数据是，模型不是。' }]).findings.some((f) => f.rule.startsWith('speakers.')));
});

test('the host a brief asks for: none, one, or two for a conversation, each with a look or left to the writer', () => {
  assert.deepEqual(normalizeHosts(undefined), []);
  assert.deepEqual(normalizeHosts({ on: false, looks: ['analyst_f'] }), []);
  assert.deepEqual(normalizeHosts({ on: true }), [{ id: 'A', look: '' }]);
  const preset = HOST_PRESETS.find((p) => p.id === 'analyst_f');
  assert.deepEqual(normalizeHosts({ on: true, looks: ['analyst_f', 'ignored'] }, 1, 'zh'), [{ id: 'A', look: preset.look.zh }]);
  assert.deepEqual(normalizeHosts({ on: true, looks: ['analyst_f', '  戴眼镜的\n中年男人。 '] }, 2, 'en'), [{ id: 'A', look: preset.look.en }, { id: 'B', look: '戴眼镜的 中年男人' }]);
  assert.equal([...normalizeHosts({ on: true, looks: ['字'.repeat(900)] })[0].look].length, MAX_HOST_LOOK);
  assert.deepEqual(hostSetting({ on: true, looks: ['analyst_f', ' my own. ', 'third'] }), { on: true, looks: ['analyst_f', 'my own'] });
  assert.equal(hostSetting({ on: false }), null);
  for (const p of HOST_PRESETS) assert.ok(p.name.zh && p.name.en && p.look.zh.length > 15 && p.look.en.length > 40, p.id);
  assert.equal(new Set(HOST_PRESETS.map((p) => p.id)).size, HOST_PRESETS.length);

  assert.deepEqual(buildPlan({ ...duo, host: { on: true, looks: ['analyst_f'] } }).brief.hosts.map((h) => [h.id, Boolean(h.look)]), [['A', true], ['B', false]]);
  assert.deepEqual(buildPlan({ ...duo, frameworkId: 'pas', host: { on: true } }).brief.hosts, [{ id: 'A', look: '' }]);
  assert.deepEqual(buildPlan(duo).brief.hosts, []);
});

test('a script with a host: the scriptwriter is told, and the cast is held to what the creator fixed', () => {
  const plain = buildPrompts(buildPlan({ platformId: 'tiktok', frameworkId: 'pas', topic: 'x' })).system;
  assert.ok(!plain.includes('# Speakers') && !plain.includes('"cast"') && !plain.includes('"host"'), 'a video with one unseen voice is written as before');

  const solo = buildPlan({ platformId: 'tiktok', frameworkId: 'pas', topic: 'x', host: { on: true } });
  const one = buildPrompts(solo).system;
  assert.ok(one.includes('# Speakers and on-screen host') && one.includes('Design the host to fit the topic') && one.includes('calls them "the host"'));
  assert.ok(one.includes('"host": "who is in frame: A, or an empty string') && one.includes('"cast": ['));
  assert.ok(one.indexOf('# Writing rules') < one.indexOf('# Speakers and on-screen host') && one.indexOf('# Speakers and on-screen host') < one.indexOf('# Response format'));

  const both = buildPlan({ ...duo, host: { on: true, looks: ['a woman in a red coat', ''] } });
  const two = buildPrompts(both).system;
  assert.ok(two.includes('The creator has fixed the look of A') && two.includes('  A: a woman in a red coat') && two.includes('Design host B') && two.includes('“主播A”“主播B”') && two.includes('the two-shot ("AB")'));

  // The model's reply, settled: the creator's look wins, a look the model forgot is filled in, and each scene says who is in frame.
  const reply = JSON.stringify({
    title: 'T',
    cast: [{ id: 'A', name: '林夏', role: '主持人', look: 'someone else entirely', voice: '女声' }, { id: 'B', name: '周原', role: '嘉宾', look: '', voice: '男声' }],
    scenes: [
      { start: 0, end: 5, voiceover: 'A：为什么？', visual: '主播A 面对镜头提问', host: 'A' },
      { start: 5, end: 10, voiceover: 'B：因为数据。', visual: '主播B 回答，主播A 在听' },
      { start: 10, end: 15, voiceover: 'A：等等。', visual: '一张架构图铺满画面', host: '' },
      { start: 15, end: 20, voiceover: 'B：是的。', visual: '两人同框', host: 'both' },
    ],
  });
  const script = settleScript(parseScript(reply), both.brief);
  assert.deepEqual(script.cast.map((c) => [c.id, c.name, c.voice]), [['A', '林夏', '女声'], ['B', '周原', '男声']]);
  assert.equal(script.cast[0].look, 'a woman in a red coat');
  assert.ok(script.cast[1].look.length > 10, 'a host with no look gets a ready-made one, so the images still show one person');
  assert.deepEqual(script.scenes.map((s) => s.host), ['A', 'AB', '', 'AB']);

  // A conversation with nobody on screen keeps its voices only; a plain script carries no cast at all.
  const heard = settleScript(parseScript(reply), buildPlan(duo).brief);
  assert.deepEqual([heard.cast.map((c) => c.look), heard.scenes.some((s) => 'host' in s)], [['', ''], false]);
  const none = settleScript(parseScript(reply), buildPlan({ platformId: 'tiktok', frameworkId: 'pas', topic: 'x' }).brief);
  assert.ok(!('cast' in none) && none.scenes.every((s) => !('host' in s)) && none.scenes[0].voiceover === 'A：为什么？');
  assert.deepEqual(settleCast([], solo.brief).map((c) => [c.id, c.look.length > 10]), [['A', true]]);

  assert.deepEqual([onFrame('AB'), onFrame('a and b'), onFrame('Host B'), onFrame(''), onFrame('none'), onFrame('yes', ['A']), onFrame('BANANA')], [['A', 'B'], ['A', 'B'], ['B'], [], [], ['A'], []]);
  assert.deepEqual([inferHost('主播A 面对镜头，主播 B 点头', ['A', 'B']), inferHost('the host points at the chart', ['A']), inferHost('a chart fills the frame', ['A'])], ['AB', 'A', '']);
  assert.deepEqual(normalizeCast([{ id: 'b', name: 'x', look: 'tall.' }, { name: 'y' }, { name: 'z' }]).map((c) => [c.id, c.name, c.look]), [['A', 'y', ''], ['B', 'x', 'tall']]);
});

test('every image of a scene with a host carries the same description of them, and the portrait is the reference', () => {
  const cast = [{ id: 'A', name: 'Lin', look: 'a woman in a cream blazer' }, { id: 'B', look: 'a man in a grey sweater' }];
  const scene = { visual: '主播A 指着屏幕', camera: 'medium shot', cast, host: 'A' };
  const p = buildVisualPrompt(scene);
  assert.ok(p.includes('Recurring host of this video, the same person in every shot.') && p.includes('Host A, Lin (called "主播A" or "Host A" in the description): a woman in a cream blazer.'));
  assert.ok(!p.includes('grey sweater') && !p.includes('attached image'), 'only who is in frame, and no reference is claimed that was not sent');
  assert.ok(p.indexOf('主播A 指着屏幕') < p.indexOf('Recurring host') && p.indexOf('Recurring host') < p.indexOf('No captions'));
  assert.ok(buildVisualPrompt({ ...scene, host: 'AB' }, 'video').includes('Host B (called "主播B" or "Host B" in the description): a man in a grey sweater.'));
  assert.ok(!buildVisualPrompt({ ...scene, host: '' }).includes('Recurring'), 'a cutaway scene has nobody in it');
  assert.ok(!buildVisualPrompt({ visual: 'x' }).includes('Recurring'));
  assert.ok(buildVisualPrompt(scene, 'image', [], null, { referenced: ['A'] }).includes('The attached image is the reference portrait of this person'));
  assert.ok(buildVisualPrompt({ ...scene, host: 'AB' }, 'image', [], null, { referenced: ['A', 'B'] }).includes('Attached image 1 is the reference portrait of Host A; attached image 2 is the reference portrait of Host B'));
  assert.equal(castLine(cast, 'B', { referenced: ['A'] }).includes('Attached'), false, 'a portrait of someone who is not in frame is not mentioned');
  // The detail and surroundings cutaways of a scene leave the host out, as they leave out every subject.
  const [hero, detail, context] = planShots('broll', 3).map((shot) => buildVisualPrompt(scene, 'image', [], shot));
  assert.deepEqual([hero.includes('Recurring host'), detail.includes('Recurring host'), context.includes('Recurring host')], [true, false, false]);

  const portrait = buildHostPrompt(cast[0], { aspectRatio: '16:9', styleIds: ['podcast'] });
  assert.match(portrait, /^Landscape 16:9 reference portrait of the recurring host[\s\S]*a woman in a cream blazer\.[\s\S]*One person only[\s\S]*Visual style: solo podcast studio/);
  assert.throws(() => buildHostPrompt({ id: 'B', look: '' }), /no look/);
});

function fakeImages({ edits = true } = {}) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    seen.push({ url: req.url, type: req.headers['content-type'] || '', body: Buffer.concat(chunks).toString('latin1') });
    const send = (status, obj) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(obj));
    if (req.url === '/v1/images/generations') return send(200, { data: [{ b64_json: 'UExBSU4=' }] });
    if (req.url === '/v1/images/edits' && edits) return send(200, { data: [{ b64_json: 'UkVG' }] });
    send(404, { error: { message: 'no such route' } });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}/v1` })));
}

test('a host portrait goes to the image model as a reference, and a provider that takes none is not asked twice', async (t) => {
  const references = [{ bytes: Buffer.from('PNG-A'), type: 'image/png' }, { bytes: Buffer.from('JPG-B'), type: 'image/jpeg' }];
  const ask = { prompt: 'plain prompt', referencePrompt: 'prompt that mentions the portraits', references, aspectRatio: '16:9' };

  const up = await fakeImages();
  t.after(() => up.server.close());
  const config = mergeConfig({ provider: 'custom', baseUrl: 'https://text.example/v1', model: 'writer', image: { baseUrl: up.base, model: 'painter', size: '1024x1536' } });
  assert.deepEqual(await generateImage(config, ask), { url: 'data:image/png;base64,UkVG', usage: null, referenced: true });
  assert.equal(up.seen.length, 1);
  assert.equal(up.seen[0].url, '/v1/images/edits');
  assert.match(up.seen[0].type, /^multipart\/form-data/);
  for (const part of ['name="model"\r\n\r\npainter', 'prompt that mentions the portraits', 'name="size"\r\n\r\n1536x1024', 'name="image[]"; filename="reference-1.png"', 'name="image[]"; filename="reference-2.jpg"', 'PNG-A', 'JPG-B']) assert.ok(up.seen[0].body.includes(part), part);
  assert.ok(!up.seen[0].body.includes('plain prompt'));
  // One reference is sent as "image"; no reference is a plain request, as before.
  await generateImage(config, { ...ask, references: references.slice(0, 1) });
  assert.ok(up.seen[1].body.includes('name="image"; filename="reference-1.png"'));
  assert.deepEqual(await generateImage(config, { prompt: 'plain prompt' }), { url: 'data:image/png;base64,UExBSU4=', usage: null });
  assert.equal(up.seen[2].url, '/v1/images/generations');

  // A provider with no edits endpoint: the picture is made from the description alone, and it is not asked again.
  const plain = await fakeImages({ edits: false });
  t.after(() => plain.server.close());
  const other = mergeConfig({ provider: 'custom', baseUrl: 'https://text.example/v1', model: 'writer', image: { baseUrl: plain.base, model: 'painter' } });
  assert.equal(takesReference(other), true);
  assert.deepEqual(await generateImage(other, ask), { url: 'data:image/png;base64,UExBSU4=', usage: null });
  assert.deepEqual(plain.seen.map((r) => r.url), ['/v1/images/edits', '/v1/images/generations']);
  assert.ok(JSON.parse(plain.seen[1].body).prompt === 'plain prompt', 'without the pictures, the prompt does not mention them');
  assert.equal(takesReference(other), false);
  await generateImage(other, ask);
  assert.deepEqual(plain.seen.map((r) => r.url).slice(2), ['/v1/images/generations']);
  assert.equal(takesReference(mergeConfig({ provider: 'mock' })), false, 'demo mode draws placeholders');
});

test('the look is picked from the topic, the structure, the platform, the tone and the host', () => {
  const known = new Set(STYLES.map((s) => s.id));
  for (const id of VOTED) assert.ok(known.has(id), `the suggester votes for "${id}", which is not a style`);
  for (const f of FRAMEWORKS) assert.ok(BY_FRAMEWORK[f.id], `${f.id}: no style is suggested for this structure`);

  const lead = (brief, lang = 'zh') => suggestStyles(brief, lang).styleIds[0];
  assert.equal(lead({ topic: '企业 AI 到底怎么落地：拆解 Palantir 的 Ontology', frameworkId: 'consultant_lecture', platformId: 'wechat_channels' }), 'whiteboard');
  assert.equal(lead({ topic: '从英伟达最新财报看 B 端生意的赚钱逻辑', frameworkId: 'earnings' }), 'deck');
  assert.equal(lead({ topic: 'Transformer 到底是怎么读懂一句话的？', frameworkId: 'tech_deepdive' }), 'diagram');
  assert.equal(lead({ topic: '两个人聊：企业到底该不该自己训练大模型', frameworkId: 'podcast_duo', host: { on: true } }), 'podcastduo');
  assert.equal(lead({ topic: 'The three things in AI worth knowing this week', frameworkId: 'tech_rundown', host: { on: true } }, 'en'), 'newsdesk');
  assert.deepEqual(suggestStyles({ topic: '老上海咖啡馆的故事', frameworkId: 'story' }, 'zh').styleIds, ['cinematic', 'shanghai']);

  // A second style, when there is one, sets the tone of the first: it comes from the bright or the mood group.
  const blended = suggestStyles({ topic: '什么是 Ontology（本体）？', frameworkId: 'tech_explainer', platformId: 'wechat_channels' }, 'zh');
  assert.deepEqual(blended.styleIds, ['diagram', 'brighttech']);
  assert.match(blended.reason, /选题偏「AI 与软件」.*以「动态图解」为主，融入「明亮科技」的氛围。$/);
  assert.equal(blended.by, 'rules');
  assert.ok(blended.alternatives.length === 3 && blended.alternatives.every((id) => known.has(id) && !blended.styleIds.includes(id)));

  // With a host on screen, the video is led by a style that shows a person.
  const hosted = suggestStyles({ topic: '普通人学 AI 最该先学的一件事', frameworkId: 'golden_retention', host: { on: true } }, 'zh');
  assert.equal(hosted.styleIds[0], 'techdesk');
  assert.match(hosted.reason, /有出镜主播/);
  assert.notEqual(lead({ topic: '普通人学 AI 最该先学的一件事', frameworkId: 'golden_retention' }), 'techdesk');

  // A topic that says nothing recognisable is led by what its structure is made for, and the answer never changes.
  const bare = suggestStyles({ topic: 'xyz', frameworkId: 'howto' }, 'en');
  assert.deepEqual([bare.styleIds, bare.themes], [['screen'], []]);
  assert.match(bare.reason, /^Chosen for the structure "How-to tutorial": led by Screen recording\.$/);
  assert.deepEqual(suggestStyles({ topic: 'xyz', frameworkId: 'howto' }, 'en'), bare);
  assert.equal(lead({ topic: 'x', frameworkId: 'nope' }), lead({ topic: 'x', frameworkId: 'golden_retention' }));
  assert.equal(lead({ topic: 'a calm morning routine', tone: 'warm and gentle', frameworkId: 'golden_retention', platformId: 'instagram' }, 'en'), 'watercolor', 'the tone of the brief votes too');
});

test('the model can be asked for the look too, and its answer is held to the catalogue', () => {
  const { system, user } = buildStylePrompts({ topic: '什么是本体', frameworkId: 'tech_explainer', platformId: 'douyin', tone: '冷静', host: { on: true } }, 'zh');
  for (const s of STYLES) assert.ok(system.includes(`\n${s.id} | ${s.group} | `), s.id);
  assert.ok(system.includes('the lead must be a style that shows a person') && system.includes('Simplified Chinese'));
  assert.ok(user.includes('<<<BRIEF\nTopic: 什么是本体') && user.includes('Tone: 冷静') && user.includes('Platform: 抖音') && user.includes('Structure: Hard tech, demystified'));
  assert.ok(!buildStylePrompts({ topic: 'x' }, 'en').system.includes('shows a person'));

  assert.deepEqual(parseStylePick('```json\n{"lead":"diagram","blend":"brighttech","alternatives":["isometric","nope","diagram","hud"],"reason":"讲的是系统。"}\n```'), { styleIds: ['diagram', 'brighttech'], alternatives: ['isometric', 'hud'], reason: '讲的是系统。', by: 'model' });
  assert.deepEqual(parseStylePick('{"lead":"deck","blend":"deck","reason":"x"}').styleIds, ['deck']);
  assert.deepEqual(parseStylePick('{"lead":"deck","blend":"made-up"}').styleIds, ['deck']);
  for (const raw of ['{"lead":"made-up"}', 'no json here', '{"blend":"deck"}']) assert.equal(parseStylePick(raw), null, raw);
});

// ---------- Through the real HTTP API, in demo mode ----------

test('HTTP: a suggested look, a script with two hosts, their portraits and the package', async (t) => {
  const { spawn } = await import('node:child_process');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');

  const port = 4300 + Math.floor(Math.random() * 90);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scripter-cast-'));
  const admin = { email: 'host@example.test', password: 'correct-horse-battery' };
  const env = { ...process.env, PORT: String(port), DATA_DIR: dir, GATEWAY_CONFIG_FILE: path.join(dir, 'none.json'), DATABASE_URL: '', POSTGRES_URL: '', LLM_PROVIDER: '', API_KEY: '', LLM_API_KEY: '', ADMIN_EMAIL: admin.email, ADMIN_PASSWORD: admin.password };
  const child = spawn(process.execPath, ['server.mjs'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(async () => {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise((resolve) => child.stdout.once('data', resolve));

  let cookie = '';
  const post = async (url, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie && { cookie }) }, body: JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return res;
  };
  const json = async (url, body) => {
    const res = await post(url, body);
    return { status: res.status, body: await res.json() };
  };
  const generate = async (body) => {
    const blocks = (await (await post('/api/generate', body)).text()).split('\n\n').filter(Boolean);
    return JSON.parse(/^data: (.*)$/m.exec(blocks.at(-1))[1]).entry;
  };

  for (const url of ['/api/styles/suggest', '/api/media/host']) assert.equal((await json(url, duo)).status, 401, `${url} needs a signed-in user`);
  assert.equal((await json('/api/auth/login', admin)).status, 200);

  const meta = await (await fetch(`http://127.0.0.1:${port}/api/meta`, { headers: { cookie } })).json();
  assert.deepEqual(meta.styleGroups.map((g) => g.id), ['live', 'illustration', '3d', 'graphic', 'present', 'host', 'bright', 'mood']);
  assert.deepEqual(meta.styles.filter((s) => s.group === 'host').map((s) => s.id), ['techdesk', 'podcast', 'podcastduo', 'newsdesk', 'virtualstudio']);
  assert.ok(meta.hostPresets.length === HOST_PRESETS.length && meta.hostPresets.every((p) => p.name.zh && p.look.en) && meta.maxHostLook === MAX_HOST_LOOK);

  // The look for a brief: by rule at once; in demo mode the model's turn is answered by the rules too.
  const picked = await json('/api/styles/suggest', { ...duo, host: { on: true }, lang: 'zh' });
  assert.deepEqual([picked.status, picked.body.styleIds, picked.body.by], [200, ['podcastduo'], 'rules']);
  assert.deepEqual((await json('/api/styles/suggest', { ...duo, host: { on: true }, lang: 'zh', by: 'model' })).body, picked.body);
  assert.equal((await json('/api/styles/suggest', { platformId: 'douyin' })).status, 400);

  // A conversation with both hosts on screen: A as the creator picked, B designed with the script.
  const host = { on: true, looks: ['analyst_f', ''] };
  const entry = await generate({ ...duo, host, styleIds: picked.body.styleIds });
  assert.deepEqual(entry.script.cast.map((c) => c.id), ['A', 'B']);
  assert.equal(entry.script.cast[0].look, HOST_PRESETS.find((p) => p.id === 'analyst_f').look.zh);
  assert.ok(entry.script.cast[1].look && entry.script.cast.every((c) => c.name && c.voice));
  assert.ok(entry.script.scenes.every((s) => /^A：.*B：/.test(s.voiceover)), 'every line says who speaks');
  assert.deepEqual([entry.script.scenes[0].host, entry.script.scenes.at(-1).host], ['AB', 'AB']);
  assert.ok(entry.script.scenes.some((s) => s.host === ''), 'some scenes cut away from the hosts');
  assert.deepEqual(entry.brief.host, host, 'the host setting is kept with the script, so the form can be put back');

  // Their portraits, stored with the script like scene images.
  const portrait = await json('/api/media/host', { historyId: entry.id, hostId: 'A', aspectRatio: '16:9', styleIds: ['podcastduo'] });
  assert.equal(portrait.status, 200);
  assert.match(portrait.body.url, new RegExp(`^/media/${entry.id}-shostA-image-\\w+\\.svg$`));
  assert.equal((await json('/api/media/host', { historyId: entry.id, hostId: 'B' })).status, 200);
  assert.equal((await json('/api/media/host', { historyId: entry.id, hostId: 'C' })).status, 400);
  assert.equal((await fetch(`http://127.0.0.1:${port}${portrait.body.url}`)).status, 401, 'a portrait is as private as any other image of the script');
  const scene = entry.script.scenes[0];
  const image = await json('/api/media/image', { ...scene, historyId: entry.id, sceneId: scene.id, aspectRatio: '16:9' });
  assert.deepEqual([image.status, image.body.urls.length, image.body.referenced], [200, 1, undefined], 'the demo placeholder is not a reference');
  const saved = (await (await fetch(`http://127.0.0.1:${port}/api/history`, { headers: { cookie } })).json()).find((e) => e.id === entry.id);
  assert.deepEqual(Object.keys(saved.media).sort(), ['1', 'hostA', 'hostB']);

  // The package has the portraits next to the scene images, and the page shows the cast.
  const zip = Buffer.from(await (await post('/api/history/package', { id: entry.id, markdown: '# x', lang: 'zh' })).arrayBuffer()).toString('latin1');
  for (const name of ['images/host-A.svg', 'images/host-B.svg', 'images/scene-01_']) assert.ok(zip.includes(name), name);

  // A conversation with nobody on screen keeps its two voices; any other script is as it always was.
  const heard = await generate(duo);
  assert.deepEqual([heard.script.cast.map((c) => c.look), heard.script.scenes.some((s) => 'host' in s), heard.brief.host], [['', ''], false, undefined]);
  assert.equal((await json('/api/media/host', { historyId: heard.id, hostId: 'A' })).status, 400, 'a voice has no portrait');
  const plain = await generate({ platformId: 'douyin', frameworkId: 'pas', topic: '为什么企业买了大模型却用不起来' });
  assert.ok(!('cast' in plain.script) && plain.script.scenes.every((s) => !('host' in s)));
  const solo = await generate({ platformId: 'tiktok', frameworkId: 'podcast_solo', topic: 'Whose job is AI actually taking?', host: { on: true } });
  assert.deepEqual([solo.script.cast.map((c) => c.id), solo.script.scenes[0].host, solo.brief.host], [['A'], 'A', { on: true, looks: [] }]);
});
