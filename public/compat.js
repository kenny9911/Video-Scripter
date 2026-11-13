// Which styles go together. One set of rules, read by the server (src/styles.mjs, src/frameworks.mjs) and by
// the page, which greys out what the current choice rules out. No DOM and no imports: it runs in both.
//
// Visual styles (for every image and clip). A style has at most one value on each of these axes; two styles
// clash when they have different values on the same one. A style with no value on an axis goes with anything
// there, which is why a light, an era or a set can be laid over most media.
//   medium   what it is made of: photo | drawn | 3d | graphic. Only the styles of the four media groups (and the
//            consulting deck) have one: a light, an era or a mood is a tone laid over a medium, whatever it was first seen in
//   light    bright | dark, for a style whose light is what it is (a diagram that happens to sit on dark slate has none)
//   colour   quiet (monochrome, muted) | vivid
//   era      ancient | prewar | midcentury | late20c | y2k | victorian | postapoc | now
//   place    the one set it is presented from: a desk, a stage, a board…
//   finish   raw (phone, camcorder) | polished (studio, launch film)
//
// Narration styles (for the script). The structure leads; other narration styles lend their voice. Two clash
// when they are not spoken by the same number of people, are made for lengths that do not overlap, or are
// spoken at clearly different speeds.

export const STYLE_AXES = ['medium', 'light', 'colour', 'era', 'place', 'finish'];

/** Why two styles clash, in both interface languages. */
export const CLASH_REASON = {
  medium: { en: 'a different medium', zh: '媒介不同' },
  light: { en: 'bright against dark', zh: '一明一暗' },
  colour: { en: 'quiet colour against vivid colour', zh: '素净与浓艳相冲' },
  era: { en: 'a different era', zh: '年代不同' },
  place: { en: 'a different set', zh: '场景不同' },
  finish: { en: 'raw against polished', zh: '粗粝与精致相冲' },
  speakers: { en: 'one voice against two', zh: '单人与双人不能混' },
  length: { en: 'made for a different length', zh: '适用时长不重叠' },
  pace: { en: 'a very different pace', zh: '语速差得太多' },
};

const P = 'photo';
const D = 'drawn';
const G = 'graphic';

/** The traits of every catalogue style that has any. A style that is not listed goes with everything. */
export const STYLE_TRAITS = {
  // Live action
  cinematic: { medium: P, finish: 'polished' },
  documentary: { medium: P },
  ugc: { medium: P, finish: 'raw', era: 'now' },
  studio: { medium: P, finish: 'polished', place: 'backdrop' },
  lifestyle: { medium: P, light: 'bright' },
  office: { medium: P, era: 'now' },
  macro: { medium: P },
  // Illustration
  flat: { medium: D },
  isometric: { medium: D },
  sketch: { medium: D },
  watercolor: { medium: D, colour: 'quiet' },
  ink: { medium: D, colour: 'quiet' },
  anime: { medium: D },
  comic: { medium: D, colour: 'vivid' },
  collage: { medium: D },
  // 3D and stop motion
  toon3d: { medium: '3d' },
  clay: { medium: '3d' },
  glass3d: { medium: '3d', finish: 'polished' },
  // Graphics and data
  infographic: { medium: G },
  minimal: { medium: G, colour: 'quiet' },
  hud: { medium: G, light: 'dark' },
  screen: { medium: G, era: 'now' },
  diagram: { medium: G },
  mathanim: { medium: G, light: 'dark' },
  codescreen: { medium: G, era: 'now' },
  motiondoc: { medium: G },
  // Presenting and launching
  deck: { medium: G, light: 'bright', era: 'now' },
  boardroom: { place: 'boardroom', era: 'now' },
  whiteboard: { place: 'whiteboard', light: 'bright' },
  lightboard: { place: 'lightboard', light: 'dark' },
  chalkboard: { place: 'chalkboard' },
  productdemo: { light: 'bright', finish: 'polished' },
  keynote: { place: 'stage', light: 'dark', finish: 'polished', era: 'now' },
  launchfilm: { light: 'dark', finish: 'polished' },
  // Hosts and podcasts
  techdesk: { place: 'desk', era: 'now' },
  podcast: { place: 'podcast', era: 'now' },
  podcastduo: { place: 'podcastduo', era: 'now' },
  newsdesk: { place: 'newsdesk', finish: 'polished', era: 'now' },
  virtualstudio: { place: 'virtual', era: 'now' },
  // Bright and light
  highkey: { light: 'bright' },
  brighttech: { light: 'bright', era: 'now' },
  cream: { light: 'bright', colour: 'quiet' },
  nordic: { light: 'bright', colour: 'quiet' },
  pastel: { light: 'bright' },
  dopamine: { light: 'bright', colour: 'vivid' },
  airy: { light: 'bright', colour: 'quiet' },
  forest: { light: 'bright' },
  summer: { light: 'bright', colour: 'vivid' },
  coastal: { light: 'bright', colour: 'vivid' },
  misty: { colour: 'quiet' },
  // Era and mood
  gufeng: { era: 'ancient' },
  bwfilm: { era: 'prewar', colour: 'quiet' },
  artdeco: { era: 'prewar' },
  shanghai: { era: 'prewar' },
  midcentury: { era: 'midcentury' },
  retrofuture: { era: 'midcentury' },
  nostalgia: { era: 'late20c' },
  hongkong: { era: 'late20c', colour: 'vivid' },
  vhs: { era: 'late20c', finish: 'raw' },
  y2k: { era: 'y2k', colour: 'vivid' },
  vaporwave: { colour: 'vivid' },
  neon: { light: 'dark', colour: 'vivid' },
  cyberpunk: { light: 'dark', colour: 'vivid' },
  steampunk: { era: 'victorian' },
  wasteland: { era: 'postapoc', colour: 'quiet' },
  noir: { light: 'dark', colour: 'quiet' },
  academia: { light: 'dark' },
  wabisabi: { colour: 'quiet' },
};

/** What a group's custom style is made of: the four groups that are media. The others are a format or a tone. */
const GROUP_MEDIUM = { live: P, illustration: D, '3d': '3d', graphic: G };

/** The traits of a style id: a catalogue style's own, or the medium of the group a custom style ("custom:<group>…") is in. */
export function traitsOf(id) {
  const custom = /^custom:([^:]+)/.exec(String(id));
  if (custom) return GROUP_MEDIUM[custom[1]] ? { medium: GROUP_MEDIUM[custom[1]] } : {};
  return STYLE_TRAITS[id] || {};
}

/** The axis two styles clash on, or '' when they go together. */
export function styleClash(a, b) {
  if (a === b) return '';
  const x = traitsOf(a);
  const y = traitsOf(b);
  return STYLE_AXES.find((axis) => x[axis] && y[axis] && x[axis] !== y[axis]) || '';
}

/** The ids of `ids` that go together, kept in order: one that clashes with an earlier one is left out. */
export function compatibleStyles(ids) {
  const kept = [];
  for (const id of ids) if (!kept.some((k) => styleClash(k, id))) kept.push(id);
  return kept;
}

/**
 * Why a style cannot be added to the ones chosen: { with, axis } names the first chosen style it clashes
 * with, { full: true } says the limit is reached, and null says it can be added.
 */
export function styleBlock(id, chosen, max) {
  if (chosen.includes(id)) return null;
  for (const other of chosen) {
    const axis = styleClash(other, id);
    if (axis) return { with: other, axis };
  }
  return chosen.length >= max ? { full: true } : null;
}

// ---------- Narration styles ----------

export const PACE_GAP = 0.6; // Chinese characters a second: further apart than this and two voices do not blend

/**
 * Why two narration styles do not blend: 'speakers', 'length' or 'pace', or '' when they do.
 * A style is { id, speakers, length: { min, max }, pace: { zh } } as src/frameworks.mjs has it; a plain
 * structure has no length or pace of its own and clashes only on the number of speakers.
 */
export function voiceClash(a, b) {
  if (!a || !b || a.id === b.id) return '';
  if ((a.speakers || 1) !== (b.speakers || 1)) return 'speakers';
  if (a.length && b.length && (a.length.min > b.length.max || b.length.min > a.length.max)) return 'length';
  if (a.pace?.zh && b.pace?.zh && Math.abs(a.pace.zh - b.pace.zh) > PACE_GAP) return 'pace';
  return '';
}

/**
 * Why a narration style cannot lend its voice: { with, axis } names the structure or the chosen voice it
 * clashes with, { full: true } says the limit is reached, null says it can be added.
 */
export function voiceBlock(style, lead, chosen, max) {
  if (chosen.some((v) => v.id === style.id)) return null;
  for (const other of [lead, ...chosen]) {
    const axis = voiceClash(other, style);
    if (axis) return { with: other.id, axis };
  }
  return chosen.length >= max ? { full: true } : null;
}
