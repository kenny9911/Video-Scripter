// Video Scripter front end. Plain ES modules, no build step.

import { t, lang, applyI18n, explain } from './i18n.js';
import { icon, hydrateIcons } from './icons.js';
import { showAuth, wireAccount, fmt, money } from './account.js';
import { wireTheme, wireLang, enhancePasswords } from './shell.js';
import { countSpoken, fitDuration, splitNarration, spokenText, MIN_DURATION, MAX_DURATION } from './narration.js';
import { wireLibrary } from './library.js';
import { wirePost } from './post.js';
import { wireWebSettings, wireBriefWeb, sourcesNode, readingNote } from './web.js';
import { wireVideo } from './video.js';
import { wirePublish } from './publish.js';

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
  styleIds: [], // the chips that are ticked: a style id, or "custom:<group>" for a group's own custom style
  customStyles: {}, // group id -> what the creator wrote for that group's custom style
  styleAuto: true, // the styles follow the brief: they are picked from the topic until the creator picks their own
  pick: null, // the last suggestion: { styleIds, alternatives, reason, by, model, key }
  hostLooks: ['', ''], // per host (A, B): '' designed by the scriptwriter | a preset id | 'custom'
  hostCustom: ['', ''], // per host: the creator's own description, used while its look is 'custom'
  // platformId -> { status, raw, script, error, plan, brief, abort, narration }
  // status: 'drafting' (the narration is being written) | 'narration' (it is open in the editor) |
  //         'running' (the script is being written) | 'done' | 'error' | 'stopped'
  runs: {},
  active: null,
  teleprompter: {},
  narrationMode: 'auto', // 'auto' with the script | 'draft' written first, then edited | 'own' the creator's own
  emptyNode: null, // the "No script yet" block, kept so it can be shown again
};

// The creator's library (素材库, library.js): set once the page knows who is signed in. Until then nothing is picked.
let library = { selected: () => [], setSelected() {}, has: () => false, open() {}, pick() {}, load() {}, added() {}, saveText: async () => null };

// The image post of a script (图文, post.js): set once the page knows the platforms. A run shows its script or its post (`run.view`).
let imagePost = { has: () => false, view: () => null };
// The video of a script (video.js): its voiceover spoken, then the file made in the browser.
let film = null;

const HISTORY_KEY = 'video-scripter.history';
const FORM_KEY = 'video-scripter.brief';
const FIELDS = ['topic', 'keyMessage', 'audience', 'tone', 'brand', 'cta', 'experience', 'reference'];

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.user) location.reload(); // the session ended: back to the log-in screen
  if (!res.ok) throw fault(data, res.status);
  return data;
}

/** A failure the server answered with, as an Error whose message says whose end it is on (i18n.js explain). */
const fault = (data, status) => new Error(explain(data.error || t('Request failed ({status})', { status }), data.cause));
const DROPPED = { side: 'app', code: 'dropped' };
const UNREADABLE = { side: 'provider', code: 'reply' };
/** What to show for a caught error: a request the browser could not finish is our end, and says so. */
// A request that never reached the server, or a reply that broke off on the way: the browser reports both as a TypeError.
const offline = (err) => err instanceof TypeError && /fetch|network|load failed|input stream/i.test(err.message);
const shown = (err) => (offline(err) ? explain(err.message, DROPPED) : err.message);

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
const plainVo = spokenText;

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
  state.runs[state.active]?.narration?.dom?.settle(); // an editor that was hidden could not measure its text
}

/** A button with an icon and a label, the way every action in the app is drawn. */
const iconBtn = (name, label, attrs = {}) => h('button', { class: 'btn', type: 'button', ...attrs }, icon(name, 16), h('span', {}, label));

// ---------- Brief form ----------

function selectedPlatforms() {
  return [...document.querySelectorAll('input[name="platform"]:checked')].map((i) => i.value);
}

// ---------- Aspect ratio (the frame of the video, and of every scene image and clip) ----------

/** The aspect for an id; an unknown one, or a script from before the option existed, is the first (vertical). */
const aspectOf = (id) => state.meta.aspects.find((a) => a.id === id) || state.meta.aspects[0];
const selectedAspect = () => aspectOf(document.querySelector('input[name="aspect"]:checked')?.value).id;
const setAspect = (id) => document.querySelectorAll('input[name="aspect"]').forEach((i) => (i.checked = i.value === aspectOf(id).id));
/** A script keeps the shape it was written in, whatever the form says now. */
const runAspect = (run) => aspectOf(run.brief?.aspectRatio);

// ---------- Visual style (one, or two blended; the first picked leads) ----------
// Every group ends with "Custom": a style the creator describes in their own words. On the form its id is
// "custom:<group>"; when it is sent or saved the words ride along in the id, "custom:<group>:<words>",
// which is the form the server reads (src/styles.mjs).

const MAX_CUSTOM_STYLE = 200; // as many characters as the server keeps
const customOf = (id) => {
  const m = /^custom:([^:]+)(?::([\s\S]*))?$/.exec(String(id));
  return m && state.meta.styleGroups.some((g) => g.id === m[1]) ? { group: m[1], text: (m[2] || '').trim() } : null;
};
const clip = (text, n = 14) => ([...text].length > n ? `${[...text].slice(0, n).join('')}…` : text);

/** A style by id. A custom one is made up from what was written for it: the words in the id, or in its group's box. */
function styleOf(id) {
  const custom = customOf(id);
  if (!custom) return state.meta.styles.find((s) => s.id === id);
  const text = custom.text || (state.customStyles[custom.group] || '').trim();
  const name = text ? t('Custom: {text}', { text: clip(text) }) : t('Custom');
  return { id: `custom:${custom.group}`, group: custom.group, custom: true, text, name: { en: name, zh: name }, blurb: text };
}
const styleNames = (ids) => (ids || []).map((id) => styleOf(id)?.name[lang]).filter(Boolean).join(' + ');

/** The chosen styles as they are sent and saved: a custom one carries its words, and one with nothing written is left out. */
const activeStyleIds = () =>
  state.styleIds
    .map((id) => {
      const custom = customOf(id);
      if (!custom) return id;
      const text = (state.customStyles[custom.group] || '').trim();
      return text ? `custom:${custom.group}:${text}` : '';
    })
    .filter(Boolean);

function refreshStyleHint() {
  const [a, b] = state.styleIds.map(styleOf);
  $('styleHint').textContent = !a
    ? t('No style chosen: the script and image model decide the look.')
    : [a, b].some((s) => s?.custom && !s.text)
      ? t('Describe the look you want in the box under its group. Until then it is not used.')
      : !b
        ? a.custom
          ? t('Custom: {text}', { text: a.text })
          : `${a.name[lang]}: ${t(a.blurb)}`
        : t('Blend: {a} leads, mixed with {b}.', { a: a.name[lang], b: b.name[lang] });
}

function setStyles(ids) {
  // A custom style that comes with its words (a saved brief, a script from the history) puts them back in its group's box.
  const picked = ids.map((id) => {
    const custom = customOf(id);
    if (!custom) return id;
    if (custom.text) state.customStyles[custom.group] = custom.text;
    return `custom:${custom.group}`;
  });
  state.styleIds = [...new Set(picked)].filter(styleOf).slice(-state.meta.maxStyles); // a third pick replaces the oldest
  document.querySelectorAll('input[name="style"]').forEach((i) => (i.checked = state.styleIds.includes(i.value)));
  for (const box of document.querySelectorAll('.style-custom')) {
    box.hidden = !state.styleIds.includes(`custom:${box.dataset.group}`);
    if (document.activeElement !== box) box.value = state.customStyles[box.dataset.group] || '';
  }
  refreshStyleHint();
  if ($('imageMode').options.length) refreshImageMode();
  refreshSummaries();
  refreshPick();
}

/** The mode only matters with two or three images; "Style comparison" also needs two styles picked. */
function refreshImageMode() {
  const many = Number($('imageCount').value) > 1;
  const mode = state.meta.imageModes.find((m) => m.id === $('imageMode').value);
  const styles = activeStyleIds().length;
  for (const o of $('imageMode').options) o.disabled = (state.meta.imageModes.find((m) => m.id === o.value).needsStyles || 0) > styles;
  $('imageMode').hidden = !many;
  $('imageModeHint').hidden = !many;
  $('imageModeHint').textContent = !mode ? '' : (mode.needsStyles || 0) > styles ? t('Pick two visual styles above to compare them. Until then this makes alternatives.') : mode.blurb[lang];
}

/** Caption for one image of a set: "Wide", "Start", a style name, or nothing for a plain take. */
function shotLabel(id) {
  if (!id) return '';
  if (id.startsWith('style-')) return styleOf(id.slice(6))?.name[lang] || '';
  return state.meta.shotLabels[id]?.[lang] || '';
}

function buildStyles() {
  const chip = (id, label, title, then) =>
    h(
      'label',
      { class: `chip${customOf(id) ? ' custom' : ''}`, title },
      h('input', { type: 'checkbox', name: 'style', value: id, onchange: (e) => (stopAuto(), setStyles(e.target.checked ? [...state.styleIds, id] : state.styleIds.filter((x) => x !== id)), then?.(e.target.checked)) }),
      h('span', {}, label),
    );
  $('styleGroups').replaceChildren(
    ...state.meta.styleGroups.map((g) => {
      // The group's own style, in the creator's words: the box shows while its chip is ticked.
      const box = h('input', { type: 'text', class: 'style-custom', 'data-group': g.id, maxlength: MAX_CUSTOM_STYLE, hidden: true, placeholder: t('Describe the look: medium, colours, light, texture'), 'aria-label': t('Custom style: {group}', { group: g.name[lang] }) });
      box.addEventListener('input', () => {
        stopAuto();
        state.customStyles[g.id] = box.value;
        refreshStyleHint();
        refreshImageMode();
      });
      return h(
        'div',
        { class: 'style-group' },
        h('span', { class: 'group-label' }, g.name[lang]),
        h(
          'div',
          { class: 'chips' },
          state.meta.styles.filter((s) => s.group === g.id).map((s) => chip(s.id, s.name[lang], t(s.blurb))),
          chip(`custom:${g.id}`, t('Custom…'), t('Describe your own look for this group'), (on) => on && box.focus()),
          box,
        ),
      );
    }),
  );
  setStyles([]);
}

// ---------- The look, picked from the topic ----------
// While "Pick the look for me" is ticked, the styles follow the brief: the server suggests one style to lead
// and perhaps a second for its tone (by rule, at once), and they are ticked for the creator. Ticking a style
// by hand, or having the model choose, ends that: the choice then stays as it is.

let pickSeq = 0;
/** What a suggestion is made from. While none of this has changed there is nothing new to ask. */
const pickBrief = () => ({ topic: $('topic').value.trim(), keyMessage: $('keyMessage').value.trim(), audience: $('audience').value.trim(), tone: $('tone').value.trim(), brand: $('brand').value.trim(), frameworkId: $('framework').value, platformId: selectedPlatforms()[0] || '', host: $('hostOn').checked ? { on: true } : undefined });
const sameIds = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);
const stopAuto = () => ((state.styleAuto = false), ($('styleAuto').checked = false));

/** The line under the switch: why these styles, and what else would fit. Shown while the suggestion is what is ticked. */
function refreshPick() {
  const pick = state.pick;
  const visible = Boolean(pick) && sameIds(pick.styleIds, activeStyleIds());
  $('stylePick').hidden = !visible;
  $('styleAsk').disabled = !$('topic').value.trim() || Boolean(state.asking);
  if (!visible) return;
  const by = pick.swapped ? t('Your choice from the suggestions.') : pick.by === 'model' ? t('Picked by {model}.', { model: pick.model || t('the model') }) : t('Picked for this topic.');
  $('stylePickText').replaceChildren(h('b', {}, by), pick.swapped ? '' : ` ${pick.reason}`);
  // An alternative takes the lead; the style it replaces is offered in its place.
  const swap = (id) => {
    stopAuto();
    state.pick = { ...pick, swapped: true, styleIds: [id, ...pick.styleIds.slice(1).filter((x) => x !== id)], alternatives: [pick.styleIds[0], ...pick.alternatives.filter((x) => x !== id)] };
    setStyles(state.pick.styleIds);
    saveForm();
  };
  const others = pick.alternatives.map(styleOf).filter(Boolean);
  $('stylePickAlts').replaceChildren(...(others.length ? [h('span', { class: 'hint' }, t('Also fits')), ...others.map((x) => h('button', { class: 'chip', type: 'button', title: t(x.blurb), onclick: () => swap(x.id) }, x.name[lang]))] : []));
}

/** Ask for the look of the brief as it stands, and tick it. `by` 'model' has the model in use choose; otherwise the rules do, at once. */
async function pickStyles(by = 'rules') {
  const brief = pickBrief();
  const key = JSON.stringify(brief);
  const seq = ++pickSeq;
  if (!brief.topic) {
    state.pick = null;
    if (state.styleAuto) setStyles([]);
    return refreshPick();
  }
  try {
    const r = await api('/api/styles/suggest', { method: 'POST', body: { ...brief, by, lang } });
    if (seq !== pickSeq) return; // the brief moved on while this was being answered
    state.pick = { ...r, key };
    setStyles(r.styleIds);
  } catch (err) {
    if (by === 'model') toast(shown(err));
  }
  refreshPick();
}

/** The brief changed: pick again shortly, when the styles are picked automatically and what they depend on moved. */
function pickSoon() {
  clearTimeout(pickSoon.timer);
  if (!state.styleAuto) return refreshPick();
  if (state.pick?.key === JSON.stringify(pickBrief())) return;
  pickSoon.timer = setTimeout(() => pickStyles(), 450);
}

/** Before a brief is sent: the styles that go with it are the ones for the brief as it is now. */
async function settlePick() {
  clearTimeout(pickSoon.timer);
  if (state.styleAuto && $('topic').value.trim() && state.pick?.key !== JSON.stringify(pickBrief())) await pickStyles();
}

function setStyleAuto(on) {
  state.styleAuto = Boolean(on);
  $('styleAuto').checked = state.styleAuto;
  if (state.styleAuto) pickStyles();
}

/** Have the model in use choose the look. Its choice stays: typing more does not swap it for the rules' pick. */
async function askModel() {
  if (!$('topic').value.trim() || state.asking) return;
  clearTimeout(pickSoon.timer);
  state.asking = true;
  $('styleAsk').classList.add('busy');
  refreshPick();
  await pickStyles('model');
  state.asking = false;
  $('styleAsk').classList.remove('busy');
  if (state.pick?.by === 'model') stopAuto();
  else if (state.pick) toast(t('No model answered, so the look was picked by rule.'));
  refreshPick();
  saveForm();
}

// ---------- On-screen host (a digital presenter who is the same person in every scene) ----------
// One host, or two when the structure is a conversation (A the host, B the guest). Each has a look: left to
// the scriptwriter ("Designed to fit the topic"), one of the ready-made ones, or the creator's own words.

const HOSTS = ['A', 'B'];
const speakersOf = () => frameworkOf($('framework').value)?.speakers || 1;

/** The host setting as it is sent and saved: nothing when no host is on screen. */
function hostValue() {
  if (!$('hostOn').checked) return undefined;
  return { on: true, looks: HOSTS.map((_, i) => (state.hostLooks[i] === 'custom' ? (state.hostCustom[i] || '').trim() : state.hostLooks[i] || '')) };
}

/** Put a host setting into the form: a look that is not one of the ready-made ones is the creator's own words. */
function setHost(host) {
  $('hostOn').checked = Boolean(host?.on);
  HOSTS.forEach((_, i) => {
    const look = String(host?.looks?.[i] || '');
    const preset = state.meta.hostPresets.some((p) => p.id === look);
    state.hostLooks[i] = !look ? '' : preset ? look : 'custom';
    if (look && !preset) state.hostCustom[i] = look;
  });
  refreshHost();
}

function refreshHost() {
  const on = $('hostOn').checked;
  const duo = speakersOf() === 2;
  $('hostFields').hidden = !on;
  for (const row of $('hostFields').children) {
    const i = HOSTS.indexOf(row.dataset.host);
    row.hidden = i > 0 && !duo;
    row.querySelector('.group-label').textContent = duo ? t(i ? 'B · guest' : 'A · host') : t('Look');
    const box = row.querySelector('input');
    row.querySelector('select').value = state.hostLooks[i];
    box.hidden = state.hostLooks[i] !== 'custom';
    if (document.activeElement !== box) box.value = state.hostCustom[i] || '';
    const preset = state.meta.hostPresets.find((p) => p.id === state.hostLooks[i]);
    const note = row.querySelector('.host-look');
    note.textContent = preset ? preset.look[lang] : '';
    note.hidden = !preset;
  }
  $('hostHint').hidden = !on;
  $('hostHint').textContent = duo
    ? t('This structure is a conversation: A is the host and B the guest. Both are written into the script and drawn the same way in every scene.')
    : t('The host is written into the script and drawn the same way in every scene. Make their portrait first, and scene images are drawn from it.');
  refreshSummaries();
}

function buildHost() {
  $('hostFields').replaceChildren(
    ...HOSTS.map((id, i) => {
      const sel = h('select', { 'aria-label': t('Look of host {id}', { id }) }, h('option', { value: '' }, t('Designed to fit the topic')), state.meta.hostPresets.map((p) => h('option', { value: p.id }, p.name[lang])), h('option', { value: 'custom' }, t('Custom…')));
      const box = h('input', { type: 'text', maxlength: state.meta.maxHostLook, hidden: true, placeholder: t('Describe the host: age, hair, clothes, bearing'), 'aria-label': t('Your description of host {id}', { id }) });
      sel.addEventListener('change', () => {
        state.hostLooks[i] = sel.value;
        refreshHost();
        if (sel.value === 'custom') box.focus();
      });
      box.addEventListener('input', () => (state.hostCustom[i] = box.value));
      return h('div', { class: 'host-row', 'data-host': id }, h('span', { class: 'group-label' }), h('div', { class: 'host-pick' }, sel, box, h('p', { class: 'hint host-look', hidden: true })));
    }),
  );
  $('hostOn').addEventListener('change', () => (refreshHost(), pickSoon()));
  refreshHost();
}

const IDEAS = {
  en: ['Why most people quit learning to code in week three', '3 pricing mistakes that quietly kill small cafés', 'What a 5-minute morning routine actually changes'],
  zh: ['为什么企业买了大模型却用不起来', '小餐馆定价最容易踩的三个坑', '普通人学 AI 最该先学的一件事'],
};

/** One-line summaries on the folded brief sections, and topic ideas while the topic is empty. */
function refreshSummaries() {
  const look = [styleNames(activeStyleIds()) || t('No style'), state.styleAuto && t('auto'), $('hostOn').checked && t(speakersOf() === 2 ? 'two hosts' : 'host'), $('autoImages').checked && t('{n} per scene', { n: $('imageCount').value })].filter(Boolean);
  $('lookSummary').textContent = look.join(' · ');
  const filled = FIELDS.filter((f) => f !== 'topic' && $(f).value.trim()).length + ($('ttsReady').checked ? 1 : 0);
  $('detailsSummary').textContent = filled ? t('{n} filled', { n: filled }) : t('Optional');
  $('topicIdeas').hidden = Boolean($('topic').value.trim());
}

// ---------- Length: Auto (the platform's usual length), one of the platform's lengths, or a custom number of seconds ----------

const clampSeconds = (v) => Math.min(MAX_DURATION, Math.max(MIN_DURATION, Math.round(Number(v))));
const lengthLabel = (d) => (d >= 120 && d % 60 === 0 ? `${d / 60} min` : `${d} s`);

/** The length asked for, in seconds as a string. '' is Auto. */
function durationValue() {
  if ($('duration').value !== 'custom') return $('duration').value;
  return Number($('durationCustom').value) > 0 ? String(clampSeconds($('durationCustom').value)) : '';
}

let lastPreset = ''; // the length that was chosen before "Custom"

/** The seconds field is shown, and has to be filled in, only while "Custom" is chosen. */
function syncCustomDuration() {
  const custom = $('duration').value === 'custom';
  $('durationCustomBox').hidden = !custom;
  $('durationCustom').disabled = !custom;
  if (!custom) lastPreset = $('duration').value;
}

/** Choose a length: one the platforms offer when there is such an option, otherwise as a custom number of seconds. */
function setDuration(value) {
  const seconds = String(value || '');
  if ([...$('duration').options].some((o) => o.value === seconds && seconds !== 'custom')) $('duration').value = seconds;
  else if (Number(seconds) > 0) {
    $('duration').value = 'custom';
    $('durationCustom').value = clampSeconds(seconds);
  } else $('duration').value = '';
  syncCustomDuration();
}

function refreshDurations() {
  const sel = $('duration');
  const keep = sel.value;
  const options = new Set();
  for (const id of selectedPlatforms()) platformOf(id).durations.forEach((d) => options.add(d));
  if (!options.size) [15, 30, 45, 60, 90].forEach((d) => options.add(d));
  sel.replaceChildren(
    h('option', { value: '' }, t('Auto')),
    ...[...options].sort((a, b) => a - b).map((d) => h('option', { value: d }, lengthLabel(d))),
    h('option', { value: 'custom' }, t('Custom…')),
  );
  sel.value = [...sel.options].some((o) => o.value === keep) ? keep : ''; // a length the platforms no longer offer -> Auto
  syncCustomDuration();
  refreshFit();
}

/** The picker changed. Choosing "Custom" starts from the length that was showing, so the field is never empty. */
function onDurationPick() {
  syncCustomDuration();
  if ($('duration').value !== 'custom') return;
  const field = $('durationCustom');
  if (!field.value) field.value = clampSeconds(lastPreset || platformOf(selectedPlatforms()[0])?.defaultDuration || 60);
  field.focus();
  field.select();
}

const frameworkOf = (id) => state.meta.frameworks.find((f) => f.id === id);
/** How fast a structure is spoken in a language: its own pace when it is a narration style that sets one. */
const paceFor = (framework, language) => framework?.pace?.[language] ?? state.meta.pace[language];

/**
 * A narration style is made for a length and a pace: say so under the picker. "Auto" follows the style, so
 * the hint only offers to change the length when one that does not suit the style was picked by hand.
 */
function refreshFit() {
  const f = frameworkOf($('framework')?.value);
  const box = $('frameworkFit');
  if (!box) return;
  box.hidden = !f?.length;
  if (!f?.length) return;
  const language = platformOf(selectedPlatforms()[0])?.lang || lang;
  const pace = language === 'zh' ? t('{n} characters per second', { n: paceFor(f, language) }) : t('{n} words per second', { n: paceFor(f, language) });
  const picked = Number(durationValue()) || 0;
  const off = picked > 0 && (picked < f.length.min || picked > f.length.max);
  $('frameworkFitText').textContent = t('Made for {min}–{max}, spoken at about {pace}.', { min: lengthLabel(f.length.min), max: lengthLabel(f.length.max), pace }) + (picked ? '' : ` ${t('Auto gives {n}.', { n: lengthLabel(f.length.default) })}`);
  $('frameworkFitUse').hidden = !off;
  $('frameworkFitUse').textContent = t('Use {n}', { n: lengthLabel(f.length.default) });
  box.classList.toggle('note', off);
}

/** The blurb under the structure picker, its warning when the style needs facts, and topic ideas that suit it. */
function refreshBlurb() {
  const f = frameworkOf($('framework').value);
  $('frameworkBlurb').textContent = f ? f.blurb[lang] : '';
  $('frameworkNeeds').hidden = !f?.needsReference || Boolean($('reference').value.trim());
  refreshFit();
  $('topicIdeaList').replaceChildren(
    ...(f?.topics?.[lang] || IDEAS[lang]).map((idea) =>
      h('button', { class: 'chip', type: 'button', onclick: () => (($('topic').value = idea), refreshSummaries(), saveForm(), $('topic').focus()) }, idea),
    ),
  );
}

// ---------- Narration mode (how the narration comes to be: with the script, drafted first, or the creator's own) ----------

const MODE = {
  auto: { cta: 'Generate scripts', hint: '' },
  draft: { cta: 'Draft the narration', hint: 'The narration is written first. Edit and refine it, then the script is built around it.' },
  own: { cta: 'Open the narration editor', hint: 'Paste or write your own narration. The script is built around it word for word.' },
};

/** The agent writes narration; with "My narration" there is none to write, only to review from the editor. */
function refreshAgent() {
  $('agent').closest('.agent-pick').classList.toggle('muted', state.narrationMode === 'own');
}

function setNarrationMode(mode) {
  state.narrationMode = MODE[mode] ? mode : 'auto';
  for (const b of $('narrationMode').children) b.setAttribute('aria-checked', String(b.dataset.mode === state.narrationMode));
  $('narrationModeHint').textContent = t(MODE[state.narrationMode].hint);
  $('narrationModeHint').hidden = !MODE[state.narrationMode].hint;
  if (!$('generate').disabled) $('generateLabel').textContent = t(MODE[state.narrationMode].cta);
  refreshAgent();
}

function saveForm() {
  const data = Object.fromEntries(FIELDS.map((f) => [f, $(f).value]));
  Object.assign(data, { platforms: selectedPlatforms(), framework: $('framework').value, duration: durationValue(), aspectRatio: selectedAspect(), ttsReady: $('ttsReady').checked, autoImages: $('autoImages').checked, imageCount: $('imageCount').value, imageMode: $('imageMode').value, styles: activeStyleIds(), styleAuto: state.styleAuto, host: hostValue() || null, narrationMode: state.narrationMode, agent: $('agent').checked, assetIds: library.selected(), webLinks: $('webLinks').checked, webSearch: $('webSearch').checked });
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
  setAspect(data.aspectRatio);
  // autoImages is not restored from a saved brief: it is remembered on the user's account (see buildForm).
  if ('imageCount' in data) $('imageCount').value = ['2', '3'].includes(String(data.imageCount)) ? String(data.imageCount) : '1';
  setHost(data.host);
  library.setSelected(data.assetIds); // the library files the brief is written from; none when it names none
  $('webLinks').checked = data.webLinks !== false; // links are read unless the brief says not to
  $('webSearch').checked = Boolean(data.webSearch);
  // Styles someone picked by hand stay theirs; a brief without any gets them picked from its topic.
  state.styleAuto = 'styleAuto' in data ? Boolean(data.styleAuto) : !data.styles?.length;
  $('styleAuto').checked = state.styleAuto;
  state.pick = null;
  setStyles(Array.isArray(data.styles) ? data.styles : []);
  if (state.meta.imageModes.some((m) => m.id === data.imageMode)) $('imageMode').value = data.imageMode;
  refreshImageMode();
  refreshDurations();
  setDuration(data.duration); // a length the platforms do not offer comes back as a custom one
  if (data.narrationMode) setNarrationMode(data.narrationMode); // a script from the history does not say: leave the choice alone
  if ('agent' in data) $('agent').checked = data.agent !== false;
  refreshAgent();
  refreshBlurb();
  refreshHost(); // one row or two: the structure says
  pickSoon();
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
  $('framework').append(
    ...state.meta.frameworkGroups.map((g) => h('optgroup', { label: g.name[lang] }, state.meta.frameworks.filter((f) => f.group === g.id).map((f) => h('option', { value: f.id }, f.name[lang])))),
  );
  $('framework').addEventListener('change', refreshBlurb);
  // A format led by a host (a podcast) comes with one: it is switched on when the format is chosen.
  $('framework').addEventListener('change', () => {
    if (frameworkOf($('framework').value)?.hosted && !$('hostOn').checked) {
      $('hostOn').checked = true;
      toast(t('This format is led by a host, so the on-screen host was switched on.'));
    }
    refreshHost();
  });
  $('reference').addEventListener('input', refreshBlurb);
  for (const b of $('narrationMode').children) b.addEventListener('click', () => (setNarrationMode(b.dataset.mode), saveForm()));
  // Arrow keys move the choice, as in any radio group.
  $('narrationMode').addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const all = [...$('narrationMode').children];
    const next = all[(all.findIndex((b) => b.dataset.mode === state.narrationMode) + step + all.length) % all.length];
    setNarrationMode(next.dataset.mode);
    saveForm();
    next.focus();
  });
  setNarrationMode('auto');
  $('agent').addEventListener('change', () => (refreshAgent(), saveForm()));
  $('frameworkFitUse').addEventListener('click', () => (setDuration(frameworkOf($('framework').value)?.length?.default), refreshFit(), saveForm()));
  $('aspects').append(...state.meta.aspects.map((a) => h('label', { class: 'chip' }, h('input', { type: 'radio', name: 'aspect', value: a.id }), h('span', {}, `${a.id} ${a.name[lang]}`))));
  setAspect();
  refreshDurations();
  $('duration').addEventListener('change', () => (onDurationPick(), refreshFit()));
  $('durationCustom').max = MAX_DURATION;
  $('durationCustom').placeholder = `${MIN_DURATION}–${MAX_DURATION}`;
  // Seconds outside the range are brought into it as soon as the field is left.
  $('durationCustom').addEventListener('change', (e) => (Number(e.target.value) > 0 && (e.target.value = clampSeconds(e.target.value)), refreshFit()));
  buildStyles();
  buildHost();
  $('styleAuto').addEventListener('change', (e) => setStyleAuto(e.target.checked));
  $('styleAsk').addEventListener('click', askModel);
  $('imageMode').append(...state.meta.imageModes.map((m) => h('option', { value: m.id }, m.name[lang])));
  $('imageCount').addEventListener('change', refreshImageMode);
  $('imageMode').addEventListener('change', refreshImageMode);
  refreshImageMode();
  $('briefForm').addEventListener('input', () => (refreshSummaries(), pickSoon()));
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
  pickSoon();
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

/**
 * The provider failed and the server is trying again by itself: say so while the creator waits. A reply that
 * broke off half-way is picked up where it stopped, so what has been written stays on screen.
 */
function noteRetry(platformId, run, info) {
  const about = { host: info.host || t('The provider'), status: info.status, n: info.attempt, of: info.of };
  run.notice = info.resumed
    ? t('{host} broke off in the middle of its reply. Picking it up where it stopped: attempt {n} of {of}.', about)
    : info.status
      ? t('{host} is not answering ({status}). Trying again: attempt {n} of {of}.', about)
      : t('{host} broke off before it started writing. Trying again: attempt {n} of {of}.', about);
  if (state.active === platformId && state.runs[platformId] === run) updateStream(run);
}

/** The web is being read for a run (the links in its brief, a search for its topic), or has been: the run keeps what was read. */
function noteWeb(platformId, run, data) {
  if (data.status === 'reading') run.webNote = readingNote(data);
  else {
    const { status: _, ...web } = data;
    Object.assign(run, { web, webNote: '' });
  }
  if (state.active === platformId && state.runs[platformId] === run) render();
}

const MAX_PARTS = 8; // requests one script may take (the server's limit: src/limits.mjs)
const MIN_PROGRESS = 16; // characters a request must add for the next one to be worth making
const RECONNECT_MS = 1500;

/** Wait, unless the run is stopped first. */
const pause = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Stopped', 'AbortError'));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), reject(new DOMException('Stopped', 'AbortError'))), { once: true });
  });

async function runPlatform(platformId, brief) {
  const abort = new AbortController();
  // A script built around a narration keeps the editor's copy, so it can be opened and changed again.
  const before = state.runs[platformId];
  const narration = brief.narration && before?.narration;
  // The last step of the agent's chain: the steps before it stay on show while the script is written.
  const chained = brief.narrationBy === 'agent' && before?.steps ? { steps: before.steps, skills: before.skills, chain: true, retry: 'auto' } : null;
  const run = (state.runs[platformId] = { status: 'running', raw: '', brief, abort, styleIds: brief.styleIds, ...(narration && { narration }), ...chained });
  runChanged(platformId);
  try {
    // One request writes most scripts. A long one from a slow provider may take more: a host that limits how
    // long a request runs ends it with `handover`, and the next request carries the reply on from what is
    // on screen. A connection that drops in the middle of a reply is picked up the same way.
    for (let part = 1; run.status === 'running'; part++) {
      const had = run.raw.length;
      let handed = false;
      let dropped = null;
      try {
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...brief, platformId, ...(part > 1 && { resume: { text: run.raw, part } }) }),
          signal: abort.signal,
        });
        if (!res.ok) throw fault(await res.json().catch(() => ({})), res.status);
        for await (const { event, data } of sse(res)) {
          if (event === 'plan') {
            run.plan = data;
            if (state.active === platformId) render(); // the line under the progress bar now says which model is writing
          } else if (event === 'retry') noteRetry(platformId, run, data);
          else if (event === 'web') noteWeb(platformId, run, data);
          else if (event === 'delta') {
            run.raw += data.text;
            run.notice = '';
            if (state.active === platformId) updateStream(run);
          } else if (event === 'error') throw fault(data);
          else if (event === 'handover') handed = true;
          else if (event === 'done') {
            if (data.script) {
              run.script = data.script;
              run.status = 'done';
              run.historyId = data.historyId;
              if (run.narration) run.narration.dirty = false; // it is a script now, and in the history
              if (data.entry) {
                state.history.unshift(data.entry);
                run.plan = { ...run.plan, ...data.entry.plan }; // says whether a locked narration had to be put back
                run.media = savedMedia(data.entry); // the creator's own pictures and clips are already in the scenes that show them
              }
              renderHistory();
            } else {
              run.raw = data.raw || run.raw;
              throw new Error(explain(t("The model's reply could not be read as a script ({reason}). The raw reply is shown below.", { reason: data.parseError }), UNREADABLE));
            }
          }
        }
      } catch (err) {
        if (!offline(err)) throw err;
        dropped = err;
      }
      if (run.status !== 'running') break;
      // The request is over and the script is not. It is carried on only while each request adds to it.
      if (run.raw.length - had < MIN_PROGRESS || part >= MAX_PARTS) throw dropped || new Error(explain(t('The connection closed before the script was finished.'), DROPPED));
      run.notice = handed
        ? t('This script is taking longer than one request may run. Carrying on where it stopped: part {n}.', { n: part + 1 })
        : t('The connection closed in the middle of the script. Picking it up where it stopped: part {n}.', { n: part + 1 });
      if (state.active === platformId) updateStream(run);
      if (!handed) await pause(RECONNECT_MS, abort.signal); // give a server that is restarting a moment
    }
  } catch (err) {
    run.status = err.name === 'AbortError' ? 'stopped' : 'error';
    run.error = err.name === 'AbortError' ? t('Stopped.') : shown(err);
  }
  runChanged(platformId);
  if (run.status === 'done' && $('autoImages').checked) autoImages(run);
}

/**
 * A run changed state. It is redrawn when it is the tab on screen; otherwise only the tab strip is, because
 * the tab on screen may be a narration editor someone is typing in, and rebuilding it would drop the cursor.
 */
function runChanged(platformId) {
  if (state.active === platformId || !state.runs[state.active]) return render();
  renderTabs();
  state.runs[state.active].narration?.dom?.repaint();
}

/** The brief as the form has it now. */
function collectBrief() {
  const brief = Object.fromEntries(FIELDS.map((f) => [f, $(f).value.trim()]));
  return Object.assign(brief, { frameworkId: $('framework').value, duration: durationValue() || undefined, aspectRatio: selectedAspect(), ttsReady: $('ttsReady').checked, styleIds: activeStyleIds(), host: hostValue(), agent: $('agent').checked, assetIds: library.selected().length ? library.selected() : undefined, webLinks: $('webLinks').checked ? undefined : false, webSearch: ($('webSearch').checked && !$('webSearch').disabled) || undefined });
}

const isWriting = (run) => run.status === 'running' || run.status === 'drafting';
const anyWriting = () => Object.values(state.runs).some(isWriting);

/** Start over with the platforms picked in the form; every earlier tab goes. */
function resetRuns() {
  state.runs = {};
  state.teleprompter = {};
  const ids = selectedPlatforms();
  state.active = ids[0];
  return ids;
}

/** Write scripts. Without `platformIds` this starts over with the platforms in the form; with them, only those tabs are rewritten. */
async function generate(platformIds, brief = collectBrief()) {
  saveForm();
  platformIds ??= resetRuns();
  setView('script');
  setBusy(true);
  await Promise.all(platformIds.map((id) => runPlatform(id, brief)));
  setBusy(anyWriting());
}

/**
 * Write again what a tab holds: the narration draft, the agent's whole chain (a new narration and the script
 * around it), or the script alone (around the same narration when it was built on the creator's own).
 */
function rerun(platformId) {
  const run = state.runs[platformId];
  if (run?.retry === 'draft') return draftNarrations([platformId]);
  if (run?.retry === 'auto' || run?.brief?.narrationBy === 'agent' || run?.plan?.narration?.agent) return $('agent').checked ? draftNarrations([platformId], { chain: true }) : generate([platformId]);
  return generate([platformId], run?.brief?.narration ? { ...collectBrief(), narration: run.brief.narration, card: run.narration?.card || run.script?.card || undefined } : undefined);
}

function setBusy(busy) {
  $('generate').disabled = busy;
  $('generateLabel').textContent = busy ? t('Generating…') : t(MODE[state.narrationMode].cta);
  $('stop').hidden = !busy;
  refreshMediaStatus();
}

/** The form's main button: scripts in one go, or the narration first (drafted, or the creator's own). */
function start() {
  if (!mayReplaceRuns()) return;
  if (state.narrationMode === 'draft') return draftNarrations();
  if (state.narrationMode === 'own') return openEditors();
  // With the script: the agent writes the narration, then the script is built around it, as two requests.
  return $('agent').checked ? draftNarrations(undefined, { chain: true }) : generate();
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

/** The media saved with a script, as a run keeps it: run.media[sceneId][kind] = { status, urls, shots }. */
function savedMedia(entry) {
  const media = {};
  for (const [sceneId, kinds] of Object.entries(entry.media || {})) {
    media[sceneId] = Object.fromEntries(Object.entries(kinds).map(([kind, m]) => [kind, { status: 'done', urls: m.urls?.length ? m.urls : [m.url], shots: m.shots }]));
  }
  return media;
}

/** The voice saved with a script, as a run keeps it: each scene's recording by its address. */
function savedVoice(entry) {
  if (!entry.voice?.scenes) return null;
  return { ...entry.voice, scenes: Object.fromEntries(Object.entries(entry.voice.scenes).map(([id, v]) => [id, { url: `/api/voice/file?id=${entry.id}&name=${v.name}`, seconds: v.seconds, say: v.say || '' }])) };
}

/**
 * Show a saved script and put the brief it was written from back into the form, so it can be edited and
 * generated again. Generating always saves a new history entry: the one opened here is never changed.
 */
function openHistory(entry) {
  if (!mayReplaceRuns()) return;
  const media = savedMedia(entry);
  const brief = entry.brief?.topic ? entry.brief : null; // an imported script may have no brief
  if (brief) {
    fillForm({ ...brief, platforms: [entry.platformId], framework: brief.frameworkId, styles: brief.styleIds, styleAuto: false });
    $('formError').hidden = true;
    saveForm();
    toast(t('Brief restored from this script'));
  }
  state.runs = { [entry.platformId]: { status: 'done', raw: '', brief, plan: entry.plan, script: entry.script, historyId: entry.id, media, styleIds: entry.brief?.styleIds || [], post: entry.post || null, voice: savedVoice(entry), published: entry.published || [] } };
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
                e.post?.cards?.length > 0 && h('span', {}, t('Image post')),
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
  const L = [`# ${s.title}`, '', `> ${s.logline}`, '', `**${t('Platform')}:** ${p.name} · **${t('Length')}:** ${s.scenes.at(-1).end}s · **${t('Aspect ratio')}:** ${runAspect(run).id}`, ''];
  if (s.card) L.push(`## ${t('Viewpoint card')}`, '', ...cardMarkdown(s.card), '');
  if (s.cast?.length) L.push(`## ${t(s.cast.some((c) => c.look) ? 'On-screen host' : 'Speakers')}`, '', ...s.cast.flatMap((c) => [`- **${c.id}${c.name ? ` · ${c.name}` : ''}**${c.role ? ` (${c.role})` : ''}`, c.look && `  - ${t('Look')}: ${c.look}`, c.voice && `  - ${t('Voice')}: ${c.voice}`].filter(Boolean)), '');
  if (s.whiteboard) L.push(`## ${t('Whiteboard blueprint')}`, '', '```', s.whiteboard, '```', '');
  L.push(`## ${t('Hook options')}`, '', ...s.hookOptions.map((o) => `- ${o.type ? `**${o.type}:** ` : ''}${plainVo(o.line)}`), '');
  L.push(`## ${t('Script')}`, '');
  for (const sc of s.scenes) {
    L.push(`### ${fmtTime(sc.start)}–${fmtTime(sc.end)} · ${sc.stage}`, '', `**${t('Voiceover')}:** ${sc.voiceover}`, '');
    if (sc.onScreenText) L.push(`- **${t('On screen')}:** ${sc.onScreenText}`);
    if (sc.visual) L.push(`- **${t('Visual')}:** ${sc.visual}`);
    if (sc.camera) L.push(`- **${t('Camera')}:** ${sc.camera}`);
    if (sc.host) L.push(`- **${t('In frame')}:** ${[...sc.host].join(' + ')}`);
    if (sc.asset) L.push(`- **${t('From your library')}:** ${sc.asset.name}`);
    if (sc.sfx) L.push(`- **${t('Sound')}:** ${sc.sfx}`);
    L.push('');
  }
  L.push(`## ${t('Voiceover only')}`, '', s.scenes.map((sc) => plainVo(sc.voiceover)).join('\n\n'), '');
  L.push(`## ${t('Publishing package')}`, '', `**${t('Titles')}**`, '', ...s.publish.titles.map((title, i) => `${i + 1}. ${title}`), '');
  if (s.publish.coverText) L.push(`**${t('Cover text')}:** ${s.publish.coverText}`, '');
  L.push(`**${t('Description')}**`, '', s.publish.description, '');
  if (s.publish.shareLine) L.push(`**${t('Line for sharing')}:** ${s.publish.shareLine}`, '');
  L.push(`**${t('Hashtags')}:** ${s.publish.hashtags.join(' ')}`, '', `**${t('Pinned comment')}:** ${s.publish.pinnedComment}`, '');
  if (s.publish.chapters?.length) L.push(`**${t('Chapters')}**`, '', ...s.publish.chapters.map((c) => `- ${c.time} ${c.title}`.trimEnd()), '');
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

/** Keep a scene's finished media on the script's history entry too, so it is there when the script is opened again. */
function rememberMedia(run, sc, kind, m) {
  const entry = state.history.find((e) => e.id === run.historyId);
  if (entry) ((entry.media ??= {})[sc.id] ??= {})[kind] = { url: m.urls[0], urls: m.urls, shots: m.shots };
}

/** Make a scene's image or clip from the script. With `asset` (a picture from the library) the image is drawn from that picture and the scene. */
async function startMedia(run, sc, kind, asset = null) {
  const store = mediaOf(run, sc);
  const m = (store[kind] = { status: 'running', note: '', count: kind === 'image' ? Number($('imageCount').value) || 1 : 1 });
  const paint = () => (store.paint?.(), refreshMediaStatus());
  const body = { ...sc, cast: run.script.cast, historyId: run.historyId, sceneId: sc.id, aspectRatio: runAspect(run).id, styleIds: run.styleIds?.length ? run.styleIds : activeStyleIds(), ...(asset && { assetId: asset.id }) };
  paint();
  try {
    if (kind === 'image') ({ urls: m.urls, shots: m.shots, referenced: m.referenced, from: m.from } = await makeImage(body));
    else m.urls = [await makeVideo(body, (p) => ((m.note = p ? ` ${Math.round(p)}%` : ''), paint()))];
    m.status = 'done';
    rememberMedia(run, sc, kind, m);
  } catch (err) {
    m.status = 'error';
    m.error = err.message;
  }
  paint();
}

/** Use a picture or a clip from the library as a scene's image or clip, as it is. */
async function placeAsset(run, sc, asset) {
  const store = mediaOf(run, sc);
  const m = (store[asset.kind] = { status: 'running', note: '', count: 1 });
  const paint = () => (store.paint?.(), refreshMediaStatus());
  paint();
  try {
    ({ urls: m.urls, shots: m.shots } = await api('/api/media/asset', { method: 'POST', body: { historyId: run.historyId, sceneId: sc.id, assetId: asset.id } }));
    m.status = 'done';
    rememberMedia(run, sc, asset.kind, m);
  } catch (err) {
    m.status = 'error';
    m.error = err.message;
  }
  paint();
}

/** Open the library to choose a scene's picture or clip: one of the creator's own as it is, or a new image drawn from one. */
function pickForScene(run, sc) {
  const canDraw = activeGw().image.ready;
  library.pick({
    title: t('A picture or clip for scene {n}', { n: sc.id }),
    hint: canDraw ? t('Use one of your own files as it is, or have a new image drawn from a picture and what this scene says.') : t('Use one of your own files as this scene’s picture or clip.'),
    kinds: ['image', 'video'],
    actions: (a) =>
      [
        { label: a.kind === 'video' ? t('Use this clip') : t('Use this picture'), primary: true, run: () => placeAsset(run, sc, a) },
        a.kind === 'image' && canDraw && { label: t('Generate from it'), icon: 'sparkles', title: t('A new image is drawn from this picture and what the scene says.'), run: () => startMedia(run, sc, 'image', a) },
      ].filter(Boolean),
  });
}

/** Save a generated image or clip to the library, so other scripts can use it. */
async function keepInLibrary(url, name, btn) {
  btn.disabled = true;
  try {
    library.added((await api('/api/assets/keep', { method: 'POST', body: { url, name } })).asset);
    toast(t('Saved to your library'));
  } catch (err) {
    toast(err.message);
    btn.disabled = false;
  }
}

/** The "generate images with the script" option: one image per scene, two at a time. */
async function autoImages(run) {
  if (!activeGw().image.ready) return toast(t('No image model is set: add one under LLM settings → Images and videos'));
  const todo = run.script.scenes.filter((sc) => sc.visual && !mediaOf(run, sc).image);
  state.autoRun = { done: 0, total: todo.length };
  refreshMediaStatus();
  // The hosts' portraits come first: every scene with a host is then drawn from them.
  for (const c of run.script.cast || []) if (c.look && !hostStore(run, c).image) await startHost(run, c);
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
  $('navBusy').hidden = !busy && !anyWriting();
}

/**
 * The large view of a scene's images, opened by clicking one. `items` is [{ url, label }]; with several,
 * the arrows (or the ← → keys) step through them. Esc, the close button, or a click on the image or
 * around it closes the view. `aspect` (from the script) sizes the picture to fit the window.
 */
function viewImages(items, at, alt, aspect) {
  const img = h('img', { alt, title: t('Close'), onclick: () => dlg.close() });
  const caption = h('span', { class: 'lightbox-caption' });
  const save = h('a', { class: 'btn small', target: '_blank', rel: 'noopener' }, t('Save'));
  const many = items.length > 1;
  const step = (label, by) => h('button', { class: `icon-btn ${by < 0 ? 'prev' : 'next'}`, type: 'button', 'aria-label': label, title: label, onclick: () => show(at + by) }, icon('chevron'));
  const dlg = h(
    'dialog',
    { class: 'lightbox', 'aria-label': alt, style: `--ar:${aspect.w / aspect.h}` },
    img,
    h('div', { class: 'lightbox-bar' }, caption, many && step(t('Previous image'), -1), many && step(t('Next image'), 1), save, h('button', { class: 'icon-btn', type: 'button', autofocus: true, 'aria-label': t('Close'), onclick: () => dlg.close() }, icon('x'))),
  );
  function show(i) {
    at = (i + items.length) % items.length;
    const { url, label } = items[at];
    img.src = url;
    save.href = url;
    save.download = url.split('/').pop().split('?')[0];
    caption.textContent = [many && `${at + 1} / ${items.length}`, label].filter(Boolean).join(' · ');
  }
  dlg.addEventListener('keydown', (e) => many && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && show(at + (e.key === 'ArrowLeft' ? -1 : 1)));
  dlg.addEventListener('click', (e) => e.target === dlg && dlg.close());
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  show(at);
  dlg.showModal();
}

/** Buttons and results under one scene. */
function sceneMedia(run, sc) {
  const g = activeGw();
  const store = mediaOf(run, sc);
  const kinds = ['image', 'video'].filter((k) => g[k].ready || store[k]);
  const own = library.has('image') || library.has('video'); // the creator has pictures or clips of their own to use
  if (!sc.visual || (!kinds.length && !own)) return null;
  const box = h('div', { class: 'media', 'data-aspect': runAspect(run).id });
  const title = run.script.title || t('Script');

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
                kind === 'image'
                  ? h(
                      'button',
                      { class: 'shot-open', type: 'button', title: t('View larger'), onclick: () => viewImages(m.urls.map((u, n) => ({ url: u, label: shotLabel(m.shots?.[n]) })), i, t('Generated image for scene {n}', { n: sc.id }), runAspect(run)) },
                      h('img', { src: url, alt: t('Generated image for scene {n}', { n: sc.id }), loading: 'lazy' }),
                    )
                  : h('video', { src: url, controls: true, playsinline: true, preload: 'metadata' }),
                h(
                  'div',
                  { class: 'shot-actions' },
                  h('a', { class: 'btn small', href: url, download: url.split('/').pop().split('?')[0] || `scene-${sc.id}`, target: '_blank', rel: 'noopener' }, t('Save')),
                  url.startsWith('/media/') && !url.endsWith('.svg') && m.shots?.[i] !== 'library' && h('button', { class: 'btn small', type: 'button', title: t('Saves this to your library, so other scripts can use it.'), onclick: (e) => keepInLibrary(url, `${title} · ${t('scene {n}', { n: sc.id })}`, e.currentTarget) }, t('To library')),
                ),
              ),
            ),
          ),
        busy &&
          h(
            'div',
            { class: 'shots', role: 'status' },
            Array.from({ length: m.count || 1 }, () => h('div', { class: 'shot loading' }, h('div', { class: 'ph' }, h('span', { class: 'spin' }), h('span', {}, t(kind === 'image' ? 'Generating image…' : 'Generating video…'))))),
          ),
        m?.status === 'done' && m.from && h('span', { class: 'hint' }, t('Drawn from your picture “{name}”', { name: m.from })),
        m?.status === 'done' && m.referenced && !m.from && h('span', { class: 'hint' }, t('Drawn from the host portrait')),
        m?.status === 'error' && h('p', { class: 'error' }, m.error),
        h(
          'div',
          { class: 'actions' },
          g[kind].ready && iconBtn(busy ? 'refresh' : kind, label, { class: `btn small${busy ? ' busy' : ''}`, disabled: busy, 'aria-busy': busy ? 'true' : null, onclick: () => startMedia(run, sc, kind) }),
        ),
      );
    });

  // The creator's own files: one as it is, or a new image drawn from one of their pictures.
  const fromLibrary = () => own && h('div', { class: 'media-item' }, h('div', { class: 'actions' }, iconBtn('folder', t('From library'), { class: 'btn small', title: t('Use one of your own pictures or clips in this scene.'), onclick: () => pickForScene(run, sc) })));
  store.paint = () => box.replaceChildren(...view(), ...[fromLibrary()].filter(Boolean));
  store.paint();
  return box;
}

// ---------- The cast: who speaks, who is on screen, and the portrait every scene of a host is drawn from ----------

const hostStore = (run, c) => ((run.media ??= {})[`host${c.id}`] ??= {});

/** Make (or remake) a host's reference portrait, in the frame and the style of the script. */
async function startHost(run, c) {
  const store = hostStore(run, c);
  const m = (store.image = { status: 'running' });
  const paint = () => (store.paint?.(), refreshMediaStatus());
  paint();
  try {
    const r = await api('/api/media/host', { method: 'POST', body: { historyId: run.historyId, hostId: c.id, cast: run.script.cast, aspectRatio: runAspect(run).id, styleIds: run.styleIds?.length ? run.styleIds : activeStyleIds() } });
    m.urls = [r.url];
    m.status = 'done';
    const entry = state.history.find((e) => e.id === run.historyId);
    if (entry) ((entry.media ??= {})[`host${c.id}`] ??= {}).image = { url: r.url, urls: [r.url] };
  } catch (err) {
    m.status = 'error';
    m.error = err.message;
  }
  paint();
}

/** Fix a host of this script in the brief, so the next script has the same person. */
function keepHost(c) {
  const i = HOSTS.indexOf(c.id);
  $('hostOn').checked = true;
  state.hostLooks[i] = 'custom';
  state.hostCustom[i] = [...c.look].slice(0, state.meta.maxHostLook).join('');
  refreshHost();
  saveForm();
  toast(t('This look is now fixed in the brief: the next script has the same host.'));
}

/** The people of a script: each with their look and voice, and for a host on screen the portrait and its buttons. */
function castSection(run) {
  const cast = run.script.cast || [];
  if (!cast.length) return null;
  const seen = cast.some((c) => c.look);
  const aspect = runAspect(run);
  const card = (c) => {
    const store = hostStore(run, c);
    const box = h('div', { class: 'host-card' });
    const view = () => {
      const m = store.image;
      const busy = m?.status === 'running';
      const url = m?.status === 'done' ? m.urls[0] : '';
      const alt = t('Portrait of host {id}', { id: c.id });
      return [
        c.look &&
          h(
            'div',
            { class: 'host-portrait', style: `--ar:${aspect.w / aspect.h}` },
            url
              ? h('button', { class: 'shot-open', type: 'button', title: t('View larger'), onclick: () => viewImages([{ url, label: c.name || c.id }], 0, alt, aspect) }, h('img', { src: url, alt, loading: 'lazy' }))
              : h('div', { class: `host-ph${busy ? ' loading' : ''}`, role: busy ? 'status' : null }, busy ? [h('span', { class: 'spin' }), h('span', {}, t('Generating image…'))] : icon('user', 28)),
          ),
        h(
          'div',
          { class: 'host-info' },
          h('div', { class: 'host-who' }, h('span', { class: 'host-id' }, c.id), h('b', {}, c.name || t('Host {id}', { id: c.id })), c.role && h('span', { class: 'hint' }, c.role)),
          (c.look || c.voice) && h('dl', { class: 'cues' }, c.look && [h('dt', {}, t('Look')), h('dd', {}, c.look)], c.voice && [h('dt', {}, t('Voice')), h('dd', {}, c.voice)]),
          m?.status === 'error' && h('p', { class: 'error' }, m.error),
          c.look &&
            h(
              'div',
              { class: 'actions' },
              activeGw().image.ready && iconBtn(busy ? 'refresh' : 'image', busy ? t('Making portrait…') : url ? t('Redo portrait') : t('Generate portrait'), { class: `btn small${busy ? ' busy' : ''}`, disabled: busy, 'aria-busy': busy ? 'true' : null, onclick: () => startHost(run, c) }),
              url && h('a', { class: 'btn small', href: url, download: url.split('/').pop().split('?')[0], target: '_blank', rel: 'noopener' }, t('Save')),
              iconBtn('check', t('Keep this host'), { class: 'btn small', title: t('Fixes this look in the brief, so the next script has the same host.'), onclick: () => keepHost(c) }),
            ),
        ),
      ].filter(Boolean);
    };
    store.paint = () => box.replaceChildren(...view());
    store.paint();
    return box;
  };
  return h(
    'div',
    { class: 'section' },
    h('div', { class: 'section-head' }, h('h3', {}, t(seen ? 'On-screen host' : 'Speakers'))),
    h('div', { class: 'cast' }, cast.map(card)),
    seen && h('p', { class: 'hint' }, t('Make the portrait first: every scene with this host is then drawn from it, so the face stays the same. It is also the picture to give a talking-avatar tool.')),
  );
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
    if (!res.ok) throw fault(await res.json().catch(() => ({})), res.status);
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

// ---------- Narration first: draft it or bring your own, edit and refine it, then build the script around it ----------
// A run's narration is { beats: [{ id, stage, text, prev, busy }], title, target, undo, dirty, busy, card, report }.
// `target` is the plan for the brief as the form has it (story line, length, budget): what there is room for.
// `card` is the viewpoint card the agent wrote the narration to; `report` is what the measured checks found
// ({ findings, errors, warns, stats, notes, beatIds }), refreshed as the narration changes.

let beatSeq = 0;
const newBeat = (b = {}) => ({ id: ++beatSeq, stage: b.stage || '', text: b.text || '' });
const showsEditor = (run) => Boolean(run?.narration) && (run.status === 'narration' || Boolean(run.editing));
const filledBeats = (run) => run.narration.beats.filter((b) => b.text.trim());
const forServer = (beats) => beats.map(({ stage, text }) => ({ stage, text: text.trim() }));
const narrationText = (run) => filledBeats(run).map((b) => b.text.trim()).join('\n\n');
const scriptLang = (platformId, run) => run.plan?.lang || (run.plan?.unit === '汉字' ? 'zh' : run.plan?.unit ? 'en' : platformOf(platformId).lang);

/** True when no narration that would be lost is on screen, or the user agrees to let it go. */
function mayReplaceRuns() {
  const atRisk = Object.values(state.runs).some((run) => showsEditor(run) && narrationText(run) && (run.status === 'narration' || run.narration.dirty));
  return !atRisk || confirm(t('Replace the narration you are editing? It has not been turned into a script yet.'));
}

/** What there is room for, when the server could not say (no topic yet): the platform's usual length. */
function fallbackTarget(platformId) {
  const p = platformOf(platformId);
  const pace = paceFor(frameworkOf($('framework').value), p.lang);
  return { timeline: [], duration: p.defaultDuration, lang: p.lang, pace, budget: Math.round(p.defaultDuration * pace), unit: p.lang === 'zh' ? '汉字' : 'words' };
}

async function loadTarget(platformId) {
  const run = state.runs[platformId];
  if (!run?.narration) return;
  try {
    const target = await api('/api/plan', { method: 'POST', body: { ...collectBrief(), platformId } });
    if (run.narration) run.narration.target = target;
  } catch {
    run.narration.target ??= fallbackTarget(platformId);
  }
}

/** The brief changed while an editor is open: what there is room for may have changed with it. */
function refreshTargets() {
  clearTimeout(refreshTargets.timer);
  refreshTargets.timer = setTimeout(async () => {
    const open = Object.entries(state.runs).filter(([, run]) => showsEditor(run));
    await Promise.all(open.map(([id]) => loadTarget(id)));
    for (const [id, run] of open) {
      run.narration.dom?.repaint();
      recheck(id);
    }
  }, 400);
}

/** A report with the ids of the beats its findings point at (the server knows beats by their position). */
const withBeatIds = (report, beats) => report && { ...report, beatIds: beats.map((b) => b.id) };

/**
 * Measure the narration again after it changed: length, breath-length sentences, wrap-up phrases, throttled
 * words, missing names, rhythm. No model is called. The editor's notes from the last review are kept.
 */
async function recheck(platformId) {
  const run = state.runs[platformId];
  const n = run?.narration;
  if (!n) return;
  const beats = filledBeats(run);
  if (!beats.length || !$('topic').value.trim()) {
    n.report = null;
    return n.dom?.paintChecks();
  }
  const seq = (n.checkSeq = (n.checkSeq || 0) + 1);
  try {
    const report = await api('/api/narration/check', { method: 'POST', body: { ...collectBrief(), platformId, narration: forServer(beats), card: n.card || undefined } });
    if (state.runs[platformId]?.narration !== n || n.checkSeq !== seq) return; // the narration moved on while this was measured
    n.report = { ...withBeatIds(report, beats), notes: n.report?.notes || [], rounds: n.report?.rounds || 0, reviewed: Boolean(n.report?.reviewed) };
    n.dom?.paintChecks();
  } catch {
    // The check is a help, not a gate: the editor works without it.
  }
}
const recheckSoon = (platformId) => (clearTimeout(recheckSoon.timer), (recheckSoon.timer = setTimeout(() => recheck(platformId), 700)));


// Narration that is not a script yet is kept in this browser, per user, so a reload does not lose it.
const draftsKey = () => `video-scripter.narration.${state.user.id}`;

function saveDrafts() {
  const out = {};
  for (const [id, run] of Object.entries(state.runs)) {
    if (showsEditor(run) && !run.script && narrationText(run)) out[id] = { beats: forServer(run.narration.beats), title: run.narration.title || '', brief: run.brief || null, card: run.narration.card || null };
  }
  try {
    if (Object.keys(out).length) localStorage.setItem(draftsKey(), JSON.stringify(out));
    else localStorage.removeItem(draftsKey());
  } catch {}
}
const saveDraftsSoon = () => (clearTimeout(saveDraftsSoon.timer), (saveDraftsSoon.timer = setTimeout(saveDrafts, 400)));

async function restoreDrafts() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(draftsKey()) || 'null');
  } catch {}
  const ids = Object.keys(saved || {}).filter((id) => platformOf(id) && Array.isArray(saved[id]?.beats));
  if (!ids.length || Object.keys(state.runs).length) return;
  for (const id of ids) state.runs[id] = { status: 'narration', raw: '', brief: saved[id].brief, styleIds: saved[id].brief?.styleIds || [], narration: { beats: saved[id].beats.map(newBeat), title: saved[id].title, card: saved[id].card || null } };
  state.active = ids[0];
  await Promise.all(ids.map(loadTarget));
  render();
  ids.forEach(recheck);
}

/** Keep what the agent says about a step: the skills it picked, where it is, and what a step found. */
function noteStep(run, data) {
  run.steps ??= [];
  const step = run.steps.find((x) => x.id === data.id);
  if (step) Object.assign(step, data);
  else run.steps.push({ ...data });
  if (data.skills) run.skills = data.skills;
}

/** One streamed request of a run: plan and step events are kept on the run, text goes to the raw view. Returns the `done` data. */
async function streamRun(platformId, run, url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: run.abort.signal });
  if (!res.ok) throw fault(await res.json().catch(() => ({})), res.status);
  let done = null;
  for await (const { event, data } of sse(res)) {
    if (event === 'plan') run.plan = { ...run.plan, ...data };
    else if (event === 'step') {
      noteStep(run, data);
      if (state.active === platformId && state.runs[platformId] === run) render();
    } else if (event === 'retry') noteRetry(platformId, run, data);
    else if (event === 'web') noteWeb(platformId, run, data);
    else if (event === 'delta') {
      run.raw += data.text;
      run.notice = '';
      if (state.active === platformId && state.runs[platformId] === run) updateStream(run);
    } else if (event === 'error') throw fault(data);
    else if (event === 'done') done = data;
  }
  return done;
}

/**
 * Have the narration of one platform written. With the agent on, that is two requests: plan and write, then
 * review (so a slow model never has one request carry two long calls). With `chain`, the script is then
 * built around it straight away: the form's "With script" choice when the agent is on.
 */
async function draftNarration(platformId, brief, { chain = false } = {}) {
  const abort = new AbortController();
  const before = state.runs[platformId]; // a redraft from the editor: put this back if the new draft fails
  const run = (state.runs[platformId] = { status: 'drafting', raw: '', brief, abort, styleIds: brief.styleIds, retry: chain ? 'auto' : 'draft', chain, steps: [] });
  runChanged(platformId);
  try {
    const data = await streamRun(platformId, run, '/api/narration/draft', { ...brief, platformId });
    if (!data) throw new Error(explain(t('The connection closed before the narration was finished.'), DROPPED));
    if (!data.narration) {
      run.raw = data.raw || run.raw;
      throw new Error(explain(t("The model's reply could not be read as a narration ({reason}). The raw reply is shown below.", { reason: data.parseError }), UNREADABLE));
    }
    const old = before?.narration?.beats;
    let beats = data.narration.beats.map(newBeat);
    const narration = { beats, title: data.narration.title, target: run.plan, undo: old?.some((b) => b.text.trim()) ? old : null, card: data.card || null, report: withBeatIds(data.report, beats) };
    // The agent's second half: review the draft. If the review fails, the draft is still a narration.
    if (run.plan?.agent) {
      try {
        const revised = await streamRun(platformId, run, '/api/narration/review', { ...brief, platformId, narration: forServer(beats), card: narration.card || undefined });
        if (revised?.beats) {
          beats = revised.beats.map(newBeat);
          Object.assign(narration, { beats, report: withBeatIds(revised.report, beats) });
        }
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        noteStep(run, { id: 'review', status: 'done', note: err.message });
        toast(t('The review did not finish ({reason}). The draft is kept as it is.', { reason: err.message }));
      }
    }
    run.narration = narration;
    run.status = 'narration';
  } catch (err) {
    const stopped = err.name === 'AbortError';
    if (!chain && before?.narration && narrationText(before)) {
      state.runs[platformId] = before; // keep what was there
      if (!stopped) toast(shown(err));
    } else {
      run.status = stopped ? 'stopped' : 'error';
      run.error = stopped ? t('Stopped.') : shown(err);
    }
  }
  if (state.runs[platformId] !== run && state.runs[platformId] !== before) return; // the tab was started over meanwhile
  if (chain && run.status === 'narration') return runPlatform(platformId, { ...brief, narration: forServer(run.narration.beats), card: run.narration.card || undefined, narrationBy: 'agent' });
  runChanged(platformId);
}

/** Have the narration written: for the platforms in the form, or again for the tabs given. `chain` goes on to the script. */
async function draftNarrations(platformIds, { chain = false } = {}) {
  const brief = collectBrief();
  saveForm();
  platformIds ??= resetRuns();
  setView('script');
  setBusy(true);
  await Promise.all(platformIds.map((id) => draftNarration(id, brief, { chain })));
  setBusy(anyWriting());
}

/** An empty editor for each platform in the form: the creator pastes or writes the narration. */
async function openEditors() {
  const brief = collectBrief();
  saveForm();
  const ids = resetRuns();
  for (const id of ids) state.runs[id] = { status: 'narration', raw: '', brief, styleIds: brief.styleIds, narration: { beats: [] } };
  await Promise.all(ids.map(loadTarget));
  setView('script');
  render();
}

// ---------- The viewpoint card and the checks, as the editor and the script show them ----------

const LAYER = { hook: 'Hook', insider: 'Insider explanation', experience: 'First-hand experience', insight: 'Core insight', cta: 'Call to action' };
const layerOf = (card, stage) => card?.outline?.find((o) => o.stage === stage)?.layer || '';
const layerChip = (card, stage) => (LAYER[layerOf(card, stage)] && !['hook', 'cta'].includes(layerOf(card, stage)) ? h('span', { class: `layer layer-${layerOf(card, stage)}` }, t(LAYER[layerOf(card, stage)])) : null);

/** The card as a block of rows: who speaks, to whom, the idea, and the three layers that carry it. */
function cardNode(card) {
  const row = (label, body) => body && h('div', { class: 'vc-row' }, h('div', { class: 'vc-label' }, label), h('div', { class: 'vc-body' }, body));
  const list = (items) => items.length > 0 && h('ul', {}, items.map((x) => h('li', {}, x)));
  return h(
    'div',
    { class: 'vc' },
    row(t('Speaking as'), card.persona),
    row(t('For'), card.viewer),
    row(t('Core insight'), card.insight.claim && [h('p', { class: 'vc-claim' }, card.insight.claim), card.insight.against && h('p', { class: 'hint' }, t('Overturns: {belief}', { belief: card.insight.against }))]),
    row(t('Insider explanation'), list(card.insider)),
    row(t('First-hand experience'), list(card.experience.map((e) => [e.point, e.source === 'draft' && h('span', { class: 'vc-tag' }, t('Drafted: confirm or replace'))]))),
    row(t('Analogy'), card.analogy),
    row(t('Must be spoken'), card.mustSay.length > 0 && h('div', { class: 'vc-names' }, card.mustSay.map((x) => h('span', {}, x)))),
    row(t('Before you record'), card.toVerify.length > 0 && h('ul', { class: 'vc-verify' }, card.toVerify.map((x) => h('li', {}, x)))),
  );
}

/** The card as Markdown lines, for the exported script. */
function cardMarkdown(card) {
  const L = [];
  const line = (label, value) => value && L.push(`- **${label}:** ${value}`);
  line(t('Speaking as'), card.persona);
  line(t('For'), card.viewer);
  line(t('Core insight'), card.insight.claim);
  line(t('Overturns: {belief}', { belief: '' }).replace(/[:：]\s*$/, ''), card.insight.against);
  for (const x of card.insider) line(t('Insider explanation'), x);
  for (const e of card.experience) line(t('First-hand experience'), `${e.point}${e.source === 'draft' ? ` (${t('Drafted: confirm or replace')})` : ''}`);
  line(t('Analogy'), card.analogy);
  line(t('Must be spoken'), card.mustSay.join(' · '));
  for (const x of card.toVerify) line(t('Before you record'), x);
  return L;
}

/** The narration of a finished script as beats: the one it was built on, or its scenes' voiceover gathered by stage. */
function beatsOfScript(platformId, run) {
  if (run.brief?.narration?.length) return run.brief.narration.map(newBeat);
  const glue = scriptLang(platformId, run) === 'zh' ? '' : ' ';
  const beats = [];
  for (const sc of run.script.scenes) {
    const text = plainVo(sc.voiceover);
    if (!text) continue;
    const last = beats.at(-1);
    if (last && last.stage === sc.stage) last.text += glue + text;
    else beats.push(newBeat({ stage: sc.stage, text }));
  }
  return beats;
}

/** Open the editor on a finished script. The script stays as it is until a new one is built from the editor. */
async function editNarration(platformId) {
  const run = state.runs[platformId];
  run.narration ??= { beats: beatsOfScript(platformId, run), title: run.script.title, card: run.script.card || null };
  run.editing = true;
  await loadTarget(platformId);
  render();
  recheck(platformId);
}

/** Build the script around the narration as the editor has it, word for word. */
function buildFromNarration(platformId) {
  const run = state.runs[platformId];
  const beats = filledBeats(run);
  if (!beats.length) return toast(t('Write or paste the narration first.'));
  if (!$('topic').value.trim()) {
    setView('brief');
    $('topic').focus();
    return toast(t('Add a topic to the brief first.'));
  }
  generate([platformId], { ...collectBrief(), narration: forServer(beats), card: run.narration.card || undefined });
}

/** The room a beat has: its stage's share of the length, when it has that stage to itself. 0 when unknown. */
function beatTarget(n, beat) {
  const stage = n.target.timeline.find((s) => s.key === beat.stage);
  if (!stage || n.beats.filter((b) => b.stage === beat.stage).length !== 1) return 0;
  return Math.max(1, Math.round((stage.end - stage.start) * n.target.pace));
}

/** Have one beat, or the whole narration (no `beat`), rewritten: by a preset, by the creator's own instruction, or both. */
async function refine(platformId, beat, { preset, instruction }) {
  const run = state.runs[platformId];
  const n = run.narration;
  const beats = filledBeats(run);
  if (!beats.length || (beat && !beat.text.trim())) return toast(t('There is nothing to rewrite yet.'));
  const body = { ...collectBrief(), platformId, narration: forServer(beats), preset, instruction, ...(beat && { index: beats.indexOf(beat), target: beatTarget(n, beat) || undefined }) };
  const current = () => state.runs[platformId] === run;
  const mark = (busy) => {
    if (beat) {
      beat.busy = busy;
      if (current()) n.dom?.paintBeat(beat);
    } else {
      n.busy = busy;
      if (current() && state.active === platformId && showsEditor(run)) render();
    }
  };
  mark(true);
  try {
    const r = await api('/api/narration/refine', { method: 'POST', body: { ...body, card: n.card || undefined } });
    if (beat && n.beats.includes(beat)) {
      beat.prev = beat.text;
      beat.text = r.text;
    } else if (!beat) {
      n.undo = n.beats;
      n.beats = r.beats.map(newBeat);
      if (r.report) n.report = withBeatIds(r.report, n.beats); // the agent's review comes with what it measured
    }
    n.dirty = true;
    if (current()) toast(beat ? t('Beat rewritten. Undo is on the beat.') : preset === 'review' ? t('Reviewed and corrected. Undo is in the toolbar.') : t('Narration rewritten. Undo is in the toolbar.'));
  } catch (err) {
    toast(err.message);
  }
  mark(false);
  saveDrafts();
  if (beat || preset !== 'review') recheck(platformId);
}

/** A sparkles button that opens the refinements for one beat (`scope` 'beat') or the whole narration ('all'). */
function refineMenu({ scope, label, fit, onPick, small = true }) {
  const input = h('input', { type: 'text', maxlength: 600, placeholder: t('Or say what to change…'), 'aria-label': t('What to change') });
  const pick = (how) => ((menu.open = false), onPick(how));
  const custom = () => input.value.trim() && pick({ instruction: input.value.trim() });
  input.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), custom()));
  const presets = state.meta.refinePresets.filter((p) => (p.scope === 'both' || p.scope === scope) && (p.id !== 'fit' || fit));
  const menu = h(
    'details',
    { class: 'menu' },
    h('summary', { class: small ? 'btn small' : 'btn' }, icon('sparkles', 16), h('span', {}, label)),
    h(
      'div',
      { class: 'menu-panel' },
      presets.map((p) => h('button', { class: 'menu-item', type: 'button', onclick: () => pick({ preset: p.id }) }, p.id === 'fit' ? fit : p.name[lang])),
      h('div', { class: 'menu-custom' }, input, h('button', { class: 'btn small primary', type: 'button', onclick: custom }, t('Rewrite'))),
    ),
  );
  return menu;
}

/** Paste a whole narration in place of the one in the editor. */
function pasteNarration(platformId) {
  const run = state.runs[platformId];
  const area = h('textarea', { rows: 12, placeholder: t('Paste your narration here.'), 'aria-label': t('Your narration') });
  const use = () => {
    const beats = splitNarration(area.value).map(newBeat);
    if (!beats.length) return area.focus();
    setBeats(run, beats);
    dlg.close();
    recheck(platformId);
  };
  const dlg = h(
    'dialog',
    { class: 'dialog', 'aria-label': t('Paste narration') },
    h(
      'div',
      { class: 'dialog-shell' },
      h('header', { class: 'dialog-head' }, h('h2', {}, t('Paste narration')), h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Close'), onclick: () => dlg.close() }, icon('x'))),
      h('div', { class: 'dialog-body' }, h('p', { class: 'hint' }, t('This replaces the narration in the editor (Undo brings it back). Blank lines separate beats; without blank lines, each line is a beat.')), area),
      h('footer', { class: 'dialog-foot' }, h('div', { class: 'dialog-actions' }, h('span', { class: 'spacer' }), h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, t('Cancel')), h('button', { class: 'btn primary', type: 'button', onclick: use }, t('Use this narration')))),
    ),
  );
  dlg.addEventListener('click', (e) => e.target === dlg && dlg.close());
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  area.focus();
}

/** Replace every beat at once, keeping the old ones for Undo when they held anything. */
function setBeats(run, beats) {
  const n = run.narration;
  n.undo = n.beats.some((b) => b.text.trim()) ? n.beats : null;
  n.beats = beats;
  n.dirty = true;
  render();
}

/** A stage of the story line as a short name and what the beat has to do: "Hook: open on…" -> { name, guide }. */
function stageParts(target, key) {
  const label = target.timeline.find((s) => s.key === key)?.label;
  if (!label) return { name: key, guide: '' };
  const m = /^(.+?)[：:]\s*(.+)$/.exec(label);
  return m ? { name: m[1], guide: m[2] } : { name: label, guide: '' };
}

const autosizes = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');
/** Grow a textarea to its text where the browser cannot do it by itself. */
function autosize(area) {
  if (autosizes || !area.scrollHeight) return;
  area.style.height = 'auto';
  area.style.height = `${area.scrollHeight + 2}px`;
}

function renderNarration(platformId, run) {
  const n = run.narration;
  n.target ??= fallbackTarget(platformId);
  const T = () => n.target; // read at use: the brief can change what there is room for while the editor is open
  const zh = () => T().lang === 'zh';
  const amount = (count, room) => (zh() ? `${count}${room ? ` / ${room}` : ''} 字` : room ? t('{n} / {room} words', { n: count, room }) : t('{n} words', { n: count }));
  const secs = (count) => Math.max(count ? 1 : 0, Math.round(count / T().pace));
  const count = (text) => countSpoken(text, T().lang);
  const frozen = () => Boolean(n.busy); // the whole narration is being rewritten
  const waiting = () => frozen() || anyWriting(); // nothing new can be started from here yet
  const has = n.beats.some((b) => b.text.trim());
  const cards = new Map(); // beat id -> { el, count, time }

  const meter = { count: h('b'), rest: h('span'), verdict: h('span', { class: 'narr-verdict' }), fill: h('i'), note: h('p', { class: 'hint' }), fit: null };
  meter.bar = h('div', { class: 'narr-bar' }, meter.fill, h('em')); // the mark is the budget; the bar is full at 130% of it
  meter.fit = h('button', { class: 'btn small', type: 'button', hidden: true, onclick: () => refine(platformId, null, { preset: 'fit' }) }, t('Fit the length'));
  const foot = h('p', { class: 'hint' });
  const aim = h('span'); // the length asked for, in the chips under the title

  // What the measured checks found: a summary with the whole-narration findings, and each beat's own under it.
  const issueNode = (f) => h('li', { class: `issue ${f.level}` }, h('span', {}, f.message), f.excerpt && h('q', {}, f.excerpt));
  const checks = { summary: h('span', { class: 'checks-summary' }), ratio: h('p', { class: 'hint' }), list: h('ul', { class: 'beat-issues' }), notes: h('details', { class: 'checks-notes' }) };
  checks.review = h('button', { class: 'btn small', type: 'button', title: t('The agent measures the narration, has an editor review it against the skills, and corrects it.'), onclick: () => refine(platformId, null, { preset: 'review' }) }, icon('sparkles', 16), h('span', {}, t('Agent review')));
  checks.box = h('div', { class: 'checks', hidden: true }, h('div', { class: 'checks-top' }, h('span', { class: 'checks-title' }, t('Checks')), checks.summary, h('span', { class: 'spacer' }), checks.review), checks.ratio, checks.list, checks.notes);

  function paintChecks() {
    const r = n.report;
    const whole = [];
    const byBeat = new Map();
    for (const f of r?.findings || []) {
      const id = f.beat == null ? null : r.beatIds?.[f.beat];
      if (id == null) whole.push(f);
      else byBeat.set(id, [...(byBeat.get(id) || []), f]);
    }
    for (const [id, card] of cards) card.issues.replaceChildren(...(byBeat.get(id) || []).map(issueNode));
    checks.box.hidden = !r;
    if (!r) return;
    checks.box.dataset.state = r.errors ? 'error' : r.warns ? 'warn' : 'ok';
    checks.summary.textContent = r.errors || r.warns ? t('{e} to fix · {w} to consider', { e: r.errors, w: r.warns }) : t('Nothing found by measurement.');
    const ratio = r.stats?.ratio;
    checks.ratio.textContent = ratio ? t('Insider {a}% · Experience {b}% · Insight {c}% (aim for about 30 · 30 · 40)', { a: ratio.insider, b: ratio.experience, c: ratio.insight }) : '';
    checks.ratio.hidden = !ratio;
    checks.list.replaceChildren(...whole.map(issueNode));
    checks.notes.hidden = !r.notes?.length;
    if (r.notes?.length) {
      checks.notes.replaceChildren(
        h('summary', {}, t('What the editor changed ({n})', { n: r.notes.length })),
        h('ul', {}, r.notes.map((x) => h('li', {}, x.beat != null && h('b', {}, `#${x.beat + 1} `), x.problem, x.fix && h('span', { class: 'hint' }, ` → ${x.fix}`)))),
      );
    }
    checks.review.disabled = waiting();
  }

  function repaint() {
    const { duration, pace, budget } = T();
    let total = 0;
    for (const beat of n.beats) {
      const c = count(beat.text);
      const card = cards.get(beat.id);
      if (card) {
        const room = beatTarget(n, beat);
        card.count.textContent = `${amount(c, room)} · ${t('{n} s', { n: secs(c) })}`;
        card.count.classList.toggle('over', Boolean(room) && c > room * 1.25);
        card.time.textContent = c ? `${fmtTime(Math.round(total / pace))}–${fmtTime(Math.round((total + c) / pace))}` : '';
      }
      total += c;
    }
    const natural = Math.round(total / pace);
    const off = natural - duration;
    const fits = Math.abs(total / pace - duration) <= duration * 0.1;
    const runs = fitDuration(duration, total, pace);
    aim.textContent = t('{d} s target', { d: duration });
    meter.count.textContent = total;
    meter.rest.textContent = ` / ${amount(budget)} · ${t('about {n} s', { n: natural })}`;
    meter.fill.style.width = `${Math.min(100, (total / (budget * 1.3)) * 100)}%`;
    meter.bar.dataset.state = !total ? 'empty' : fits ? 'ok' : off > 0 ? 'over' : 'under';
    meter.verdict.textContent = !total ? '' : fits ? t('Fits the {d} s target', { d: duration }) : off > 0 ? t('{n} s over the {d} s target', { n: off, d: duration }) : t('{n} s under the {d} s target', { n: -off, d: duration });
    meter.note.textContent = !total || fits ? '' : t('Keep it and the video runs about {n} s, or bring it back to length.', { n: runs });
    meter.note.hidden = !meter.note.textContent;
    meter.fit.hidden = !total || fits || frozen();
    build.disabled = waiting();
    draft.disabled = waiting();
    checks.review.disabled = waiting();
    foot.textContent = total ? t('The video will run about {n} s. Everything else comes from the brief as it is now.', { n: runs }) : t('Write or paste the narration first.');
  }

  function beatCard(beat) {
    const i = n.beats.indexOf(beat);
    const { name, guide } = beat.stage ? stageParts(T(), beat.stage) : { name: '', guide: '' };
    const busy = Boolean(beat.busy);
    const locked = busy || frozen();
    const area = h('textarea', { rows: 2, 'aria-label': t('Narration of beat {n}', { n: i + 1 }), placeholder: t('What is said in this beat'), readonly: locked });
    area.value = beat.text;
    area.addEventListener('input', () => {
      beat.text = area.value;
      n.dirty = true;
      autosize(area);
      repaint();
      saveDraftsSoon();
      recheckSoon(platformId);
    });
    const move = (by) => {
      const j = i + by;
      if (j < 0 || j >= n.beats.length) return;
      n.beats.splice(j, 0, n.beats.splice(i, 1)[0]);
      n.dirty = true;
      render();
      recheckSoon(platformId);
    };
    const tool = (name, label, onclick, off) => h('button', { class: 'icon-btn', type: 'button', title: label, 'aria-label': label, disabled: locked || off, onclick }, icon(name, 16));
    const card = { count: h('span', { class: 'beat-count' }), time: h('span', { class: 'time' }), area, issues: h('ul', { class: 'beat-issues' }) };
    card.el = h(
      'li',
      { class: `beat${busy ? ' busy' : ''}` },
      h('div', { class: 'beat-head' }, h('span', { class: 'beat-no' }, String(i + 1).padStart(2, '0')), name && h('span', { class: 'stage' }, name), layerChip(n.card, beat.stage), card.time, h('span', { class: 'spacer' }), card.count),
      guide && h('p', { class: 'beat-guide' }, guide),
      area,
      card.issues,
      h(
        'div',
        { class: 'beat-actions' },
        busy
          ? h('span', { class: 'beat-status', role: 'status' }, h('span', { class: 'spin' }), t('Rewriting…'))
          : !locked && refineMenu({ scope: 'beat', label: t('Refine'), fit: beatTarget(n, beat) ? t('Fit to {room}', { room: amount(beatTarget(n, beat)) }) : '', onPick: (how) => refine(platformId, beat, how) }),
        beat.prev != null && !locked && iconBtn('undo', t('Undo'), { class: 'btn small', onclick: () => ((beat.text = beat.prev), (beat.prev = null), paintBeat(beat), saveDrafts()) }),
        h('span', { class: 'spacer' }),
        tool('arrowUp', t('Move up'), () => move(-1), i === 0),
        tool('arrowDown', t('Move down'), () => move(1), i === n.beats.length - 1),
        tool('plus', t('Add a beat below'), () => addBeat(i + 1)),
        tool('trash', t('Delete this beat'), () => {
          n.undo = [...n.beats];
          n.beats.splice(i, 1);
          n.dirty = true;
          render();
          recheckSoon(platformId);
        }),
      ),
    );
    cards.set(beat.id, card);
    return card.el;
  }

  /** Redraw one beat without touching the others, so typing elsewhere is not interrupted. */
  function paintBeat(beat) {
    const old = cards.get(beat.id)?.el;
    if (!old || !n.beats.includes(beat)) return;
    old.replaceWith(beatCard(beat));
    autosize(cards.get(beat.id).area);
    repaint();
    paintChecks();
  }

  function addBeat(at) {
    const beat = newBeat();
    n.beats.splice(at, 0, beat);
    render();
    state.runs[platformId]?.narration?.dom?.focus(beat);
  }

  n.dom = {
    repaint,
    paintBeat,
    paintChecks,
    focus: (beat) => cards.get(beat.id)?.area.focus(),
    settle: () => (cards.forEach((c) => autosize(c.area)), repaint(), paintChecks()),
  };

  const skills = T().skills || [];
  const cardPanel = n.card && h('details', { class: 'storyline card-panel' }, h('summary', {}, h('span', {}, t('Viewpoint card')), h('span', { class: 'hint' }, n.card.insight.claim)), cardNode(n.card));
  const skillsLine = skills.length > 0 && h('p', { class: 'hint skills-line' }, h('b', {}, t('Skills in use')), ' ', skills.map((sk) => h('span', { title: sk.description }, sk.title[lang])));

  const framework = frameworkOf($('framework').value);
  const storyline =
    T().timeline.length > 0 &&
    h(
      'details',
      { class: 'storyline', open: !n.beats.some((b) => b.stage) },
      h('summary', {}, h('span', {}, t('Story line')), framework && h('span', { class: 'hint' }, framework.name[lang])),
      h(
        'ol',
        {},
        T().timeline.map((s) => {
          const { name, guide } = stageParts(T(), s.key);
          return h('li', {}, h('span', { class: 'time' }, `${fmtTime(s.start)}–${fmtTime(s.end)}`), h('span', { class: 'storyline-what' }, h('b', {}, name), guide && ` ${guide}`), h('span', { class: 'beat-count' }, amount(Math.max(1, Math.round((s.end - s.start) * T().pace)))));
        }),
      ),
    );

  const redraft = () => (!has || confirm(t('Replace the narration with a new draft? Undo brings this one back.'))) && draftNarrations([platformId]);
  const draft = iconBtn('sparkles', has ? t('Redraft') : t('Draft with AI'), { title: $('agent').checked ? t('The agent plans the narration on a viewpoint card, writes it with the skills that fit the brief, then reviews and corrects it.') : t('The narration is written from the brief, one beat per stage of the story line.'), onclick: redraft });
  const build = iconBtn('arrowRight', run.script ? t('Rebuild the script') : t('Generate the script'), { class: 'btn cta', onclick: () => buildFromNarration(platformId) });
  const discard = () => {
    if (has && !confirm(t('Discard this narration?'))) return;
    delete state.runs[platformId];
    state.active = Object.keys(state.runs)[0] || null;
    render();
  };
  const blank = h('textarea', { class: 'narr-paste', rows: 9, placeholder: t('Paste or write your narration here. Blank lines separate beats; without blank lines, each line is a beat.'), 'aria-label': t('Your narration') });

  return h(
    'div',
    { class: 'narr' },
    h(
      'div',
      { class: 'script-head' },
      h(
        'div',
        {},
        h('h2', {}, t('Narration')),
        h('p', { class: 'logline' }, t('Edit it, paste your own, or have any beat rewritten. The script is then built around these words exactly as they are.')),
        h('div', { class: 'meta' }, h('span', {}, platformOf(platformId).name), framework && h('span', {}, framework.name[lang]), aim),
      ),
      h(
        'div',
        { class: 'actions' },
        draft,
        has && iconBtn('clipboard', t('Paste narration'), { disabled: frozen(), onclick: () => pasteNarration(platformId) }),
        has && !frozen() && refineMenu({ scope: 'all', label: t('Refine all'), fit: t('Fit the length'), small: false, onPick: (how) => refine(platformId, null, how) }),
        n.busy && h('span', { class: 'status-pill', role: 'status' }, h('span', { class: 'spin' }), t('Rewriting the narration…')),
        n.undo && !frozen() && iconBtn('undo', t('Undo'), { title: t('Bring back the narration as it was before the last rewrite, paste or deletion.'), onclick: () => (([n.beats, n.undo] = [n.undo, null]), render()) }),
        has && iconBtn('copy', t('Copy'), { onclick: () => copy(narrationText(run), t('Narration copied')) }),
        run.script ? iconBtn('back', t('Back to the script'), { onclick: () => ((run.editing = false), render()) }) : iconBtn('trash', t('Discard'), { class: 'btn danger', disabled: frozen(), onclick: discard }),
      ),
    ),
    has || n.beats.length
      ? [
          h('div', { class: 'narr-meter' }, h('div', { class: 'narr-meter-top' }, h('span', { class: 'narr-total' }, meter.count, meter.rest), meter.verdict, meter.fit), meter.bar, meter.note),
          checks.box,
          cardPanel,
          storyline,
          skillsLine,
          sourcesNode(run.plan?.web || run.web || n.target?.web),
          h('ol', { class: 'beats' }, n.beats.map(beatCard)),
          h('button', { class: 'btn add-beat', type: 'button', disabled: frozen(), onclick: () => addBeat(n.beats.length) }, icon('plus', 16), h('span', {}, t('Add a beat'))),
          h('div', { class: 'narr-foot' }, foot, build),
        ]
      : [
          h(
            'div',
            { class: 'narr-empty' },
            blank,
            h(
              'div',
              { class: 'actions' },
              iconBtn('check', t('Use this narration'), { class: 'btn primary', onclick: () => (splitNarration(blank.value).length ? (setBeats(run, splitNarration(blank.value).map(newBeat)), recheck(platformId)) : blank.focus()) }),
              iconBtn('plus', t('Start with one empty beat'), { onclick: () => addBeat(0) }),
            ),
          ),
          storyline,
        ],
  );
}

// ---------- Rendering ----------

/** How far the model has got, read from the partial reply. */
const scenesSoFar = (raw) => (raw.match(/"voiceover"\s*:/g) || []).length;

const STEP = { skills: 'Pick the skills', write: 'Plan and write the narration', review: 'Measure, review and correct', script: 'Build the script around it' };

/** Where the agent is: every step of its chain with what it has said so far. Null for a single-pass run. */
function agentSteps(run) {
  if (!run.plan?.agent && !run.chain) return null;
  const ids = [...state.meta.agentSteps, ...(run.chain ? ['script'] : [])];
  const seen = new Map((run.steps || []).map((x) => [x.id, x]));
  const scripting = run.status === 'running';
  const active = scripting ? 'script' : ids.find((id) => seen.get(id)?.status !== 'done');
  return ids.map((id) => {
    const st = seen.get(id) || {};
    const done = id !== 'script' && (scripting || st.status === 'done');
    const detail =
      id === 'skills' && run.skills?.length
        ? run.skills.map((sk) => sk.title[lang]).join(' · ')
        : id === 'write' && done && st.beats
          ? `${st.card ? `${t('Viewpoint card')} · ` : ''}${t('{n} beats', { n: st.beats })}`
          : id === 'review' && done && st.errors != null
            ? st.errors || st.warns ? t('{e} to fix · {w} to consider', { e: st.errors, w: st.warns }) : t('Nothing found by measurement.')
            : st.note || '';
    return { id, state: done ? 'done' : id === active ? 'active' : 'todo', label: t(STEP[id]), detail };
  });
}

function progressNote(run) {
  if (run.webNote) return run.webNote;
  if (!run.plan) return t('Contacting the model…');
  const step = agentSteps(run)?.find((x) => x.state === 'active');
  if (step) return `${step.label}…`;
  if (run.status === 'drafting') {
    const beats = (run.raw.match(/"text"\s*:/g) || []).length;
    return beats ? t('Writing beat {n}…', { n: beats }) : t('Planning the story line…');
  }
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
  const notice = document.querySelector('.retry-note');
  if (notice) {
    notice.hidden = !run.notice;
    notice.lastElementChild.textContent = run.notice || '';
  }
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
        isWriting(run) && h('span', { class: 'spin', 'aria-label': 'generating' }),
        showsEditor(run) && !isWriting(run) && icon('edit', 14),
        run.status === 'error' && h('span', { class: 'bad', 'aria-label': 'failed' }, '!'),
      );
    }),
  );
}

const chapterText = (chapters) => chapters.map((c) => `${c.time} ${c.title}`.trim()).join('\n');

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
  const zh = scriptLang(platformId, run) === 'zh';
  const spoken = countSpoken(voText, zh ? 'zh' : 'en');
  const count = zh ? `${spoken} 字` : t('{n} words', { n: spoken });
  const locked = run.plan?.narration; // built around a narration from the editor: { locked, repaired }
  const meta = [platformOf(platformId).name, `${s.scenes.at(-1).end}s`, runAspect(run).id, t('{n} scenes', { n: s.scenes.length }), t('voiceover {count}', { count }), locked && (locked.agent ? t('Narration by the agent') : t('Your narration, word for word')), run.plan?.model && `${run.plan.model}`, styleNames(run.styleIds)].filter(Boolean);

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
        iconBtn('mic', t('Edit narration'), { title: t('Change the narration, then build a new script around it. This one stays in History.'), onclick: () => editNarration(platformId) }),
        iconBtn('folder', t('To library'), {
          title: t('Saves the narration of this script to your library as a document, to write other scripts from.'),
          onclick: async () => (await library.saveText(`${s.title || t('Script')} · ${platformOf(platformId).name}`, [s.title, s.logline, voText].filter(Boolean).join('\n\n'))) && toast(t('Saved to your library')),
        }),
        run.brief && iconBtn('refresh', t('Regenerate'), { title: t('Writes a new script from the brief. This one stays in History.'), onclick: () => rerun(platformId) }),
      ),
    ),
    locked?.repaired && h('p', { class: 'note', role: 'status' }, icon('info', 16), h('span', {}, t('The model changed some of the wording, so your narration was put back word for word. Stress and pause marks were left out.'))),
    sourcesNode(run.plan?.web || run.web), // the pages that were read for it, and what its search found

    s.card && h('div', { class: 'section' }, h('div', { class: 'section-head' }, h('h3', {}, t('Viewpoint card'))), cardNode(s.card)),

    castSection(run),

    s.whiteboard &&
      h('div', { class: 'section' }, h('div', { class: 'section-head' }, h('h3', {}, t('Whiteboard blueprint')), h('div', { class: 'actions' }, h('button', { class: 'btn small', type: 'button', onclick: () => copy(s.whiteboard) }, t('Copy')))), h('pre', { class: 'board' }, s.whiteboard)),

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
                h('div', {}, h('div', { class: 'time' }, `${fmtTime(sc.start)}–${fmtTime(sc.end)}`), sc.stage && h('span', { class: 'stage' }, sc.stage), sc.host && h('span', { class: 'in-frame', title: t('In frame') }, icon('user', 12), [...sc.host].join(' + ')), layerChip(s.card, sc.stage)),
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
                    sc.asset && [h('dt', {}, t('From your library')), h('dd', {}, sc.asset.name)],
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
        s.publish.shareLine && pubItem(t('Line for sharing'), s.publish.shareLine, s.publish.shareLine),
        s.publish.hashtags.length > 0 && pubItem(t('Hashtags'), s.publish.hashtags.join(' '), s.publish.hashtags.join(' ')),
        s.publish.pinnedComment && pubItem(t('Pinned comment'), s.publish.pinnedComment, s.publish.pinnedComment),
        s.publish.chapters?.length > 0 && pubItem(t('Chapters'), h('ol', { class: 'chapters' }, s.publish.chapters.map((c) => h('li', {}, c.time && h('span', { class: 'time' }, c.time), c.title))), chapterText(s.publish.chapters)),
      ),
    ),

    s.productionNotes.length > 0 && h('div', { class: 'section' }, h('div', { class: 'section-head' }, h('h3', {}, t('Production notes'))), h('ul', { class: 'notes' }, s.productionNotes.map((n) => h('li', {}, n)))),
  );
}

/** Script, image post or video: what one script can be published as. The image post is there where the platform has one. */
function formatSwitch(platformId, run) {
  if (!run.historyId || !(imagePost.has(platformId) || film)) return null;
  const format = platformOf(platformId).post;
  const tab = (id, label) => h('button', { class: 'seg-btn', type: 'button', role: 'tab', 'aria-selected': String((run.view || 'script') === id), onclick: () => ((run.view = id), render()) }, label);
  return h(
    'div',
    { class: 'seg format-switch', role: 'tablist', 'aria-label': t('Script, image post or video') },
    tab('script', t('Video script')),
    imagePost.has(platformId) && tab('post', `${t('Image post')}${lang === 'zh' ? (format.name === '图文' ? '' : ` · ${format.name}`) : /^Image (post|note)$/.test(format.nameEn) ? '' : ` · ${format.nameEn}`}`),
    film && tab('video', t('Video')),
  );
}

/** What a finished run shows: its script, its image post or its video. */
function finishedView(platformId, run) {
  if (run.historyId && run.view === 'post' && imagePost.has(platformId)) return imagePost.view(platformId, run);
  if (run.historyId && run.view === 'video' && film) return film.view(platformId, run, { aspect: runAspect(run).id, lang: scriptLang(platformId, run) });
  return renderScript(platformId, run);
}

function render() {
  renderTabs();
  const run = state.runs[state.active];
  const box = $('result');
  if (!run) {
    if (!Object.keys(state.runs).length && state.emptyNode) box.replaceChildren(state.emptyNode);
    return saveDrafts();
  }
  if (showsEditor(run)) {
    box.replaceChildren(renderNarration(state.active, run));
    run.narration.dom.settle();
    return saveDrafts();
  }
  saveDrafts();
  if (run.status === 'done') return box.replaceChildren(...[formatSwitch(state.active, run), finishedView(state.active, run)].filter(Boolean));
  if (isWriting(run)) {
    const about = { platform: platformOf(state.active).name, model: run.plan?.model, budget: run.plan?.budget, unit: run.plan?.unit };
    const note = !run.plan
      ? t('Contacting the model…')
      : run.status === 'drafting'
        ? t('Writing the narration for {platform} with {model} · target about {budget} {unit}', about)
        : run.brief?.narrationBy === 'agent'
          ? t('Building the script for {platform} around the narration with {model}', about)
          : run.plan.narration || run.brief?.narration
            ? t('Building the script for {platform} around your narration with {model}', about)
          : t('Writing for {platform} with {model} · target about {budget} {unit} of voiceover', about);
    const pre = h('pre', { class: 'stream' }, run.raw);
    const steps = agentSteps(run);
    box.replaceChildren(
      h(
        'div',
        { class: 'progress', role: 'status', 'aria-live': 'polite' },
        h('div', { class: 'progress-head' }, h('span', { class: 'spin' }), h('p', { class: 'progress-title' }, progressNote(run))),
        h('div', { class: 'progress-bar' }, h('i')),
        h('p', { class: 'stream-note' }, note),
        h('p', { class: 'note retry-note', role: 'status', hidden: !run.notice }, icon('info', 16), h('span', {}, run.notice || '')),
        sourcesNode(run.plan?.web || run.web),
        steps
          ? h('ol', { class: 'agent-steps' }, steps.map((x) => h('li', { class: x.state }, h('span', { class: 'agent-dot' }, x.state === 'done' ? icon('check', 14) : x.state === 'active' ? h('span', { class: 'spin' }) : null), h('div', {}, h('b', {}, x.label), x.detail && h('span', { class: 'hint' }, x.detail)))))
          : h('div', { class: 'skeleton', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
        h('details', { class: 'raw' }, h('summary', {}, t('Show the raw reply')), pre),
      ),
    );
    return;
  }
  const id = state.active;
  // Open the editor from here: on the narration the script was being built around, or on an empty one after a failed draft.
  const toEditor = async () => {
    run.narration ??= { beats: [] };
    run.status = 'narration';
    await loadTarget(id);
    render();
  };
  box.replaceChildren(
    h('p', { class: 'error', role: 'alert' }, run.error),
    h(
      'div',
      { class: 'actions', style: 'margin:14px 0' },
      iconBtn('refresh', t('Try again'), { class: 'btn primary', onclick: () => rerun(id) }),
      run.narration && iconBtn('mic', t('Back to the narration'), { onclick: toEditor }),
      !run.narration && run.retry === 'draft' && iconBtn('edit', t('Write it myself'), { onclick: toEditor }),
      iconBtn('settings', t('LLM settings'), { onclick: openSettings }),
      iconBtn('edit', t('Edit the brief'), { class: 'btn mobile-only', onclick: () => setView('brief') }),
    ),
    run.raw && h('details', { class: 'raw' }, h('summary', {}, t('Show the raw reply')), h('pre', { class: 'stream' }, run.raw)),
  );
}

// ---------- Gateway settings ----------

const presetOf = (id) => state.meta.providers.find((p) => p.id === id);
const activeGw = () => state.gateway.profiles.find((p) => p.id === state.gateway.activeId) || state.gateway.profiles[0];

// Settings dialog state: the saved gateway being edited (null = a new one) and its model list.
const ui = { editId: null, provider: null, available: [], enabled: new Set(), prices: new Map(), priceSource: '', priceGroups: [] };
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
  ui.prices = new Map(Object.entries(p?.pricing?.models || {}).map(([model, row]) => [model, { ...row }]));
  ui.priceSource = p?.pricing?.source || '';
  ui.priceGroups = [];
  $('priceCurrency').value = p?.pricing?.currency || 'USD';
  $('priceGroup').hidden = true;
  $('priceNote').textContent = ui.priceSource ? t('Prices from {source}.', { source: ui.priceSource }) : '';
  $('pricing').open = false;
  setSettingsStatus('');
  showTest('');
  syncSettingsFields(false);
  syncMediaFields();
  renderProfileList();
  renderModelList();
  renderPrices();
}

// ---------- Pricing: what this gateway's provider charges, per model ----------

const PRICE_FIELDS = ['input', 'output', 'image', 'second'];
/** The models this gateway calls: the default, the ones in the picker, and the image and video models. */
const modelsInUse = () => [...new Set([$('model').value.trim(), ...ui.enabled, $('imageModel').value.trim(), $('videoModel').value.trim()].filter(Boolean))];

/** One row per model in use, priced or not; prices kept for other models are counted under the table. */
function renderPrices() {
  const used = modelsInUse();
  const sign = $('priceCurrency').value === 'CNY' ? '¥' : '$';
  $('priceRows').replaceChildren(
    ...used.map((model) => {
      const row = ui.prices.get(model) || {};
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      name.textContent = model;
      if (row.longAbove) {
        const sub = document.createElement('span');
        sub.className = 'sub';
        sub.textContent = t('Over {n} tokens in: {input} in, {output} out', { n: fmt(row.longAbove), input: `${sign}${row.longInput ?? row.input ?? 0}`, output: `${sign}${row.longOutput ?? row.output ?? 0}` });
        name.append(sub);
      }
      tr.append(name);
      for (const field of PRICE_FIELDS) {
        const td = document.createElement('td');
        td.className = 'num';
        const input = Object.assign(document.createElement('input'), { type: 'number', min: '0', step: 'any', inputMode: 'decimal', placeholder: '—', value: row[field] ?? '' });
        input.setAttribute('aria-label', `${model}: ${t({ input: 'Input / 1M tokens', output: 'Output / 1M tokens', image: 'Per image', second: 'Per video second' }[field])}`);
        input.addEventListener('input', () => {
          const next = { ...ui.prices.get(model) };
          if (input.value === '' || !(Number(input.value) >= 0)) delete next[field];
          else next[field] = Number(input.value);
          if (PRICE_FIELDS.some((f) => next[f] !== undefined)) ui.prices.set(model, next);
          else ui.prices.delete(model);
          ui.priceSource = '';
          syncPriceSummary();
        });
        td.append(input);
        tr.append(td);
      }
      return tr;
    }),
  );
  syncPriceSummary();
}

function syncPriceSummary() {
  const used = modelsInUse();
  const priced = used.filter((m) => ui.prices.has(m)).length;
  const others = [...ui.prices.keys()].filter((m) => !used.includes(m)).length;
  $('pricingSummary').textContent = used.length ? `· ${t('{on} of {n} models priced', { on: priced, n: used.length })}` : '';
  $('priceMore').textContent = others ? t('Prices for {n} other models are kept, for when you switch to one of them.', { n: others }) : '';
}

/** Take a key group's prices from the provider's list: they are added to the sheet, over any price already there. */
function applyPriceGroup(group, host) {
  for (const [model, row] of Object.entries(group.models)) ui.prices.set(model, { ...row });
  const names = ui.priceSource.startsWith(`${host} · `) ? ui.priceSource.slice(host.length + 3).split(', ') : [];
  ui.priceSource = `${host} · ${[...new Set([...names, group.name])].join(', ')}`;
  $('priceCurrency').value = 'USD';
  const missing = modelsInUse().filter((m) => !ui.prices.has(m));
  $('priceNote').textContent = [
    t('Added {n} prices from “{group}” ({rate}× the official price). Save to keep them.', { n: Object.keys(group.models).length, group: group.name, rate: group.rate }),
    missing.length ? t('No price in this group for: {models}. Type one in, or pick the group their key belongs to.', { models: missing.join(', ') }) : '',
  ].filter(Boolean).join(' ');
  renderPrices();
}

const pricingPayload = () => ({ currency: $('priceCurrency').value, source: ui.priceSource, models: Object.fromEntries(ui.prices) });

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
    if (!r.ok) note.textContent = explain(r.error, r.cause);
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
    pricing: pricingPayload(),
    activate: $('useGateway').checked,
  };
}

function setSettingsStatus(text, kind) {
  const el = $('settingsStatus');
  el.hidden = !text;
  el.textContent = text || '';
  el.className = `status ${kind || ''}`;
}

/** What the endpoint itself answered a failed test with, word for word: the address, the HTTP status and the body. */
const exactAnswer = (e) => (e ? `${t('The endpoint answered:')}\n${e.url}\nHTTP ${e.status}${e.statusText ? ` ${e.statusText}` : ''}\n${e.body || t('(an empty body)')}` : '');

/** The Test API panel: the reply or the error, and a line about it. */
function showTest(text, kind = '', meta = '') {
  const box = $('testReply');
  box.hidden = !text;
  box.textContent = text || '';
  box.className = `test-reply ${kind}`;
  $('testMeta').textContent = meta;
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
      else setSettingsStatus(explain(r.error, r.cause), 'bad');
    } catch (err) {
      setSettingsStatus(err.message, 'bad');
    }
    $('testGateway').disabled = false;
  });

  $('testPrompt').value = t('Say hello in one sentence.');
  // Test API: one prompt to the model with the form as it stands, and the reply (or why there was none).
  $('sendTest').addEventListener('click', async () => {
    const prompt = $('testPrompt').value.trim();
    if (!prompt) return showTest(t('Write a prompt to send first.'), 'bad');
    $('sendTest').disabled = true;
    showTest('', '', t('Waiting for the model…'));
    try {
      const r = await api('/api/gateway/test', { method: 'POST', body: { ...settingsPayload(), prompt } });
      if (r.ok) showTest(r.reply, 'ok', t('{model} replied in {ms} ms · {input} tokens in, {output} out', { model: r.model, ms: fmt(r.ms), input: fmt(r.inputTokens), output: fmt(r.outputTokens) }) + (r.currency ? ` · ${money({ [r.currency]: r.cost })}` : '') + (r.truncated ? ` · ${t('reply cut short here')}` : ''));
      else showTest([explain(r.error, r.cause), exactAnswer(r.endpoint)].filter(Boolean).join('\n\n'), 'bad', t('No reply after {ms} ms', { ms: fmt(r.ms) }));
    } catch (err) {
      showTest(shown(err), 'bad');
    }
    $('sendTest').disabled = false;
  });

  // Pricing: the table follows the models chosen elsewhere in the form; the provider's own list fills it in.
  $('settingsForm').addEventListener('input', (e) => !e.target.closest('#pricing') && renderPrices());
  $('settingsForm').addEventListener('change', (e) => !e.target.closest('#pricing') && renderPrices());
  $('priceCurrency').addEventListener('change', renderPrices);
  $('loadPrices').addEventListener('click', async () => {
    $('loadPrices').disabled = true;
    $('priceNote').textContent = t('Asking the provider for its prices…');
    try {
      const r = await api('/api/gateway/prices', { method: 'POST', body: { baseUrl: $('baseUrl').value.trim() } });
      if (!r.ok) throw new Error(t(r.error));
      ui.priceGroups = r.groups.map((g) => ({ ...g, host: r.host }));
      const pick = $('priceGroup');
      pick.replaceChildren(new Option(t('Choose the group your key is in…'), ''), ...ui.priceGroups.map((g) => new Option(`${g.name} · ${g.rate}× · ${t('{n} models', { n: Object.keys(g.models).length })}`, g.id)));
      pick.hidden = false;
      $('priceNote').textContent = t('{host} has {n} key groups, each with its own rate. Choose the one this gateway’s key belongs to; choose another to add its prices too.', { host: r.host, n: ui.priceGroups.length });
    } catch (err) {
      $('priceNote').textContent = err.message;
    }
    $('loadPrices').disabled = false;
  });
  $('priceGroup').addEventListener('change', () => {
    const g = ui.priceGroups.find((x) => x.id === $('priceGroup').value);
    if (g) applyPriceGroup(g, g.host);
  });

  $('listModels').addEventListener('click', async () => {
    $('listModels').disabled = true;
    setSettingsStatus(t('Asking the provider for its models…'));
    try {
      const r = await api('/api/gateway/models', { method: 'POST', body: settingsPayload() });
      if (!r.ok) setSettingsStatus(explain(r.error, r.cause), 'bad');
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
  // A server that has not been restarted since the page was updated does not know the hosts yet: the page still works.
  state.meta = { hostPresets: [], maxHostLook: 240, ...state.meta };
  state.emptyNode = $('result').firstElementChild;
  state.openAccount = wireAccount({ user: me.user, storage: me.storage, platformName: (id) => platformOf(id)?.name || id || '', openSettings });
  // A server that has not been restarted since the page was updated has no library yet: the rest of the page still works.
  if (state.meta.library) {
    library = wireLibrary({
      limits: state.meta.library,
      toast,
      view: (a) => viewImages([{ url: a.url, label: a.name }], 0, a.note || a.name, { w: 4, h: 3 }),
      // The files picked for the brief changed, or the library did: the brief is saved, and a script on screen offers them.
      onChange: () => {
        if (!$('framework').options.length) return; // the form is still being built
        saveForm();
        refreshTargets();
        const run = state.runs[state.active];
        if (run?.status === 'done' && !showsEditor(run)) render();
      },
    });
    $('openLibrary').addEventListener('click', () => library.open());
  } else {
    $('openLibrary').hidden = true;
    $('assetChips').closest('.field').hidden = true;
  }
  // A server that has not been restarted since the page was updated knows no image posts yet: the script still shows.
  // Sending an image post or a video to the person's own channels (publish.js), where the server can.
  const publish = wirePublish({ toast, isAdmin: () => state.user.role === 'admin' });
  if (state.meta.platforms.some((p) => p.post))
    imagePost = wirePost({
      toast,
      copy,
      platformOf,
      publish,
      // The post was written or edited: the history has it too, so reopening the script shows it.
      changed: (run) => {
        const entry = state.history.find((e) => e.id === run.historyId);
        if (entry) entry.post = run.post;
      },
    });
  // The voice was made: the history learns of it from the server, which keeps the recordings.
  film = wireVideo({ toast, platformOf, publish, isAdmin: () => state.user.role === 'admin', changed: () => loadHistory().catch(() => {}) });
  buildForm();
  library.load();
  wireSettings();
  wireWebSettings({ dialog: $('settings'), tabs: $('settingsTabs'), panel: $('webSettings') }); // the Web search tab: Tavily and Firecrawl
  wireBriefWeb({ links: $('webLinks'), search: $('webSearch'), hint: $('webHint') });
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
    settlePick().then(start);
  });
  $('briefForm').addEventListener('change', () => (saveForm(), refreshTargets(), pickSoon()));
  $('stop').addEventListener('click', () => Object.values(state.runs).forEach((r) => isWriting(r) && r.abort.abort()));
  // A refine menu closes when something else is clicked, or on Escape.
  document.addEventListener('click', (e) => document.querySelectorAll('details.menu[open]').forEach((m) => m.contains(e.target) || (m.open = false)));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && document.querySelectorAll('details.menu[open]').forEach((m) => (m.open = false)));
  restoreDrafts();
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
