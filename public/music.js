// Music for under the voice of a video. Two sources, both on this device: a file the creator picks (theirs
// to have the rights to), or a bed synthesised here, which nobody else owns: a few soft chords, nothing a
// platform's music matching could claim.
//
//   BEDS                         the built-in beds
//   bedOf(id, seconds)           one of them, as long as the video: { left, right } at 48 kHz
//   decodeMusic(arrayBuffer)     an audio file, the same way
//
// film.js lays the result under the voice and turns it down while someone is speaking (withMusic).

const RATE = 48000;

export const BEDS = [
  { id: 'calm', name: { en: 'Calm pad', zh: '舒缓铺底' } },
  { id: 'bright', name: { en: 'Bright pulse', zh: '明快律动' } },
];

// Four chords that go round without ever arriving: C major 7, A minor 7, F major 7, G 6.
const CHORDS = [
  [130.81, 164.81, 196.0, 246.94],
  [110.0, 130.81, 164.81, 196.0],
  [87.31, 130.81, 164.81, 220.0],
  [98.0, 146.83, 196.0, 246.94],
];

const planes = (buffer) => ({ left: buffer.getChannelData(0).slice(), right: (buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0)).slice() });

/** An audio file (MP3, WAV, M4A: whatever this browser plays) as { left, right } at 48 kHz. */
export async function decodeMusic(arrayBuffer) {
  const ctx = new OfflineAudioContext(2, 1, RATE);
  return planes(await ctx.decodeAudioData(arrayBuffer));
}

/** A sustained note: two voices a hair apart, in from nothing and out again, a little to one side. */
function pad(ctx, out, freq, at, length, pan, level) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(level, at + length * 0.3);
  gain.gain.setValueAtTime(level, at + length * 0.7);
  gain.gain.linearRampToValueAtTime(0, at + length * 1.25);
  const side = ctx.createStereoPanner();
  side.pan.value = pan;
  gain.connect(side).connect(out);
  for (const [type, detune, octave] of [['triangle', -6, 1], ['sine', 7, 2]]) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq * octave;
    osc.detune.value = detune;
    osc.connect(gain);
    osc.start(at);
    osc.stop(at + length * 1.3);
  }
}

/** A plucked note: quick in, gone in a third of a second. */
function pluck(ctx, out, freq, at, pan, level) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(level, at + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0008, at + 0.34);
  const side = ctx.createStereoPanner();
  side.pan.value = pan;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  osc.connect(gain).connect(side).connect(out);
  osc.start(at);
  osc.stop(at + 0.4);
}

/** One of the built-in beds, `seconds` long. */
export async function bedOf(id, seconds) {
  const length = Math.min(420, Math.max(2, seconds));
  const ctx = new OfflineAudioContext(2, Math.ceil(length * RATE), RATE);
  const tone = ctx.createBiquadFilter(); // nothing bright enough to fight the voice
  tone.type = 'lowpass';
  tone.frequency.value = id === 'bright' ? 2600 : 1300;
  tone.connect(ctx.destination);
  if (id === 'bright') {
    const beat = 60 / 96 / 2; // eighth notes at 96 beats a minute
    const bar = beat * 8;
    for (let b = 0; b * bar < length; b++) {
      const chord = CHORDS[b % CHORDS.length];
      chord.forEach((f, n) => pad(ctx, tone, f, b * bar, bar, n % 2 ? 0.3 : -0.3, 0.035));
      for (let step = 0; step < 8 && b * bar + step * beat < length; step++) pluck(ctx, tone, chord[[0, 2, 1, 3, 2, 1, 3, 2][step]] * 2, b * bar + step * beat, step % 2 ? 0.35 : -0.35, step % 4 === 0 ? 0.16 : 0.1);
    }
  } else {
    const bar = 6;
    for (let b = 0; b * bar < length; b++) CHORDS[b % CHORDS.length].forEach((f, n) => pad(ctx, tone, f, b * bar, bar, [-0.5, 0.25, -0.2, 0.5][n], 0.06));
  }
  return planes(await ctx.startRendering());
}
