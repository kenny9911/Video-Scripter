// The video of a script, made in the browser: every scene is its picture (or the theme, where it has none)
// with its on-screen text, the voiceover as captions in time with the voice, and the voice itself.
//
//   captionsOf(voiceover, lang)           a voiceover as the short lines a viewer reads, weighted by how long each takes to say
//   buildTimeline(scenes, voice, lang)    when every scene, caption and piece of sound happens: the video is cut to the voice
//   cue(film, t)                          brings the scene's clip, if it has one, to the frame second `t` shows
//   drawFrame(ctx, t, film)               the picture at second `t`
//   mixTrack / withMusic                  the voice laid along the timeline, and a music bed that steps back under it
//   renderFilm(film, clips, options)      every frame and the sound, encoded (WebCodecs) and written as an MP4 (mp4.js)
//
// Drawing is the same code for the preview and the file, so the preview is the video.

import { textBlock, background, SANS } from './cards.js';
import { muxMp4 } from './mp4.js';

export const FPS = 30;
export const FRAME_SIZES = { '9:16': { w: 1080, h: 1920 }, '16:9': { w: 1920, h: 1080 }, '1:1': { w: 1080, h: 1080 }, '3:4': { w: 1080, h: 1440 }, '4:3': { w: 1440, h: 1080 } };
const LEAD = 0.25; // before the first word
const GAP = 0.22; // a breath between scenes
const TAIL = 0.7; // after the last word
const AUDIO_RATE = 48000;

// ---------- Captions ----------

const STRONG = '。！？!?；;…';
const WEAK = '，,、：:';
const letters = (s) => (s.match(/[\p{L}\p{N}]/gu) || []).length;
const bare = (s) => s.replace(/\*\*/g, '');

/**
 * A voiceover as captions: [{ text, weight }]. Lines break at punctuation and at pause marks, and stay short
 * enough to read at a glance (about 16 characters of Chinese, 44 letters of English). `[[stressed]]` words
 * come out as `**marked**`. `weight` is how long the line takes to say, in letters plus a beat for a stop.
 */
export function captionsOf(voiceover, lang = 'zh') {
  const max = lang === 'zh' ? 16 : 44;
  const text = String(voiceover ?? '')
    .replace(/(^|[\s。！？!?.…])[AB][:：]\s*/g, '$1') // a conversation's speaker labels are not read out
    .replace(/\[\[/g, '**')
    .replace(/\]\]/g, '**')
    .replace(/\s*⏸\s*/g, '\n')
    .replace(/[ \t]+/g, ' ');
  // Clauses: each ends at punctuation or at a pause.
  const clauses = [];
  let cur = '';
  const close = (strong) => (cur.trim() && clauses.push({ text: cur.trim(), strong }), (cur = ''));
  const chars = [...text];
  chars.forEach((c, i) => {
    if (c === '\n') return close(true);
    cur += c;
    const next = chars[i + 1] || '';
    if ((STRONG + WEAK).includes(next) || '”’」』）)*'.includes(next)) return; // punctuation and what closes a phrase stay with it
    if (STRONG.includes(c) || (c === '.' && (!next || next === ' '))) close(true);
    else if (WEAK.includes(c) && (lang === 'zh' || next === ' ' || !next)) close(false);
  });
  close(true);
  // Lines: clauses joined while they fit; a clause too long for a line is cut into even pieces.
  const lines = [];
  let line = null;
  for (const clause of clauses) {
    const size = [...bare(clause.text)].length;
    if (size > max * 1.25) {
      line = null;
      const units = lang === 'zh' ? [...clause.text] : clause.text.split(/(?<= )/);
      const count = Math.ceil(size / max);
      const per = Math.ceil(units.length / count);
      for (let i = 0; i < units.length; i += per) lines.push({ text: units.slice(i, i + per).join('').trim(), strong: i + per >= units.length && clause.strong });
      continue;
    }
    if (line && !line.strong && [...bare(line.text)].length + size <= max) {
      line.text += (lang === 'zh' ? '' : ' ') + clause.text;
      line.strong = clause.strong;
    } else lines.push((line = { ...clause }));
  }
  return lines
    .filter((l) => letters(l.text))
    .map((l) => ({
      // A marker cut in two by a line break marks nothing; a comma or a full stop at the end of a caption is noise.
      text: ((l.text.match(/\*\*/g) || []).length % 2 ? bare(l.text) : l.text).replace(/[，,、：:。.；;]+(\*\*)?$/u, '$1').trim(),
      weight: letters(l.text) + (l.strong ? 1.6 : 0.6),
    }));
}

/**
 * When everything happens. `voice` is { [sceneId]: { seconds } }: a scene lasts as long as its sound, with a
 * breath after it; a scene with no sound keeps the length the script gave it.
 * Returns { duration, scenes: [{ id, start, end, audioAt, seconds, headline, captions: [{ text, start, end }] }] }.
 */
export function buildTimeline(scenes, voice = {}, lang = 'zh') {
  let at = LEAD;
  const out = scenes.map((sc, i) => {
    const seconds = voice[sc.id]?.seconds || Math.max(1, (Number(sc.end) || 0) - (Number(sc.start) || 0));
    const start = i ? at : 0;
    const audioAt = at;
    const lines = captionsOf(sc.voiceover, lang);
    const total = lines.reduce((n, l) => n + l.weight, 0) || 1;
    let said = 0;
    const captions = lines.map((l) => {
      const from = audioAt + (said / total) * seconds;
      said += l.weight;
      return { text: l.text, start: from, end: audioAt + (said / total) * seconds };
    });
    at = audioAt + seconds + GAP;
    return { id: sc.id, start, end: at, audioAt, seconds, headline: String(sc.onScreenText || '').trim(), captions };
  });
  if (!out.length) return { duration: 0, scenes: [] };
  out.at(-1).end += TAIL - GAP;
  return { duration: out.at(-1).end, scenes: out };
}

/** The captions of a timeline as a SubRip (.srt) file, for a platform's own subtitles or an editor. */
export function srtOf(timeline) {
  const stamp = (s) => {
    const ms = Math.round(s * 1000);
    const two = (n) => String(n).padStart(2, '0');
    return `${two(Math.floor(ms / 3600000))}:${two(Math.floor(ms / 60000) % 60)}:${two(Math.floor(ms / 1000) % 60)},${String(ms % 1000).padStart(3, '0')}`;
  };
  return timeline.scenes
    .flatMap((sc) => sc.captions)
    .map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${bare(c.text)}\n`)
    .join('\n');
}

// ---------- Drawing ----------

const clamp = (v) => Math.min(1, Math.max(0, v));
const ease = (v) => 1 - (1 - clamp(v)) ** 3;

/** A picture or a clip's current frame filling the frame, darkened where text sits on it. A still drifts slowly closer over the scene. */
function picture(ctx, media, w, h, progress) {
  const moving = 'videoWidth' in media;
  const [mw, mh] = moving ? [media.videoWidth, media.videoHeight] : [media.naturalWidth, media.naturalHeight];
  const k = Math.max(w / mw, h / mh) * (moving ? 1 : 1.03 + 0.07 * progress);
  const [iw, ih] = [mw * k, mh * k];
  ctx.drawImage(media, (w - iw) / 2, (h - ih) / 2 - (moving ? 0 : (ih - h) * 0.15 * (progress - 0.5)), iw, ih);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0.42)');
  g.addColorStop(0.3, 'rgba(0,0,0,0.08)');
  g.addColorStop(0.58, 'rgba(0,0,0,0.12)');
  g.addColorStop(1, 'rgba(0,0,0,0.78)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/** What a scene shows behind its words: its clip, else its picture, else nothing (the theme). */
const mediaOf = (film, scene) => film.clips?.get(scene.id) || film.images.get(scene.id) || null;

/**
 * Bring the clip of the scene at second `t` to the frame that second shows, so drawFrame can draw it. A clip
 * plays at its own speed from the start of its scene and holds its last frame if the scene outlasts it.
 * Resolves at once for a scene without a clip.
 */
export function cue(film, t) {
  const scene = film.timeline.scenes.findLast((sc) => t >= sc.start) || film.timeline.scenes[0];
  const clip = scene && film.clips?.get(scene.id);
  if (!clip || !(clip.duration > 0)) return Promise.resolve();
  const at = Math.min(Math.max(0, t - scene.start), clip.duration - 0.04);
  if (Math.abs(clip.currentTime - at) < 0.004 && !clip.seeking) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => (clearTimeout(timer), clip.removeEventListener('seeked', done), resolve());
    const timer = setTimeout(done, 2000); // a clip that will not seek does not hold the whole video up
    clip.addEventListener('seeked', done);
    clip.currentTime = at;
  });
}

/**
 * The frame at second `t`. `film` is
 *   { size: { w, h }, theme, timeline, images: Map(sceneId -> <img>), clips: Map(sceneId -> <video>), captions: true, label: 'AI生成', layouts: Map }
 * A scene with a clip shows the frame the clip is on: call cue(film, t) first.
 * `layouts` keeps the text that was already set, so a line is measured once and drawn many times.
 */
export function drawFrame(ctx, t, film) {
  const { w, h } = film.size;
  const { scenes, duration } = film.timeline;
  const u = Math.min(w, h) / 1080;
  const tall = h / w > 1.6;
  const pad = (w > h ? 150 : 92) * u;
  const maxW = w - pad * 2;
  const i = Math.max(0, scenes.findLastIndex((sc) => t >= sc.start));
  const sc = scenes[i];
  if (!sc) return;
  const local = t - sc.start;
  const theme = film.theme;
  const image = mediaOf(film, sc);
  const paint = (scene, progress) => {
    const media = mediaOf(film, scene);
    if (media) picture(ctx, media, w, h, progress);
    else background(ctx, theme, w, h, u, false);
  };

  // The scene before fades into this one where either has a picture.
  const before = scenes[i - 1];
  const fading = before && local < 0.3 && (image || mediaOf(film, before));
  ctx.globalAlpha = 1;
  if (fading) paint(before, 1);
  ctx.globalAlpha = fading ? clamp(local / 0.3) : 1;
  paint(sc, clamp(local / (sc.end - sc.start)));
  ctx.globalAlpha = 1;

  const set = (key, make) => {
    if (!film.layouts.has(key)) film.layouts.set(key, make());
    return film.layouts.get(key);
  };
  const onPicture = { color: '#FFFFFF', accent: '#FFE14D', mark: { type: 'color' } };
  const shadow = (on) => {
    ctx.shadowColor = on ? 'rgba(0,0,0,0.6)' : 'transparent';
    ctx.shadowBlur = on ? 22 * u : 0;
    ctx.shadowOffsetY = on ? 4 * u : 0;
  };

  // On-screen text: the scene's headline, large on the theme, smaller over a picture.
  const head = sc.headline && set(`head:${sc.id}:${Boolean(image)}`, () => textBlock(ctx, sc.headline, { family: theme.title, weight: 900, max: (image ? 86 : 124) * u, min: 56 * u, lh: 1.24, maxLines: image ? 3 : 5, maxW, balance: true, color: theme.ink, accent: theme.accent, mark: theme.mark, ...(image && onPicture) }));
  if (head) {
    const shown = ease(local / 0.4);
    const top = image ? (tall ? 250 : 110) * u : Math.max(pad + (tall ? 130 * u : 0), h * (tall ? 0.4 : 0.42) - head.h / 2);
    ctx.globalAlpha = shown;
    if (!image) {
      ctx.fillStyle = theme.accent;
      ctx.fillRect(pad, top - 52 * u + (1 - shown) * 30 * u, 120 * u, 12 * u);
    }
    shadow(Boolean(image));
    head.draw(pad, top + (1 - shown) * 30 * u);
    shadow(false);
    ctx.globalAlpha = 1;
  }

  // The caption being said. With nothing else on the frame it takes the middle, larger.
  const index = film.captions === false ? -1 : sc.captions.findLastIndex((c) => t >= c.start);
  const caption = sc.captions[index];
  if (caption) {
    const alone = !head && !image;
    const block = set(`cap:${sc.id}:${index}:${Boolean(image)}`, () => textBlock(ctx, caption.text, { family: SANS, weight: 800, max: (alone ? 84 : 58) * u, min: 42 * u, lh: 1.34, maxLines: 3, maxW, balance: true, align: 'center', color: theme.ink, accent: theme.accent, mark: theme.mark, ...(image && { ...onPicture, stroke: { color: 'rgba(0,0,0,0.72)', width: 9 * u } }) }));
    if (block) {
      const y = alone ? h * 0.46 - block.h / 2 : h * (tall ? 0.79 : 0.9) - block.h;
      block.draw(pad, y);
    }
  }

  // What the law and the platforms ask of synthetic media: a visible label, in a corner.
  if (film.label) {
    ctx.font = `600 ${28 * u}px ${SANS}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    shadow(Boolean(image));
    ctx.fillStyle = image ? 'rgba(255,255,255,0.86)' : theme.sub;
    ctx.fillText(film.label, pad, (tall ? 150 : 44) * u);
    shadow(false);
  }

  // How far in we are: a line along the bottom.
  ctx.fillStyle = theme.accent;
  ctx.fillRect(0, h - 10 * u, w * clamp(t / duration), 10 * u);
}

// ---------- Sound ----------

/** The 16-bit mono sound in a WAV file this app wrote (src/speech.mjs): { samples: Int16Array, rate }. */
export function readWav(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 44 || view.getUint32(0) !== 0x52494646) throw new Error('Not a WAV file');
  return { samples: new Int16Array(buffer.slice(44, 44 + Math.floor((buffer.byteLength - 44) / 2) * 2)), rate: view.getUint32(24, true) };
}

/** Every scene's sound laid where the timeline says, as one track: a Float32Array at 48 kHz. */
export function mixTrack(timeline, clips, rate = AUDIO_RATE) {
  const out = new Float32Array(Math.ceil(timeline.duration * rate));
  for (const sc of timeline.scenes) {
    const clip = clips.get(sc.id);
    if (!clip) continue;
    const from = Math.round(sc.audioAt * rate);
    const n = Math.min(out.length - from, Math.floor((clip.samples.length * rate) / clip.rate));
    for (let i = 0; i < n; i++) {
      const at = (i * clip.rate) / rate;
      const a = Math.floor(at);
      const b = Math.min(clip.samples.length - 1, a + 1);
      out[from + i] = (clip.samples[a] * (1 - (at - a)) + clip.samples[b] * (at - a)) / 32768;
    }
  }
  return out;
}

/**
 * The voice with a music bed under it: { left, right }. `music` is { left, right } at the track's rate; it
 * loops if the video outlasts it, fades in and out, and steps back whenever someone is speaking.
 * `level` (0..1) is how loud the music is between the words; under the voice it is at 40% of that.
 */
export function withMusic(voice, music, { level = 0.5, rate = AUDIO_RATE } = {}) {
  const n = voice.length;
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  if (!music?.left?.length || level <= 0) return left.set(voice), right.set(voice), { left, right };
  // How loud the voice is around each moment: the largest sample in 50 ms, held, so the gaps between words do not pump.
  const hop = Math.round(rate * 0.05);
  const loud = new Float32Array(Math.ceil(n / hop));
  for (let i = 0; i < n; i++) {
    const v = Math.abs(voice[i]);
    if (v > loud[(i / hop) | 0]) loud[(i / hop) | 0] = v;
  }
  let peak = 0;
  for (let i = 0; i < music.left.length; i++) peak = Math.max(peak, Math.abs(music.left[i]), Math.abs(music.right[i]));
  const full = (0.32 * level) / (peak || 1);
  const fall = 1 - Math.exp(-1 / (rate * 0.12)); // the music gets out of the way quickly
  const rise = 1 - Math.exp(-1 / (rate * 0.6)); // and comes back slowly
  let gain = full;
  for (let i = 0; i < n; i++) {
    const speaking = loud[(i / hop) | 0] > 0.02 || loud[Math.min(loud.length - 1, ((i / hop) | 0) + 4)] > 0.02; // a little ahead of the word
    const target = speaking ? full * 0.4 : full;
    gain += (target - gain) * (target < gain ? fall : rise);
    const edge = Math.min(1, i / (rate * 0.8), (n - i) / (rate * 1.6));
    const m = i % music.left.length;
    left[i] = Math.max(-1, Math.min(1, voice[i] + music.left[m] * gain * edge));
    right[i] = Math.max(-1, Math.min(1, voice[i] + music.right[m] * gain * edge));
  }
  return { left, right };
}

// ---------- Encoding ----------

const VIDEO_CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028']; // H.264 High, Main, Baseline at level 4: what every platform takes
const AUDIO = { codec: 'mp4a.40.2', sampleRate: AUDIO_RATE, numberOfChannels: 2, bitrate: 128000 };
const bytesOf = (b) => (b instanceof ArrayBuffer ? new Uint8Array(b.slice(0)) : new Uint8Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
// A turn of the event loop that a background tab does not slow down, as it does timers.
const tick = () =>
  new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });

/** The settings this browser can encode `size` with, or the reason it cannot: { video, audio } | { reason }. */
export async function encoderFor(size) {
  if (typeof VideoEncoder === 'undefined' || typeof AudioEncoder === 'undefined') return { reason: 'no-webcodecs' };
  const bitrate = Math.round(Math.min(8_000_000, Math.max(2_500_000, size.w * size.h * 2.9)));
  for (const codec of VIDEO_CODECS) {
    const config = { codec, width: size.w, height: size.h, bitrate, framerate: FPS, avc: { format: 'avc' } };
    if ((await VideoEncoder.isConfigSupported(config).catch(() => null))?.supported) {
      if (!(await AudioEncoder.isConfigSupported(AUDIO).catch(() => null))?.supported) return { reason: 'no-aac' };
      return { video: config, audio: AUDIO };
    }
  }
  return { reason: 'no-h264' };
}

/**
 * The film as an MP4: Blob. `sounds` is Map(sceneId -> { samples, rate }), every scene's recording; `music` is
 * { left, right, level } for a bed under the voice, or nothing. `onProgress(0..1)` is called as it goes;
 * aborting `signal` stops it.
 */
export async function renderFilm(film, sounds, { onProgress = () => {}, signal, music = null } = {}) {
  const { w, h } = film.size;
  const encoder = await encoderFor(film.size);
  if (encoder.reason) throw Object.assign(new Error(`This browser cannot encode the video (${encoder.reason})`), { reason: encoder.reason });
  const stopped = () => signal?.aborted && Object.assign(new Error('Stopped'), { name: 'AbortError' });
  let failure = null;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  const video = { width: w, height: h, fps: FPS, config: null, samples: [] };
  const pictures = new VideoEncoder({
    output(chunk, meta) {
      if (meta?.decoderConfig?.description) video.config = bytesOf(meta.decoderConfig.description);
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      video.samples.push({ data, key: chunk.type === 'key', at: chunk.timestamp });
    },
    error: (err) => (failure = err),
  });
  pictures.configure(encoder.video);
  const frames = Math.max(1, Math.ceil(film.timeline.duration * FPS));
  for (let f = 0; f < frames; f++) {
    if (stopped() || failure) break;
    if (film.clips?.size) await cue(film, f / FPS);
    drawFrame(ctx, f / FPS, film);
    const frame = new VideoFrame(canvas, { timestamp: Math.round((f * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
    pictures.encode(frame, { keyFrame: f % (FPS * 2) === 0 });
    frame.close();
    while (pictures.encodeQueueSize > 6 && !failure) await tick();
    if (f % 10 === 0) onProgress((f / frames) * 0.92), await tick();
  }
  if (stopped() || failure) {
    pictures.state !== 'closed' && pictures.close();
    throw failure || stopped();
  }
  await pictures.flush();
  pictures.close();
  if (!video.config) throw new Error('The browser encoded the video without saying how to decode it');
  if (video.samples.some((s, i, all) => i && s.at <= all[i - 1].at)) throw new Error('The browser encoded the frames out of order');

  const audio = { sampleRate: AUDIO_RATE, channels: 2, bitrate: AUDIO.bitrate, config: null, samples: [] };
  const sound = new AudioEncoder({
    output(chunk, meta) {
      if (meta?.decoderConfig?.description) audio.config = bytesOf(meta.decoderConfig.description);
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      audio.samples.push({ data });
    },
    error: (err) => (failure = err),
  });
  sound.configure(encoder.audio);
  const track = withMusic(mixTrack(film.timeline, sounds), music, { level: music?.level });
  const length = track.left.length;
  for (let from = 0; from < length && !failure; from += AUDIO_RATE) {
    const size = Math.min(length, from + AUDIO_RATE) - from;
    const planes = new Float32Array(size * 2); // the left channel, then the right
    planes.set(track.left.subarray(from, from + size), 0);
    planes.set(track.right.subarray(from, from + size), size);
    const data = new AudioData({ format: 'f32-planar', sampleRate: AUDIO_RATE, numberOfFrames: size, numberOfChannels: 2, timestamp: Math.round((from * 1e6) / AUDIO_RATE), data: planes });
    sound.encode(data);
    data.close();
    if (stopped()) break;
    onProgress(0.92 + (from / length) * 0.07);
    await tick();
  }
  if (stopped() || failure) {
    sound.state !== 'closed' && sound.close();
    throw failure || stopped();
  }
  await sound.flush();
  sound.close();
  // AAC-LC, 48 kHz, two channels: what the encoder was asked for, should it not have said so itself.
  audio.config ||= Uint8Array.of(0x11, 0x90);
  onProgress(1);
  return new Blob([muxMp4({ video, audio })], { type: 'video/mp4' });
}
