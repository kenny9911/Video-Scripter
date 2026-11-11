// The narration agent: its skills, the measured review, the viewpoint card, and the plan → write → review loop.
import test from 'node:test';
import assert from 'node:assert/strict';

import { SKILLS, STEPS, parseSkill, selectSkills, skillSection, publicSkill } from '../src/agent/skills.mjs';
import { reviewNarration, namesIn, LIMITS } from '../src/agent/review.mjs';
import { normalizeCard } from '../src/agent/card.mjs';
import { buildEditPrompts, parseEdit } from '../src/agent/prompts.mjs';
import { runNarrationAgent, writeNarration, reviseNarration, checkNarration, AGENT_STEPS } from '../src/agent/narrator.mjs';
import { buildPlan, buildPrompts, buildNarrationPrompts, parseScript } from '../src/prompt.mjs';
import { PLATFORMS } from '../src/platforms.mjs';
import { MAX_DURATION } from '../src/narration.mjs';

const palantir = { platformId: 'wechat_channels', frameworkId: 'tech_explainer', topic: '企业AI怎么落地：学 Palantir 的 ONTOLOGY，中文叫本体', duration: 90 };
const ids = (skills) => skills.map((s) => s.id);

// ---------- Skills ----------

test('every skill file is complete, and the app only ever shows its name and purpose', () => {
  assert.ok(SKILLS.length >= 8);
  assert.equal(new Set(ids(SKILLS)).size, SKILLS.length);
  for (const s of SKILLS) {
    assert.equal(s.name, s.id, `${s.id}: the name in the header matches the folder`);
    assert.ok(s.title.zh && s.title.en && s.description.length > 30, `${s.id}: titles and description`);
    assert.ok(s.steps.length && s.steps.every((x) => STEPS.includes(x)), `${s.id}: steps`);
    assert.ok(s.body.length > 200, `${s.id}: a playbook, not a stub`);
    assert.deepEqual(Object.keys(publicSkill(s)), ['id', 'title', 'description']);
  }
});

test('parseSkill reads the header and refuses a file without one, an unknown step or an empty body', () => {
  const s = parseSkill('---\nname: demo\ntitle-zh: 演示\nlang: zh\nplatforms: douyin, tiktok\nkeywords: Alpha，贝塔\nmin-duration: 120\nsteps: write, review\n---\n\n# Demo\n\nbody', 'demo');
  assert.deepEqual([s.title, s.lang, s.platforms, s.keywords, s.minDuration, s.steps, s.body], [{ zh: '演示', en: 'demo' }, 'zh', ['douyin', 'tiktok'], ['Alpha', '贝塔'], 120, ['write', 'review'], '# Demo\n\nbody']);
  assert.deepEqual(parseSkill('---\nname: x\n---\nbody', 'x').steps, ['plan', 'write', 'review'], 'no steps named: the three narration steps');
  assert.throws(() => parseSkill('# just markdown', 'x'), /no header/);
  assert.throws(() => parseSkill('---\nsteps: dance\n---\nbody', 'x'), /unknown step/);
  assert.throws(() => parseSkill('---\nname: x\n---\n', 'x'), /empty/);
});

test('skills are picked by platform, language, style, length and what the brief mentions', () => {
  const zh = ids(buildPlan(palantir).skills);
  for (const id of ['enterprise-ai-ontology', 'honest-sourcing', 'retention-rhythm', 'spoken-delivery-zh', 'viewpoint-card', 'wechat-channels-growth']) assert.ok(zh.includes(id), id);
  assert.ok(!zh.includes('spoken-delivery-en') && !zh.includes('consultant-whiteboard-lecture'));
  assert.ok(ids(buildPlan({ ...palantir, frameworkId: 'consultant_lecture' }).skills).includes('consultant-whiteboard-lecture'));
  // No keyword in the brief: the knowledge base stays out. Another platform: no 视频号 playbook.
  const plain = ids(buildPlan({ platformId: 'douyin', topic: '小餐馆定价最容易踩的三个坑' }).skills);
  assert.ok(!plain.includes('enterprise-ai-ontology') && !plain.includes('wechat-channels-growth') && plain.includes('spoken-delivery-zh'));
  // A keyword is found in the reference material too, whatever its case or spacing.
  assert.ok(ids(buildPlan({ platformId: 'douyin', topic: 'x', reference: '我们在做企业 ai 落地' }).skills).includes('enterprise-ai-ontology'));
  const en = ids(buildPlan({ platformId: 'tiktok', topic: 'Why most people quit learning to code' }).skills);
  assert.deepEqual(en, ['honest-sourcing', 'spoken-delivery-en']);
  // The conditions themselves.
  const brief = buildPlan({ ...palantir, duration: 60 }).brief;
  const skill = (over) => ({ id: 'x', lang: '', platforms: [], frameworks: [], groups: [], keywords: [], minDuration: 0, ...over });
  assert.equal(selectSkills(brief, [skill({ minDuration: 180 })]).length, 0);
  assert.equal(selectSkills(brief, [skill({ groups: ['tech'] }), skill({ frameworks: ['pas'] }), skill({ frameworks: ['pas'], groups: ['tech'] })]).length, 2, 'a style matches by its id or by its group');
});

test('a step reads only the skills written for it, nested under the prompt\'s own headings', () => {
  const { skills } = buildPlan(palantir);
  const plan = skillSection(skills, 'plan').join('\n');
  const write = skillSection(skills, 'write').join('\n');
  assert.ok(write.includes('## Skill: spoken-delivery-zh') && !plan.includes('## Skill: spoken-delivery-zh'));
  assert.ok(plan.includes('## Skill: viewpoint-card') && plan.includes('#### 三维'), 'a playbook\'s headings sit below the skill\'s');
  assert.ok(!/^# (?!Skills)/m.test(write), 'no playbook heading competes with the prompt\'s sections');
  assert.deepEqual(skillSection([], 'write'), []);
});

// ---------- The measured review ----------

const rules = (report, level) => report.findings.filter((f) => !level || f.level === level).map((f) => f.rule);

test('the review catches what a model cannot see in its own draft', () => {
  const plan = buildPlan({ ...palantir, ttsReady: true });
  const bad = [
    { stage: 'hook', text: '大家好，我是老王，今天给大家讲一家市值4000亿美金的公司。' },
    { stage: 'analogy', text: '这家公司通过基于底层数据进行统一建模的方式实现了对企业全部业务对象的实时状态管理和跨系统动作执行。【画面：架构图】' },
    { stage: 'cta', text: '总结一下，这就是最好的方案，加微信领资料。' },
  ];
  const report = reviewNarration(bad, plan);
  const errors = rules(report, 'error');
  for (const rule of ['opening.greeting', 'closing.wrapup', 'compliance.banned', 'spoken.direction', 'tts.digits', 'ear.breath']) assert.ok(errors.includes(rule), rule);
  const warns = rules(report, 'warn');
  for (const rule of ['compliance.extreme', 'names.missing', 'length.under', 'stage.missing']) assert.ok(warns.includes(rule), rule);
  assert.equal(report.errors + report.warns, report.findings.length);
  assert.ok(report.findings.findIndex((f) => f.level === 'warn') > report.findings.findLastIndex((f) => f.level === 'error'), 'errors come first');
  assert.ok(report.findings.find((f) => f.rule === 'names.missing').message.includes('Palantir'));
  assert.ok(report.findings.every((f) => f.message && !/undefined|NaN/.test(f.message)));
});

test('a narration that keeps the rules passes, and the three layers are weighed from the card', () => {
  const plan = buildPlan(palantir);
  const room = (key) => plan.timeline.find((s) => s.key === key);
  const fill = (key, opener) => {
    const size = Math.round((room(key).end - room(key).start) * plan.pace);
    let text = opener;
    while (text.replace(/[，。？]/g, '').length < size) text += '但问题是，系统看不懂业务。';
    return { stage: key, text };
  };
  const good = [
    { stage: 'hook', text: '上了大模型，为什么只敢让它聊天？这一分钟说清楚。先学一家公司。' },
    fill('analogy', 'Palantir靠的是Ontology，中文叫本体。'),
    fill('pitfall', '我们做诊断的时候常看到一个场景。'),
    fill('landing', '落地分三步走。'),
    { stage: 'cta', text: '本体是业务大脑。转给你们负责数字化的同事。下期讲怎么选场景。' },
  ];
  const card = normalizeCard({ insight: { claim: '本体是业务大脑' }, mustSay: ['Palantir', 'Ontology（本体）'], outline: [{ stage: 'hook', layer: 'hook' }, { stage: 'analogy', layer: 'insider' }, { stage: 'pitfall', layer: 'experience' }, { stage: 'landing', layer: 'insight' }, { stage: 'cta', layer: 'cta' }] });
  const report = reviewNarration(good, plan, { card });
  assert.deepEqual(rules(report, 'error'), []);
  assert.ok(Math.abs(report.stats.total - plan.budget) <= plan.budget * 0.1);
  const { insider, experience, insight } = report.stats.ratio;
  assert.ok(insider > 20 && experience > 20 && insight > 20 && Math.abs(insider + experience + insight - 100) <= 1);
  // A name on the card counts as spoken in either of its forms; one that is missing is an error once the card asks for it.
  const missing = reviewNarration(good, plan, { card: { ...card, mustSay: ['Foundry'] } });
  assert.ok(missing.findings.some((f) => f.rule === 'names.missing' && f.level === 'error'));
  // No experience beat at all: said plainly.
  const flat = reviewNarration(good, plan, { card: { ...card, outline: card.outline.map((o) => (o.layer === 'experience' ? { ...o, layer: 'insider' } : o)) } });
  assert.ok(rules(flat).includes('layers.experience'));
});

test('English is measured by the sentence, and names are only taken from a Chinese topic', () => {
  const plan = buildPlan({ platformId: 'tiktok', topic: 'Why Palantir wins', duration: 30 });
  const long = Array.from({ length: LIMITS.en.breathHard + 4 }, (_, i) => `word${i}`).join(' ');
  const report = reviewNarration([{ stage: 'hook', text: `Hey guys, welcome to my channel. ${long}. To sum up, that's it for today.` }], plan);
  for (const rule of ['opening.greeting', 'closing.wrapup', 'ear.breath']) assert.ok(rules(report, 'error').includes(rule), rule);
  assert.ok(!rules(report).includes('names.missing'));
  assert.deepEqual(namesIn('学 Palantir 的 ONTOLOGY，做 AI 和 App，再看 ontology'), ['Palantir', 'ONTOLOGY']);
});

test('every platform that throttles words lists them, and the review refuses them', () => {
  for (const p of PLATFORMS.filter((x) => x.banned)) {
    const plan = buildPlan({ platformId: p.id, topic: 'x' });
    for (const word of p.banned) assert.ok(rules(reviewNarration([{ stage: '', text: `想了解的话${word}。` }], plan), 'error').includes('compliance.banned'), `${p.id}: ${word}`);
  }
});

// ---------- The viewpoint card ----------

test('normalizeCard keeps what the app knows and drops the rest', () => {
  const card = normalizeCard(
    { persona: ' 顾问 ', insight: '一句话', insider: ['a', '', { point: 'b' }], experience: ['seen it', { point: 'mine', source: 'brief' }, { point: '' }], mustSay: 'Palantir', outline: [{ stage: 'hook', layer: 'hook', point: 'p' }, { stage: 'nope', layer: 'insider' }, { stage: 'cta', layer: 'made-up' }], extra: 'ignored', toVerify: ['check'] },
    ['hook', 'cta'],
  );
  assert.deepEqual(card.insight, { claim: '一句话', against: '' });
  assert.deepEqual(card.insider, ['a', 'b']);
  assert.deepEqual(card.experience, [{ point: 'seen it', source: 'draft' }, { point: 'mine', source: 'brief' }]);
  assert.deepEqual(card.outline, [{ stage: 'hook', layer: 'hook', point: 'p' }, { stage: 'cta', layer: '', point: '' }]);
  assert.deepEqual([card.persona, card.mustSay, card.toVerify, 'extra' in card], ['顾问', ['Palantir'], ['check'], false]);
  for (const nothing of [null, 'text', {}, { persona: 'only a persona' }]) assert.equal(normalizeCard(nothing), null);
});

// ---------- Prompts ----------

test('the agent\'s draft plans first, in one reply, with the playbooks for planning and writing', () => {
  const plan = buildPlan({ ...palantir, experience: '我们给一家制造企业做过诊断' });
  const { system, user } = buildNarrationPrompts(plan, { planFirst: true });
  assert.ok(system.includes('# Plan first: the viewpoint card') && system.includes('"card": {') && system.includes('"beats"'));
  assert.ok(system.indexOf('"card"') < system.indexOf('"beats"'), 'the card is written before the narration');
  for (const id of ['viewpoint-card', 'spoken-delivery-zh', 'enterprise-ai-ontology', 'wechat-channels-growth']) assert.ok(system.includes(`## Skill: ${id}`), id);
  assert.ok(system.includes('你刚填好的观点卡') && system.includes('Palantir、Ontology'), 'names in the topic are to be spoken');
  assert.ok(user.includes('<<<EXPERIENCE\n我们给一家制造企业做过诊断\nEXPERIENCE>>>') && user.includes('Plan and write the narration'));
  // A plain draft has no card to fill in; a draft to an existing card is told to write to it.
  const plain = buildNarrationPrompts(plan);
  assert.ok(!plain.system.includes('# Plan first') && !plain.system.includes('"card"') && !plain.user.includes('<<<EXPERIENCE\n\n'));
  const card = normalizeCard({ insight: { claim: '本体是业务大脑' }, mustSay: ['Palantir'] });
  const carded = buildNarrationPrompts(plan, { card });
  assert.ok(carded.user.includes('<<<CARD') && carded.system.includes('用户消息里的观点卡') && !carded.system.includes('# Plan first'));
});

test('the edit prompt carries the measured draft and its findings, and parseEdit reads the notes and the beats', () => {
  const plan = buildPlan(palantir);
  const beats = [{ stage: 'hook', text: '大家好，今天讲本体。' }, { stage: 'cta', text: '总结一下。' }];
  const report = reviewNarration(beats, plan);
  const { system, user } = buildEditPrompts(plan, beats, report, { card: normalizeCard({ insight: { claim: 'c' } }) });
  assert.ok(system.includes('# The standard') && system.includes('## Skill: spoken-delivery-zh') && system.includes('"review"'));
  assert.match(user, /# 1 \[hook\] {2}\(\d+ 汉字, room for about \d+\)\n大家好，今天讲本体。/);
  assert.ok(user.includes('[beat #1]') && user.includes('[beat #2]') && user.includes('[whole narration]') && user.includes('<<<CARD'));
  assert.ok(buildEditPrompts(plan, beats, report, { round: 2 }).system.includes('last pass'));
  const edit = parseEdit('```json\n{"review":[{"beat":1,"problem":"寒暄开场","fix":"直接给命题"},{"beat":0,"problem":"太短"},{"problem":""}],"beats":[{"stage":"hook","text":"新开场。"}]}\n```');
  assert.deepEqual(edit.notes, [{ beat: 0, problem: '寒暄开场', fix: '直接给命题' }, { beat: null, problem: '太短', fix: '' }]);
  assert.deepEqual(edit.beats, [{ stage: 'hook', text: '新开场。' }]);
  assert.throws(() => parseEdit('{"review":[]}'), /no narration/);
});

test('a script built around the agent\'s narration gets its card, the board and the chapters the style calls for', () => {
  const card = normalizeCard({ insight: { claim: '本体是业务大脑' }, mustSay: ['Palantir'] });
  const narration = [{ stage: 'myth', text: '字'.repeat(1000) }];
  const lecture = buildPrompts(buildPlan({ ...palantir, frameworkId: 'consultant_lecture', duration: 240, narration, card }));
  assert.ok(lecture.user.includes('<<<CARD') && lecture.user.indexOf('<<<CARD') < lecture.user.indexOf('<<<NARRATION'));
  assert.ok(lecture.system.includes('whiteboard 必填') && lecture.system.includes('publish.chapters：给出带时间戳'));
  assert.ok(lecture.system.includes('## Skill: consultant-whiteboard-lecture') && !lecture.system.includes('## Skill: spoken-delivery-zh'), 'a final narration needs no writing playbook');
  const short = buildPrompts(buildPlan(palantir));
  assert.ok(short.system.includes('publish.chapters 留空数组') && short.system.includes('whiteboard：只有当') && short.system.includes('## Skill: spoken-delivery-zh'));
  const s = parseScript('{"scenes":[{"voiceover":"hi"}],"whiteboard":"A -> B\\n","publish":{"shareLine":"值得看","chapters":[{"time":"00:00","title":"破题"},"全局架构",{"time":"01:00"}]}}');
  assert.deepEqual([s.whiteboard, s.publish.shareLine, s.publish.chapters], ['A -> B', '值得看', [{ time: '00:00', title: '破题' }, { time: '', title: '全局架构' }]]);
  assert.deepEqual(parseScript('{"scenes":[{"voiceover":"hi"}]}').publish.chapters, []);
});

test('a style sets the pace and, on Auto, the length', () => {
  assert.deepEqual([buildPlan({ ...palantir, frameworkId: 'quiet_story', duration: 60 }).pace, buildPlan({ ...palantir, frameworkId: 'quiet_story', duration: 60 }).budget], [3.5, 210]);
  assert.equal(buildPlan({ platformId: 'tiktok', frameworkId: 'quiet_story', topic: 'x', duration: 60 }).pace, 2.1);
  const auto = buildPlan({ platformId: 'wechat_channels', frameworkId: 'consultant_lecture', topic: 'x' });
  assert.deepEqual([auto.brief.duration, auto.budget], [240, Math.round(240 * 4.2)]);
  assert.equal(buildPlan({ platformId: 'wechat_channels', frameworkId: 'pas', topic: 'x' }).brief.duration, 90, 'a plain structure keeps the platform\'s length');
  assert.equal(buildPlan({ platformId: 'wechat_channels', frameworkId: 'consultant_lecture', topic: 'x', duration: 999 }).brief.duration, MAX_DURATION);
  // A locked narration is timed at the style's pace.
  assert.equal(buildPlan({ ...palantir, frameworkId: 'quiet_story', narration: [{ text: '字'.repeat(420) }] }).brief.duration, 120);
});

// ---------- The agent ----------

/** A stand-in for the gateway: answers each step with the next scripted reply and records what it was asked. */
function scripted(replies) {
  const calls = [];
  const chat = async function* (config, { system, user, meta }) {
    calls.push({ kind: meta.kind, system, user });
    const reply = replies[calls.length - 1];
    if (reply instanceof Error) throw reply;
    yield JSON.stringify(reply).slice(0, 20);
    yield JSON.stringify(reply).slice(20);
  };
  return { chat, calls };
}

const draftCard = { insight: { claim: '本体是业务大脑' }, mustSay: ['Palantir'], outline: [{ stage: 'hook', layer: 'hook', point: 'p' }] };
const greeting = [{ stage: 'hook', text: '大家好，今天讲Palantir。' }];
const clean = [{ stage: 'hook', text: 'Palantir靠什么赚钱？' }];

test('the agent plans and writes in one call, reviews in another, and keeps the corrected narration', async () => {
  const plan = buildPlan(palantir);
  const { chat, calls } = scripted([{ card: draftCard, title: 'T', beats: greeting }, { review: [{ beat: 1, problem: '寒暄', fix: '改成提问' }], beats: clean }]);
  const events = [];
  const recorded = [];
  const out = await runNarrationAgent({ config: {}, plan, chat, emit: (e, d) => events.push([e, d]), onCall: (c) => recorded.push(c) });

  assert.deepEqual(calls.map((c) => c.kind), ['narration', 'edit']);
  assert.ok(calls[1].user.includes('大家好，今天讲Palantir。') && calls[1].user.includes('[beat #1]'), 'the editor sees the draft and what was measured');
  assert.deepEqual([out.title, out.beats, out.card.insight.claim], ['T', clean, '本体是业务大脑']);
  assert.ok(!out.report.findings.some((f) => f.rule === 'opening.greeting'));
  assert.deepEqual([out.report.rounds, out.report.reviewed, out.report.notes], [1, true, [{ beat: 0, problem: '寒暄', fix: '改成提问' }]]);
  assert.deepEqual(out.report.skills.map((s) => s.id), ids(plan.skills));
  const steps = events.filter(([e]) => e === 'step').map(([, d]) => `${d.id}:${d.status}`);
  assert.deepEqual(steps, ['skills:done', 'write:start', 'write:done', 'review:start', 'review:done']);
  assert.deepEqual(AGENT_STEPS, [...new Set(steps.map((x) => x.split(':')[0]))]);
  assert.ok(events.some(([e, d]) => e === 'delta' && d.text.includes('write')), 'the reply is streamed, each step under its own heading');
  assert.deepEqual(recorded.map((c) => [c.step, c.ok]), [['write', true], ['review', true]]);
  assert.ok(recorded.every((c) => c.raw && c.prompts.system && c.ms >= 0));
});

test('an edit that measures worse is not taken, and a second pass runs only while errors are left', async () => {
  const plan = buildPlan(palantir);
  // The first edit still greets; the second fixes it.
  const twice = scripted([{ beats: greeting }, { review: [], beats: greeting }, { review: [], beats: clean }]);
  const two = await runNarrationAgent({ config: {}, plan, chat: twice.chat });
  assert.deepEqual([twice.calls.length, two.report.rounds, two.beats, two.card], [3, 2, clean, null]);
  assert.ok(twice.calls[2].system.includes('last pass'));
  // An edit that adds an error is dropped: the draft stands.
  const worse = scripted([{ beats: clean }, { review: [], beats: [{ stage: 'hook', text: '大家好，总结一下，加微信。' }] }]);
  const kept = await runNarrationAgent({ config: {}, plan, chat: worse.chat });
  assert.deepEqual([kept.beats, worse.calls.length], [clean, 2]);
});

test('the agent fails only when there is no draft: an unreadable review keeps the draft', async () => {
  const plan = buildPlan(palantir);
  await assert.rejects(runNarrationAgent({ config: {}, plan, chat: scripted([{ card: draftCard }]).chat }), (err) => err.unreadable === true && typeof err.raw === 'string' && /no narration/.test(err.message));
  const notes = [];
  const out = await runNarrationAgent({ config: {}, plan, chat: scripted([{ beats: clean }, { oops: true }]).chat, emit: (e, d) => d.status === 'note' && notes.push(d.note) });
  assert.deepEqual([out.beats, out.report.rounds, out.report.reviewed, notes.length], [clean, 0, false, 1]);
  const failed = [];
  await assert.rejects(runNarrationAgent({ config: {}, plan, chat: scripted([new Error('upstream down')]).chat, onCall: (c) => failed.push(c) }), /upstream down/);
  assert.deepEqual(failed.map((c) => [c.step, c.ok, c.error]), [['write', false, 'upstream down']]);
  // Stopping is passed on, not swallowed.
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  await assert.rejects(runNarrationAgent({ config: {}, plan, chat: scripted([{ beats: clean }, abort]).chat }), { name: 'AbortError' });
});

test('the two halves run on their own, a late review takes one pass, and the checks alone change nothing', async () => {
  const plan = buildPlan(palantir);
  const first = scripted([{ card: draftCard, title: 'T', beats: greeting }]);
  const written = await writeNarration({ config: {}, plan, chat: first.chat });
  assert.deepEqual([written.beats, written.report.reviewed, first.calls.length], [greeting, false, 1]);
  assert.ok(written.report.findings.some((f) => f.rule === 'opening.greeting'), 'the draft comes with what it measures as');
  const { chat, calls } = scripted([{ review: [{ beat: 1, problem: 'x', fix: 'y' }], beats: clean }]);
  const out = await reviseNarration({ config: {}, plan, beats: greeting, chat });
  assert.deepEqual([out.beats, out.report.reviewed, calls.length], [clean, true, 1]);
  // Errors are left, but the request is already old: no second pass.
  const late = scripted([{ review: [], beats: greeting }, { review: [], beats: clean }]);
  const once = await reviseNarration({ config: {}, plan, beats: greeting, chat: late.chat, until: Date.now() - 1 });
  assert.deepEqual([once.beats, once.report.rounds, late.calls.length], [greeting, 1, 1]);
  const checked = checkNarration(plan, greeting);
  assert.deepEqual([checked.reviewed, checked.rounds, checked.notes], [false, 0, []]);
  assert.ok(checked.findings.some((f) => f.rule === 'opening.greeting'));
});

test('demo mode runs the whole agent offline', async () => {
  for (const brief of [palantir, { platformId: 'tiktok', frameworkId: 'toolkit', topic: 'Ship your first agent' }]) {
    const plan = buildPlan(brief);
    const out = await runNarrationAgent({ config: { provider: 'mock' }, plan });
    assert.deepEqual(out.beats.map((b) => b.stage), plan.timeline.map((s) => s.key));
    assert.equal(out.card.outline.length, plan.timeline.length);
    assert.ok(out.report.reviewed && out.report.notes.length === 1);
  }
});
