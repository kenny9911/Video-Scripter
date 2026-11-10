// The shapes a video can be written and illustrated in. The brief carries one id (`aspectRatio`);
// it sets the frame the script is written for and the shape of every scene image and clip.

export const ASPECTS = [
  { id: '9:16', w: 9, h: 16, shape: 'Vertical', name: { en: 'Vertical', zh: '竖屏' } },
  { id: '16:9', w: 16, h: 9, shape: 'Landscape', name: { en: 'Landscape', zh: '横屏' } },
  { id: '1:1', w: 1, h: 1, shape: 'Square', name: { en: 'Square', zh: '方形' } },
  { id: '3:4', w: 3, h: 4, shape: 'Portrait', name: { en: 'Portrait', zh: '竖版' } },
  { id: '4:3', w: 4, h: 3, shape: 'Landscape', name: { en: 'Standard', zh: '横版' } },
];

export const DEFAULT_ASPECT = ASPECTS[0].id;

/** The aspect for an id; anything unknown (or a script from before the option existed) is vertical. */
export const getAspect = (id) => ASPECTS.find((a) => a.id === id) || ASPECTS[0];

/**
 * The pixel size to ask a media model for. The gateway's Size setting ("1024x1536") names the
 * model's two edge lengths: they are used short-by-long for an upright frame (9:16, 3:4), long-by-short
 * for a wide one (16:9, 4:3) and short-by-short for square, which is how image and video models offer
 * their sizes. The edges are not rescaled, so 3:4 and 4:3 get the model's nearest size, not an exact one.
 * A blank size stays blank (the provider decides); one that is not WIDTHxHEIGHT is sent as written.
 */
export function sizeFor(size, aspectId) {
  const m = /^\s*(\d{2,5})\s*[x×*]\s*(\d{2,5})\s*$/i.exec(size || '');
  if (!m) return size || '';
  const short = Math.min(Number(m[1]), Number(m[2]));
  const long = Math.max(Number(m[1]), Number(m[2]));
  const { w, h } = getAspect(aspectId);
  return w === h ? `${short}x${short}` : w < h ? `${short}x${long}` : `${long}x${short}`;
}
