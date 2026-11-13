// The measured half of a narration review. A language model cannot count characters or notice that it
// dropped a name, so these checks are done in code: length against the budget, breath-length sentences,
// greetings and wrap-up phrases, words a platform throttles, names the topic promised, the turn rhythm,
// and the 3 : 3 : 4 balance of the viewpoint card. The editor step of the agent gets the findings as a
// worklist, and the narration editor in the app shows what is left.
//
// reviewNarration(beats, plan, { card }) -> { findings, stats, errors, warns, score }
//   finding: { level: 'error' | 'warn', rule, beat (index, or null for the whole narration), message, excerpt }
// Messages are written in the language of the narration.

import { countSpoken, spokenText } from '../narration.mjs';
import { LAYERS } from './card.mjs';

/** What a sentence may be, per language. Chinese is measured per breath (between two punctuation marks), English per sentence. */
export const LIMITS = {
  zh: { breath: 20, breathHard: 28, hook: 20, turnEvery: 70, turnFrom: 90, figures: 3 },
  en: { breath: 18, breathHard: 26, hook: 12, turnEvery: 40, turnFrom: 55, figures: 3 },
};

const BREATHS = { zh: /[，。！？；：、…—\n]+|[,;:!?]+|\.(?!\d)/, en: /(?<=[.!?…])["'”’)\]]*\s+|\n+/ };
const FIRST_SENTENCE = { zh: /^[^。！？!?\n]*/, en: /^[^.!?\n]*/ };

const GREETING = {
  zh: /大家好|各位好|朋友们好|欢迎来到|欢迎回到|今天(?:给|跟|和|为)大家|^[\s，,！!]*(?:嗨|哈喽|hello)?[\s，,！!]*我是/i,
  en: /\b(?:hey|hi|hello)[, ]+(?:guys|everyone|everybody|folks|friends)\b|\bwelcome (?:back )?to\b|\bin (?:this|today's) video\b|\bmy name is\b/i,
};
const WRAP_UP = {
  zh: /总结一下|总结来说|简单总结|综上所述|综上|以上就是|今天就(?:分享|讲|聊|说)到这|最后总结|最后我想说|感谢(?:大家的?)?(?:观看|收看)/,
  en: /\b(?:to sum up|in conclusion|in summary|to wrap up|that's (?:it|all) for (?:today|now)|thanks for watching)\b/i,
};
const EXTREME = { zh: /最好的|最佳|最强|最先进|全球第一|行业第一|全网第一|第一品牌|唯一选择|唯一正确|100%|百分之百|国家级|史上最/, en: /\b(?:guaranteed|100% (?:safe|effective)|the best in the world|number one in)\b/i };
const HYPE = { zh: /震惊|炸裂|王炸|史诗级|变天了|颠覆认知|细思极恐|赋能|抓手/, en: /\b(?:game[- ]changer|revolutionary|mind[- ]blowing|insane|shocking|changes everything|synergy)\b/i };
const TURNS = { zh: /[？?]|但是?|可是|然而|问题是|结果|反过来|其实|注意|偏偏|没想到|真相是|关键是|换句话说|如果你|假设|想象/g, en: /\?|\b(?:but|yet|except|instead|turns out|here's the (?:catch|thing)|the problem is|imagine|say you|if you)\b/gi };
const NOT_BUT = { zh: /不是[^。！？；\n]{1,30}而是/g, en: /\b(?:it's|it is|this is|that's|that is) not\b[^.!?\n]{1,60}\b(?:it's|it is|but)\b/gi };
const FIGURES = { zh: /\d+(?:\.\d+)?%?|百分之[零一二三四五六七八九十百]+|[零一二三四五六七八九十百千两]+(?:万|亿)|[一二三四五六七八九十]成/g, en: /\d[\d,.]*%?|\b(?:hundred|thousand|million|billion|trillion|percent)\b/gi };
const DIRECTION = /[[【（(]\s*(?:画面|镜头|字幕|音效|停顿|转场|内行解说|顾问经验|核心认知|b-?roll|cut to|sfx|visual|on[- ]screen|pause)[^\]】）)]*[\]】）)]/i;
const MARKUP = /\[\[|\]\]|⏸|^#{1,6}\s|\*\*|\p{Extended_Pictographic}/mu;

const MSG = {
  zh: {
    over: (n, room) => `全文 ${n} 字，超出约 ${room} 字的预算。先删重复和旁枝，保留每个事实。`,
    under: (n, room) => `全文只有 ${n} 字，预算约 ${room} 字。内容偏薄：补上具体的场景、机制或经验，不要注水。`,
    beatOver: (n, room) => `这一段 ${n} 字，这个环节大约只有 ${room} 字的位置。`,
    beatThin: (n, room) => `这一段只有 ${n} 字，这个环节有约 ${room} 字的位置，观点还没有展开。`,
    stageMissing: (label) => `故事线里的“${label}”没有对应的段落。`,
    breath: (n, max) => `这一口气 ${n} 个字，超过 ${max} 个字，拆成两句。`,
    hook: (n, max) => `第一句 ${n} 个字，开场要在 ${max} 个字以内说出命题、反常识或损失。`,
    greeting: () => '开场有寒暄或自我介绍。直接从商业命题、反常识或损失切入。',
    wrapUp: () => '出现了结束预告词，观众听到就会划走。删掉它，金句和行动指令说完就停。',
    banned: (word) => `“${word}”会被平台限流。引流改为“评论区置顶”或“私信”。`,
    extreme: (word) => `“${word}”是广告法极限词，换成可以证实的说法。`,
    hype: (word) => `“${word}”是空话或标题党用词，会拉低可信度。换成具体的说法。`,
    direction: () => '旁白里混进了画面提示或策划标签。这里只写说出口的话。',
    markup: () => '旁白里有标记、小标题或表情符号。这里只写说出口的话。',
    digits: () => '这条旁白用于语音合成：数字、百分比和符号要写成中文读法。',
    mustSay: (name) => `选题点名的“${name}”没有说出口。观众搜索和转发靠的就是这个词。`,
    notBut: (n) => `“不是…而是…”用了 ${n} 次，留下最有力的一两处。`,
    figures: (n) => `这一段报了 ${n} 个数字，耳朵记不住。只留一个，其余放到画面上。`,
    turns: (secs, has, need) => `这一段约 ${secs} 秒，只有 ${has} 处转折（每 12–15 秒需要一次：反问、“但是”、反差、具体场景）。`,
    noExperience: () => '没有一线经验的段落。加一处“我们在…的时候看到…”的真实场景，否则就是百科解说。',
    unlabelled: () => '这一段没有“A：”“B：”标签，分不清是谁在说。每句台词开头标出说话的人。',
    oneVoice: (who) => `全篇只有 ${who} 在说话。双人对谈需要两个人一来一回。`,
    thinLayer: (name, pct) => `“${name}”只占 ${pct}%，三维配比（解说 3 : 经验 3 : 认知 4）失衡。`,
  },
  en: {
    over: (n, room) => `The narration is ${n} words; there is room for about ${room}. Cut repetition and side remarks first and keep every fact.`,
    under: (n, room) => `The narration is only ${n} words; there is room for about ${room}. It is thin: add a concrete scene, mechanism or experience, not padding.`,
    beatOver: (n, room) => `This beat is ${n} words; its stage has room for about ${room}.`,
    beatThin: (n, room) => `This beat is only ${n} words; its stage has room for about ${room}. The point is not developed yet.`,
    stageMissing: (label) => `No beat covers "${label}" in the story line.`,
    breath: (n, max) => `This sentence is ${n} words. Split anything over ${max}.`,
    hook: (n, max) => `The first sentence is ${n} words. Open on the stake or the claim in ${max} or fewer.`,
    greeting: () => 'The opening greets or introduces. Start on the stake, the result or the claim.',
    wrapUp: () => 'A wrap-up phrase tells the viewer it is over, and they swipe. Cut it and stop after the last line.',
    banned: (word) => `"${word}" gets a video throttled on this platform. Point to the pinned comment instead.`,
    extreme: (word) => `"${word}" is an absolute claim. Say something that can be shown.`,
    hype: (word) => `"${word}" is hype and costs credibility. Say the specific thing.`,
    direction: () => 'A visual note or planning label is inside the narration. Spoken words only.',
    markup: () => 'There are marks, headings or emoji in the narration. Spoken words only.',
    digits: () => 'This narration feeds text-to-speech: write numbers, percentages and symbols as words.',
    mustSay: (name) => `"${name}" is named in the topic but never spoken. It is the word people search for and repeat.`,
    notBut: (n) => `"It's not X, it's Y" appears ${n} times. Keep the strongest one.`,
    figures: (n) => `This beat gives ${n} figures; a listener keeps one. Put the rest on screen.`,
    turns: (secs, has, need) => `This beat runs about ${secs} s with ${has} turn${has === 1 ? '' : 's'} (it needs one every 10–12 s: a question, a "but", a contrast, a scene).`,
    noExperience: () => 'No beat carries first-hand experience. Add one concrete scene from practice, or this is an encyclopedia entry.',
    unlabelled: () => 'This beat has no "A:" / "B:" labels, so nobody can tell who is speaking. Start every line with its speaker.',
    oneVoice: (who) => `Only ${who} speaks in the whole narration. A two-host conversation needs both voices.`,
    thinLayer: (name, pct) => `"${name}" is only ${pct}% of the narration; the balance (3 insider : 3 experience : 4 insight) is off.`,
  },
};

const LAYER_NAME = { zh: { insider: '内行解说', experience: '顾问经验', insight: '核心认知' }, en: { insider: 'Insider explanation', experience: 'First-hand experience', insight: 'Core insight' } };

const clip = (s, max = 36) => (s.length > max ? `${s.slice(0, max)}…` : s);
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');

const COMMON = new Set(['app', 'ppt', 'pdf', 'the', 'and', 'for', 'sop', 'ceo', 'cto', 'cfo', 'coo']);

/** Names in a Chinese topic that are written in Latin letters: companies, products, technologies ("Palantir", "ONTOLOGY"). */
export function namesIn(topic) {
  const seen = new Map();
  for (const [word] of String(topic || '').matchAll(/[A-Za-z][A-Za-z0-9.+-]{2,}/g)) if (!COMMON.has(word.toLowerCase()) && !seen.has(word.toLowerCase())) seen.set(word.toLowerCase(), word);
  return [...seen.values()];
}

/** The share of the narration each of the three layers carries, from the card's outline. Null when the card does not say. */
function layerShares(beats, card, count) {
  const layerOf = new Map((card?.outline || []).map((o) => [o.stage, o.layer]));
  const sums = { insider: 0, experience: 0, insight: 0 };
  for (const b of beats) if (layerOf.get(b.stage) in sums) sums[layerOf.get(b.stage)] += count(b.text);
  const total = sums.insider + sums.experience + sums.insight;
  if (!total) return null;
  return Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, Math.round((v / total) * 100)]));
}

export function reviewNarration(beats, plan, { card = null } = {}) {
  const { brief, timeline, budget } = plan;
  const lang = brief.lang === 'zh' ? 'zh' : 'en';
  const language = brief.language || lang;
  // Sentence length, the opening and the turn rhythm are measured with the punctuation and the turn words of
  // Chinese and of English. A narration in another language is held to its length and to what any language
  // shares (marks, digits, names, labels); the editor step reads the rest by ear.
  const measured = /^zh\b/i.test(language) || language === 'en';
  const limit = LIMITS[lang];
  // The English messages count in words; a language counted by the character is told so in its own unit.
  const say = lang === 'en' && plan.unit && plan.unit !== 'words' ? Object.fromEntries(Object.entries(MSG.en).map(([k, fn]) => [k, (...a) => fn(...a).replace(/\bwords\b/g, plan.unit)])) : MSG[lang];
  const pace = plan.pace;
  const count = (text) => countSpoken(text, language);
  const findings = [];
  const add = (level, rule, beat, message, excerpt = '') => findings.push({ level, rule, beat, message, ...(excerpt && { excerpt: clip(excerpt) }) });

  const texts = beats.map((b) => spokenText(b.text));
  const counts = texts.map(count);
  const total = counts.reduce((a, b) => a + b, 0);
  const whole = texts.join('\n');

  // ----- Length -----
  if (total > budget * 1.1) add('error', 'length.over', null, say.over(total, budget));
  else if (total && total < budget * 0.85) add('warn', 'length.under', null, say.under(total, budget));
  const staged = beats.filter((b) => timeline.some((s) => s.key === b.stage)).length;
  const rooms = beats.map((b) => {
    const stage = timeline.find((s) => s.key === b.stage);
    if (!stage || beats.filter((x) => x.stage === b.stage).length !== 1) return 0;
    return Math.max(1, Math.round((stage.end - stage.start) * pace));
  });
  beats.forEach((b, i) => {
    if (!rooms[i]) return;
    if (counts[i] > rooms[i] * 1.35 && counts[i] - rooms[i] > 8) add('warn', 'length.beat', i, say.beatOver(counts[i], rooms[i]));
    else if (counts[i] < rooms[i] * 0.5 && rooms[i] - counts[i] > 12) add('warn', 'length.thin', i, say.beatThin(counts[i], rooms[i]));
  });
  if (staged >= beats.length / 2) for (const s of timeline) if (!beats.some((b) => b.stage === s.key)) add('warn', 'stage.missing', null, say.stageMissing(s.label.split(/[：:]/)[0]));

  // ----- Opening and close -----
  if (texts[0]) {
    const first = FIRST_SENTENCE[lang].exec(texts[0])[0].trim();
    if (GREETING[lang].test(texts[0].slice(0, 40))) add('error', 'opening.greeting', 0, say.greeting(), GREETING[lang].exec(texts[0])[0]);
    else if (measured && count(first) > limit.hook) add('warn', 'opening.hook', 0, say.hook(count(first), limit.hook), first);
  }
  texts.forEach((text, i) => {
    const hit = WRAP_UP[lang].exec(text);
    if (hit) add('error', 'closing.wrapup', i, say.wrapUp(), hit[0]);
  });

  // ----- Words that cost reach or credibility -----
  const banned = (brief.platform.banned || []).filter((w) => norm(whole).includes(norm(w)));
  texts.forEach((text, i) => {
    for (const w of banned) if (norm(text).includes(norm(w))) add('error', 'compliance.banned', i, say.banned(w), w);
    const extreme = EXTREME[lang].exec(text);
    if (extreme) add('warn', 'compliance.extreme', i, say.extreme(extreme[0]), extreme[0]);
    const hype = HYPE[lang].exec(text);
    if (hype) add('warn', 'style.hype', i, say.hype(hype[0]), hype[0]);
    if (DIRECTION.test(beats[i].text)) add('error', 'spoken.direction', i, say.direction(), DIRECTION.exec(beats[i].text)[0]);
    else if (MARKUP.test(beats[i].text)) add('error', 'spoken.markup', i, say.markup());
    if (brief.ttsReady && /\d|%/.test(text)) add('error', 'tts.digits', i, say.digits(), /\S*[\d%]\S*/.exec(text)[0]);
  });

  // ----- Names the topic promised -----
  const promised = card?.mustSay?.length ? card.mustSay.map((name) => ({ name, level: 'error' })) : lang === 'zh' ? namesIn(brief.topic).map((name) => ({ name, level: 'warn' })) : [];
  for (const { name, level } of promised) {
    // "Ontology（本体）" is spoken when either form is.
    const forms = name.split(/[（(／/、,，]|\s+or\s+|或/).map((s) => norm(s.replace(/[）)]/g, ''))).filter(Boolean);
    if (forms.length && !forms.some((f) => norm(whole).includes(f))) add(level, 'names.missing', null, say.mustSay(name));
  }

  // ----- The ear: breath length, figures, the one pattern everyone overuses -----
  let longest = 0;
  texts.forEach((text, i) => {
    const long = [];
    for (const part of measured ? text.split(BREATHS[lang]) : []) {
      const n = count(part);
      longest = Math.max(longest, n);
      if (n > limit.breath) long.push({ part: part.trim(), n });
    }
    long.sort((a, b) => b.n - a.n);
    for (const { part, n } of long.slice(0, 3)) add(n > limit.breathHard ? 'error' : 'warn', 'ear.breath', i, say.breath(n, limit.breath), part);
    const figures = (text.match(FIGURES[lang]) || []).length;
    if (figures >= limit.figures) add('warn', 'ear.figures', i, say.figures(figures));
    if (measured && counts[i] >= limit.turnFrom) {
      const need = Math.floor(counts[i] / limit.turnEvery);
      const has = (text.match(TURNS[lang]) || []).length;
      if (has < need) add('warn', 'rhythm.turns', i, say.turns(Math.round(counts[i] / pace), has, need));
    }
  });
  const notBut = (whole.match(NOT_BUT[lang]) || []).length;
  if (notBut > (lang === 'zh' ? 2 : 1)) add('warn', 'style.notbut', null, say.notBut(notBut));

  // ----- Two voices: every line says whose it is -----
  if (brief.framework.speakers === 2 && total) {
    const label = /(?:^|[\s。！？!?….”’」])([AB])[：:]/g;
    const voices = new Set();
    texts.forEach((text, i) => {
      const said = [...text.matchAll(label)].map((m) => m[1]);
      said.forEach((v) => voices.add(v));
      if (text && !said.length) add('error', 'speakers.label', i, say.unlabelled());
    });
    if (voices.size === 1) add('error', 'speakers.voices', null, say.oneVoice([...voices][0]));
  }

  // ----- The three layers of the viewpoint card -----
  const ratio = layerShares(beats, card, count);
  if (ratio) {
    if (!ratio.experience) add('warn', 'layers.experience', null, say.noExperience());
    else for (const layer of LAYERS) if (ratio[layer] < 15) add('warn', 'layers.balance', null, say.thinLayer(LAYER_NAME[lang][layer], ratio[layer]));
  }

  findings.sort((a, b) => (a.level === b.level ? (a.beat ?? -1) - (b.beat ?? -1) : a.level === 'error' ? -1 : 1));
  const errors = findings.filter((f) => f.level === 'error').length;
  const warns = findings.length - errors;
  return {
    findings,
    errors,
    warns,
    score: errors * 4 + warns,
    stats: { total, budget, unit: plan.unit, seconds: Math.round(total / pace), longest, beats: counts.map((n, i) => ({ count: n, room: rooms[i] })), ...(ratio && { ratio }) },
  };
}

/** The findings as the editor step reads them: one line each, by beat number. */
export function findingLines(findings) {
  return findings.map((f) => `- ${f.beat == null ? '[whole narration]' : `[beat #${f.beat + 1}]`} ${f.message}${f.excerpt ? ` → “${f.excerpt}”` : ''}`);
}
