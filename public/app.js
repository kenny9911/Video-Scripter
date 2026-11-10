// Video Scripter front end. Plain ES modules, no build step.

import { t, lang, applyI18n } from './i18n.js';
import { icon, hydrateIcons } from './icons.js';
import { showAuth, wireAccount } from './account.js';
import { wireTheme, wireLang, enhancePasswords } from './shell.js';

const $ = (id) => document.getElementById(id);

/** Tiny DOM builder: h('div', { class: 'x', onclick }, child, 'text', ...) */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const state = {
  meta: null,
  gateway: null,
  user: null,
  autoRun: null, // { done, total } while images are being made for every scene
  history: [],
  styleIds: [],
  runs: {}, // platformId -> { status: 'running'|'done'|'error', raw, script, error, plan, brief, abort }
  active: null,
  teleprompter: {},
};

const HISTORY_KEY = 'video-scripter.history';
const FORM_KEY = 'video-scripter.brief';
const FIELDS = ['topic', 'keyMessage', 'audience', 'tone', 'brand', 'cta', 'reference'];

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.user) location.reload(); // the session ended: back to the log-in screen
  if (!res.ok) throw new Error(data.error || t('Request failed ({status})', { status: res.status }));
  return data;
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 1800);
}

async function copy(text, label = t('Copied')) {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    toast(t('Copy failed: select the text and copy manually'));
  }
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  h('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const platformOf = (id) => state.meta.platforms.find((p) => p.id === id);
const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const plainVo = (s) => s.replace(/\[\[|\]\]/g, '').replace(/\s*⏸\s*/g, ' ').trim();

/** Render voiceover markup: [[stress]] -> <mark>, ⏸ -> pause glyph. */
function voNodes(text) {
  const out = [];
  for (const part of text.split(/(\[\[.+?\]\]|⏸)/g)) {
    if (!part) continue;
    if (part === '⏸') out.push(h('span', { class: 'pause', title: 'pause' }, '⏸'));
    else if (part.startsWith('[[')) out.push(h('mark', {}, part.slice(2, -2)));
    else out.push(part);
  }
  return out;
}

// ---------- Views ----------
// On a phone the brief and the script are separate views switched from the bottom bar;
// on a wide screen both are visible and this only moves the highlight.

const isMobile = () => matchMedia('(max-width: 899px)').matches;

function setView(view) {
  document.body.dataset.view = view;
  for (const b of document.querySelectorAll('.nav-btn')) {
    if (b.dataset.nav === view) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  if (isMobile()) scrollTo({ top: 0 });
}

/** A button with an icon and a label, the way every action in the app is drawn. */
const iconBtn = (name, label, attrs = {}) => h('button', { class: 'btn', type: 'button', ...attrs }, icon(name, 16), h('span', {}, label));

// ---------- Brief form ----------

function selectedPlatforms() {
  return [...document.querySelectorAll('input[name="platform"]:checked')].map((i) => i.value);
}

// ---------- Visual style (one, or two blended; the first picked leads) ----------

const styleOf = (id) => state.meta.styles.find((s) => s.id === id);
const styleNames = (ids) => (ids || []).map((id) => styleOf(id)?.name[lang]).filter(Boolean).join(' + ');

function setStyles(ids) {
  state.styleIds = ids.filter(styleOf).slice(-state.meta.maxStyles); // a third pick replaces the oldest
  document.querySelectorAll('input[name="style"]').forEach((i) => (i.checked = state.styleIds.includes(i.value)));
  const [a, b] = state.styleIds.map(styleOf);
  $('styleHint').textContent = !a
    ? t('No style chosen: the script and image model decide the look.')
    : !b
      ? `${a.name[lang]}: ${t(a.blurb)}`
      : t('Blend: {a} leads, mixed with {b}.', { a: a.name[lang], b: b.name[lang] });
  if ($('imageMode').options.length) refreshImageMode();
  refreshSummaries();
}

/** The mode only matters with two or three images; "Style comparison" also needs two styles picked. */
function refreshImageMode() {
  const many = Number($('imageCount').value) > 1;
  const mode = state.meta.imageModes.find((m) => m.id === $('imageMode').value);
  for (const o of $('imageMode').options) o.disabled = (state.meta.imageModes.find((m) => m.id === o.value).needsStyles || 0) > state.styleIds.length;
  $('imageMode').hidden = !many;
  $('imageModeHint').hidden = !many;
  $('imageModeHint').textContent = !mode ? '' : (mode.needsStyles || 0) > state.styleIds.length ? t('Pick two visual styles above to compare them. Until then this makes alternatives.') : mode.blurb[lang];
}

/** Caption for one image of a set: "Wide", "Start", a style name, or nothing for a plain take. */
function shotLabel(id) {
  if (!id) return '';
  if (id.startsWith('style-')) return styleOf(id.slice(6))?.name[lang] || '';
  return state.meta.shotLabels[id]?.[lang] || '';
}

function buildStyles() {
  $('styleGroups').replaceChildren(
    ...state.meta.styleGroups.map((g) =>
      h(
        'div',
        { class: 'style-group' },
        h('span', { class: 'group-label' }, g.name[lang]),
        h(
          'div',
          { class: 'chips' },
          state.meta.styles
            .filter((s) => s.group === g.id)
            .map((s) =>
              h(
                'label',
                { class: 'chip', title: t(s.blurb) },
                h('input', { type: 'checkbox', name: 'style', value: s.id, onchange: (e) => setStyles(e.target.checked ? [...state.styleIds, s.id] : state.styleIds.filter((id) => id !== s.id)) }),
                h('span', {}, s.name[lang]),
              ),
            ),
        ),
      ),
    ),
  );
  setStyles([]);
}

const IDEAS = {
  en: ['Why most people quit learning to code in week three', '3 pricing mistakes that quietly kill small cafés', 'What a 5-minute morning routine actually changes'],
  zh: ['为什么企业买了大模型却用不起来', '小餐馆定价最容易踩的三个坑', '普通人学 AI 最该先学的一件事'],
};

/** One-line summaries on the folded brief sections, and topic ideas while the topic is empty. */
function refreshSummaries() {
  const look = [styleNames(state.styleIds) || t('No style'), $('autoImages').checked && t('{n} per scene', { n: $('imageCount').value })].filter(Boolean);
  $('lookSummary').textContent = look.join(' · ');
  const filled = ['keyMessage', 'audience', 'tone', 'brand', 'cta', 'reference'].filter((f) => $(f).value.trim()).length + ($('ttsReady').checked ? 1 : 0);
  $('detailsSummary').textContent = filled ? t('{n} filled', { n: filled }) : t('Optional');
  $('topicIdeas').hidden = Boolean($('topic').value.trim());
}

function refreshDurations() {
  const sel = $('duration');
  const keep = sel.value;
  const options = new Set();
  for (const id of selectedPlatforms()) platformOf(id).durations.forEach((d) => options.add(d));
  if (!options.size) [15, 30, 45, 60, 90].forEach((d) => options.add(d));
  sel.replaceChildren(
    h('option', { value: '' }, t('Auto')),
    ...[...options].sort((a, b) => a - b).map((d) => h('option', { value: d }, d >= 120 ? `${d / 60} min` : `${d} s`)),
  );
  sel.value = [...sel.options].some((o) => o.value === keep) ? keep : '';
}

function refreshBlurb() {
  const f = state.meta.frameworks.find((x) => x.id === $('framework').value);
  $('frameworkBlurb').textContent = f ? f.blurb[lang] : '';
}

function saveForm() {
  const data = Object.fromEntries(FIELDS.map((f) => [f, $(f).value]));
  Object.assign(data, { platforms: selectedPlatforms(), framework: $('framework').value, duration: $('duration').value, ttsReady: $('ttsReady').checked, autoImages: $('autoImages').checked, imageCount: $('imageCount').value, imageMode: $('imageMode').value, styles: state.styleIds });
  try {
    localStorage.setItem(FORM_KEY, JSON.stringify(data));
  } catch {}
}

/**
 * Put a brief back into the form. `data` has the shape saveForm writes. Images per scene is left alone
 * when `data` does not carry it (a script from the history records its brief, not the image settings).
 */
function fillForm(data) {
  FIELDS.forEach((f) => ($(f).value = data[f] || ''));
  if (Array.isArray(data.platforms)) document.querySelectorAll('input[name="platform"]').forEach((i) => (i.checked = data.platforms.includes(i.value)));
  if (state.meta.frameworks.some((f) => f.id === data.framework)) $('framework').value = data.framework;
  $('ttsReady').checked = Boolean(data.ttsReady);
  // autoImages is not restored from a saved brief: it is remembered on the user's account (see buildForm).
  if ('imageCount' in data) $('imageCount').value = ['2', '3'].includes(String(data.imageCount)) ? String(data.imageCount) : '1';
  setStyles(Array.isArray(data.styles) ? data.styles : []);
  if (state.meta.imageModes.some((m) => m.id === data.imageMode)) $('imageMode').value = data.imageMode;
  refreshImageMode();
  refreshDurations();
  const duration = String(data.duration || '');
  $('duration').value = [...$('duration').options].some((o) => o.value === duration) ? duration : ''; // a length the platform no longer offers -> Auto
  refreshBlurb();
}

function restoreForm() {
  let data;
  try {
    data = JSON.parse(localStorage.getItem(FORM_KEY) || 'null');
  } catch {}
  if (data) fillForm(data);
}

function buildForm() {
  for (const p of state.meta.platforms) {
    const chip = h('label', { class: 'chip' }, h('input', { type: 'checkbox', name: 'platform', value: p.id, onchange: refreshDurations }), h('span', {}, p.name));
    $(p.lang === 'zh' ? 'platformsZh' : 'platformsEn').append(chip);
  }
  document.querySelector('input[name="platform"]').checked = true;
  $('framework').append(...state.meta.frameworks.map((f) => h('option', { value: f.id }, f.name[lang])));
  $('framework').addEventListener('change', refreshBlurb);
  refreshDurations();
  buildStyles();
  $('imageMode').append(...state.meta.imageModes.map((m) => h('option', { value: m.id }, m.name[lang])));
  $('imageCount').addEventListener('change', refreshImageMode);
  $('imageMode').addEventListener('change', refreshImageMode);
  refreshImageMode();
  $('topicIdeaList').replaceChildren(
    ...IDEAS[lang].map((idea) =>
      h('button', { class: 'chip', type: 'button', onclick: () => (($('topic').value = idea), refreshSummaries(), saveForm(), $('topic').focus()) }, idea),
    ),
  );
  $('briefForm').addEventListener('input', refreshSummaries);
  restoreForm();
  // "Also generate an image for every scene": off unless this user last left it on. Kept on their account,
  // so it is the same on every device and is not inherited from someone else who used this browser.
  $('autoImages').checked = state.user.prefs?.autoImages === true;
  $('autoImages').addEventListener('change', (e) => {
    state.user.prefs = { ...state.user.prefs, autoImages: e.target.checked };
    api('/api/auth/prefs', { method: 'POST', body: { autoImages: e.target.checked } }).catch((err) => toast(err.message));
  });
  refreshSummaries();
  refreshBlurb();
}

// ---------- Generation ----------

async function* sse(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (event && data) yield { event, data: JSON.parse(data) };
    }
  }
}

async function runPlatform(platformId, brief) {
  const abort = new AbortController();
  const run = (state.runs[platformId] = { status: 'running', raw: '', brief, abort, styleIds: brief.styleIds });
  render();
  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...brief, platformId }),
      signal: abort.signal,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || t('Request failed ({status})', { status: res.status }));
    for await (const { event, data } of sse(res)) {
      if (event === 'plan') run.plan = data;
      else if (event === 'delta') {
        run.raw += data.text;
        if (state.active === platformId) updateStream(run);
      } else if (event === 'error') throw new Error(data.error);
      else if (event === 'done') {
        if (data.script) {
          run.script = data.script;
          run.status = 'done';
          run.historyId = data.historyId;
          if (data.entry) state.history.unshift(data.entry);
          renderHistory();
        } else {
          run.raw = data.raw || run.raw;
          throw new Error(t("The model's reply could not be read as a script ({reason}). The raw reply is shown below.", { reason: data.parseError }));
        }
      }
    }
    if (run.status === 'running') throw new Error(t('The connection closed before the script was finished.'));
  } catch (err) {
    run.status = err.name === 'AbortError' ? 'stopped' : 'error';
    run.error = err.name === 'AbortError' ? t('Stopped.') : err.message;
  }
  render();
  if (run.status === 'done' && $('autoImages').checked) autoImages(run);
}

async function generate(platformIds) {
  const brief = Object.fromEntries(FIELDS.map((f) => [f, $(f).value.trim()]));
  Object.assign(brief, { frameworkId: $('framework').value, duration: $('duration').value || undefined, ttsReady: $('ttsReady').checked, styleIds: [...state.styleIds] });
  saveForm();
  if (!platformIds) {
    state.runs = {};
    state.teleprompter = {};
    platformIds = selectedPlatforms();
    state.active = platformIds[0];
  }
  setView('script');
  setBusy(true);
  await Promise.all(platformIds.map((id) => runPlatform(id, brief)));
  setBusy(Object.values(state.runs).some((r) => r.status === 'running'));
}

function setBusy(busy) {
  $('generate').disabled = busy;
  $('generateLabel').textContent = busy ? t('Generating…') : t('Generate scripts');
  $('stop').hidden = !busy;
  refreshMediaStatus();
}

// ---------- History ----------
// Saved on the server (data/history.json), so it survives clearing the browser and is shared across browsers.

async function loadHistory() {
  state.history = await api('/api/history');
  // Earlier versions kept history in this browser only: move it across once.
  try {
    const old = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    for (const e of old.reverse()) state.history.unshift(await api('/api/history', { method: 'POST', body: e }));
    localStorage.removeItem(HISTORY_KEY);
    state.history.sort((x, y) => y.ts - x.ts);
  } catch {}
  renderHistory();
}

/**
 * Show a saved script and put the brief it was written from back into the form, so it can be edited and
 * generated again. Generating always saves a new history entry: the one opened here is never changed.
 */
function openHistory(entry) {
  const media = {};
  for (const [sceneId, kinds] of Object.entries(entry.media || {})) {
    media[sceneId] = Object.fromEntries(Object.entries(kinds).map(([kind, m]) => [kind, { status: 'done', urls: m.urls?.length ? m.urls : [m.url], shots: m.shots }]));
  }
  const brief = entry.brief?.topic ? entry.brief : null; // an imported script may have no brief
  if (brief) {
    fillForm({ ...brief, platforms: [entry.platformId], framework: brief.frameworkId, styles: brief.styleIds });
    $('formError').hidden = true;
    saveForm();
    toast(t('Brief restored from this script'));
  }
  state.runs = { [entry.platformId]: { status: 'done', raw: '', brief, plan: entry.plan, script: entry.script, historyId: entry.id, media, styleIds: entry.brief?.styleIds || [] } };
  state.teleprompter = {};
  state.active = entry.platformId;
  setView('script');
  render();
}

function renderHistory() {
  const q = $('historySearch').value.trim().toLowerCase();
  const list = state.history.filter((e) => !q || `${e.script.title} ${e.brief?.topic || ''} ${platformOf(e.platformId)?.name || ''}`.toLowerCase().includes(q));
  $('historyCount').textContent = state.history.length;
  $('historyCount').hidden = !state.history.length;
  $('historyList').replaceChildren(
    ...(list.length
      ? list.map((e) => {
          const when = new Date(e.ts).toLocaleString(lang === 'zh' ? 'zh-CN' : [], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          const media = Object.values(e.media || {});
          const images = media.reduce((n, m) => n + (m.image ? m.image.urls?.length || 1 : 0), 0);
          const videos = media.filter((m) => m.video).length;
          const thumb = media.find((m) => m.image)?.image.url;
          return h(
            'button',
            { class: 'history-item', type: 'button', onclick: () => (openHistory(e), $('historyDialog').close()) },
            thumb ? h('img', { class: 'history-thumb', src: thumb, alt: '', loading: 'lazy' }) : h('span', { class: 'history-thumb' }, icon('script', 16)),
            h(
              'span',
              { class: 'history-main' },
              h('span', { class: 'history-title' }, e.script.title || e.brief?.topic || t('Untitled script')),
              h(
                'span',
                { class: 'history-sub' },
                h('b', {}, platformOf(e.platformId)?.name || e.platformId),
                h('span', {}, when),
                h('span', {}, t('{n} scenes', { n: e.script.scenes.length })),
                images > 0 && h('span', {}, t('{n} images', { n: images })),
                videos > 0 && h('span', {}, t('{n} videos', { n: videos })),
              ),
            ),
          );
        })
      : [h('p', { class: 'hint' }, state.history.length ? t('No script matches that search.') : t('Scripts you generate are saved here automatically.'))]),
  );
}

// ---------- Export ----------

function toMarkdown(platformId, run) {
  const s = run.script;
  const p = platformOf(platformId);
  const L = [`# ${s.title}`, '', `> ${s.logline}`, '', `**${t('Platform')}:** ${p.name} · **${t('Length')}:** ${s.scenes.at(-1).end}s`, ''];
  L.push(`## ${t('Hook options')}`, '', ...s.hookOptions.map((o) => `- ${o.type ? `**${o.type}:** ` : ''}${plainVo(o.line)}`), '');
  L.push(`## ${t('Script')}`, '');
  for (const sc of s.scenes) {
    L.push(`### ${fmtTime(sc.start)}–${fmtTime(sc.end)} · ${sc.stage}`, '', `**${t('Voiceover')}:** ${sc.voiceover}`, '');
    if (sc.onScreenText) L.push(`- **${t('On screen')}:** ${sc.onScreenText}`);
    if (sc.visual) L.push(`- **${t('Visual')}:** ${sc.visual}`);
    if (sc.camera) L.push(`- **${t('Camera')}:** ${sc.camera}`);
    if (sc.sfx) L.push(`- **${t('Sound')}:** ${sc.sfx}`);
    L.push('');
  }
  L.push(`## ${t('Voiceover only')}`, '', s.scenes.map((sc) => plainVo(sc.voiceover)).join('\n\n'), '');
  L.push(`## ${t('Publishing package')}`, '', `**${t('Titles')}**`, '', ...s.publish.titles.map((title, i) => `${i + 1}. ${title}`), '');
  if (s.publish.coverText) L.push(`**${t('Cover text')}:** ${s.publish.coverText}`, '');
  L.push(`**${t('Description')}**`, '', s.publish.description, '', `**${t('Hashtags')}:** ${s.publish.hashtags.join(' ')}`, '', `**${t('Pinned comment')}:** ${s.publish.pinnedComment}`, '');
  if (s.productionNotes.length) L.push(`## ${t('Production notes')}`, '', ...s.productionNotes.map((n) => `- ${n}`), '');
  return L.join('\n');
}

const fileStem = (platformId, run) => `${platformId}-${(run.script.title || 'script').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40)}`;

// ---------- Scene images and videos ----------
// Generated files are saved by the server under data/media and linked from the script's history entry.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Returns { urls, shots }: as many images as "Images per scene" asks for (fewer if some failed), related as the chosen mode says. */
async function makeImage(body) {
  const r = await api('/api/media/image', { method: 'POST', body: { ...body, count: Number($('imageCount').value) || 1, mode: $('imageMode').value } });
  if (r.warning) toast(t('Made {n} of {total} images: {error}', { n: r.urls.length, total: r.requested, error: r.warning }));
  return r;
}

/** Start the job, then poll until the provider finishes and the server has saved the file. */
async function makeVideo(body, onProgress) {
  let job = await api('/api/media/video', { method: 'POST', body });
  for (let i = 0; job.status === 'running'; i++) {
    if (i >= 240) throw new Error(t('Still rendering after 20 minutes. Check the provider and try again.'));
    onProgress(job.progress);
    await sleep(5000);
    job = await api('/api/media/video/status', { method: 'POST', body: { id: job.id, historyId: body.historyId, sceneId: body.sceneId } });
  }
  if (job.status === 'failed') throw new Error(job.error || t('The provider could not make this video'));
  if (!job.url) throw new Error(t('The provider finished but returned no video file'));
  return job.url;
}

// Per-scene media state lives on the run, so it survives re-rendering: run.media[sceneId][kind] = { status, url, error, note }
const mediaOf = (run, sc) => ((run.media ??= {})[sc.id] ??= {});

async function startMedia(run, sc, kind) {
  const store = mediaOf(run, sc);
  const m = (store[kind] = { status: 'running', note: '', count: kind === 'image' ? Number($('imageCount').value) || 1 : 1 });
  const paint = () => (store.paint?.(), refreshMediaStatus());
  const body = { ...sc, historyId: run.historyId, sceneId: sc.id, styleIds: run.styleIds?.length ? run.styleIds : state.styleIds };
  paint();
  try {
    if (kind === 'image') ({ urls: m.urls, shots: m.shots } = await makeImage(body));
    else m.urls = [await makeVideo(body, (p) => ((m.note = p ? ` ${Math.round(p)}%` : ''), paint()))];
    m.status = 'done';
    const entry = state.history.find((e) => e.id === run.historyId);
    if (entry) ((entry.media ??= {})[sc.id] ??= {})[kind] = { url: m.urls[0], urls: m.urls, shots: m.shots };
  } catch (err) {
    m.status = 'error';
    m.error = err.message;
  }
  paint();
}

/** The "generate images with the script" option: one image per scene, two at a time. */
async function autoImages(run) {
  if (!activeGw().image.ready) return toast(t('No image model is set: add one under LLM settings → Images and videos'));
  const todo = run.script.scenes.filter((sc) => sc.visual && !mediaOf(run, sc).image);
  state.autoRun = { done: 0, total: todo.length };
  refreshMediaStatus();
  const worker = async () => {
    for (let sc; (sc = todo.shift()); ) {
      await startMedia(run, sc, 'image');
      state.autoRun.done += 1;
      refreshMediaStatus();
    }
  };
  await Promise.all([worker(), worker()]);
  state.autoRun = null;
  refreshMediaStatus();
}

/** The pill in the script header (and the dot on the mobile Script tab) while any image or video is still being made. */
function refreshMediaStatus() {
  const running = { image: 0, video: 0 };
  for (const run of Object.values(state.runs)) for (const scene of Object.values(run.media || {})) for (const kind of ['image', 'video']) if (scene[kind]?.status === 'running') running[kind] += 1;
  const busy = running.image + running.video > 0 || Boolean(state.autoRun);
  $('mediaStatus').hidden = !busy;
  $('mediaStatusText').textContent = state.autoRun
    ? t('Generating images: {done} of {total} scenes', state.autoRun)
    : running.video && !running.image
      ? t('Generating video…')
      : running.image && !running.video
        ? t('Generating images…')
        : t('Generating images and video…');
  $('navBusy').hidden = !busy && !Object.values(state.runs).some((r) => r.status === 'running');
}

/** Buttons and results under one scene. */
function sceneMedia(run, sc) {
  const g = activeGw();
  const store = mediaOf(run, sc);
  const kinds = ['image', 'video'].filter((k) => g[k].ready || store[k]);
  if (!sc.visual || !kinds.length) return null;
  const box = h('div', { class: 'media' });

  const view = () =>
    kinds.map((kind) => {
      const m = store[kind];
      const busy = m?.status === 'running';
      const label = busy ? `${t(`Making ${kind}…`)}${m.note}` : t(`${m ? 'Redo' : 'Generate'} ${kind}`);
      return h(
        'div',
        { class: 'media-item' },
        m?.status === 'done' &&
          h(
            'div',
            { class: 'shots' },
            m.urls.map((url, i) =>
              h(
                'div',
                { class: 'shot' },
                shotLabel(m.shots?.[i]) && h('span', { class: 'shot-label' }, `${i + 1} · ${shotLabel(m.shots[i])}`),
                kind === 'image' ? h('img', { src: url, alt: t('Generated image for scene {n}', { n: sc.id }), loading: 'lazy' }) : h('video', { src: url, controls: true, playsinline: true, preload: 'metadata' }),
                h('a', { class: 'btn small', href: url, download: url.split('/').pop().split('?')[0] || `scene-${sc.id}`, target: '_blank', rel: 'noopener' }, t('Save')),
              ),
            ),
          ),
        busy &&
          h(
            'div',
            { class: 'shots', role: 'status' },
            Array.from({ length: m.count || 1 }, () => h('div', { class: 'shot loading' }, h('div', { class: 'ph' }, h('span', { class: 'spin' }), h('span', {}, t(kind === 'image' ? 'Generating image…' : 'Generating video…'))))),
          ),
        m?.status === 'error' && h('p', { class: 'error' }, m.error),
        h(
          'div',
          { class: 'actions' },
          g[kind].ready && iconBtn(busy ? 'refresh' : kind, label, { class: `btn small${busy ? ' busy' : ''}`, disabled: busy, 'aria-busy': busy ? 'true' : null, onclick: () => startMedia(run, sc, kind) }),
        ),
      );
    });

  store.paint = () => box.replaceChildren(...view());
  store.paint();
  return box;
}

/** The whole package for one script: script files plus every generated image and video, zipped by the server. */
async function downloadPackage(platformId, run, btn) {
  btn.disabled = true;
  try {
    const res = await fetch('/api/history/package', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: run.historyId, markdown: toMarkdown(platformId, run), lang }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || t('Request failed ({status})', { status: res.status }));
    const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(res.headers.get('content-disposition') || '')?.[1] || 'package.zip');
    const url = URL.createObjectURL(await res.blob());
    h('a', { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(t('Downloaded {name}', { name }));
  } catch (err) {
    toast(err.message);
  }
  btn.disabled = false;
}

// ---------- Rendering ----------

/** How far the model has got, read from the partial reply. */
const scenesSoFar = (raw) => (raw.match(/"voiceover"\s*:/g) || []).length;

function progressNote(run) {
  if (!run.plan) return t('Contacting the model…');
  const n = scenesSoFar(run.raw);
  return n ? t('Writing scene {n}…', { n }) : t('Planning the hook and structure…');
}

function updateStream(run) {
  const pre = document.querySelector('.stream');
  if (!pre) return render();
  pre.textContent = run.raw;
  pre.scrollTop = pre.scrollHeight;
  const title = document.querySelector('.progress-title');
  if (title) title.textContent = progressNote(run);
}

function renderTabs() {
  const ids = Object.keys(state.runs);
  $('tabs').replaceChildren(
    ...ids.map((id) => {
      const run = state.runs[id];
      return h(
        'button',
        { class: 'tab', role: 'tab', type: 'button', 'aria-selected': String(id === state.active), onclick: () => ((state.active = id), render()) },
        platformOf(id).name,
        run.status === 'running' && h('span', { class: 'spin', 'aria-label': 'generating' }),
        run.status === 'error' && h('span', { class: 'bad', 'aria-label': 'failed' }, '!'),
      );
    }),
  );
}

function pubItem(label, value, copyText) {
  return h(
    'div',
    { class: 'pub-item' },
    h('div', { class: 'label' }, label, h('button', { class: 'btn small', type: 'button', onclick: () => copy(copyText) }, t('Copy'))),
    h('div', { class: 'value' }, value),
  );
}

function renderScript(platformId, run) {
  const s = run.script;
  const tele = state.teleprompter[platformId];
  const voText = s.scenes.map((sc) => plainVo(sc.voiceover)).join('\n\n');
  const zh = run.plan ? run.plan.unit === '汉字' : platformOf(platformId).lang === 'zh';
  const count = zh
    ? `${voText.replace(/[\s\p{P}]/gu, '').length} 字`
    : t('{n} words', { n: voText.split(/\s+/).filter(Boolean).length });
  const meta = [platformOf(platformId).name, `${s.scenes.at(-1).end}s`, t('{n} scenes', { n: s.scenes.length }), t('voiceover {count}', { count }), run.plan && `${run.plan.model}`, styleNames(run.styleIds)].filter(Boolean);

  return h(
    'div',
    {},
    h(
      'div',
      { class: 'script-head' },
      h('div', {}, h('h2', {}, s.title), h('p', { class: 'logline' }, s.logline), h('div', { class: 'meta' }, meta.map((m) => h('span', {}, m)))),
      h(
        'div',
        { class: 'actions' },
        run.historyId && iconBtn('package', t('Download .zip'), { class: 'btn primary', title: t('Script files plus every generated image and video'), onclick: (e) => downloadPackage(platformId, run, e.currentTarget) }),
        iconBtn('copy', t('Copy Markdown'), { onclick: () => copy(toMarkdown(platformId, run), t('Script copied as Markdown')) }),
        iconBtn('download', '.md', { onclick: () => download(`${fileStem(platformId, run)}.md`, toMarkdown(platformId, run), 'text/markdown') }),
        iconBtn('download', '.json', { onclick: () => download(`${fileStem(platformId, run)}.json`, JSON.stringify({ platform: platformId, brief: run.brief, ...s }, null, 2), 'application/json') }),
        run.brief && iconBtn('refresh', t('Regenerate'), { title: t('Writes a new script from the brief. This one stays in History.'), onclick: () => generate([platformId]) }),
      ),
    ),

    s.hookOptions.length > 0 &&
      h('div', { class: 'section' }, h('div', { class: 'section-head' }, h('h3', {}, t('Hook options'))), h('div', { class: 'hooks' }, s.hookOptions.map((o) => h('div', { class: 'hook' }, o.type && h('div', { class: 'type' }, o.type), h('div', {}, voNodes(o.line)))))),

    h(
      'div',
      { class: 'section' },
      h(
        'div',
        { class: 'section-head' },
        h('h3', {}, tele ? t('Voiceover') : t('Script')),
        h(
          'div',
          { class: 'actions' },
          h('button', { class: 'btn small', type: 'button', onclick: () => copy(voText, t('Voiceover copied')) }, t('Copy voiceover')),
          h('button', { class: 'btn small', type: 'button', onclick: () => ((state.teleprompter[platformId] = !tele), render()) }, tele ? t('Show full script') : t('Voiceover only')),
        ),
      ),
      tele
        ? h('div', { class: 'teleprompter' }, s.scenes.flatMap((sc, i) => [i ? '\n\n' : '', ...voNodes(sc.voiceover)]))
        : h(
            'div',
            {},
            s.scenes.map((sc) =>
              h(
                'div',
                { class: 'scene' },
                h('div', {}, h('div', { class: 'time' }, `${fmtTime(sc.start)}–${fmtTime(sc.end)}`), sc.stage && h('span', { class: 'stage' }, sc.stage)),
                h(
                  'div',
                  {},
                  h('div', { class: 'vo' }, voNodes(sc.voiceover)),
                  h(
                    'dl',
                    { class: 'cues' },
                    sc.onScreenText && [h('dt', {}, t('On screen')), h('dd', { class: 'screen' }, sc.onScreenText)],
                    sc.visual && [h('dt', {}, t('Visual')), h('dd', {}, sc.visual)],
                    sc.camera && [h('dt', {}, t('Camera')), h('dd', {}, sc.camera)],
                    sc.sfx && [h('dt', {}, t('Sound')), h('dd', {}, sc.sfx)],
                  ),
                  sceneMedia(run, sc),
                ),
              ),
            ),
          ),
    ),

    h(
      'div',
      { class: 'section' },
      h('div', { class: 'section-head' }, h('h3', {}, t('Publishing package'))),
      h(
        'div',
        { class: 'pub' },
        s.publish.titles.length > 0 && pubItem(t('Titles'), h('ol', {}, s.publish.titles.map((title) => h('li', {}, title))), s.publish.titles.join('\n')),
        s.publish.coverText && pubItem(t('Cover text'), s.publish.coverText, s.publish.coverText),
        s.publish.description && pubItem(t('Description'), s.publish.description, s.publish.description),
        s.publish.hashtags.length > 0 && pubItem(t('Hashtags'), s.publish.hashtags.join(' '), s.publish.hashtags.join(' ')),
        s.publish.pinnedComment && pubItem(t('Pinned comment'), s.publish.pinnedComment, s.publish.pinnedComment),
      ),
    ),

    s.productionNotes.length > 0 && h('div', { class: 'section' }, h('div', { class: 'section-head' }, h('h3', {}, t('Production notes'))), h('ul', { class: 'notes' }, s.productionNotes.map((n) => h('li', {}, n)))),
  );
}

function render() {
  renderTabs();
  const run = state.runs[state.active];
  const box = $('result');
  if (!run) return;
  if (run.status === 'done') return box.replaceChildren(renderScript(state.active, run));
  if (run.status === 'running') {
    const note = run.plan ? t('Writing for {platform} with {model} · target about {budget} {unit} of voiceover', { platform: platformOf(state.active).name, model: run.plan.model, budget: run.plan.budget, unit: run.plan.unit }) : t('Contacting the model…');
    const pre = h('pre', { class: 'stream' }, run.raw);
    box.replaceChildren(
      h(
        'div',
        { class: 'progress', role: 'status', 'aria-live': 'polite' },
        h('div', { class: 'progress-head' }, h('span', { class: 'spin' }), h('p', { class: 'progress-title' }, progressNote(run))),
        h('div', { class: 'progress-bar' }, h('i')),
        h('p', { class: 'stream-note' }, note),
        h('div', { class: 'skeleton', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
        h('details', { class: 'raw' }, h('summary', {}, t('Show the raw reply')), pre),
      ),
    );
    return;
  }
  box.replaceChildren(
    h('p', { class: 'error', role: 'alert' }, run.error),
    h('div', { class: 'actions', style: 'margin:14px 0' }, iconBtn('refresh', t('Try again'), { class: 'btn primary', onclick: () => generate([state.active]) }), iconBtn('settings', t('LLM settings'), { onclick: openSettings }), iconBtn('edit', t('Edit the brief'), { class: 'btn mobile-only', onclick: () => setView('brief') })),
    run.raw && h('details', { class: 'raw' }, h('summary', {}, t('Show the raw reply')), h('pre', { class: 'stream' }, run.raw)),
  );
}

// ---------- Gateway settings ----------

const presetOf = (id) => state.meta.providers.find((p) => p.id === id);
const activeGw = () => state.gateway.profiles.find((p) => p.id === state.gateway.activeId) || state.gateway.profiles[0];

// Settings dialog state: the saved gateway being edited (null = a new one) and its model list.
const ui = { editId: null, provider: null, available: [], enabled: new Set() };
const editing = () => state.gateway.profiles.find((p) => p.id === ui.editId) || null;

/** Top-bar chip and the "Written by" picker in the brief. */
function renderGateway() {
  const g = activeGw();
  const preset = presetOf(g.provider);
  const mock = preset.protocol === 'mock';
  const ready = mock || !preset.needsKey || g.hasKey;
  $('gatewayDot').className = `dot ${mock ? 'warn' : ready ? 'ok' : ''}`;
  $('gatewayLabel').textContent = mock ? t('Demo mode: no model connected') : `${g.name} · ${g.model || t('no model')}${ready ? '' : ` · ${t('key missing')}`}`;

  $('llm').replaceChildren(
    ...state.gateway.profiles.map((p) =>
      h('optgroup', { label: p.name }, (p.models.length ? p.models : ['']).map((m) => h('option', { value: `${p.id}::${m}` }, m || t('no model set')))),
    ),
  );
  $('llm').value = `${g.id}::${g.model}`;
  // One gateway and model for everyone: only an administrator can switch it.
  const admin = state.user.role === 'admin';
  $('llm').disabled = !admin;
  $('llm').title = admin ? t('Everyone writes with the model you choose here') : t('Chosen by your administrator');
  $('gatewayChip').title = admin ? t('LLM gateway settings') : t('Chosen by your administrator');
  $('demoBanner').hidden = !mock;
  if (state.runs[state.active]?.status === 'done') render(); // scene image / video buttons follow the gateway in use
}

async function chooseLlm(value) {
  const cut = value.indexOf('::');
  try {
    state.gateway = await api('/api/gateway/select', { method: 'POST', body: { id: value.slice(0, cut), model: value.slice(cut + 2) } });
    toast(t('Everyone now writes with {model}', { model: activeGw().model || activeGw().name }));
  } catch (err) {
    toast(err.message);
  }
  renderGateway();
}

function renderProfileList() {
  $('profileList').replaceChildren(
    ...state.gateway.profiles.map((p) =>
      h(
        'button',
        { class: 'gw-item', type: 'button', 'aria-current': String(p.id === ui.editId), onclick: () => editProfile(p.id) },
        h('span', { class: 'gw-name' }, p.name),
        h('span', { class: 'gw-sub' }, [t(presetOf(p.provider).label), p.model].filter(Boolean).join(' · ')),
        p.id === state.gateway.activeId && h('span', { class: 'gw-badge' }, t('In use')),
      ),
    ),
  );
}

function renderModelList() {
  const def = $('model').value.trim();
  const ids = ui.available;
  $('modelBox').hidden = !ids.length || (ids.length === 1 && ids[0] === def);
  $('modelFilter').hidden = ids.length < 9;
  const q = $('modelFilter').hidden ? '' : $('modelFilter').value.trim().toLowerCase();
  const on = ids.filter((id) => id === def || ui.enabled.has(id)).length;
  $('modelCount').textContent = t('{n} models · {on} in the picker', { n: ids.length, on });

  const list = $('modelList');
  const scroll = list.scrollTop;
  list.replaceChildren(
    ...ids
      .filter((id) => !q || id.toLowerCase().includes(q))
      .map((id) => {
        const isDefault = id === def;
        const toggle = (e) => {
          if (e.target.checked) ui.enabled.add(id);
          else ui.enabled.delete(id);
          renderModelList();
        };
        const makeDefault = () => {
          if (ids.includes(def)) ui.enabled.add(def); // the previous default stays in the picker
          ui.enabled.add(id);
          $('model').value = id;
          renderModelList();
        };
        return h(
          'div',
          { class: 'model-row' },
          h('label', {}, h('input', { type: 'checkbox', checked: isDefault || ui.enabled.has(id), disabled: isDefault, onchange: toggle }), h('span', { class: 'model-id', title: id }, id)),
          isDefault ? h('span', { class: 'is-default' }, t('Default')) : h('button', { class: 'btn small', type: 'button', onclick: makeDefault }, t('Make default')),
        );
      }),
  );
  list.scrollTop = scroll;
}

function syncSettingsFields(fromPreset) {
  const preset = presetOf($('provider').value);
  const mock = preset.protocol === 'mock';
  if (fromPreset) {
    // A name that was just the old provider's label follows the provider.
    if ($('profileName').value.trim() === presetOf(ui.provider)?.label) $('profileName').value = '';
    $('baseUrl').value = preset.baseUrl;
    $('model').value = preset.model;
    $('apiKey').value = '';
    ui.available = [];
    ui.enabled = new Set();
    renderModelList();
  }
  ui.provider = preset.id;
  $('profileName').placeholder = preset.label;
  for (const id of ['baseUrl', 'apiKey', 'model', 'listModels']) $(id).disabled = mock;
  $('model').placeholder = t(preset.modelHint || 'model name');
  const g = editing();
  const stored = Boolean(g?.hasKey) && g.provider === preset.id && g.baseUrl === $('baseUrl').value.trim();
  $('apiKey').placeholder = stored ? t('Saved: {key}', { key: g.keyPreview }) : preset.needsKey ? t('Paste your key') : t('Optional');
  $('keyHint').textContent = mock
    ? t('Demo mode returns placeholder text so you can try the interface. Pick a provider to write real scripts.')
    : stored
      ? t('Leave the key blank to keep the saved one.')
      : g?.hasKey
        ? t('Changing the provider or base URL clears the saved key, so a key is never sent to a different service.')
        : '';
}

/** Load a saved gateway into the form, or a blank one when id is null. */
function editProfile(id) {
  const p = state.gateway.profiles.find((x) => x.id === id) || null;
  const preset = p ? presetOf(p.provider) : state.meta.providers.find((x) => x.protocol !== 'mock');
  const inUse = Boolean(p) && p.id === state.gateway.activeId;
  ui.editId = p ? p.id : null;
  ui.provider = preset.id;
  ui.enabled = new Set(p ? p.models : []);
  ui.available = p ? [...p.models] : [];
  $('gwFormTitle').textContent = p ? t('Edit “{name}”', { name: p.name }) : t('New gateway');
  $('profileName').value = p ? p.name : '';
  $('provider').value = preset.id;
  $('baseUrl').value = p ? p.baseUrl : preset.baseUrl;
  $('model').value = p ? p.model : preset.model;
  $('apiKey').value = '';
  $('modelFilter').value = '';
  $('useGateway').checked = !p || inUse;
  $('useGateway').disabled = inUse;
  $('deleteProfile').hidden = !p || state.gateway.profiles.length < 2;
  for (const kind of ['image', 'video']) {
    const m = p ? p[kind] : { baseUrl: '', model: '', size: '' };
    $(`${kind}BaseUrl`).value = m.baseUrl;
    $(`${kind}Model`).value = m.model;
    $(`${kind}Size`).value = m.size;
    $(`${kind}Key`).value = '';
    $(`${kind}ListNote`).textContent = '';
    renderMediaModels(kind, null);
  }
  $('mediaSettings').open = false;
  setSettingsStatus('');
  syncSettingsFields(false);
  syncMediaFields();
  renderProfileList();
  renderModelList();
}

/** Key placeholders and the one-line summary for the "Images and videos" section. */
function syncMediaFields() {
  const g = editing();
  const on = [];
  for (const kind of ['image', 'video']) {
    const saved = g?.[kind];
    const stored = Boolean(saved?.hasKey) && saved.baseUrl === $(`${kind}BaseUrl`).value.trim();
    $(`${kind}Key`).placeholder = stored ? t('Saved: {key}', { key: saved.keyPreview }) : t("Blank uses the gateway's key");
    if ($(`${kind}Model`).value.trim()) on.push(`${t(kind)}: ${$(`${kind}Model`).value.trim()}`);
  }
  $('mediaSummary').textContent = on.length ? `· ${on.join(' · ')}` : `· ${t('not set')}`;
}

// Names that usually mean an image or a video model: providers list every model they have, so these go first.
const LIKELY = {
  image: /image|img|dall|flux|diffusion|imagen|banana|seedream|kolors|wanx|midjourney|recraft|ideogram/i,
  video: /video|sora|veo|kling|wan|seedance|hailuo|runway|luma|pika|vidu|cogvid/i,
};

/** The pickable list under an image / video Model field. `models` null hides it. */
function renderMediaModels(kind, models) {
  const list = $(`${kind}ModelList`);
  if (models) list.models = [...models].sort((a, b) => LIKELY[kind].test(b) - LIKELY[kind].test(a));
  const ids = models === null ? [] : list.models || [];
  if (models === null) list.models = [];
  const current = $(`${kind}Model`).value.trim();
  list.hidden = !ids.length;
  $(`${kind}ModelOptions`).replaceChildren(...ids.map((id) => h('option', { value: id })));
  const scroll = list.scrollTop;
  list.replaceChildren(
    ...ids.map((id) =>
      h(
        'div',
        { class: 'model-row' },
        h('span', { class: 'model-id', title: id }, id),
        id === current
          ? h('span', { class: 'is-default' }, t('Selected'))
          : h('button', { class: 'btn small', type: 'button', onclick: () => (($(`${kind}Model`).value = id), syncMediaFields(), renderMediaModels(kind)) }, t('Use')),
      ),
    ),
  );
  list.scrollTop = scroll;
}

async function listMediaModels(kind) {
  const btn = $(`${kind}List`);
  const note = $(`${kind}ListNote`);
  btn.disabled = true;
  note.textContent = t('Asking the provider…');
  try {
    const r = await api('/api/gateway/models', { method: 'POST', body: { ...settingsPayload(), kind } });
    if (!r.ok) note.textContent = r.error;
    else if (!r.models.length) note.textContent = t('The provider returned an empty list. Type the model name instead.');
    else {
      renderMediaModels(kind, r.models);
      const likely = r.models.filter((m) => LIKELY[kind].test(m)).length;
      note.textContent = likely
        ? t(`{n} models, {likely} that look like ${kind} models listed first.`, { n: r.models.length, likely })
        : t(`{n} models; none is obviously ${kind === 'image' ? 'an image' : 'a video'} model, so check the provider's docs.`, { n: r.models.length });
    }
  } catch (err) {
    note.textContent = err.message;
  }
  btn.disabled = false;
}

const mediaPayload = (kind) => ({
  baseUrl: $(`${kind}BaseUrl`).value.trim(),
  apiKey: $(`${kind}Key`).value.trim(),
  model: $(`${kind}Model`).value.trim(),
  size: $(`${kind}Size`).value.trim(),
});

function settingsPayload() {
  return {
    image: mediaPayload('image'),
    video: mediaPayload('video'),
    id: ui.editId || undefined,
    name: $('profileName').value.trim(),
    provider: $('provider').value,
    baseUrl: $('baseUrl').value.trim(),
    apiKey: $('apiKey').value.trim(),
    model: $('model').value.trim(),
    models: [...ui.enabled],
    activate: $('useGateway').checked,
  };
}

function setSettingsStatus(text, kind) {
  const el = $('settingsStatus');
  el.hidden = !text;
  el.textContent = text || '';
  el.className = `status ${kind || ''}`;
}

function openSettings() {
  editProfile(state.gateway.activeId);
  $('settings').showModal();
}

function wireSettings() {
  $('provider').append(...state.meta.providers.map((p) => h('option', { value: p.id }, t(p.label))));
  $('provider').addEventListener('change', () => syncSettingsFields(true));
  $('baseUrl').addEventListener('input', () => syncSettingsFields(false));
  $('model').addEventListener('input', renderModelList);
  $('modelFilter').addEventListener('input', renderModelList);
  $('mediaSettings').addEventListener('input', syncMediaFields);
  for (const kind of ['image', 'video']) {
    $(`${kind}List`).addEventListener('click', () => listMediaModels(kind));
    $(`${kind}Model`).addEventListener('input', () => renderMediaModels(kind));
  }
  $('openSettings').addEventListener('click', openSettings);
  $('gatewayChip').addEventListener('click', () => (state.user.role === 'admin' ? openSettings() : toast(t('Chosen by your administrator'))));
  $('cancelSettings').addEventListener('click', () => $('settings').close());
  $('newProfile').addEventListener('click', () => editProfile(null));
  $('llm').addEventListener('change', (e) => chooseLlm(e.target.value));

  $('testGateway').addEventListener('click', async () => {
    $('testGateway').disabled = true;
    setSettingsStatus(t('Testing…'));
    try {
      const r = await api('/api/gateway/test', { method: 'POST', body: settingsPayload() });
      if (r.ok) setSettingsStatus(t('Connected in {ms} ms. {model} replied: “{reply}”', { ms: r.ms, model: r.model, reply: r.reply }), 'ok');
      else setSettingsStatus(r.error, 'bad');
    } catch (err) {
      setSettingsStatus(err.message, 'bad');
    }
    $('testGateway').disabled = false;
  });

  $('listModels').addEventListener('click', async () => {
    $('listModels').disabled = true;
    setSettingsStatus(t('Asking the provider for its models…'));
    try {
      const r = await api('/api/gateway/models', { method: 'POST', body: settingsPayload() });
      if (!r.ok) setSettingsStatus(r.error, 'bad');
      else if (!r.models.length) setSettingsStatus(t('The provider returned an empty model list. Type the model name instead.'), 'bad');
      else {
        ui.available = [...new Set([...r.models, ...ui.enabled])];
        renderModelList();
        setSettingsStatus(t('{n} models available. Tick the ones you want in the “Written by” picker and choose a default, then save.', { n: r.models.length }), 'ok');
      }
    } catch (err) {
      setSettingsStatus(err.message, 'bad');
    }
    $('listModels').disabled = false;
  });

  $('deleteProfile').addEventListener('click', async () => {
    const p = editing();
    if (!p || !confirm(t('Delete the saved gateway “{name}”? Its API key is removed from this machine.', { name: p.name }))) return;
    try {
      state.gateway = await api('/api/gateway/delete', { method: 'POST', body: { id: p.id } });
      renderGateway();
      editProfile(state.gateway.activeId);
      toast(t('Gateway deleted'));
    } catch (err) {
      setSettingsStatus(err.message, 'bad');
    }
  });

  $('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { savedId, ...store } = await api('/api/gateway/config', { method: 'PUT', body: settingsPayload() });
      state.gateway = store;
      renderGateway();
      editProfile(savedId);
      setSettingsStatus(savedId === store.activeId ? t('Saved. Everyone now writes with this gateway.') : t('Saved.'), 'ok');
    } catch (err) {
      setSettingsStatus(err.message, 'bad');
    }
  });
}

// ---------- Boot ----------

async function boot() {
  applyI18n();
  hydrateIcons();
  enhancePasswords();
  const me = await api('/api/auth/me');
  if (!me.user) return showAuth(me);
  state.user = me.user;
  document.body.dataset.role = me.user.role;
  document.body.dataset.auth = 'in';
  wireShell();
  [state.meta, state.gateway] = await Promise.all([api('/api/meta'), api('/api/gateway/config')]);
  state.openAccount = wireAccount({ user: me.user, storage: me.storage, platformName: (id) => platformOf(id)?.name || id || '', openSettings });
  buildForm();
  wireSettings();
  renderGateway();
  wireTheme($('themeToggle'));
  wireLang($('langToggle'));
  loadHistory().catch((err) => toast(t('Could not load history: {error}', { error: err.message })));

  $('briefForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const err = $('formError');
    err.hidden = true;
    if (!selectedPlatforms().length) {
      err.textContent = t('Pick at least one platform.');
      err.hidden = false;
      return;
    }
    generate();
  });
  $('briefForm').addEventListener('change', saveForm);
  $('stop').addEventListener('click', () => Object.values(state.runs).forEach((r) => r.status === 'running' && r.abort.abort()));
}

/** Navigation, the history drawer, and dialog behaviour shared by both dialogs. */
function wireShell() {
  const showHistory = () => (($('historySearch').value = ''), renderHistory(), $('historyDialog').showModal());
  $('openHistory').addEventListener('click', showHistory);
  $('closeHistory').addEventListener('click', () => $('historyDialog').close());
  $('historySearch').addEventListener('input', renderHistory);
  $('closeSettingsX').addEventListener('click', () => $('settings').close());
  $('demoConnect').addEventListener('click', () => openSettings());
  $('openAccount').addEventListener('click', () => state.openAccount?.());
  $('emptyToBrief').addEventListener('click', () => setView('brief'));
  for (const b of document.querySelectorAll('.nav-btn')) {
    b.addEventListener('click', () => {
      if (b.dataset.nav === 'history') showHistory();
      else if (b.dataset.nav === 'account') state.openAccount?.();
      else setView(b.dataset.nav);
    });
  }
  // A click on the dimmed area around a dialog closes it.
  for (const d of document.querySelectorAll('dialog')) d.addEventListener('click', (e) => e.target === d && d.close());
  setView('brief');
}

boot().catch((err) => {
  document.body.dataset.auth = 'in';
  $('result').replaceChildren(h('p', { class: 'error' }, t('Could not start: {error}. Is the server running?', { error: err.message })));
});
