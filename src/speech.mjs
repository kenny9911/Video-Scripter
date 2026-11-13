// The voice of a video: text-to-speech for a script's voiceover, one scene at a time.
//
//   loadSpeech / saveSpeech / publicSpeech   the one voice provider the app uses, kept apart from the gateways
//                                            (a voice service is rarely the service that writes the text)
//   synthesize(config, { text, voice })      one piece of text as sound: { pcm, rate } (16-bit mono)
//   voiceScene(config, voiceover, options)   a scene's voiceover as one WAV, each speaker in their own voice
//
// Two protocols are spoken:
//   volc     火山引擎 豆包语音 (Seed-TTS), V3 one-way HTTP: lines of JSON, each carrying a piece of the sound
//   openai   POST {base}/audio/speech, the OpenAI shape many providers and gateways offer
// With no provider set, a script written in demo mode gets a placeholder tone, so the rest can be tried.
//
// Every scene is spoken on its own, so the length of its sound is known exactly: the video is cut to the
// voice, not the voice squeezed into the video.

import { randomUUID } from 'node:crypto';
import { db } from './db.mjs';
import { GatewayError, request, apiBase } from './gateway/client.mjs';

export const SPEECH_PROVIDERS = [
  {
    id: 'volc',
    label: '火山引擎 豆包语音 (Seed-TTS)',
    baseUrl: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
    model: 'seed-tts-2.0',
    needsAppId: true,
    voice: 'zh_female_vv_uranus_bigtts',
    voices: ['zh_female_vv_uranus_bigtts'],
    hint: 'APP ID and Access Token come from the 豆包语音 console; the voice is a speaker id from its voice list.',
  },
  {
    id: 'openai',
    label: 'OpenAI-compatible (/audio/speech)',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini-tts',
    needsAppId: false,
    voice: 'alloy',
    voices: ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'],
    hint: 'Any service with an OpenAI-style /audio/speech endpoint that can answer with WAV.',
  },
];

export const getSpeechProvider = (id) => SPEECH_PROVIDERS.find((p) => p.id === id);
export const MIN_SPEED = 0.7;
export const MAX_SPEED = 1.6;
export const RATE = 24000; // what the app keeps: 16-bit mono at this rate, enough for a voice and small to store
const BLANK = { provider: '', baseUrl: '', apiKey: '', appId: '', model: '', voice: '', voiceB: '' };
const text = (v, max) => String(v ?? '').trim().slice(0, max);

function envSpeech() {
  const env = process.env;
  const preset = getSpeechProvider(env.SPEECH_PROVIDER);
  if (!preset) return { ...BLANK };
  return { provider: preset.id, baseUrl: env.SPEECH_BASE_URL_API || preset.baseUrl, apiKey: env.SPEECH_API_KEY || '', appId: env.SPEECH_APP_ID || '', model: env.SPEECH_MODEL || preset.model, voice: env.SPEECH_VOICE || preset.voice, voiceB: env.SPEECH_VOICE_B || '' };
}

/** The voice provider in use: what was saved, otherwise what the environment names, otherwise none. */
export async function loadSpeech() {
  const saved = await db.get('config', 'speech');
  return saved && (saved.provider === '' || getSpeechProvider(saved.provider)) ? { ...BLANK, ...saved } : envSpeech();
}

/**
 * Form values merged over the saved settings. A blank key keeps the stored one, unless the provider or
 * the address changed: a key for one service is never sent to another.
 */
export function mergeSpeech(patch, current) {
  const cur = { ...BLANK, ...current };
  const preset = getSpeechProvider(patch.provider);
  if (!preset) return { ...BLANK };
  const baseUrl = text(patch.baseUrl, 300) || preset.baseUrl;
  const same = preset.id === cur.provider && baseUrl === cur.baseUrl;
  let apiKey = typeof patch.apiKey === 'string' ? patch.apiKey.trim() : '';
  if (!apiKey) apiKey = patch.clearKey || !same ? '' : cur.apiKey;
  return { provider: preset.id, baseUrl, apiKey, appId: preset.needsAppId ? text(patch.appId ?? cur.appId, 80) : '', model: text(patch.model, 80) || preset.model, voice: text(patch.voice, 120) || preset.voice, voiceB: text(patch.voiceB, 120) };
}

export function validateSpeech(config) {
  const preset = getSpeechProvider(config.provider);
  if (!preset) return 'Choose a voice provider';
  if (!/^https?:\/\/[^\s/]+/.test(config.baseUrl)) return 'The voice BASE_URL_API must be an http(s) URL';
  if (!config.apiKey) return 'An API key is required for the voice provider';
  if (preset.needsAppId && !config.appId) return 'An APP ID is required for this voice provider';
  return null;
}

export async function saveSpeech(config) {
  await db.put('config', { id: 'speech', ts: Date.now(), ...config });
  return config;
}

const mask = (key) => (!key ? '' : key.length <= 8 ? '••••' : `${key.slice(0, 3)}••••${key.slice(-4)}`);

/** The settings as a person may see them. An administrator gets the address and a masked key; everyone else what to pick from. */
export function publicSpeech(config, { admin = false, demo = false } = {}) {
  const preset = getSpeechProvider(config.provider);
  const ready = Boolean(preset) && !validateSpeech(config);
  const everyone = { ready, demo: !ready && demo, provider: preset?.id || '', label: preset?.label || '', voice: config.voice, voiceB: config.voiceB, voices: preset?.voices || [], speed: { min: MIN_SPEED, max: MAX_SPEED } };
  if (!admin) return everyone;
  return { ...everyone, baseUrl: config.baseUrl, appId: config.appId, model: config.model, hasKey: Boolean(config.apiKey), keyPreview: mask(config.apiKey), providers: SPEECH_PROVIDERS };
}

// ---------- What is said ----------

/** A voiceover as it is spoken: no stress marks, a pause mark as a comma, no line breaks. */
export function speakable(value, lang = 'zh') {
  const pause = lang === 'zh' ? '，' : ', ';
  return String(value ?? '')
    .replace(/\[\[|\]\]/g, '')
    // A pause mark is a comma, unless punctuation on either side already makes the pause.
    .replace(/(\p{P})?\s*⏸\s*/gu, (mark, before, at, all) => (before ? `${before}${lang === 'zh' ? '' : ' '}` : /\p{P}/u.test(all[at + mark.length] || '') ? '' : pause))
    .replace(/\s+/g, ' ')
    .trim();
}

/** A voiceover as the pieces each person says: [{ speaker: 'A' | 'B' | '', text }]. One piece when nobody is named. */
export function spokenParts(voiceover, lang = 'zh') {
  const parts = [];
  let speaker = '';
  for (const piece of String(voiceover ?? '').split(/(?:^|(?<=[\s。！？!?.…]))([AB])[:：]\s*/)) {
    if (piece === 'A' || piece === 'B') {
      speaker = piece;
      continue;
    }
    const said = speakable(piece, lang);
    if (!said.replace(/[\p{P}\s]/gu, '')) continue; // nothing but punctuation is nothing to say
    if (parts.at(-1)?.speaker === speaker) parts.at(-1).text += ` ${said}`;
    else parts.push({ speaker, text: said });
  }
  return parts;
}

// ---------- Sound ----------

const silence = (seconds, rate = RATE) => Buffer.alloc(Math.round(seconds * rate) * 2);

/** 16-bit mono PCM from one rate to another, by straight-line interpolation: plenty for speech. */
export function resample(pcm, from, to) {
  if (from === to) return pcm;
  const n = Math.floor(pcm.length / 2);
  const out = Buffer.alloc(Math.floor((n * to) / from) * 2);
  for (let i = 0; i < out.length / 2; i++) {
    const at = (i * from) / to;
    const a = Math.min(n - 1, Math.floor(at));
    const b = Math.min(n - 1, a + 1);
    out.writeInt16LE(Math.round(pcm.readInt16LE(a * 2) * (1 - (at - a)) + pcm.readInt16LE(b * 2) * (at - a)), i * 2);
  }
  return out;
}

/** A WAV file from 16-bit mono PCM. */
export function wavOf(pcm, rate = RATE) {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

/** The sound in a WAV file as { pcm, rate }: 16-bit, folded down to one channel. Throws on anything else. */
export function pcmOfWav(bytes) {
  if (bytes.length < 44 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WAVE') throw new Error('The voice provider did not return a WAV file');
  let fmt = null;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = bytes.toString('latin1', at, at + 4);
    const declared = bytes.readUInt32LE(at + 4);
    // A file that was streamed says its sound is 0xFFFFFFFF long: it runs to the end.
    const size = id === 'data' && (declared === 0xffffffff || at + 8 + declared > bytes.length) ? bytes.length - at - 8 : declared;
    if (id === 'fmt ') fmt = { format: bytes.readUInt16LE(at + 8), channels: bytes.readUInt16LE(at + 10), rate: bytes.readUInt32LE(at + 12), bits: bytes.readUInt16LE(at + 22) };
    if (id === 'data') {
      if (!fmt || (fmt.format !== 1 && fmt.format !== 0xfffe) || fmt.bits !== 16 || !fmt.channels) throw new Error('The voice provider returned sound in a format the app does not read (16-bit PCM WAV is needed)');
      const data = bytes.subarray(at + 8, at + 8 + size - (size % (2 * fmt.channels)));
      if (fmt.channels === 1) return { pcm: Buffer.from(data), rate: fmt.rate };
      const mono = Buffer.alloc(data.length / fmt.channels);
      for (let i = 0; i < mono.length / 2; i++) {
        let sum = 0;
        for (let c = 0; c < fmt.channels; c++) sum += data.readInt16LE((i * fmt.channels + c) * 2);
        mono.writeInt16LE(Math.round(sum / fmt.channels), i * 2);
      }
      return { pcm: mono, rate: fmt.rate };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error('The voice provider returned a WAV file with no sound in it');
}

/** A placeholder for demo mode: a soft tone that rises and falls like syllables, as long as the text would take. */
export function demoPcm(said, lang, speed = 1) {
  const count = lang === 'zh' ? [...said.replace(/[\p{P}\s]/gu, '')].length : said.split(/\s+/).filter(Boolean).length * 1.6;
  const seconds = Math.min(60, Math.max(0.6, count / (4.2 * speed)));
  const pcm = Buffer.alloc(Math.round(seconds * RATE) * 2);
  for (let i = 0; i < pcm.length / 2; i++) {
    const t = i / RATE;
    const syllable = Math.sin(Math.PI * ((t * 4.2 * speed) % 1)) ** 2;
    const edge = Math.min(1, t * 20, (seconds - t) * 20);
    pcm.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 196 * t) * 2600 * syllable * edge), i * 2);
  }
  return pcm;
}

const clampSpeed = (v) => Math.min(MAX_SPEED, Math.max(MIN_SPEED, Number(v) || 1));

async function volc(config, { text: said, voice, speed, lang, signal }) {
  const body = {
    user: { uid: 'video-scripter' },
    req_params: {
      text: said,
      speaker: voice,
      audio_params: { format: 'pcm', sample_rate: RATE, speech_rate: Math.round((speed - 1) * 100) },
      additions: JSON.stringify({ disable_markdown_filter: true, ...(lang === 'zh' && { explicit_language: 'zh-cn' }) }),
    },
  };
  const headers = { 'content-type': 'application/json', 'x-api-app-id': config.appId, 'x-api-access-key': config.apiKey, 'x-api-resource-id': config.model, 'x-api-request-id': randomUUID() };
  const res = await request(config.baseUrl, { method: 'POST', headers, body: JSON.stringify(body), signal }, { timeouts: 1 });
  const chunks = [];
  for (const row of (await res.text()).split('\n')) {
    if (!row.trim()) continue;
    let event;
    try {
      event = JSON.parse(row);
    } catch {
      continue;
    }
    // 0 while the sound arrives, 20000000 when it is done; anything else is the provider's refusal.
    if (event.code && event.code !== 20000000) throw new GatewayError(`The voice provider refused the text (${event.code}): ${String(event.message || '').slice(0, 200)}`, 502);
    if (typeof event.data === 'string' && event.data) chunks.push(Buffer.from(event.data, 'base64'));
  }
  if (!chunks.length) throw new GatewayError('The voice provider returned no sound', 502);
  return { pcm: Buffer.concat(chunks), rate: RATE };
}

async function openai(config, { text: said, voice, speed, signal }) {
  const url = `${apiBase(config.baseUrl).replace(/\/audio\/speech$/, '')}/audio/speech`;
  const body = { model: config.model, voice, input: said, response_format: 'wav', ...(speed !== 1 && { speed }) };
  const res = await request(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify(body), signal }, { timeouts: 1 });
  const bytes = Buffer.from(await res.arrayBuffer());
  try {
    return pcmOfWav(bytes);
  } catch (err) {
    throw new GatewayError(err.message, 502);
  }
}

/**
 * One piece of text as sound: { pcm, rate } in 16-bit mono at RATE. `demo` makes the placeholder tone
 * instead of calling anyone.
 */
export async function synthesize(config, { text: said, voice, speed = 1, lang = 'zh', signal, demo = false }) {
  const pace = clampSpeed(speed);
  if (demo) return { pcm: demoPcm(said, lang, pace), rate: RATE };
  const invalid = validateSpeech(config);
  if (invalid) throw new GatewayError(invalid, 400);
  const made = await (config.provider === 'volc' ? volc : openai)(config, { text: said, voice: voice || config.voice, speed: pace, lang, signal });
  return { pcm: resample(made.pcm, made.rate, RATE), rate: RATE };
}

/**
 * A scene's voiceover as one WAV: { wav, seconds, chars }. Where two people speak, each line is said in
 * that person's voice (`voices.A`, `voices.B`), with a breath between them.
 */
export async function voiceScene(config, voiceover, { voices = {}, speed = 1, lang = 'zh', signal, demo = false } = {}) {
  const parts = spokenParts(voiceover, lang);
  if (!parts.length) return { wav: wavOf(silence(0.4)), seconds: 0.4, chars: 0 };
  const sounds = [];
  for (const [i, part] of parts.entries()) {
    const voice = part.speaker === 'B' ? voices.B || config.voiceB || voices.A || config.voice : voices.A || config.voice;
    if (i) sounds.push(silence(0.22));
    sounds.push((await synthesize(config, { text: part.text, voice, speed, lang, signal, demo })).pcm);
  }
  const pcm = Buffer.concat(sounds);
  return { wav: wavOf(pcm), seconds: pcm.length / 2 / RATE, chars: parts.reduce((n, p) => n + [...p.text].length, 0) };
}
