// What the model is told in a conversation, and how a conversation becomes its turns.
//
//   systemPrompt({ skills, tools })     who the assistant is, how it answers, the pictures and clips it can make,
//                                       and the skills picked for the conversation
//   turnsFor(messages)                  the conversation as { history, user }: the turns before the last prompt,
//                                       as many of the latest as fit, and the prompt itself, each prompt with
//                                       what was read on the web for it
//   briefFromPrompt(text)               a prompt as a brief for the narration agent: the topic, the platform it
//                                       names and the length it asks for
//   narrationMarkdown(result, plan)     what the narration agent wrote, as the reply the conversation shows
//
// The assistant makes a picture or a clip by writing a fenced block (```image, ```video) in its reply: any
// model can do that, whatever its provider's own tool format is. The server reads the blocks out of the
// finished reply and has them made (src/chat/routes.mjs); the page shows the result in the block's place.

import { ASPECTS } from '../aspects.mjs';
import { estimateTokens } from '../audit.mjs';
import { PLATFORMS } from '../platforms.mjs';

/** How much of a conversation is sent back to the model with each prompt, in tokens (CHAT_CONTEXT_TOKENS). */
export const contextTokens = (env = process.env) => (Number(env.CHAT_CONTEXT_TOKENS) > 0 ? Math.round(Number(env.CHAT_CONTEXT_TOKENS)) : 60_000);

/** How many pictures and clips one reply may ask for. More than that is a runaway reply, not a request. */
export const MAX_EMBEDS = { image: 4, video: 1 };

const SHAPES = ASPECTS.map((a) => a.id).join(', ');

function toolSection({ image, video }) {
  if (!image && !video) return [];
  const what = [image && 'pictures', video && 'short video clips'].filter(Boolean).join(' and ');
  return [
    `# Making ${what}`,
    `You can make ${what}. To make one, write a fenced block on its own lines, at the place in your reply where it should appear:`,
    '',
    ...(image ? ['```image', 'aspect: 16:9', 'What the picture shows: the subject, the setting, the style, the light and the framing.', '```', ''] : []),
    ...(video ? ['```video', 'aspect: 9:16', 'seconds: 8', 'What the clip shows: the subject, the action, the camera movement and the mood.', '```', ''] : []),
    '- The app makes it from the block and shows the result in its place. Never say you cannot draw or film, and never show a block as an example: writing one makes one.',
    `- The description is everything the ${image && video ? 'image or video' : image ? 'image' : 'video'} model is given. It has not read this conversation, so name what is in the frame in full, and write the description in English unless words in another language have to appear in it.`,
    `- The \`aspect:\` line is optional (${SHAPES}; a vertical frame is the default)${video ? ', and so is `seconds:` for a clip (4, 8 or 12)' : ''}.`,
    `- Make one only when the person asks for a picture${video ? ' or a clip' : ''}, or plainly needs one. One block makes one${image ? ` picture: write a block for each, at most ${MAX_EMBEDS.image} in a reply` : ' clip'}.${video ? ' A clip takes a few minutes and costs far more than a picture: make one only when a clip is what was asked for, and one at a time.' : ''}`,
    '- Around a block, write as you normally would: a line on what you made is enough.',
    '',
  ];
}

function skillSection(skills) {
  if (!skills.length) return [];
  // A skill's own headings sit two levels below the prompt's.
  const nested = (body) => body.replace(/^(#{1,4}) /gm, '##$1 ');
  return [
    '# Skills',
    'The person picked these skills for this conversation. Each one is their own instructions for a kind of work. Follow a skill whenever the request falls within what it is for; where it differs from the guidance above, the skill wins. Do not mention the skills unless you are asked about them.',
    '',
    ...skills.flatMap((s) => [`## Skill: ${s.name}`, ...(s.description ? [`When to use it: ${s.description}`, ''] : []), nested(s.body), '']),
  ];
}

/** The system prompt of a conversation. `tools` says what can be made here: { image, video }. */
export function systemPrompt({ skills = [], tools = {}, now = new Date() } = {}) {
  return [
    'You are the assistant in Video Scripter, a workspace where people plan, write and produce short videos and the posts that go with them. Help with whatever they ask: ideas, scripts, copy, research, analysis, translation, code.',
    '',
    '# How to answer',
    '- Answer in the language the person writes in.',
    '- Lead with the answer. Be specific and concrete, leave out filler, and do not repeat the question back.',
    '- Your reply is shown as rendered Markdown. Use headings, lists, tables and fenced code blocks (name the language) where they make the answer easier to use, and plain paragraphs otherwise. Something the person will keep and edit (a script, an article, a plan, a report) starts with a `#` title.',
    '- Say so when you are not sure. Never invent facts, figures, quotations or sources.',
    `- Today is ${now.toISOString().slice(0, 10)}.`,
    '',
    ...toolSection(tools),
    ...skillSection(skills),
  ]
    .join('\n')
    .trim();
}

/**
 * The conversation as the model is sent it: `user` is the last prompt and `history` the turns before it, user
 * and assistant in turn, as many of the latest as fit in `budget` tokens. A reply that failed before it wrote
 * anything leaves no turn, and two turns by the same side are joined, so every provider accepts the list.
 */
export function turnsFor(messages, { budget = contextTokens() } = {}) {
  const turns = [];
  for (const m of messages) {
    // A prompt is read with what the web gave it: the pages it links to, the results of its search (src/web).
    const content = [String(m.content || '').trim(), m.role === 'user' && m.web?.context].filter(Boolean).join('\n\n');
    if (!content) continue;
    if (turns.at(-1)?.role === m.role) turns.at(-1).content += `\n\n${content}`;
    else turns.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content });
  }
  while (turns.length && turns.at(-1).role !== 'user') turns.pop();
  const user = turns.pop()?.content || '';
  let room = budget - estimateTokens(user);
  let from = turns.length;
  while (from > 0 && room - estimateTokens(turns[from - 1].content) >= 0) room -= estimateTokens(turns[--from].content);
  if (turns[from]?.role === 'assistant') from++; // the first turn the model sees is the person's
  return { history: turns.slice(from), user, dropped: from };
}

// ---------- The narration agent, asked from a conversation ----------

const PLATFORM_WORDS = [
  ['wechat_channels', /视频号|wechat\s*channels?|weixin/i],
  ['douyin', /抖音|douyin/i],
  ['xiaohongshu', /小红书|xiaohongshu|rednote/i],
  ['tiktok', /tik\s?tok/i],
  ['instagram', /instagram|\breels?\b/i],
  ['youtube_shorts', /youtube|\bshorts\b/i],
];

/**
 * A prompt as a brief for the narration agent. The prompt is the topic; the platform is the one it names
 * (otherwise 视频号 for a prompt in Chinese and YouTube Shorts for any other), and a length it asks for
 * ("90 秒", "2 min") is taken. A long prompt is also the reference material, so none of it is lost.
 */
export function briefFromPrompt(text) {
  const source = String(text || '').trim();
  const named = PLATFORM_WORDS.find(([id, words]) => words.test(source) && PLATFORMS.some((p) => p.id === id))?.[0];
  const platformId = named || (/[㐀-鿿]/.test(source) ? 'wechat_channels' : 'youtube_shorts');
  const minutes = /(\d+(?:\.\d+)?)\s*(?:分钟|分鐘|min(?:ute)?s?\b)/i.exec(source);
  const seconds = /(\d+)\s*(?:秒|s(?:ec(?:ond)?s?)?\b)/i.exec(source);
  const duration = minutes ? Math.round(Number(minutes[1]) * 60) : seconds ? Number(seconds[1]) : 0;
  return { topic: source.slice(0, 500), platformId, ...(duration && { duration }), ...(source.length > 500 && { reference: source }) };
}

const WORDS = {
  en: { narration: 'Narration', card: 'Viewpoint card', insight: 'The one idea', against: 'It overturns', persona: 'Who is speaking', viewer: 'Who it is for', analogy: 'Analogy', openLoop: 'Open loop', mustSay: 'Names to say', insider: 'Insider points', experience: 'From practice', draft: 'to confirm', verify: 'Confirm before recording', review: 'Review', clean: 'Measured against the brief: nothing to fix.', left: (e, w) => `Measured against the brief: ${e} to fix, ${w} to look at.`, notReviewed: 'The draft was not reviewed: the request ran out of time. Ask again to have it reviewed.', spoken: (n, unit, s) => `${n} ${unit}, about ${s} s spoken`, skills: 'Written with', beat: 'Beat' },
  zh: { narration: '旁白', card: '观点卡', insight: '核心认知', against: '它推翻的常见看法', persona: '谁在讲', viewer: '讲给谁听', analogy: '贯穿的比喻', openLoop: '开场悬念', mustSay: '必须说出的名字', insider: '内行解说', experience: '一线经验', draft: '待确认', verify: '录制前请核实', review: '审稿', clean: '已对照创作要求测量：没有需要修改的地方。', left: (e, w) => `已对照创作要求测量：${e} 处需要修改，${w} 处值得留意。`, notReviewed: '这一稿还没有审稿：本次请求的时间用完了。再发一次即可审稿。', spoken: (n, unit, s) => `${n} ${unit}，约 ${s} 秒`, skills: '使用的技能', beat: '第' },
};

const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`;
/** Narration markup as Markdown: [[stressed words]] are bold. */
const spoken = (text) => String(text || '').replace(/\[\[(.+?)\]\]/g, '**$1**').trim();

/** What the narration agent wrote, as a reply: the narration by stage, the viewpoint card it was written to, and the review. */
export function narrationMarkdown({ title, beats, card, report }, plan, { reviewed = true } = {}) {
  const { brief, timeline } = plan;
  const w = WORDS[brief.lang] || WORDS.en;
  const zh = brief.lang === 'zh';
  const stage = (key) => timeline.find((s) => s.key === key);
  const head = (label) => String(label || '').split(/[：:]/)[0].trim();
  const out = [`# ${title || brief.topic}`, '', `> ${[zh ? brief.platform.name : brief.platform.nameEn || brief.platform.name, brief.framework.name?.[brief.lang] || brief.framework.name?.en, `${brief.duration} s`, report?.stats && w.spoken(report.stats.total, report.stats.unit, report.stats.seconds)].filter(Boolean).join(' · ')}`, '', `## ${w.narration}`, ''];
  for (const [i, b] of beats.entries()) {
    const s = stage(b.stage);
    out.push(`**${s ? head(s.label) : zh ? `${w.beat} ${i + 1} 段` : `${w.beat} ${i + 1}`}**${s ? ` \`${clock(s.start)}–${clock(s.end)}\`` : ''}`, '', spoken(b.text), '');
  }
  if (card) {
    const row = (label, value) => (value ? [`- **${label}${zh ? '：' : ':'}** ${value}`] : []);
    out.push(`## ${w.card}`, '', ...row(w.insight, card.insight?.claim), ...row(w.against, card.insight?.against), ...row(w.persona, card.persona), ...row(w.viewer, card.viewer), ...row(w.analogy, card.analogy), ...row(w.openLoop, card.openLoop), ...row(w.mustSay, card.mustSay?.join(zh ? '、' : ', ')), '');
    if (card.insider?.length) out.push(`### ${w.insider}`, '', ...card.insider.map((p) => `- ${p}`), '');
    if (card.experience?.length) out.push(`### ${w.experience}`, '', ...card.experience.map((e) => `- ${e.point}${e.source === 'draft' ? (zh ? `（${w.draft}）` : ` (${w.draft})`) : ''}`), '');
    if (card.toVerify?.length) out.push(`### ${w.verify}`, '', ...card.toVerify.map((p) => `- [ ] ${p}`), '');
  }
  if (report) {
    out.push(`## ${w.review}`, '', !reviewed ? w.notReviewed : report.errors || report.warns ? w.left(report.errors, report.warns) : w.clean, '');
    // What has to be fixed comes first, in bold; each finding names the beat it is about.
    const where = (f) => (f.beat == null ? '' : zh ? `第 ${f.beat + 1} 段：` : `Beat ${f.beat + 1}: `);
    for (const f of [...(report.findings || [])].sort((a, b) => (a.level === 'error' ? 0 : 1) - (b.level === 'error' ? 0 : 1)).slice(0, 12)) out.push(`- ${f.level === 'error' ? `**${where(f)}${f.message}**` : `${where(f)}${f.message}`}`);
    if (report.findings?.length) out.push('');
    if (report.skills?.length) out.push(`${w.skills}${zh ? '：' : ': '}${report.skills.map((s) => s.title?.[brief.lang] || s.title?.en || s.id).join(zh ? '、' : ', ')}`, '');
  }
  return out.join('\n').trim();
}
