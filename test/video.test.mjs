// The video of a script: what is spoken, the two voice protocols (against stand-in servers), captions and
// timing, the MP4 writer, and the voice routes end to end in demo mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { speakable, spokenParts, wavOf, pcmOfWav, resample, demoPcm, mergeSpeech, validateSpeech, publicSpeech, synthesize, voiceScene, RATE, SPEECH_PROVIDERS } from '../src/speech.mjs';
import { captionsOf, buildTimeline, mixTrack, withMusic, srtOf, readWav, FRAME_SIZES, FPS } from '../public/film.js';
import { muxMp4, boxes } from '../public/mp4.js';

test('a voiceover is spoken without its marks, and each speaker says their own lines', () => {
  assert.equal(speakable('你买了大模型，[[却没用起来]]。⏸ 为什么？ ⏸'), '你买了大模型，却没用起来。为什么？');
  assert.equal(speakable('先看结果 ⏸ 再看过程'), '先看结果，再看过程'); // a pause mark is a comma where there is no punctuation
  assert.equal(speakable('Look at this ⏸ it [[works]]. ⏸ Really', 'en'), 'Look at this, it works. Really');
  assert.deepEqual(spokenParts('A：第一句。B：数据没有打通！A：那怎么办？AI：不是说话人'), [
    { speaker: 'A', text: '第一句。' },
    { speaker: 'B', text: '数据没有打通！' },
    { speaker: 'A', text: '那怎么办？AI：不是说话人' },
  ]);
  assert.deepEqual(spokenParts('没有标签的一段。'), [{ speaker: '', text: '没有标签的一段。' }]);
  assert.deepEqual(spokenParts(' ⏸ …… '), []);
});

test('sound: WAV in and out, more than one channel, a streamed file, another rate', () => {
  const pcm = demoPcm('你好世界你好', 'zh');
  const back = pcmOfWav(wavOf(pcm));
  assert.deepEqual([back.rate, back.pcm.equals(pcm)], [RATE, true]);
  assert.ok(pcm.length / 2 / RATE > 1 && pcm.length / 2 / RATE < 2); // six characters at about four a second
  assert.ok(demoPcm('你好世界你好', 'zh', 1.5).length < pcm.length);
  // Stereo is folded down; a file whose length was not known when it was sent runs to its end.
  const stereo = Buffer.alloc(44 + 8);
  wavOf(Buffer.alloc(8), 44100).copy(stereo);
  stereo.writeUInt16LE(2, 22);
  stereo.writeUInt32LE(0xffffffff, 40);
  stereo.writeInt16LE(100, 44);
  stereo.writeInt16LE(300, 46);
  const folded = pcmOfWav(stereo);
  assert.deepEqual([folded.rate, folded.pcm.length, folded.pcm.readInt16LE(0)], [44100, 4, 200]);
  assert.throws(() => pcmOfWav(Buffer.from('ID3 this is an mp3')), /WAV/);
  assert.equal(resample(pcm, 24000, 48000).length, pcm.length * 2);
  assert.equal(resample(pcm, 24000, 24000), pcm);
});

test('voice settings: a key stays with its service, and only an administrator sees where it goes', () => {
  const saved = mergeSpeech({ provider: 'volc', apiKey: 'token-123456789', appId: '42', voice: 'zh_female_x' }, null);
  assert.deepEqual([saved.baseUrl, saved.model, saved.voice, validateSpeech(saved)], [SPEECH_PROVIDERS[0].baseUrl, 'seed-tts-2.0', 'zh_female_x', null]);
  assert.equal(mergeSpeech({ provider: 'volc', voice: 'other' }, saved).apiKey, 'token-123456789'); // a blank key keeps the stored one
  assert.equal(mergeSpeech({ provider: 'openai' }, saved).apiKey, ''); // another service: the key is not carried over
  assert.equal(mergeSpeech({ provider: 'volc', baseUrl: 'https://elsewhere.example/tts' }, saved).apiKey, '');
  assert.equal(mergeSpeech({ provider: '' }, saved).provider, '');
  assert.match(validateSpeech({ ...saved, appId: '' }), /APP ID/);
  assert.match(validateSpeech(mergeSpeech({ provider: 'openai' }, null)), /API key/);
  const member = publicSpeech(saved);
  assert.deepEqual([member.ready, member.voice, 'baseUrl' in member, 'keyPreview' in member, JSON.stringify(member).includes('token')], [true, 'zh_female_x', false, false, false]);
  const admin = publicSpeech(saved, { admin: true });
  assert.deepEqual([admin.keyPreview, admin.hasKey, admin.providers.length], ['tok••••6789', true, 2]);
  assert.deepEqual([publicSpeech(mergeSpeech({}, null), { demo: true }).demo, publicSpeech(saved, { demo: true }).demo], [true, false]);
});

test('both voice protocols, against stand-in servers', async (t) => {
  const asked = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    asked.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
    if (req.url === '/volc') {
      const pcm = Buffer.alloc(RATE); // half a second
      const said = JSON.parse(body).req_params.text;
      if (said === 'refuse') return res.end(`${JSON.stringify({ code: 45000000, message: 'speaker not found' })}\n`);
      res.end([{ code: 0, data: pcm.subarray(0, 100).toString('base64') }, { code: 0, data: null, sentence: { text: said, words: [] } }, { code: 0, data: pcm.subarray(100).toString('base64') }, { code: 20000000, message: 'OK', data: null }].map((e) => JSON.stringify(e)).join('\n'));
    } else if (req.url === '/v1/audio/speech') {
      res.writeHead(200, { 'content-type': 'audio/wav' }).end(wavOf(Buffer.alloc(48000 * 2), 48000)); // one second at another rate
    } else res.writeHead(404).end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const volc = { provider: 'volc', baseUrl: `${base}/volc`, apiKey: 'token', appId: '42', model: 'seed-tts-2.0', voice: 'speaker_a', voiceB: 'speaker_b' };
  let made = await synthesize(volc, { text: '你好', speed: 1.2, lang: 'zh' });
  assert.deepEqual([made.rate, made.pcm.length], [RATE, RATE]);
  let last = asked.at(-1);
  assert.deepEqual([last.headers['x-api-app-id'], last.headers['x-api-access-key'], last.headers['x-api-resource-id']], ['42', 'token', 'seed-tts-2.0']);
  assert.deepEqual([last.body.req_params.speaker, last.body.req_params.audio_params.speech_rate, last.body.req_params.audio_params.sample_rate], ['speaker_a', 20, RATE]);
  await assert.rejects(synthesize(volc, { text: 'refuse' }), /speaker not found/);
  await assert.rejects(synthesize({ ...volc, apiKey: '' }, { text: '你好' }), /API key/);

  // A conversation: each line in its speaker's voice, a breath between them.
  const scene = await voiceScene(volc, 'A：你好。B：你好！', { voices: { A: '', B: '' } });
  assert.deepEqual(asked.slice(-2).map((a) => [a.body.req_params.speaker, a.body.req_params.text]), [['speaker_a', '你好。'], ['speaker_b', '你好！']]);
  assert.ok(Math.abs(scene.seconds - 1.22) < 0.01 && scene.chars === 6 && pcmOfWav(scene.wav).rate === RATE);

  const openai = { provider: 'openai', baseUrl: base, apiKey: 'sk-test', model: 'tts-1', voice: 'alloy' };
  made = await synthesize(openai, { text: 'Hello', voice: 'nova', speed: 3, lang: 'en' });
  last = asked.at(-1);
  assert.deepEqual([last.url, last.headers.authorization, last.body], ['/v1/audio/speech', 'Bearer sk-test', { model: 'tts-1', voice: 'nova', input: 'Hello', response_format: 'wav', speed: 1.6 }]); // a bare host is called under /v1; the speed is kept in range
  assert.equal(made.pcm.length / 2 / RATE, 1); // brought to the rate the app keeps
});

test('captions: short lines cut at punctuation and pauses, stress kept, weighted by what is said', () => {
  const zh = captionsOf('你买了大模型，[[却没用起来]]。⏸ 为什么？因为业务本体没有建起来，数据也没有打通，所以模型只能回答一些泛泛的问题。', 'zh');
  assert.deepEqual(zh.map((c) => c.text), ['你买了大模型，**却没用起来**', '为什么？', '因为业务本体没有建起来', '数据也没有打通', '所以模型只能回答一些泛泛的问题']);
  assert.ok(zh.every((c) => [...c.text.replace(/\*\*/g, '')].length <= 20));
  assert.ok(zh[0].weight > zh[1].weight);
  assert.deepEqual(captionsOf('A：这是第一句。B：这是第二句！', 'zh').map((c) => c.text), ['这是第一句', '这是第二句！']); // nobody reads the speaker labels
  const en = captionsOf('Most teams buy the model first. Then nothing happens, because nobody mapped the work it was meant to do.', 'en');
  assert.deepEqual(en.map((c) => c.text), ['Most teams buy the model first', 'Then nothing happens', 'because nobody mapped the work it was meant to do']); // a little over the line is left whole: the frame wraps it
  assert.deepEqual(captionsOf('', 'zh'), []);
});

test('the timeline is cut to the voice: a scene lasts as long as its sound', () => {
  const scenes = [
    { id: 1, start: 0, end: 4, voiceover: '第一句话。第二句话更长一些。', onScreenText: '开场' },
    { id: 2, start: 4, end: 9, voiceover: '没有配音的场景。', onScreenText: '' },
  ];
  const tl = buildTimeline(scenes, { 1: { seconds: 3 } }, 'zh');
  assert.deepEqual([tl.scenes[0].start, tl.scenes[0].audioAt, tl.scenes[0].headline], [0, 0.25, '开场']);
  assert.ok(Math.abs(tl.scenes[0].end - 3.47) < 1e-9 && tl.scenes[1].start === tl.scenes[0].end);
  assert.ok(Math.abs(tl.duration - (3.47 + 5 + 0.7)) < 1e-9); // a scene with no sound keeps the script's length
  const [a, b] = tl.scenes[0].captions;
  assert.ok(a.start === 0.25 && Math.abs(a.end - b.start) < 1e-9 && Math.abs(b.end - 3.25) < 1e-9 && b.end - b.start > a.end - a.start);
  assert.deepEqual(buildTimeline([], {}, 'zh'), { duration: 0, scenes: [] });
  assert.deepEqual([FRAME_SIZES['9:16'], FPS], [{ w: 1080, h: 1920 }, 30]);

  // The sound goes where the timeline says, at the rate the file is encoded in.
  const wav = wavOf(Buffer.from(new Int16Array(RATE).fill(16384).buffer));
  const clip = readWav(wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.length));
  assert.deepEqual([clip.rate, clip.samples.length], [RATE, RATE]);
  const track = mixTrack(tl, new Map([[1, clip]]), 48000);
  assert.equal(track.length, Math.ceil(tl.duration * 48000));
  assert.deepEqual([track[0], track[0.25 * 48000 + 10], track[1.25 * 48000 + 10]], [0, 0.5, 0]);

  // The captions as a subtitle file: numbered, timed, without the stress marks.
  const srt = srtOf(buildTimeline([{ id: 1, voiceover: '第一句[[重点]]。第二句话更长一些。' }], { 1: { seconds: 3 } }, 'zh'));
  assert.match(srt, /^1\n00:00:00,250 --> 00:00:0\d,\d{3}\n第一句重点\n\n2\n00:00:0\d,\d{3} --> 00:00:03,250\n第二句话更长一些\n$/);

  // Music goes under the voice: quieter while someone speaks, back up in the gaps, silent at both ends.
  const rate = 48000;
  const speech = new Float32Array(rate * 6);
  speech.fill(0.5, rate * 2, rate * 4); // someone speaks from 2 s to 4 s
  const bed = { left: new Float32Array(rate).fill(1), right: new Float32Array(rate).fill(-1) }; // one second of music, so it has to loop
  const mixed = withMusic(speech, bed, { level: 1, rate });
  const music = (at) => mixed.left[Math.round(at * rate)] - speech[Math.round(at * rate)];
  assert.ok(Math.abs(music(1.2) - 0.32) < 0.01, `between the words: ${music(1.2)}`);
  assert.ok(Math.abs(music(3.5) - 0.128) < 0.01, `under the voice: ${music(3.5)}`);
  assert.ok(music(1.95) < 0.3 && music(4.38) > 0.2 && music(4.38) < 0.3, 'it steps back just before the word and comes back, slowly, after it');
  assert.ok(music(0.01) < 0.02 && Math.abs(music(5.99)) < 0.02);
  assert.ok(mixed.right[Math.round(1.2 * rate)] < 0); // left and right stay apart
  const dry = withMusic(speech, null);
  assert.deepEqual([dry.left[rate * 3], dry.right[rate * 3], dry.left[rate]], [0.5, 0.5, 0]);
});

test('the MP4 writer: the index comes first and points at every sample', () => {
  const frame = (n, fill) => new Uint8Array(n).fill(fill);
  const video = { width: 1080, height: 1920, fps: 30, config: Uint8Array.of(1, 100, 0, 40, 255, 225, 0, 0, 1, 0, 0), samples: Array.from({ length: 45 }, (_, i) => ({ data: frame(50 + i, 1 + (i % 200)), key: i % 30 === 0 })) };
  const audio = { sampleRate: 48000, channels: 2, config: Uint8Array.of(0x11, 0x90), samples: Array.from({ length: 71 }, (_, i) => ({ data: frame(20 + (i % 5), 201 + (i % 50)) })) };
  const file = muxMp4({ video, audio });
  const top = boxes(file);
  assert.deepEqual(top.map((b) => b.type), ['ftyp', 'moov', 'mdat']);
  assert.equal(top.reduce((n, b) => n + b.size, 0), file.length);
  const moov = boxes(top[1].data);
  assert.deepEqual(moov.map((b) => b.type), ['mvhd', 'trak', 'trak']);
  const view = (b) => new DataView(b.data.buffer, b.data.byteOffset, b.data.byteLength);
  assert.deepEqual([view(moov[0]).getUint32(12), view(moov[0]).getUint32(16)], [1000, 1515]); // 71 AAC frames outlast 45 pictures: 71 × 1024 / 48000 s
  const dig = (b, ...types) => types.reduce((cur, type) => boxes(cur.data).find((x) => x.type === type), b);
  for (const [trak, samples, kind] of [[moov[1], video.samples, 'vide'], [moov[2], audio.samples, 'soun']]) {
    const stbl = dig(trak, 'mdia', 'minf', 'stbl');
    assert.equal(String.fromCharCode(...dig(trak, 'mdia', 'hdlr').data.subarray(8, 12)), kind);
    const table = (type) => view(boxes(stbl.data).find((b) => b.type === type));
    const stsz = table('stsz');
    assert.equal(stsz.getUint32(8), samples.length);
    // Walk the chunks as a player does: every sample is where the index says, byte for byte.
    const stco = table('stco');
    const stsc = table('stsc');
    const perChunk = (chunk) => {
      let count = 0;
      for (let i = 0; i < stsc.getUint32(4); i++) if (stsc.getUint32(8 + i * 12) <= chunk) count = stsc.getUint32(12 + i * 12);
      return count;
    };
    let n = 0;
    for (let c = 0; c < stco.getUint32(4); c++) {
      let at = stco.getUint32(8 + c * 4);
      for (let k = 0; k < perChunk(c + 1); k++, n++) {
        const size = stsz.getUint32(12 + n * 4);
        assert.deepEqual([size, file[at], file[at + size - 1]], [samples[n].data.length, samples[n].data[0], samples[n].data[0]], `${kind} sample ${n}`);
        at += size;
      }
    }
    assert.equal(n, samples.length);
    if (kind === 'vide') assert.deepEqual([table('stss').getUint32(4), table('stss').getUint32(8), table('stss').getUint32(12)], [2, 1, 31]);
  }
  assert.deepEqual(boxes(muxMp4({ video })).map((b) => b.type), ['ftyp', 'moov', 'mdat']); // a silent film is a film too
});

test('voicing over HTTP in demo mode: scene by scene, kept with the script, only for its owner', async (t) => {
  const PORT = 4100 + Math.floor(Math.random() * 90);
  const base = `http://127.0.0.1:${PORT}`;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scripter-voice-'));
  const env = { ...process.env, PORT: String(PORT), DATA_DIR: dir, GATEWAY_CONFIG_FILE: path.join(dir, 'none.json'), DATABASE_URL: '', POSTGRES_URL: '', LLM_PROVIDER: '', API_KEY: '', LLM_API_KEY: '', SPEECH_PROVIDER: '', ADMIN_EMAIL: 'boss@example.test', ADMIN_PASSWORD: 'correct-horse-battery', ALLOW_SIGNUP: '' };
  const child = spawn(process.execPath, ['server.mjs'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(async () => {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise((resolve) => child.stdout.once('data', resolve));
  const client = () => {
    let cookie = '';
    const raw = async (method, url, body) => {
      const res = await fetch(base + url, { method, headers: { ...(body && { 'content-type': 'application/json' }), ...(cookie && { cookie }) }, body: body && JSON.stringify(body) });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return res;
    };
    const call = async (method, url, body) => {
      const res = await raw(method, url, body);
      return { status: res.status, body: await res.json() };
    };
    return { raw, call };
  };
  const ann = client();
  await ann.call('POST', '/api/auth/signup', { email: 'ann@example.test', password: 'ann-password-1' });
  const admin = client();
  await admin.call('POST', '/api/auth/login', { email: 'boss@example.test', password: 'correct-horse-battery' });

  // No voice provider: demo mode says so, and only an administrator may connect one.
  let r = await ann.call('GET', '/api/speech/config');
  assert.deepEqual([r.status, r.body.ready, r.body.demo, 'providers' in r.body], [200, false, true, false]);
  assert.equal((await ann.call('PUT', '/api/speech/config', { provider: 'openai', apiKey: 'x' })).status, 403);
  assert.equal((await admin.call('GET', '/api/speech/config')).body.providers.length, 2);
  assert.equal((await admin.call('PUT', '/api/speech/config', { provider: 'volc', apiKey: 'token' })).status, 400); // no APP ID
  r = await admin.call('PUT', '/api/speech/config', { provider: 'volc', apiKey: 'token-123456789', appId: '42' });
  assert.deepEqual([r.status, r.body.ready, r.body.keyPreview], [200, true, 'tok••••6789']);
  assert.deepEqual([(await ann.call('GET', '/api/speech/config')).body.ready, JSON.stringify((await ann.call('GET', '/api/speech/config')).body).includes('tok')], [true, false]);
  r = await admin.call('PUT', '/api/speech/config', { provider: '' }); // disconnected again: back to the demo tone
  assert.deepEqual([r.body.ready, r.body.provider], [false, '']);

  const text = await (await ann.raw('POST', '/api/generate', { platformId: 'douyin', topic: '企业 AI 落地', duration: 30 })).text();
  const id = JSON.parse(/^event: done\ndata: (.*)$/m.exec(text)[1]).historyId;
  const script = (await ann.call('GET', '/api/history')).body.find((e) => e.id === id).script;
  r = await ann.call('POST', '/api/voice/scene', { historyId: id, sceneId: script.scenes[0].id, speed: 1.2 });
  assert.deepEqual([r.status, r.body.sceneId, r.body.demo, r.body.seconds > 0.5], [200, script.scenes[0].id, true, true]);
  const wav = Buffer.from(await (await ann.raw('GET', r.body.url)).arrayBuffer());
  const sound = pcmOfWav(wav);
  assert.deepEqual([sound.rate, Math.abs(sound.pcm.length / 2 / RATE - r.body.seconds) < 0.001], [RATE, true]);
  // A line read differently than it is written: what is said is kept with the recording.
  r = await ann.call('POST', '/api/voice/scene', { historyId: id, sceneId: script.scenes[1].id, text: '一句很长很长很长很长很长很长很长很长很长很长的话', done: true });
  assert.ok(r.body.seconds > 4);
  const kept = (await ann.call('GET', '/api/history')).body.find((e) => e.id === id).voice;
  assert.deepEqual([kept.scenes[script.scenes[1].id].say, 'say' in kept.scenes[script.scenes[0].id]], ['一句很长很长很长很长很长很长很长很长很长很长的话', false]);
  // The recordings go into the download package, beside the script.
  const zip = Buffer.from(await (await ann.raw('POST', '/api/history/package', { id, markdown: '# x' })).arrayBuffer());
  assert.ok(zip.includes(Buffer.from('/audio/scene-01_')) && zip.includes(Buffer.from('/audio/scene-02_')) && !zip.includes(Buffer.from('/audio/scene-03_')));
  assert.deepEqual([Object.keys(kept.scenes).length, kept.speed, kept.scenes[script.scenes[0].id].seconds > 0.5, /-voice-\w+\.wav$/.test(kept.scenes[script.scenes[1].id].name)], [2, 1, true, true]);

  assert.equal((await ann.call('POST', '/api/voice/scene', { historyId: id, sceneId: 999 })).status, 404);
  const bob = client();
  await bob.call('POST', '/api/auth/signup', { email: 'bob@example.test', password: 'bob-password-1' });
  assert.equal((await bob.call('POST', '/api/voice/scene', { historyId: id, sceneId: script.scenes[0].id })).status, 404);
  assert.equal((await bob.raw('GET', `/api/voice/file?id=${id}&name=${kept.scenes[script.scenes[0].id].name}`)).status, 404);
  assert.equal((await ann.raw('GET', `/api/voice/file?id=${id}&name=config.json`)).status, 404);
  const acts = (await ann.call('GET', '/api/activity')).body;
  assert.equal((acts.items || acts).filter((a) => a.type === 'voice.generate').length, 1);
});
