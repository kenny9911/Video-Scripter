// The video of a script: its voiceover spoken scene by scene (the server asks the voice provider,
// src/speech.mjs), then every frame drawn and the file encoded here in the browser (film.js). Nothing is
// rendered on the server and no file is uploaded: the MP4 is made on this device and is yours to download or
// to share into a platform's app.
//
//   wireVideo(...)  ->  { view(platformId, run, { aspect, lang }) }
//
// A run keeps its voice as run.voice = { voice, voiceB, speed, scenes: { [sceneId]: { url, seconds, say } } };
// `say` is how the creator had a line read where the script's own words came out wrong.

import { t, lang as uiLang } from './i18n.js';
import { icon } from './icons.js';
import { el, call } from './account.js';
import { THEMES, themeOf, drawCard, canvasBlob } from './cards.js';
import { FRAME_SIZES, buildTimeline, drawFrame, cue, srtOf, readWav, renderFilm } from './film.js';
import { BEDS, bedOf, decodeMusic } from './music.js';

const btn = (name, label, attrs = {}) => el('button', { class: 'btn', type: 'button', ...attrs }, icon(name, 16), el('span', {}, label));
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const slug = (s) => String(s || '').normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'video';
const WHY_NOT = {
  'no-webcodecs': 'This browser cannot make the video file. Use a current Chrome, Edge or Safari.',
  'no-h264': 'This browser cannot encode H.264 video at this size. Use a current Chrome, Edge or Safari.',
  'no-aac': 'This browser cannot encode AAC sound. Use a current Chrome, Edge or Safari.',
};

// Pictures and recordings are fetched once and kept: scrubbing the preview and making the file use the same ones.
const pictures = new Map();
const picture = (url) => {
  if (!pictures.has(url))
    pictures.set(
      url,
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      }),
    );
  return pictures.get(url);
};
const recordings = new Map();
const recording = (url) => {
  if (!recordings.has(url)) recordings.set(url, fetch(url).then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`HTTP ${res.status}`)))).then(readWav));
  return recordings.get(url).catch((err) => (recordings.delete(url), Promise.reject(err)));
};

/** Whether this browser can hand a file to another app (a phone's share sheet). */
const canShare = (file) => {
  try {
    return Boolean(navigator.canShare?.({ files: [file] }));
  } catch {
    return false;
  }
};

// A scene's clip is a <video> that is never played: it is moved to the frame each moment of the video needs.
const movies = new Map();
const movie = (url) => {
  if (!movies.has(url))
    movies.set(
      url,
      new Promise((resolve) => {
        const video = document.createElement('video');
        Object.assign(video, { muted: true, playsInline: true, preload: 'auto' });
        const done = (ok) => (clearTimeout(timer), resolve(ok ? video : null));
        const timer = setTimeout(() => done(false), 15000);
        video.addEventListener('loadeddata', () => done(true), { once: true });
        video.addEventListener('error', () => done(false), { once: true });
        video.src = url;
      }),
    );
  return movies.get(url);
};
let player = null; // one recording plays at a time
const play = (url) => {
  player ??= new Audio();
  player.src = url;
  player.play().catch(() => {});
};

/** A scene's clip, if it has one this browser can show a frame of. */
const clipOf = (run, sc) => (run.media?.[sc.id]?.video?.urls || []).find((url) => /^\/media\/[\w-]+\.(?:mp4|webm|mov)$/.test(url)) || '';

/** A scene's first still picture, if it has one the frame can be drawn from. */
const stillOf = (run, sc) => (run.media?.[sc.id]?.image?.urls || []).find((url) => /^\/media\/[\w-]+\.(?:png|jpe?g|webp)$/.test(url)) || '';

/**
 * `toast(message)` is the app's own; `platformOf(id)` gives a platform; `isAdmin()` says whether the person
 * may change the voice provider; `publish` is the panel that sends the video out (publish.js), where there is
 * one; `changed(run)` hears when a run's voice was made.
 */
export function wireVideo({ toast, platformOf, isAdmin, publish = null, changed = () => {} }) {
  let speech = null; // the voice provider as this person may see it; asked for once, and again after it is changed
  const loadSpeech = async (again = false) => (speech && !again ? speech : (speech = await call('/api/speech/config').catch(() => ({ ready: false, demo: false, voices: [], speed: { min: 0.7, max: 1.6 } }))));

  /** The administrator's dialog: which service speaks, with which key and which voice. */
  function settings(done) {
    const dlg = el('dialog', { class: 'dialog' });
    const state = { ...speech, apiKey: '' };
    const status = el('p', { class: 'hint', role: 'status' });
    const body = el('div', { class: 'dialog-body' });
    const field = (label, node, hint) => el('label', { class: 'field' }, el('span', {}, label), node, hint && el('span', { class: 'hint' }, hint));
    const input = (key, attrs = {}) => el('input', { type: 'text', value: state[key] || '', oninput: (e) => (state[key] = e.target.value), ...attrs });
    const payload = () => ({ provider: state.provider, baseUrl: state.baseUrl, apiKey: state.apiKey, appId: state.appId, model: state.model, voice: state.voice, voiceB: state.voiceB });
    const paint = () => {
      const preset = speech.providers.find((p) => p.id === state.provider);
      body.replaceChildren(
        field(
          t('Voice provider'),
          el(
            'select',
            {
              onchange: (e) => {
                const next = speech.providers.find((p) => p.id === e.target.value);
                Object.assign(state, { provider: next?.id || '', baseUrl: next?.baseUrl || '', model: next?.model || '', voice: next?.voice || '', voiceB: '', appId: '', apiKey: '' });
                paint();
              },
            },
            el('option', { value: '', selected: !preset }, t('None: videos cannot be voiced')),
            speech.providers.map((p) => el('option', { value: p.id, selected: p.id === state.provider }, t(p.label))),
          ),
          preset && t(preset.hint),
        ),
        ...(preset ? [
          field('BASE_URL_API', input('baseUrl', { type: 'url' })),
          preset.needsAppId && field('APP ID', input('appId', { autocomplete: 'off' })),
          field(preset.needsAppId ? 'Access Token' : preset.keyOptional ? t('API_KEY (optional)') : 'API_KEY', input('apiKey', { type: 'password', autocomplete: 'off', placeholder: state.hasKey && state.provider === speech.provider ? `${speech.keyPreview} ${t('(saved)')}` : '' })),
          field(preset.needsAppId ? 'Resource ID' : t('Model'), input('model')),
          field(preset.id === 'elevenlabs' ? t('Voice ID') : t('Voice'), input('voice', { list: 'speechVoices' }), t('The voice a script is read in unless another is picked for it.')),
          field(t('Second voice'), input('voiceB', { list: 'speechVoices' }), t('For the guest in a two-host conversation. Blank: the same voice.')),
          el('datalist', { id: 'speechVoices' }, preset.voices.map((v) => el('option', { value: v }))),
        ] : []).filter(Boolean),
      );
    };
    const run = async (button, work) => {
      button.disabled = true;
      status.textContent = '';
      try {
        await work();
      } catch (err) {
        status.textContent = err.message;
      }
      button.disabled = false;
    };
    dlg.append(
      el(
        'div',
        { class: 'dialog-shell' },
        el('header', { class: 'dialog-head' }, el('h2', {}, t('Voice settings')), el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Close'), onclick: () => dlg.close() }, icon('x'))),
        body,
        el(
          'footer',
          { class: 'dialog-foot' },
          status,
          el(
            'div',
            { class: 'dialog-actions' },
            btn('mic', t('Hear it'), {
              onclick: (e) =>
                run(e.currentTarget, async () => {
                  const { audio, seconds } = await call('/api/speech/test', { method: 'POST', body: { ...payload(), lang: uiLang } });
                  status.textContent = t('Playing {n} seconds in this voice.', { n: seconds.toFixed(1) });
                  await new Audio(audio).play();
                }),
            }),
            el('span', { class: 'spacer' }),
            el('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, t('Cancel')),
            el(
              'button',
              {
                class: 'btn primary',
                type: 'button',
                onclick: (e) =>
                  run(e.currentTarget, async () => {
                    speech = { ...speech, ...(await call('/api/speech/config', { method: 'PUT', body: payload() })) };
                    dlg.close();
                    toast(t('Voice settings saved'));
                    done();
                  }),
              },
              t('Save'),
            ),
          ),
        ),
      ),
    );
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('click', (e) => e.target === dlg && dlg.close());
    paint();
    document.body.append(dlg);
    dlg.showModal();
  }

  function view(platformId, run, { aspect, lang }) {
    const platform = platformOf(platformId);
    const scenes = run.script.scenes;
    const size = FRAME_SIZES[aspect] || FRAME_SIZES['9:16'];
    const twoVoices = scenes.some((sc) => /(^|[\s。！？!?.…])B[:：]/.test(sc.voiceover));
    const ui = (run.videoUi ??= { busy: '', at: 0, error: '', theme: 'ink', captions: true, label: true, voice: '', voiceB: '', speed: 1, t: 0, url: '', blob: null, stop: null, music: 'none', musicLevel: 0.5, tune: null, open: false });
    const voice = (run.voice ??= { scenes: {} });
    voice.scenes ??= {};
    // How the creator wants a line read, by scene: kept apart from the recordings so voicing everything again keeps it.
    ui.says ??= Object.fromEntries(Object.entries(voice.scenes).flatMap(([id, v]) => (v.say ? [[id, v.say]] : [])));
    const root = el('div', { class: 'post film' });
    const voiced = () => scenes.filter((sc) => voice.scenes[sc.id]).length;
    const forget = () => (ui.url && URL.revokeObjectURL(ui.url), (ui.url = ''), (ui.blob = null)); // the file no longer matches what is on screen
    const stem = `${platformId}-${slug(run.script.title)}`;
    const save = (name, blob) => {
      const url = URL.createObjectURL(blob);
      el('a', { href: url, download: name }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(t('Downloaded {name}', { name }));
    };

    /** Voice every scene from `from` on, or `only` one scene again. */
    async function speak(from = 0, only = -1) {
      ui.busy = 'voice';
      ui.error = '';
      forget();
      if (only < 0 && !from) voice.scenes = {};
      try {
        for (const i of only >= 0 ? [only] : scenes.map((_, n) => n).slice(from)) {
          ui.at = i;
          paint();
          const sc = scenes[i];
          const made = await call('/api/voice/scene', { method: 'POST', body: { historyId: run.historyId, sceneId: sc.id, voice: ui.voice, voiceB: ui.voiceB, speed: ui.speed, text: ui.says[sc.id] || '', done: only < 0 && i === scenes.length - 1 } });
          voice.scenes[sc.id] = { url: made.url, seconds: made.seconds, say: ui.says[sc.id] || '' };
        }
        if (only < 0) Object.assign(voice, { voice: ui.voice, voiceB: ui.voiceB, speed: ui.speed });
        changed(run);
      } catch (err) {
        ui.error = t('Scene {n} could not be voiced: {error}', { n: ui.at + 1, error: err.message });
        ui.resume = only < 0 ? ui.at : 0;
      }
      ui.busy = '';
      paint();
    }

    function paint() {
      if (!speech) {
        root.replaceChildren(el('p', { class: 'hint' }, t('Loading…')));
        return loadSpeech().then(paint);
      }
      ui.voice ||= voice.voice || speech.voice || '';
      ui.voiceB ||= voice.voiceB || speech.voiceB || '';
      if (voice.speed && !ui.touched) ui.speed = voice.speed;
      const busy = Boolean(ui.busy);
      const canSpeak = speech.ready || speech.demo;
      const done = voiced();
      const complete = done === scenes.length && done > 0;
      const timeline = buildTimeline(scenes, voice.scenes, lang);
      const film = { size, theme: themeOf(ui.theme), timeline, images: new Map(), clips: new Map(), captions: ui.captions, label: ui.label ? (/^zh\b/i.test(lang) ? 'AI生成' : 'AI-generated') : '', layouts: new Map() };
      ui.t = Math.min(ui.t, timeline.duration);

      // ---- The preview: the frame at the second the slider is on ----
      const canvas = el('canvas', { class: 'film-canvas', width: size.w, height: size.h, role: 'img', 'aria-label': t('Preview of the video'), style: `aspect-ratio:${size.w}/${size.h}` });
      const ctx = canvas.getContext('2d', { alpha: false });
      const stamp = el('span', { class: 'count' });
      let turn = 0;
      const show = () => {
        const mine = ++turn;
        stamp.textContent = `${clock(ui.t)} / ${clock(timeline.duration)}`;
        cue(film, ui.t).then(() => mine === turn && drawFrame(ctx, ui.t, film)); // a clip is brought to its frame first
      };
      const arrived = (map, sc) => (media) => media && canvas.isConnected && (map.set(sc.id, media), film.layouts.clear(), show());
      for (const sc of scenes) {
        if (clipOf(run, sc)) movie(clipOf(run, sc)).then(arrived(film.clips, sc));
        if (stillOf(run, sc)) picture(stillOf(run, sc)).then(arrived(film.images, sc));
      }
      const slider = el('input', { type: 'range', class: 'film-scrub', min: 0, max: timeline.duration.toFixed(2), step: 0.05, value: ui.t, disabled: ui.busy === 'film', 'aria-label': t('Position in the video'), oninput: (e) => ((ui.t = Number(e.target.value)), show()) });

      // ---- Making the file ----
      async function make() {
        ui.busy = 'film';
        ui.error = '';
        ui.progress = 0;
        forget();
        const abort = new AbortController();
        ui.stop = () => abort.abort();
        paint();
        try {
          const sounds = new Map(await Promise.all(scenes.map(async (sc) => [sc.id, await recording(voice.scenes[sc.id].url)])));
          const images = new Map();
          const clips = new Map();
          for (const sc of scenes) {
            const clip = clipOf(run, sc) && (await movie(clipOf(run, sc)));
            const img = !clip && stillOf(run, sc) && (await picture(stillOf(run, sc)));
            if (clip) clips.set(sc.id, clip);
            else if (img) images.set(sc.id, img);
          }
          const tune = ui.music === 'file' ? ui.tune?.data : ui.music !== 'none' ? await bedOf(ui.music, timeline.duration) : null;
          const blob = await renderFilm({ ...film, images, clips, layouts: new Map() }, sounds, { signal: abort.signal, music: tune && { ...tune, level: ui.musicLevel }, onProgress: (p) => ((ui.progress = p), ui.bar && (ui.bar.style.width = `${Math.round(p * 100)}%`)) });
          ui.blob = blob;
          ui.url = URL.createObjectURL(blob);
        } catch (err) {
          if (err.name !== 'AbortError') ui.error = WHY_NOT[err.reason] ? t(WHY_NOT[err.reason]) : t('The video could not be made: {error}', { error: err.message });
        }
        ui.busy = '';
        ui.stop = null;
        paint();
      }
      const file = () => new File([ui.blob], `${stem}.mp4`, { type: 'video/mp4' });
      const sharing = Boolean(ui.blob) && canShare(file());
      const share = () => navigator.share({ files: [file()] }).catch((err) => err.name === 'AbortError' || toast(t('Sharing did not work here: download the video instead.')));
      // The cover a platform asks for beside the video: the cover text over the first picture, in the same theme.
      const cover = async () => {
        const first = scenes.find((sc) => stillOf(run, sc));
        const image = first ? await picture(stillOf(run, first)) : null;
        const c = document.createElement('canvas');
        drawCard(c, { kind: 'cover', kicker: '', title: run.script.publish?.coverText || run.script.title, body: '', bullets: [] }, { theme: themeOf(ui.theme), size, total: 1, image });
        save(`${stem}-cover.png`, await canvasBlob(c));
      };

      // ---- The voice ----
      const voiceField = (key, label) =>
        el('label', { class: 'pfield' }, el('span', {}, label), el('input', { type: 'text', list: 'filmVoices', value: ui[key], disabled: !speech.ready || busy, placeholder: speech.ready ? '' : t('Placeholder tone'), oninput: (e) => (ui[key] = e.target.value.trim()) }));
      const speedLabel = el('span', {}, `${t('Speed')} ${ui.speed.toFixed(2)}×`);
      const voiceBox = el(
        'div',
        { class: 'post-look' },
        voiceField('voice', twoVoices ? t('Voice of A') : t('Voice')),
        twoVoices && voiceField('voiceB', t('Voice of B')),
        el('datalist', { id: 'filmVoices' }, (speech.voices || []).map((v) => el('option', { value: v }))),
        el('label', { class: 'pfield' }, speedLabel, el('input', { type: 'range', min: 0.8, max: 1.4, step: 0.05, value: ui.speed, disabled: busy, oninput: (e) => ((ui.speed = Number(e.target.value)), (ui.touched = true), (speedLabel.textContent = `${t('Speed')} ${ui.speed.toFixed(2)}×`)) })),
        el(
          'div',
          { class: 'actions' },
          el(
            'button',
            { class: `btn ${complete ? '' : 'primary'}${ui.busy === 'voice' ? ' busy' : ''}`, type: 'button', disabled: !canSpeak || busy, onclick: () => speak(0) },
            icon(ui.busy === 'voice' ? 'refresh' : 'mic', 16),
            el('span', {}, ui.busy === 'voice' ? t('Voicing scene {n} of {total}…', { n: ui.at + 1, total: scenes.length }) : complete ? t('Voice it again') : t('Voice the script')),
          ),
          !busy && ui.error && ui.resume > 0 && done < scenes.length && btn('refresh', t('Carry on from scene {n}', { n: ui.resume + 1 }), { onclick: () => speak(ui.resume) }),
          isAdmin() && btn('settings', t('Voice settings'), { disabled: busy, onclick: () => settings(() => loadSpeech(true).then(paint)) }),
        ),
      );
      // Scene by scene: hear each line, and have one read differently without voicing the rest again.
      const sceneList =
        done > 0 &&
        el(
          'details',
          { class: 'film-scenes', open: ui.open, ontoggle: (e) => (ui.open = e.target.open) },
          el('summary', {}, t('Listen scene by scene, and fix how a line is read')),
          el('p', { class: 'hint' }, t('Where a name or a number comes out wrong, write the line the way it should be said and voice that scene again. The captions keep the script’s own words.')),
          scenes.map((sc, i) => {
            const made = voice.scenes[sc.id];
            return el(
              'div',
              { class: 'film-scene' },
              el('b', {}, String(i + 1).padStart(2, '0')),
              el('button', { class: 'icon-btn small', type: 'button', title: t('Play'), 'aria-label': t('Play scene {n}', { n: i + 1 }), disabled: !made, onclick: () => play(made.url) }, icon('logo', 14)),
              el('span', { class: 'count' }, made ? `${made.seconds.toFixed(1)}s` : '—'),
              el('input', { type: 'text', maxlength: 600, value: ui.says[sc.id] || '', placeholder: sc.voiceover.replace(/\[\[|\]\]/g, '').replace(/\s*⏸\s*/g, ' '), 'aria-label': t('How scene {n} is read', { n: i + 1 }), disabled: busy, oninput: (e) => (e.target.value.trim() ? (ui.says[sc.id] = e.target.value.trim()) : delete ui.says[sc.id]) }),
              el('button', { class: 'icon-btn small', type: 'button', title: t('Voice this scene again'), 'aria-label': t('Voice scene {n} again', { n: i + 1 }), disabled: !canSpeak || busy, onclick: () => speak(0, i) }, icon('refresh', 14)),
            );
          }),
        );

      // ---- Music under the voice ----
      const picker = el('input', {
        type: 'file',
        accept: 'audio/*',
        hidden: true,
        onchange: async (e) => {
          const chosen = e.target.files[0];
          if (!chosen) return;
          try {
            ui.tune = { name: chosen.name, data: await decodeMusic(await chosen.arrayBuffer()) };
            ui.music = 'file';
            forget();
          } catch {
            toast(t('This browser could not read that audio file.'));
          }
          paint();
        },
      });
      const levelLabel = el('span', {}, `${t('Music level')} ${Math.round(ui.musicLevel * 100)}%`);
      const musicBox = [
        el(
          'label',
          { class: 'pfield' },
          el('span', {}, t('Music under the voice')),
          el(
            'select',
            { disabled: busy, onchange: (e) => (e.target.value === 'pick' ? picker.click() : ((ui.music = e.target.value), forget(), paint())) },
            el('option', { value: 'none', selected: ui.music === 'none' }, t('No music')),
            BEDS.map((b) => el('option', { value: b.id, selected: ui.music === b.id }, b.name[uiLang] || b.name.en)),
            ui.tune && el('option', { value: 'file', selected: ui.music === 'file' }, ui.tune.name),
            el('option', { value: 'pick' }, t('Your own audio file…')),
          ),
          picker,
        ),
        ui.music !== 'none' && el('label', { class: 'pfield' }, levelLabel, el('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: ui.musicLevel, disabled: busy, oninput: (e) => ((ui.musicLevel = Number(e.target.value)), (levelLabel.textContent = `${t('Music level')} ${Math.round(ui.musicLevel * 100)}%`)), onchange: forget })),
        ui.music !== 'none' && el('p', { class: 'hint' }, t('The music is mixed in on this device and steps back while the voice speaks. Use only music you have the right to publish.')),
      ];

      const media = scenes.reduce((n, sc) => ({ clips: n.clips + (clipOf(run, sc) ? 1 : 0), stills: n.stills + (!clipOf(run, sc) && stillOf(run, sc) ? 1 : 0) }), { clips: 0, stills: 0 });
      const meta = [platform.name, `${aspect} · ${size.w}×${size.h}`, t('{n} scenes', { n: scenes.length }), complete && clock(timeline.duration), complete && voice.voice].filter(Boolean);
      root.replaceChildren(
        el(
          'div',
          { class: 'script-head' },
          el('div', {}, el('h2', {}, run.script.title), el('div', { class: 'meta' }, meta.map((m) => el('span', {}, m)))),
          ui.error && el('p', { class: 'error', role: 'alert' }, ui.error),
        ),
        el(
          'div',
          { class: 'section' },
          el('div', { class: 'section-head' }, el('h3', {}, t('1 · Voice')), complete && el('span', { class: 'hint' }, t('{n} scenes voiced, {time} in all', { n: done, time: clock(timeline.duration) }))),
          !speech.ready && el('p', { class: `finding ${speech.demo ? 'warn' : 'error'}` }, icon('info', 16), el('span', {}, speech.demo ? t('Demo mode: a placeholder tone stands in for the voice. Connect a voice provider to hear the script.') : isAdmin() ? t('No voice provider is connected yet. Connect one under Voice settings.') : t('No voice provider is connected yet. Ask an administrator to connect one.'))),
          voiceBox,
          sceneList,
        ),
        el(
          'div',
          { class: 'section' },
          el('div', { class: 'section-head' }, el('h3', {}, t('2 · Look and sound')), el('span', { class: 'hint' }, t('With a clip: {clips} · with a picture: {stills} · the other scenes show the theme.', media))),
          el(
            'div',
            { class: 'film-stage' },
            el('div', { class: 'film-preview' }, canvas, el('div', { class: 'film-bar' }, slider, stamp)),
            el(
              'div',
              { class: 'film-options' },
              el(
                'div',
                { class: 'pfield' },
                el('span', {}, t('Theme')),
                el(
                  'div',
                  { class: 'swatches', role: 'radiogroup', 'aria-label': t('Theme') },
                  THEMES.map((th) =>
                    el(
                      'button',
                      { class: 'swatch', type: 'button', role: 'radio', 'aria-checked': String(th.id === ui.theme), disabled: busy, onclick: () => ((ui.theme = th.id), forget(), paint()) },
                      el('i', { style: `background:${Array.isArray(th.bg) ? `linear-gradient(135deg, ${th.bg.join(',')})` : th.bg}; border-color:${th.accent}` }, el('b', { style: `background:${th.ink}` })),
                      el('span', {}, th.name[uiLang] || th.name.en),
                    ),
                  ),
                ),
              ),
              el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: ui.captions, disabled: busy, onchange: (e) => ((ui.captions = e.target.checked), forget(), paint()) }), el('span', {}, t('Captions: the voiceover on screen, in time with the voice'))),
              el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: ui.label, disabled: busy, onchange: (e) => ((ui.label = e.target.checked), forget(), paint()) }), el('span', {}, t('Label the video as AI-generated, in a corner'))),
              el('p', { class: 'hint' }, t('The voice is synthetic, so platforms and, in mainland China, the law ask for this label. Also tick the platform’s own declaration when you post.')),
              musicBox,
            ),
          ),
        ),
        el(
          'div',
          { class: 'section' },
          el('div', { class: 'section-head' }, el('h3', {}, t('3 · Video'))),
          !complete && el('p', { class: 'hint' }, t('Voice the script first: the video is cut to the voice.')),
          complete &&
            el(
              'div',
              { class: 'actions' },
              ui.busy === 'film'
                ? [el('button', { class: 'btn busy', type: 'button', disabled: true }, icon('refresh', 16), el('span', {}, t('Making the video…'))), btn('stop', t('Stop'), { onclick: () => ui.stop?.() })]
                : el('button', { class: `btn ${ui.url ? '' : 'primary'}`, type: 'button', disabled: busy, onclick: make }, icon('video', 16), el('span', {}, ui.url ? t('Make it again') : t('Make the video'))),
              ui.url && btn('download', t('Download .mp4'), { class: 'btn primary', onclick: () => save(`${stem}.mp4`, ui.blob) }),
              ui.url && sharing && btn('upload', t('Share to an app'), { onclick: share }),
              btn('image', t('Cover (.png)'), { title: t('The cover text over the first picture, at the size of the video'), disabled: busy, onclick: cover }),
              btn('script', t('Subtitles (.srt)'), { title: t('The captions with their times, for a platform’s own subtitles or an editor'), disabled: busy, onclick: () => save(`${stem}.srt`, new Blob([srtOf(timeline)], { type: 'application/x-subrip' })) }),
            ),
          ui.busy === 'film' && el('div', { class: 'film-progress' }, (ui.bar = el('i', { style: `width:${Math.round((ui.progress || 0) * 100)}%` }))),
          ui.busy === 'film' && el('p', { class: 'hint' }, t('The video is made on this device. Keep this tab open until it is done.')),
          ui.url && el('video', { class: 'film-video', src: ui.url, controls: true, playsinline: true, style: `aspect-ratio:${size.w}/${size.h}` }),
          ui.url && el('p', { class: 'hint' }, t('{size} MB, H.264 with AAC sound. It is not kept on the server: download it before you leave this page.', { size: (ui.blob.size / 1048576).toFixed(1) })),
        ),
        // Straight to the channels the person connected: the file that was just made, with the script's own publishing text.
        ...(publish
          ? [
              publish.panel({
                run,
                platformId,
                kind: 'video',
                ready: Boolean(ui.blob) && !busy,
                files: async () => [{ name: `${stem}.mp4`, blob: ui.blob }],
                text: [run.script.publish?.description, (run.script.publish?.hashtags || []).join(' ')].filter(Boolean).join('\n\n'),
                title: run.script.publish?.titles?.[0] || run.script.title,
                hashtags: run.script.publish?.hashtags || [],
                ai: true, // the voice is synthetic
              }),
            ]
          : []),
      );
      show();
    }

    paint();
    return root;
  }

  return { view };
}
