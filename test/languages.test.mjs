// The output language of a script, the narration styles blended into its structure, and the terminal log.

import test from 'node:test';
import assert from 'node:assert/strict';

import { LANGUAGES, getLanguage, promptName, isNative } from '../src/languages.mjs';
import { buildPlan, buildPrompts, buildNarrationPrompts, buildRefinePrompts, planSummary, paceOf } from '../src/prompt.mjs';
import { countSpoken, lockNarration, PACE } from '../src/narration.mjs';
import * as browser from '../public/narration.js';
import { FRAMEWORKS, getFramework, pickVoices, MAX_VOICES } from '../src/frameworks.mjs';
import { voiceClash, voiceBlock, CLASH_REASON } from '../public/compat.js';
import { reviewNarration } from '../src/agent/review.mjs';
import { buildEditPrompts } from '../src/agent/prompts.mjs';
import { selectSkills } from '../src/agent/skills.mjs';
import { buildPostPrompts, postFormat, postLanguage } from '../src/post.mjs';
import { speakable } from '../src/speech.mjs';
import { matchLanguage, detectLang } from '../public/i18n.js';
import { captionsOf } from '../public/film.js';

test('the languages a script can be written in: the major ones, each with a family, a unit and a rate', () => {
  assert.deepEqual(LANGUAGES.slice(0, 4).map((l) => l.id), ['zh-CN', 'zh-TW', 'en', 'ja']);
  assert.ok(LANGUAGES.length >= 15 && new Set(LANGUAGES.map((l) => l.id)).size === LANGUAGES.length);
  for (const l of LANGUAGES) assert.ok(l.name && l.english && ['zh', 'en'].includes(l.family) && l.rate > 0.5 && l.rate < 2.5 && l.unit, l.id);
  for (const id of ['ko', 'es', 'fr', 'de', 'pt', 'ru', 'ar', 'hi', 'id']) assert.ok(getLanguage(id), id);

  // An id from before there was a choice, a rule family, or a browser's tag all name a language.
  assert.deepEqual(['zh', 'en', 'zh-Hans-CN', 'zh-HK', 'zh_Hant', 'pt-BR', 'EN-gb', 'JA'].map((id) => getLanguage(id).id), ['zh-CN', 'en', 'zh-CN', 'zh-TW', 'zh-TW', 'pt', 'en', 'ja']);
  for (const id of ['', null, undefined, 'xx', 'tlh-US']) assert.equal(getLanguage(id), undefined, String(id));
  assert.deepEqual([promptName(getLanguage('ja')), promptName(getLanguage('en')), promptName(getLanguage('zh'))], ['Japanese (日本語)', 'English', 'Simplified Chinese (简体中文)']);
  assert.deepEqual(LANGUAGES.filter(isNative).map((l) => l.id), ['zh-CN', 'en']);
});

test('a brief is written in the language asked for, otherwise in its platform\'s own', () => {
  const brief = (extra) => buildPlan({ platformId: 'douyin', topic: '为什么企业买了大模型却用不起来', ...extra });
  // Nothing asked: as before, the platform decides.
  assert.deepEqual([brief().brief.lang, brief().brief.language, brief().unit, brief().pace], ['zh', 'zh-CN', '汉字', PACE.zh]);
  assert.deepEqual([buildPlan({ platformId: 'tiktok', topic: 'x' }).brief.language, buildPlan({ platformId: 'tiktok', topic: 'x' }).unit], ['en', 'words']);
  // The two old values still mean what they meant.
  assert.deepEqual([brief({ language: 'en' }).brief.language, buildPlan({ platformId: 'tiktok', topic: 'x', language: 'zh' }).brief.language], ['en', 'zh-CN']);
  assert.equal(brief({ language: 'nope' }).brief.language, 'zh-CN');

  // Japanese on a Chinese platform: English rules, counted by the character, at its own pace.
  const ja = brief({ language: 'ja', duration: 60 });
  assert.deepEqual([ja.brief.lang, ja.brief.language, ja.unit, ja.pace, ja.budget], ['en', 'ja', 'characters', 5.5, 330]);
  assert.deepEqual([planSummary(ja).lang, planSummary(ja).language], ['en', 'ja']);
  const { system } = buildPrompts(ja);
  assert.match(system, /# Output language\nWrite every value in the JSON in Japanese \(日本語\)\. The rules below are written in English.*never answer in English because the rules are\. Keep the JSON keys exactly as given, in English\./);
  assert.ok(system.includes('The voiceover is spoken Japanese, the way people actually talk') && !system.includes('spoken English') && system.includes('about 330 characters in total'));
  assert.ok(buildNarrationPrompts(ja).system.includes('in Japanese (日本語)') && buildNarrationPrompts(ja).system.includes('about 330 characters of narration'));

  // Traditional Chinese keeps the Chinese rules and is told which script to write.
  const tw = brief({ language: 'zh-TW', ttsReady: true });
  assert.deepEqual([tw.brief.lang, tw.brief.language, tw.unit, tw.pace], ['zh', 'zh-TW', '汉字', PACE.zh]);
  assert.match(buildPrompts(tw).system, /in Traditional Chinese \(繁體中文\)\. Use Traditional Chinese characters \(繁體字\) throughout/);
  assert.ok(buildPrompts(tw).system.includes('旁白（voiceover）必须是中文大白话口语'));

  // The two native languages read exactly as they did: no note about the rules.
  assert.ok(buildPrompts(brief()).system.includes('# Output language\nWrite every value in the JSON in Simplified Chinese (简体中文). Keep the JSON keys exactly as given, in English.\n'));
  assert.ok(buildPrompts(brief({ language: 'en' })).system.includes('# Output language\nWrite every value in the JSON in English. Keep the JSON keys exactly as given, in English.\n'));
  assert.ok(buildPrompts(brief({ language: 'en' })).system.includes('The voiceover is spoken English: contractions'));

  // Text-to-speech and a refinement are asked for in the language, not in English.
  const es = brief({ language: 'es', ttsReady: true });
  assert.ok(buildPrompts(es).system.includes('read aloud in Spanish, with no digits or symbols left'));
  const refine = buildRefinePrompts(es, [{ stage: 'hook', text: 'Hola a todos, hoy hablamos de precios.' }], { preset: 'tts' });
  assert.ok(refine.system.includes('The narration is in Spanish (Español) and stays in Spanish (Español).') && refine.user.includes('read aloud in Spanish'));
});

test('a narration is counted and paced in its own language, the same on the server and in the browser', () => {
  assert.deepEqual([countSpoken('こんにちは、世界！', 'ja'), countSpoken('AI の時代', 'ja'), countSpoken('안녕하세요 여러분', 'ko'), countSpoken('繁體中文的旁白', 'zh-TW')], [7, 4, 8, 7]);
  assert.deepEqual([countSpoken('Hola a todos, ¿qué tal?', 'es'), countSpoken('Привет, мир', 'ru'), countSpoken('مرحبا بالعالم', 'ar'), countSpoken('こんにちは 世界', 'en')], [5, 2, 2, 2]);
  for (const text of ['こんにちは、世界！AI 2026', '안녕하세요 여러분', 'Hola a todos', '你好，世界', '[[Très]] bien ⏸ merci']) {
    for (const l of LANGUAGES) assert.equal(browser.countSpoken(text, l.id), countSpoken(text, l.id), `${l.id}: ${text}`);
  }
  // A style's own pace is scaled by the language; the two native languages keep theirs to the decimal.
  const quiet = getFramework('quiet_story');
  assert.deepEqual([paceOf(quiet, 'zh'), paceOf(quiet, 'zh-TW'), paceOf(quiet, 'en'), paceOf(quiet, 'ja'), paceOf(quiet, 'de'), paceOf(getFramework('pas'), 'ko')], [3.5, 3.5, 2.1, 4.4, 1.8, 4.7]);
  // A locked narration is laid back without spaces in Chinese and Japanese, with them elsewhere.
  const beats = [{ stage: '', text: 'これは一つ目。\nこれは二つ目。' }];
  assert.equal(lockNarration([{ voiceover: 'x' }], beats, 'ja').scenes[0].voiceover, 'これは一つ目。これは二つ目。');
  assert.equal(lockNarration([{ voiceover: 'x' }], [{ stage: '', text: 'Uno.\nDos.' }], 'es').scenes[0].voiceover, 'Uno. Dos.');
  assert.deepEqual([speakable('一つ ⏸ 二つ', 'ja'), speakable('一 ⏸ 二', 'zh-TW'), speakable('uno ⏸ dos', 'es')], ['一つ、二つ', '一，二', 'uno, dos']);
  assert.ok(captionsOf('これは日本語の字幕で、とても長い一文になっているので、短く切られます。', 'ja').every((line) => [...line.text].length <= 17));
});

test('the measured review holds another language to its length and leaves its sentences to the editor', () => {
  const plan = buildPlan({ platformId: 'tiktok', topic: 'x', language: 'ja', duration: 30 });
  const long = 'これはとても長い一文で、句点がなかなか来ないまま、ずっと同じ調子で説明が続いていくので、英語の規則で測ると一つの長すぎる文に見えてしまいます';
  const report = reviewNarration([{ stage: plan.timeline[0].key, text: long }], plan);
  assert.ok(!report.findings.some((f) => ['ear.breath', 'opening.hook', 'rhythm.turns'].includes(f.rule)), JSON.stringify(report.findings.map((f) => f.rule)));
  assert.equal(report.stats.unit, 'characters');
  const over = reviewNarration([{ stage: '', text: long.repeat(6) }], plan).findings.find((f) => f.rule === 'length.over');
  assert.match(over.message, /^The narration is \d+ characters; there is room for about \d+\./);
  // English is still measured sentence by sentence.
  const en = buildPlan({ platformId: 'tiktok', topic: 'x', duration: 30 });
  assert.ok(reviewNarration([{ stage: '', text: `${'word '.repeat(30)}.` }], en).findings.some((f) => f.rule === 'ear.breath'));
  // The editor is told the language and is not given a word limit that means nothing in it.
  const edit = buildEditPrompts(plan, [{ stage: '', text: long }], report).system;
  assert.ok(edit.includes('write the review notes in Japanese (日本語) too') && edit.includes('a sentence is short enough to say in one breath') && !edit.includes('a sentence is at most'));

  // A playbook written for one language is read for that language only.
  const ids = (extra) => selectSkills(buildPlan({ platformId: 'tiktok', topic: 'x', ...extra }).brief).map((s) => s.id);
  assert.ok(ids({}).includes('spoken-delivery-en') && !ids({ language: 'ja' }).includes('spoken-delivery-en') && !ids({ language: 'ja' }).includes('spoken-delivery-zh'));
  assert.ok(ids({ language: 'zh-TW' }).includes('spoken-delivery-zh') && ids({ language: 'zh-CN' }).includes('spoken-delivery-zh'));
});

test('an image post is written in the language of its script', () => {
  const format = postFormat('xiaohongshu');
  const entry = (extra) => ({ brief: { topic: 'x' }, script: { title: 't', scenes: [{ id: 1, voiceover: 'v', onScreenText: 'o' }], publish: {} }, ...extra });
  assert.deepEqual([postLanguage(entry(), format).id, postLanguage(entry({ plan: { language: 'ja' } }), format).id, postLanguage(entry({ brief: { topic: 'x', language: 'zh-TW' } }), format).id], ['zh-CN', 'ja', 'zh-TW']);
  assert.ok(buildPostPrompts(entry({ plan: { language: 'ja' } }), format).system.includes('in Japanese (日本語), the language of the script.'));
  assert.ok(buildPostPrompts(entry(), format).system.includes('in Simplified Chinese (简体中文), the language of the script. Keep the JSON keys'));
});

test('the page starts in the language that was picked, then in the browser\'s', () => {
  const pick = (...preferred) => matchLanguage(LANGUAGES, preferred);
  assert.equal(pick('', '', 'fr-CA', 'en-US'), 'fr'); // nothing saved: the browser's first language we write in
  assert.equal(pick('ja', 'zh', 'en-US'), 'ja'); // a saved choice wins
  assert.equal(pick('', 'zh', 'en-US'), 'zh-CN'); // then the interface language that was picked
  assert.deepEqual([pick('zh-TW'), pick('zh-HK'), pick('zh-Hant-US'), pick('zh-Hans-US'), pick('zh'), pick('pt-BR'), pick('xx', 'tlh')], ['zh-TW', 'zh-TW', 'zh-TW', 'zh-CN', 'zh-CN', 'pt', '']);
  assert.equal(detectLang(['fr-FR', 'zh-CN', 'en']), 'zh'); // the interface itself still speaks two
});

test('narration styles blend into the structure only where they go together', () => {
  const voiced = FRAMEWORKS.filter((f) => f.voice);
  assert.ok(voiced.length >= 10 && MAX_VOICES === 2);
  const f = getFramework;
  assert.deepEqual([voiceClash(f('loss_stop'), f('quiet_story')), voiceClash(f('loss_stop'), f('consultant_lecture')), voiceClash(f('podcast_duo'), f('podcast_solo')), voiceClash(f('loss_stop'), f('mouthpiece')), voiceClash(f('listicle'), f('quiet_story')), voiceClash(f('pas'), f('podcast_duo'))], ['pace', 'length', 'speakers', '', '', 'speakers']);
  for (const a of FRAMEWORKS) for (const b of FRAMEWORKS) assert.equal(voiceClash(a, b), voiceClash(b, a), `${a.id} / ${b.id}`);
  for (const axis of ['speakers', 'length', 'pace']) assert.ok(CLASH_REASON[axis].en && CLASH_REASON[axis].zh);

  // The lead is never its own voice; a plain structure lends none; what clashes is left out; two at most.
  assert.deepEqual(pickVoices(['loss_stop', 'pas', 'nope', 'quiet_story', 'mouthpiece', 'mouthpiece', 'tech_explainer', 'toolkit'], f('loss_stop')).map((v) => v.id), ['mouthpiece', 'tech_explainer']);
  assert.deepEqual(pickVoices(['quiet_story', 'loss_stop', 'toolkit'], f('listicle')).map((v) => v.id), ['quiet_story', 'toolkit']); // loss_stop is too fast for the quiet story picked before it
  assert.deepEqual([pickVoices(['podcast_solo'], f('podcast_duo')), pickVoices(undefined, f('pas')), pickVoices('mouthpiece', f('pas'))], [[], [], []]);
  assert.deepEqual(voiceBlock(f('quiet_story'), f('loss_stop'), [], 2), { with: 'loss_stop', axis: 'pace' });
  assert.deepEqual([voiceBlock(f('mouthpiece'), f('loss_stop'), [], 2), voiceBlock(f('toolkit'), f('listicle'), [f('mouthpiece'), f('tech_explainer')], 2)], [null, { full: true }]);

  // The structure keeps the story line, the pace and the length; the blended style adds its rules, in every prompt that carries a voice.
  const plain = buildPlan({ platformId: 'douyin', topic: 'x', frameworkId: 'loss_stop' });
  const mixed = buildPlan({ platformId: 'douyin', topic: 'x', frameworkId: 'loss_stop', voiceIds: ['mouthpiece', 'quiet_story'] });
  assert.deepEqual([mixed.brief.voices.map((v) => v.id), mixed.pace, mixed.budget, mixed.timeline], [['mouthpiece'], plain.pace, plain.budget, plain.timeline]);
  const lead = f('loss_stop').name.zh;
  const lent = f('mouthpiece');
  for (const system of [buildPrompts(mixed).system, buildNarrationPrompts(mixed).system, buildNarrationPrompts(mixed, { planFirst: true }).system, buildEditPrompts(mixed, [{ stage: 'hook', text: '你好' }], reviewNarration([{ stage: 'hook', text: '你好' }], mixed)).system]) {
    assert.ok(system.includes(`# Narration style: ${lead}`) && system.includes(`# Also in the voice of: ${lent.name.zh}`) && system.includes(lent.voice.zh[0]), system.slice(0, 80));
    assert.ok(system.indexOf('# Narration style:') < system.indexOf('# Also in the voice of:') && system.includes('the narration style above leads'));
  }
  assert.ok(!buildPrompts(plain).system.includes('# Also in the voice of'));
  // A plain structure has no voice of its own: the blended one is the only voice, and still does not move the story line.
  const onList = buildPrompts(buildPlan({ platformId: 'tiktok', topic: 'x', frameworkId: 'listicle', voiceIds: ['quiet_story'] })).system;
  assert.ok(!onList.includes('# Narration style:') && onList.includes(`# Also in the voice of: ${f('quiet_story').name.en}`) && onList.includes('The story line above, its stages, the length and the pace stay exactly as given.'));
});

test('the terminal log: quiet in tests, one line per event, never a query string', async () => {
  const { debug, info, where } = await import('../src/log.mjs');
  assert.equal(where('https://api.example.com/v1beta/models/x:streamGenerateContent?key=SECRET&alt=sse'), 'api.example.com/v1beta/models/x:streamGenerateContent');
  const lines = [];
  const write = console.error;
  console.error = (line) => lines.push(line);
  const before = { level: process.env.LOG_LEVEL, colour: process.env.NO_COLOR };
  try {
    debug('llm', 'not shown while the tests run');
    assert.equal(lines.length, 0);
    process.env.NO_COLOR = '1';
    process.env.LOG_LEVEL = 'debug';
    debug('llm', 'call', { model: 'm-1', wire: 'gemini', ms: 12.345, why: 'two words', empty: '', missing: undefined, long: 'x'.repeat(500) });
    process.env.LOG_LEVEL = 'info';
    debug('llm', 'hidden at info');
    info('api', 'GET /api/meta → 200', { ms: 3 });
    process.env.LOG_LEVEL = 'quiet';
    info('api', 'hidden when quiet');
  } finally {
    console.error = write;
    for (const [key, name] of [['level', 'LOG_LEVEL'], ['colour', 'NO_COLOR']]) before[key] === undefined ? delete process.env[name] : (process.env[name] = before[key]);
  }
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^\d\d:\d\d:\d\d\.\d{3} \[llm\] call model=m-1 wire=gemini ms=12.35 why="two words" long=x{220}…$/);
  assert.match(lines[1], /^\d\d:\d\d:\d\d\.\d{3} \[api\] GET \/api\/meta → 200 ms=3$/);
});
