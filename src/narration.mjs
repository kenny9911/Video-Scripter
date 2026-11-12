// The narration as its own piece of work: the spoken text of a video as an ordered list of beats
// ({ stage, text }) that can be drafted, pasted, edited and refined before the script is built around it.
// This file counts and cleans narration, and puts a locked narration back word for word when a
// model changed it. The prompts that write and refine narration are in prompt.mjs.
//
// countSpoken, splitNarration and fitDuration also run in the browser (public/narration.js) so the
// editor can count while you type. The two copies are kept identical by test/narration.test.mjs.

export const PACE = { zh: 4.3, en: 2.6 }; // spoken Chinese characters / English words per second, unless a narration style sets its own
export const MIN_DURATION = 10;
export const MAX_DURATION = 360;
export const MAX_BEATS = 60;
export const MAX_NARRATION = 8000; // characters over all beats; six minutes of speech is well under this

/** Spoken text without the delivery marks a script carries: [[stress]] and ⏸ pauses. */
export const spokenText = (s) => String(s ?? '').replace(/\[\[|\]\]/g, '').replace(/\s*⏸\s*/g, ' ').trim();

/**
 * Length of a narration in the unit its language is budgeted in. Chinese: one per 汉字 and per digit,
 * and a Latin word counts as its syllables, roughly one per two letters ("AI" 1, "Ontology" 4).
 * English: words.
 */
export function countSpoken(text, lang) {
  const s = spokenText(text);
  if (lang !== 'zh') return s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  let n = 0;
  for (const [token] of s.matchAll(/\p{Script=Han}|[A-Za-z]+|\d/gu)) n += /[A-Za-z]/.test(token) ? Math.ceil(token.length / 2) : 1;
  return n;
}

/**
 * How long the video runs when its narration is fixed. The length that was asked for is kept while the
 * narration fits it within 10% (the same tolerance the scriptwriter gets); otherwise the video is as long
 * as the narration takes at a natural pace.
 */
export function fitDuration(asked, count, pace) {
  const natural = count / pace;
  if (Math.abs(natural - asked) <= asked * 0.1) return asked;
  return Math.min(MAX_DURATION, Math.max(MIN_DURATION, Math.round(natural)));
}

/** Line breaks inside a paragraph: nothing between two Chinese characters or punctuation marks, a space otherwise. */
const joinLines = (s) => s.replace(/([\p{Script=Han}\p{P}])[ \t]*\n[ \t]*(?=[\p{Script=Han}\p{P}])/gu, '$1').replace(/\s*\n\s*/g, ' ');

/** Pasted text as beats. Blank lines separate beats; text without blank lines is split at its line breaks. */
export function splitNarration(text) {
  const clean = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!clean) return [];
  const parts = /\n[ \t]*\n/.test(clean) ? clean.split(/\n(?:[ \t]*\n)+/) : clean.split(/\n+/);
  return parts.map((p) => joinLines(p.trim()).trim()).filter(Boolean).map((t) => ({ stage: '', text: t }));
}

/** Beats from a request body: [{ stage, text }], a list of strings, or one pasted string. Empty beats are dropped. */
export function normalizeNarration(input) {
  const list = Array.isArray(input) ? input : typeof input === 'string' ? splitNarration(input) : [];
  const beats = [];
  let size = 0;
  for (const b of list) {
    const text = joinLines(String((typeof b === 'string' ? b : b?.text) ?? '').replace(/\r\n?/g, '\n').trim()).trim();
    if (!text) continue;
    size += text.length;
    beats.push({ stage: String((typeof b === 'object' && b?.stage) || '').trim().slice(0, 40), text });
  }
  if (beats.length > MAX_BEATS) throw new Error(`The narration has too many beats (${beats.length}; the limit is ${MAX_BEATS})`);
  if (size > MAX_NARRATION) throw new Error(`The narration is too long (${size} characters; the limit is ${MAX_NARRATION})`);
  return beats;
}

/** Beats as the block a prompt carries: a "# n [stage]" label line, then the spoken text. */
export const narrationBlock = (beats) => beats.map((b, i) => `# ${i + 1}${b.stage ? ` [${b.stage}]` : ''}\n${b.text}`).join('\n\n');

/** Places where a narration can be cut into scenes: after a sentence (strong) or after a clause (weak). */
function cutPoints(source) {
  const points = [];
  for (const m of source.matchAll(/(?:[。！？!?…；;]+|\.(?=["'”’)\]]*(?:\s|$)))["'”’」』）)\]]*|\n/g)) points.push({ at: m.index + m[0].length, strong: true });
  for (const m of source.matchAll(/[，、：—]+|[,:](?=\s)/g)) {
    // "A：" and "B:" at the start of a line of dialogue are labels, not clause ends: a cut there would part a speaker from their words.
    if (/(?:^|[^A-Za-z0-9])[AB]$/.test(source.slice(Math.max(0, m.index - 2), m.index)) && /^[：:]$/.test(m[0])) continue;
    points.push({ at: m.index + m[0].length, strong: false });
  }
  return points;
}

/**
 * Make the scenes of a script built around a locked narration carry it word for word.
 * The model is told to copy the narration into the scenes and only add [[stress]] and ⏸ marks. When what
 * it returned differs in any other way, the narration is laid over the model's scenes again, each scene
 * getting the share the model gave it, with every cut moved to the nearest sentence or clause end.
 * A scene left with nothing to say is folded into the one before it.
 * Returns { scenes, repaired }.
 */
export function lockNarration(scenes, beats, lang) {
  const glue = lang === 'zh' ? '' : ' ';
  const source = beats.map((b) => b.text).join('\n');
  const bare = (s) => spokenText(s).replace(/\s+/g, '');
  if (bare(scenes.map((s) => s.voiceover).join('')) === bare(source)) return { scenes, repaired: false };

  const sizes = scenes.map((s) => bare(s.voiceover).length);
  const total = sizes.reduce((a, b) => a + b, 0);
  const points = cutPoints(source);
  const slack = Math.max(4, (source.length / scenes.length) * 0.2); // how much closer a clause end must be to beat a sentence end
  let from = 0;
  let done = 0;
  const cut = scenes.map((scene, i) => {
    done += sizes[i];
    let to = source.length;
    if (i < scenes.length - 1) {
      const target = (total ? done / total : (i + 1) / scenes.length) * source.length;
      const open = points.filter((p) => p.at > from && p.at < source.length);
      to = open.length ? open.reduce((best, p) => (Math.abs(p.at - target) + (p.strong ? 0 : slack) < Math.abs(best.at - target) + (best.strong ? 0 : slack) ? p : best)).at : from;
    }
    const voiceover = source.slice(from, to).trim().replace(/\s*\n\s*/g, glue);
    from = to;
    return { ...scene, voiceover };
  });

  const kept = [];
  for (const scene of cut) {
    if (!scene.voiceover && kept.length) kept.at(-1).end = scene.end;
    else kept.push(scene);
  }
  return { scenes: kept.map((s, i) => ({ ...s, id: i + 1 })), repaired: true };
}
