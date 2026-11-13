// The video of a script: its voiceover spoken scene by scene (the server asks the voice provider,
// src/speech.mjs), then every frame drawn and the file encoded here in the browser (film.js). Nothing is
// rendered on the server and no file is uploaded: the MP4 is made on this device and is yours to download or
// to share into a platform's app.
//
//   wireVideo(...)  ->  { view(platformId, run, { aspect, lang }) }
//
// A run keeps its voice as run.voice = { voice, voiceB, speed, scenes: { [sceneId]: { url, seconds } } }.

import { t, lang as uiLang } from './i18n.js';
import { icon } from './icons.js';
import { el, call } from './account.js';
import { THEMES, themeOf } from './cards.js';
import { FRAME_SIZES, buildTimeline, drawFrame, readWav, encoderFor, renderFilm } from './film.js';

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

/** A scene's first still picture, if it has one the frame can be drawn from. */
const stillOf = (run, sc) => (run.media?.[sc.id]?.image?.urls || []).find((url) => /^\/media\/[\w-]+\.(?:png|jpe?g|webp)$/.test(url)) || '';

/**
 * `toast(message)` is the app's own; `platformOf(id)` gives a platform; `isAdmin()` says whether the person
 * may change the voice provider; `changed(run)` hears when a run's voice was made.
 */
export function wireVideo({ toast, platformOf, isAdmin, changed = () => {} }) {
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
            speech.providers.map((p) => el('option', { value: p.id, selected: p.id === state.provider }, p.label)),
          ),
          preset && t(preset.hint),
        ),
        ...(preset ? [
          field('BASE_URL_API', input('baseUrl', { type: 'url' })),
          preset.needsAppId && field('APP ID', input('appId', { autocomplete: 'off' })),
          field(preset.needsAppId ? 'Access Token' : 'API_KEY', input('apiKey', { type: 'password', autocomplete: 'off', placeholder: state.hasKey && state.provider === speech.provider ? `${speech.keyPreview} ${t('(saved)')}` : '' })),
          field(preset.needsAppId ? 'Resource ID' : t('Model'), input('model')),
          field(t('Voice'), input('voice', { list: 'speechVoices' }), t('The voice a script is read in unless another is picked for it.')),
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
    const ui = (run.videoUi ??= { busy: '', at: 0, error: '', theme: 'ink', captions: true, label: true, voice: '', voiceB: '', speed: 1, t: 0, url: '', blob: null, stop: null });
    const voice = (run.voice ??= { scenes: {} });
    voice.scenes ??= {};
    const root = el('div', { class: 'post film' });
    const voiced = () => scenes.filter((sc) => voice.scenes[sc.id]).length;
    const forget = () => (ui.url && URL.revokeObjectURL(ui.url), (ui.url = ''), (ui.blob = null)); // the file no longer matches what is on screen

    async function speak(from = 0) {
      ui.busy = 'voice';
      ui.error = '';
      forget();
      if (!from) voice.scenes = {};
      paint();
      try {
        for (let i = from; i < scenes.length; i++) {
          ui.at = i;
          paint();
          const made = await call('/api/voice/scene', { method: 'POST', body: { historyId: run.historyId, sceneId: scenes[i].id, voice: ui.voice, voiceB: ui.voiceB, speed: ui.speed, done: i === scenes.length - 1 } });
          voice.scenes[scenes[i].id] = { url: made.url, seconds: made.seconds };
        }
        Object.assign(voice, { voice: ui.voice, voiceB: ui.voiceB, speed: ui.speed });
        changed(run);
      } catch (err) {
        ui.error = t('Scene {n} could not be voiced: {error}', { n: ui.at + 1, error: err.message });
        ui.resume = ui.at;
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
      const canSpeak = speech.ready || speech.demo;
      const done = voiced();
      const complete = done === scenes.length && done > 0;
      const timeline = buildTimeline(scenes, voice.scenes, lang);
      const film = { size, theme: themeOf(ui.theme), timeline, images: new Map(), captions: ui.captions, label: ui.label ? (lang === 'zh' ? 'AI生成' : 'AI-generated') : '', layouts: new Map() };
      ui.t = Math.min(ui.t, timeline.duration);

      // ---- The preview: the frame at the second the slider is on ----
      const canvas = el('canvas', { class: 'film-canvas', width: size.w, height: size.h, role: 'img', 'aria-label': t('Preview of the video'), style: `aspect-ratio:${size.w}/${size.h}` });
      const ctx = canvas.getContext('2d', { alpha: false });
      const stamp = el('span', { class: 'count' });
      const show = () => {
        drawFrame(ctx, ui.t, film);
        stamp.textContent = `${clock(ui.t)} / ${clock(timeline.duration)}`;
      };
      for (const sc of scenes) {
        const url = stillOf(run, sc);
        if (url) picture(url).then((img) => img && canvas.isConnected && (film.images.set(sc.id, img), film.layouts.clear(), show()));
      }
      const slider = el('input', { type: 'range', class: 'film-scrub', min: 0, max: timeline.duration.toFixed(2), step: 0.05, value: ui.t, 'aria-label': t('Position in the video'), oninput: (e) => ((ui.t = Number(e.target.value)), show()) });

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
          const clips = new Map(await Promise.all(scenes.map(async (sc) => [sc.id, await recording(voice.scenes[sc.id].url)])));
          const images = new Map();
          for (const sc of scenes) {
            const img = stillOf(run, sc) && (await picture(stillOf(run, sc)));
            if (img) images.set(sc.id, img);
          }
          const blob = await renderFilm({ ...film, images, layouts: new Map() }, clips, { signal: abort.signal, onProgress: (p) => ((ui.progress = p), ui.bar && (ui.bar.style.width = `${Math.round(p * 100)}%`)) });
          ui.blob = blob;
          ui.url = URL.createObjectURL(blob);
        } catch (err) {
          if (err.name !== 'AbortError') ui.error = WHY_NOT[err.reason] ? t(WHY_NOT[err.reason]) : t('The video could not be made: {error}', { error: err.message });
        }
        ui.busy = '';
        ui.stop = null;
        paint();
      }
      const fileName = `${platformId}-${slug(run.script.title)}.mp4`;
      const download = () => {
        el('a', { href: ui.url, download: fileName }).click();
        toast(t('Downloaded {name}', { name: fileName }));
      };
      const file = () => new File([ui.blob], fileName, { type: 'video/mp4' });
      const sharing = Boolean(ui.blob) && canShare(file());
      const share = () => navigator.share({ files: [file()] }).catch((err) => err.name === 'AbortError' || toast(t('Sharing did not work here: download the video instead.')));

      // ---- The voice ----
      const voiceField = (key, label) =>
        el('label', { class: 'pfield' }, el('span', {}, label), el('input', { type: 'text', list: 'filmVoices', value: ui[key], disabled: !speech.ready || Boolean(ui.busy), placeholder: speech.ready ? '' : t('Placeholder tone'), oninput: (e) => (ui[key] = e.target.value.trim()) }));
      const speedLabel = el('span', {}, `${t('Speed')} ${ui.speed.toFixed(2)}×`);
      const voiceBox = el(
        'div',
        { class: 'post-look' },
        voiceField('voice', twoVoices ? t('Voice of A') : t('Voice')),
        twoVoices && voiceField('voiceB', t('Voice of B')),
        el('datalist', { id: 'filmVoices' }, (speech.voices || []).map((v) => el('option', { value: v }))),
        el('label', { class: 'pfield' }, speedLabel, el('input', { type: 'range', min: 0.8, max: 1.4, step: 0.05, value: ui.speed, disabled: Boolean(ui.busy), oninput: (e) => ((ui.speed = Number(e.target.value)), (ui.touched = true), (speedLabel.textContent = `${t('Speed')} ${ui.speed.toFixed(2)}×`)) })),
        el(
          'div',
          { class: 'actions' },
          el(
            'button',
            { class: `btn ${complete ? '' : 'primary'}${ui.busy === 'voice' ? ' busy' : ''}`, type: 'button', disabled: !canSpeak || Boolean(ui.busy), onclick: () => speak(0) },
            icon(ui.busy === 'voice' ? 'refresh' : 'mic', 16),
            el('span', {}, ui.busy === 'voice' ? t('Voicing scene {n} of {total}…', { n: ui.at + 1, total: scenes.length }) : complete ? t('Voice it again') : t('Voice the script')),
          ),
          !ui.busy && ui.error && ui.resume > 0 && done < scenes.length && btn('refresh', t('Carry on from scene {n}', { n: ui.resume + 1 }), { onclick: () => speak(ui.resume) }),
          isAdmin() && btn('settings', t('Voice settings'), { disabled: Boolean(ui.busy), onclick: () => settings(() => loadSpeech(true).then(paint)) }),
        ),
      );

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
        ),
        el(
          'div',
          { class: 'section' },
          el('div', { class: 'section-head' }, el('h3', {}, t('2 · Look')), el('span', { class: 'hint' }, t('A scene with a generated image shows it; the others show the theme.'))),
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
                      { class: 'swatch', type: 'button', role: 'radio', 'aria-checked': String(th.id === ui.theme), disabled: Boolean(ui.busy), onclick: () => ((ui.theme = th.id), forget(), paint()) },
                      el('i', { style: `background:${Array.isArray(th.bg) ? `linear-gradient(135deg, ${th.bg.join(',')})` : th.bg}; border-color:${th.accent}` }, el('b', { style: `background:${th.ink}` })),
                      el('span', {}, th.name[uiLang] || th.name.en),
                    ),
                  ),
                ),
              ),
              el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: ui.captions, disabled: Boolean(ui.busy), onchange: (e) => ((ui.captions = e.target.checked), forget(), paint()) }), el('span', {}, t('Captions: the voiceover on screen, in time with the voice'))),
              el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: ui.label, disabled: Boolean(ui.busy), onchange: (e) => ((ui.label = e.target.checked), forget(), paint()) }), el('span', {}, t('Label the video as AI-generated, in a corner'))),
              el('p', { class: 'hint' }, t('The voice is synthetic, so platforms and, in mainland China, the law ask for this label. Also tick the platform’s own declaration when you post.')),
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
                : el('button', { class: `btn ${ui.url ? '' : 'primary'}`, type: 'button', disabled: Boolean(ui.busy), onclick: make }, icon('video', 16), el('span', {}, ui.url ? t('Make it again') : t('Make the video'))),
              ui.url && btn('download', t('Download .mp4'), { class: 'btn primary', onclick: download }),
              ui.url && sharing && btn('upload', t('Share to an app'), { onclick: share }),
            ),
          ui.busy === 'film' && el('div', { class: 'film-progress' }, (ui.bar = el('i', { style: `width:${Math.round((ui.progress || 0) * 100)}%` }))),
          ui.busy === 'film' && el('p', { class: 'hint' }, t('The video is made on this device. Keep this tab open until it is done.')),
          ui.url && el('video', { class: 'film-video', src: ui.url, controls: true, playsinline: true, style: `aspect-ratio:${size.w}/${size.h}` }),
          ui.url && el('p', { class: 'hint' }, t('{size} MB, H.264 with AAC sound. It is not kept on the server: download it before you leave this page.', { size: (ui.blob.size / 1048576).toFixed(1) })),
        ),
      );
      show();
    }

    paint();
    return root;
  }

  return { view };
}
