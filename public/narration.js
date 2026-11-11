// Narration maths for the editor, so it can count while you type. These three functions are the
// browser's copy of the ones in src/narration.mjs (the server decides; this predicts). They must
// stay identical: test/narration.test.mjs runs both on the same text.

export const MIN_DURATION = 10;
export const MAX_DURATION = 300;

/** Spoken text without the delivery marks a script carries: [[stress]] and ⏸ pauses. */
export const spokenText = (s) => String(s ?? '').replace(/\[\[|\]\]/g, '').replace(/\s*⏸\s*/g, ' ').trim();

/** Chinese: one per 汉字 and per digit, a Latin word by its syllables (about two letters each). English: words. */
export function countSpoken(text, lang) {
  const s = spokenText(text);
  if (lang !== 'zh') return s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  let n = 0;
  for (const [token] of s.matchAll(/\p{Script=Han}|[A-Za-z]+|\d/gu)) n += /[A-Za-z]/.test(token) ? Math.ceil(token.length / 2) : 1;
  return n;
}

/** The length asked for while the narration fits it within 10%; otherwise as long as the narration takes. */
export function fitDuration(asked, count, pace) {
  const natural = count / pace;
  if (Math.abs(natural - asked) <= asked * 0.1) return asked;
  return Math.min(MAX_DURATION, Math.max(MIN_DURATION, Math.round(natural)));
}

const joinLines = (s) => s.replace(/([\p{Script=Han}\p{P}])[ \t]*\n[ \t]*(?=[\p{Script=Han}\p{P}])/gu, '$1').replace(/\s*\n\s*/g, ' ');

/** Pasted text as beats. Blank lines separate beats; text without blank lines is split at its line breaks. */
export function splitNarration(text) {
  const clean = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!clean) return [];
  const parts = /\n[ \t]*\n/.test(clean) ? clean.split(/\n(?:[ \t]*\n)+/) : clean.split(/\n+/);
  return parts.map((p) => joinLines(p.trim()).trim()).filter(Boolean).map((t) => ({ stage: '', text: t }));
}
