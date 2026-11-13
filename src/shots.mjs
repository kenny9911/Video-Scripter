// How the images of one scene relate to each other when a scene gets two or three of them.
// Each mode turns (count, styles) into a list of shots; a shot adds a directive to the scene's
// image prompt and may replace the scene's own camera note or style.
//
//   variations  the same shot, taken again: alternatives to choose from
//   sequence    the scene's action over time: start -> (middle) -> end
//   coverage    the same moment from different distances: wide -> (medium) -> close-up
//   broll       the main shot plus cutaways: hero -> detail -> (context)
//   styles      the same shot in each chosen style, then blended (needs two visual styles)

import { pickStyles } from './styles.mjs';

export const MAX_IMAGES = 3;

const SHOTS = {
  start: {
    label: { en: 'Start', zh: '开始' },
    directive: 'Moment in time: the first frame of this scene, just before the action happens. Show the setup: the subject in place, the action about to begin.',
  },
  middle: {
    label: { en: 'Middle', zh: '中段' },
    directive: 'Moment in time: the middle of this scene, with the action at its peak.',
  },
  end: {
    label: { en: 'End', zh: '结束' },
    directive: 'Moment in time: the last frame of this scene, just after the action. Show the result or the reaction.',
  },
  wide: {
    label: { en: 'Wide', zh: '全景' },
    directive: 'Camera: wide establishing shot. The whole setting is visible and the subject is small within it.',
    replaceCamera: true,
  },
  medium: {
    label: { en: 'Medium', zh: '中景' },
    directive: 'Camera: medium shot at eye level, the subject framed from the waist up.',
    replaceCamera: true,
  },
  close: {
    label: { en: 'Close-up', zh: '特写' },
    directive: "Camera: tight close-up on the subject's face, hands or the single most important object, background out of focus.",
    replaceCamera: true,
  },
  hero: { label: { en: 'Main shot', zh: '主镜头' }, directive: '' },
  detail: {
    label: { en: 'Detail cutaway', zh: '细节插入' },
    directive: 'Cutaway insert: an extreme close-up of one telling object or detail from this scene. No faces; the detail fills the frame.',
    replaceCamera: true,
  },
  context: {
    label: { en: 'Context cutaway', zh: '环境空镜' },
    directive: 'Cutaway: the place where this scene happens, shown without the main subject. An atmosphere shot of the surroundings.',
    replaceCamera: true,
  },
  blend: { label: { en: 'Blend', zh: '混合' }, directive: '' },
};

const PLANS = {
  sequence: { 2: ['start', 'end'], 3: ['start', 'middle', 'end'] },
  coverage: { 2: ['wide', 'close'], 3: ['wide', 'medium', 'close'] },
  broll: { 2: ['hero', 'detail'], 3: ['hero', 'detail', 'context'] },
};

export const IMAGE_MODES = [
  {
    id: 'variations',
    name: { en: 'Alternatives', zh: '备选方案' },
    blurb: { en: 'The same shot taken again, so you can pick the best one.', zh: '同一个镜头多生成几张，从中挑最好的一张。' },
  },
  {
    id: 'sequence',
    name: { en: 'Action beats', zh: '动作节拍' },
    blurb: {
      en: 'The scene unfolding in time: start, middle, end (start and end for two). Use as a slideshow or as first and last frames for image-to-video.',
      zh: '场景按时间展开：开始、中段、结束（两张时为开始和结束）。可做成轮播，或作为图生视频的首尾帧。',
    },
  },
  {
    id: 'coverage',
    name: { en: 'Camera coverage', zh: '多景别' },
    blurb: { en: 'The same moment from three distances: wide, medium, close-up (wide and close-up for two). Gives the editor cuts within a scene.', zh: '同一时刻的不同景别：全景、中景、特写（两张时为全景和特写）。方便在一个场景内剪切。' },
  },
  {
    id: 'broll',
    name: { en: 'Main shot + cutaways', zh: '主镜头 + 插入镜头' },
    blurb: { en: 'The scene as written, then a detail insert and a shot of the surroundings to cut away to.', zh: '先按脚本生成主镜头，再生成细节插入镜头和环境空镜，用于穿插剪辑。' },
  },
  {
    id: 'styles',
    name: { en: 'Style comparison', zh: '风格对比' },
    blurb: { en: 'The same shot in each of your first two visual styles, then the blend of all you picked. Needs two styles picked.', zh: '同一个镜头分别用所选的前两种画面风格生成，第三张为全部所选风格的混合。至少需要选择两种风格。' },
    needsStyles: 2,
  },
];

/** Everything the page needs to label modes and shots. */
// `library` is not a shot that is made: it captions a picture or a clip the creator placed from their own library.
export const SHOT_LABELS = { ...Object.fromEntries(Object.entries(SHOTS).map(([id, s]) => [id, s.label])), library: { en: 'From your library', zh: '来自素材库' } };

/**
 * The shots to make for one scene: [{ id, directive, replaceCamera, styleIds, set }].
 * `id` is '' for a plain take. Unknown modes, a count of 1, or "styles" without two styles all mean plain takes.
 */
export function planShots(mode, count, styleIds) {
  const n = Math.min(MAX_IMAGES, Math.max(1, Math.round(Number(count)) || 1));
  const plain = Array.from({ length: n }, () => ({ id: '', directive: '' }));
  if (n === 1) return plain;

  if (mode === 'styles') {
    const all = pickStyles(styleIds);
    const [a, b] = all;
    if (!b) return plain;
    // The two that lead, each on its own, then everything chosen as one look.
    return [
      { id: `style-${a.id}`, directive: '', styleIds: [a.id] },
      { id: `style-${b.id}`, directive: '', styleIds: [b.id] },
      { id: 'blend', directive: '', styleIds: all.map((s) => s.id) },
    ].slice(0, n);
  }

  const ids = PLANS[mode]?.[n];
  if (!ids) return plain;
  return ids.map((id, i) => ({
    id,
    directive: SHOTS[id].directive,
    replaceCamera: Boolean(SHOTS[id].replaceCamera),
    set: `Image ${i + 1} of a set of ${n} for the same scene: keep the same subject, wardrobe, setting, lighting and colour palette as the others.`,
  }));
}
