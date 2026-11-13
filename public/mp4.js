// Writes an MP4 file from encoded H.264 video and AAC sound, in the browser (the encoders are the
// browser's own, WebCodecs; this only puts their output in a file). The index comes first ("fast start"),
// so the file plays while it is still arriving, which is how the platforms want an upload.
//
//   muxMp4({ video, audio }) -> Uint8Array
//     video  { width, height, fps, config, samples: [{ data, key }] }       config: the avcC record
//     audio  { sampleRate, channels, config, samples: [{ data }] }          config: the AudioSpecificConfig
//                                                                           every sample is 1024 frames
// Samples are in the order they play: no B-frames (WebCodecs encoders do not make them).

const enc = new TextEncoder();
const u8 = (...v) => Uint8Array.from(v);
const u16 = (v) => u8(v >>> 8, v);
const u32 = (v) => u8(v >>> 24, v >>> 16, v >>> 8, v);
const zeros = (n) => new Uint8Array(n);
const str = (s) => enc.encode(s);

function concat(parts) {
  const list = parts.flat(Infinity).map((p) => (typeof p === 'number' ? u32(p) : p));
  const out = new Uint8Array(list.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of list) out.set(p, at), (at += p.length);
  return out;
}

/** A box: its length, its four-letter name, what is in it. A number in the contents is written as 32 bits. */
const box = (type, ...contents) => {
  const body = concat(contents);
  return concat([u32(body.length + 8), str(type), body]);
};
const full = (type, version, flags, ...contents) => box(type, u8(version, flags >>> 16, flags >>> 8, flags), ...contents);

const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
const MOVIE_SCALE = 1000;

/** [value, value, value, other] as runs: [[count, value]]. */
function runs(values) {
  const out = [];
  for (const v of values) {
    if (out.at(-1)?.[1] === v) out.at(-1)[0]++;
    else out.push([1, v]);
  }
  return out;
}

/** The descriptor that tells a player the sound is AAC and how to set its decoder up. */
function esds(config, bitrate) {
  const descr = (tag, ...contents) => {
    const body = concat(contents);
    return concat([u8(tag, 0x80, 0x80, 0x80, body.length), body]); // lengths in the four-byte form every player reads
  };
  const decoder = descr(0x04, u8(0x40, 0x15), u8(0, 0, 0), u32(bitrate), u32(bitrate), descr(0x05, config));
  return full('esds', 0, 0, descr(0x03, u16(1), u8(0), decoder, descr(0x06, u8(2))));
}

function track({ id, kind, scale, durations, sizes, keys, chunks, entry, width = 0, height = 0 }) {
  const total = durations.reduce((n, d) => n + d, 0);
  const movieTime = Math.round((total / scale) * MOVIE_SCALE);
  const video = kind === 'vide';
  const stsc = [];
  chunks.forEach((c, i) => stsc.at(-1)?.[1] === c.count || stsc.push([i + 1, c.count]));
  const stbl = box(
    'stbl',
    full('stsd', 0, 0, 1, entry),
    full('stts', 0, 0, runs(durations).length, runs(durations).map(([n, d]) => [u32(n), u32(d)])),
    video ? full('stss', 0, 0, keys.length, keys.map((k) => u32(k))) : [],
    full('stsc', 0, 0, stsc.length, stsc.map(([first, count]) => [u32(first), u32(count), u32(1)])),
    full('stsz', 0, 0, 0, sizes.length, sizes.map((s) => u32(s))),
    full('stco', 0, 0, chunks.length, chunks.map((c) => u32(c.offset))),
  );
  return box(
    'trak',
    full('tkhd', 0, 3, 0, 0, id, 0, movieTime, zeros(8), u16(0), u16(0), u16(video ? 0 : 0x0100), u16(0), MATRIX.map(u32), width << 16, height << 16),
    box(
      'mdia',
      full('mdhd', 0, 0, 0, 0, scale, total, u16(0x55c4), u16(0)),
      full('hdlr', 0, 0, 0, str(kind), zeros(12), str(video ? 'VideoHandler\0' : 'SoundHandler\0')),
      box('minf', video ? full('vmhd', 0, 1, zeros(8)) : full('smhd', 0, 0, zeros(4)), box('dinf', full('dref', 0, 0, 1, full('url ', 0, 1))), stbl),
    ),
  );
}

export function muxMp4({ video, audio }) {
  const vScale = video.fps * 1000;
  const vStep = 1000;
  const aStep = 1024;
  // Half a second of pictures, then the sound that goes with it, and so on: a player never has to look far for either.
  const pieces = [];
  const vChunks = [];
  const aChunks = [];
  let at = 0;
  let vi = 0;
  let ai = 0;
  const take = (samples, from, until, chunks) => {
    if (until <= from) return from;
    chunks.push({ offset: at, count: until - from });
    for (let i = from; i < until; i++) pieces.push(samples[i].data), (at += samples[i].data.length);
    return until;
  };
  const aSamples = audio?.samples || [];
  for (let t = 0.5; vi < video.samples.length || ai < aSamples.length; t += 0.5) {
    vi = take(video.samples, vi, Math.min(video.samples.length, Math.ceil(t * video.fps)), vChunks);
    ai = take(aSamples, ai, audio ? Math.min(aSamples.length, Math.ceil((t * audio.sampleRate) / aStep)) : 0, aChunks);
  }

  const avc1 = box(
    'avc1',
    zeros(6), u16(1), zeros(16), u16(video.width), u16(video.height), 0x00480000, 0x00480000, 0, u16(1), zeros(32), u16(0x18), u16(0xffff),
    box('avcC', video.config),
  );
  const mp4a = audio && box('mp4a', zeros(6), u16(1), zeros(8), u16(audio.channels), u16(16), zeros(4), audio.sampleRate << 16 >>> 0, esds(audio.config, audio.bitrate || 128000));

  const moov = (shift) => {
    const moved = (chunks) => chunks.map((c) => ({ ...c, offset: c.offset + shift }));
    const seconds = Math.max(video.samples.length / video.fps, audio ? (aSamples.length * aStep) / audio.sampleRate : 0);
    return box(
      'moov',
      full('mvhd', 0, 0, 0, 0, MOVIE_SCALE, Math.round(seconds * MOVIE_SCALE), 0x00010000, u16(0x0100), zeros(10), MATRIX.map(u32), zeros(24), audio ? 3 : 2),
      track({ id: 1, kind: 'vide', scale: vScale, durations: video.samples.map(() => vStep), sizes: video.samples.map((s) => s.data.length), keys: video.samples.flatMap((s, i) => (s.key ? [i + 1] : [])), chunks: moved(vChunks), entry: avc1, width: video.width, height: video.height }),
      audio ? track({ id: 2, kind: 'soun', scale: audio.sampleRate, durations: aSamples.map(() => aStep), sizes: aSamples.map((s) => s.data.length), keys: [], chunks: moved(aChunks), entry: mp4a }) : [],
    );
  };

  const ftyp = box('ftyp', str('isom'), 0x200, str('isomiso2avc1mp41'));
  // The index holds where every chunk starts, and it sits before them: its length is fixed by what it lists, so measure it first.
  const shift = ftyp.length + moov(0).length + 8;
  return concat([ftyp, moov(shift), u32(at + 8), str('mdat'), pieces]);
}

/** The boxes in a file (or in a box's contents), for checking what was written: [{ type, start, size, data }]. */
export function boxes(bytes, start = 0, end = bytes.length) {
  const out = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = start; at + 8 <= end; ) {
    const size = view.getUint32(at);
    if (size < 8 || at + size > end) break;
    out.push({ type: String.fromCharCode(...bytes.subarray(at + 4, at + 8)), start: at, size, data: bytes.subarray(at + 8, at + size) });
    at += size;
  }
  return out;
}
