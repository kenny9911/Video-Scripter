// The asset library (素材库): the creator's own files, uploaded once and used in any script.
//
// One dialog does three jobs:
//   keep the library      upload files or paste text, name them, say what each one is, delete them
//   pick for the brief    tick the files the next script is written from (the chips under the topic)
//   pick for a scene      choose one picture or clip, with the buttons the caller gives (see `pick`)
//
// The page cannot show a model what is in a picture, so every picture and clip has a note: the note is
// what the scriptwriter is told about it. A document needs none; its text is read.

import { t, lang } from './i18n.js';
import { icon } from './icons.js';
import { el, call } from './account.js';

const $ = (id) => document.getElementById(id);
const KIND_ICON = { document: 'script', image: 'image', video: 'video' };
const FILTERS = [
  ['all', 'All'],
  ['document', 'Documents'],
  ['image', 'Pictures'],
  ['video', 'Clips'],
];

/** "3.2 MB", "640 KB": how big a file is, to one decimal where that says something. */
export function fileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1048576) return `${(n / 1048576).toFixed(n >= 10485760 ? 0 : 1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/**
 * Wire the library dialog and the chips in the brief. `limits` is `meta.library` from the server;
 * `onChange` hears when the files picked for the brief, or the library itself, changed; `view(asset)`
 * shows a picture large. Returns what the rest of the app needs of the library.
 */
export function wireLibrary({ limits, toast, onChange, view }) {
  const state = {
    items: [],
    loaded: false,
    selected: [], // ids picked for the brief, in the order picked
    filter: 'all',
    mode: null, // while a scene is picking: { title, hint, kinds, actions(asset) }
    uploading: [], // names of files on their way up
  };
  const dialog = $('libraryDialog');
  const byId = (id) => state.items.find((a) => a.id === id);
  const picked = () => (state.loaded ? state.selected.filter(byId) : state.selected);
  const changed = () => (renderChips(), onChange?.());

  // ---------- The brief: which files the next script is written from ----------

  function toggle(id) {
    if (state.selected.includes(id)) state.selected = state.selected.filter((x) => x !== id);
    else if (picked().length >= limits.maxPerBrief) return toast(t('A brief can use up to {n} files.', { n: limits.maxPerBrief }));
    else state.selected.push(id);
    render();
    changed();
  }

  function renderChips() {
    const chosen = picked().map(byId).filter(Boolean);
    $('assetChips').replaceChildren(
      ...chosen.map((a) =>
        el(
          'button',
          { class: 'chip asset-chip', type: 'button', title: [a.note, t('Remove from this brief')].filter(Boolean).join(' · '), onclick: () => toggle(a.id) },
          icon(KIND_ICON[a.kind], 14),
          el('span', { class: 'asset-chip-name' }, a.name),
          icon('x', 12),
        ),
      ),
      el('button', { class: 'chip asset-add', type: 'button', onclick: () => open() }, icon('folder', 14), chosen.length ? t('Change') : t('Choose from your library')),
    );
    const docs = chosen.filter((a) => a.kind === 'document').length;
    const media = chosen.length - docs;
    $('assetHint').textContent = !chosen.length
      ? t('Your own notes, articles, pictures and clips. The script is written from the ones you pick.')
      : [docs && t('{n} read as source material', { n: docs }), media && t('{n} placed in the scenes that show them', { n: media })].filter(Boolean).join(' · ');
  }

  // ---------- The dialog ----------

  const visible = () => {
    const kinds = state.mode?.kinds;
    return state.items.filter((a) => (kinds ? kinds.includes(a.kind) : true) && (state.filter === 'all' || a.kind === state.filter));
  };

  async function save(asset, patch) {
    try {
      Object.assign(asset, (await call('/api/assets/update', { method: 'POST', body: { id: asset.id, ...patch } })).asset);
      changed();
    } catch (err) {
      toast(err.message);
    }
  }

  async function remove(asset) {
    if (!confirm(t('Delete “{name}” from your library? Scripts that already use it keep their copy.', { name: asset.name }))) return;
    try {
      await call('/api/assets/delete', { method: 'POST', body: { id: asset.id } });
      state.items = state.items.filter((a) => a.id !== asset.id);
      state.selected = state.selected.filter((id) => id !== asset.id);
      render();
      changed();
    } catch (err) {
      toast(err.message);
    }
  }

  /** The whole text of a document, to read before using it. */
  async function readDocument(asset) {
    const area = el('textarea', { rows: 16, readonly: true, 'aria-label': asset.name });
    const dlg = el(
      'dialog',
      { class: 'dialog wide', 'aria-label': asset.name },
      el(
        'div',
        { class: 'dialog-shell' },
        el('header', { class: 'dialog-head' }, el('h2', {}, asset.name), el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Close'), onclick: () => dlg.close() }, icon('x'))),
        el('div', { class: 'dialog-body' }, area),
      ),
    );
    dlg.addEventListener('click', (e) => e.target === dlg && dlg.close());
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    try {
      const r = await call(`/api/assets/text?id=${encodeURIComponent(asset.id)}`);
      area.value = r.text + (r.cut ? `\n\n${t('[The rest of this document was not kept: it is longer than the library reads.]')}` : '');
    } catch (err) {
      area.value = err.message;
    }
  }

  function card(a) {
    const on = picked().includes(a.id);
    const thumb =
      a.kind === 'image'
        ? el('button', { class: 'lib-thumb', type: 'button', title: t('View larger'), onclick: () => view?.(a) }, el('img', { src: a.url, alt: a.note || a.name, loading: 'lazy' }))
        : a.kind === 'video'
          ? el('div', { class: 'lib-thumb' }, el('video', { src: `${a.url}#t=0.1`, preload: 'metadata', muted: true, playsinline: true, controls: true }))
          : el('button', { class: 'lib-thumb lib-text', type: 'button', title: t('Read the whole document'), onclick: () => readDocument(a) }, a.excerpt);
    const name = el('input', { class: 'lib-name', type: 'text', maxlength: 120, 'aria-label': t('Name'), value: a.name });
    name.addEventListener('change', () => (name.value.trim() ? save(a, { name: name.value }) : (name.value = a.name)));
    const note = el('input', {
      class: 'lib-note',
      type: 'text',
      maxlength: 300,
      value: a.note,
      'aria-label': t('What this is'),
      title: a.kind === 'document' ? null : t('The scriptwriter cannot see a picture or a clip: this note is all it knows about it.'),
      placeholder: a.kind === 'document' ? t('What this is (optional)') : t('What does it show?'),
    });
    note.addEventListener('change', () => save(a, { note: note.value }));
    const actions = state.mode
      ? state.mode.actions(a).map((x) =>
          el('button', { class: `btn small${x.primary ? ' primary' : ''}`, type: 'button', title: x.title, onclick: () => (dialog.close(), x.run()) }, x.icon && icon(x.icon, 14), el('span', {}, x.label)),
        )
      : [
          el('button', { class: `btn small lib-use${on ? ' on' : ''}`, type: 'button', 'aria-pressed': String(on), onclick: () => toggle(a.id) }, on && icon('check', 14), el('span', {}, on ? t('In this brief') : t('Use in the brief'))),
          el('span', { class: 'spacer' }),
          el('button', { class: 'icon-btn', type: 'button', title: t('Delete'), 'aria-label': t('Delete “{name}”', { name: a.name }), onclick: () => remove(a) }, icon('trash', 16)),
        ];
    return el(
      'li',
      { class: `lib-card${on && !state.mode ? ' on' : ''}`, 'data-kind': a.kind },
      thumb,
      el('div', { class: 'lib-body' }, name, note, el('span', { class: 'lib-meta' }, icon(KIND_ICON[a.kind], 12), a.kind === 'document' ? t('{n} characters', { n: a.chars.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US') }) : fileSize(a.size)), el('div', { class: 'lib-actions' }, actions)),
    );
  }

  function render() {
    const mode = state.mode;
    $('libraryTitle').textContent = mode?.title || t('Library');
    $('libraryHint').textContent =
      mode?.hint || t('Upload your own files once and use them in any script. Documents are read by the scriptwriter as source material; pictures and clips are placed in the scenes that show them. A model cannot see a picture, so say in a few words what each one shows.');
    for (const b of $('libraryFilter').children) {
      b.hidden = Boolean(mode?.kinds) && b.dataset.kind !== 'all' && !mode.kinds.includes(b.dataset.kind);
      b.setAttribute('aria-selected', String(b.dataset.kind === state.filter));
    }
    $('libraryPaste').hidden = Boolean(mode);
    const list = visible();
    const waiting = state.uploading.map((name) => el('li', { class: 'lib-card loading', role: 'status' }, el('div', { class: 'lib-thumb' }, el('span', { class: 'spin' })), el('div', { class: 'lib-body' }, el('span', { class: 'lib-name' }, name), el('span', { class: 'lib-meta' }, t('Uploading…')))));
    $('libraryGrid').replaceChildren(...waiting, ...list.map(card));
    $('libraryEmpty').hidden = list.length + waiting.length > 0;
    $('libraryEmptyText').textContent = !state.loaded
      ? t('Loading…')
      : state.items.length
        ? t('Nothing of this kind in your library yet.')
        : t('Your library is empty. Upload notes, articles, product pictures or clips: drop them here, or use the button above.');
    const n = picked().filter(byId).length;
    $('libraryCount').textContent = mode ? '' : n ? t('{n} of {max} picked for this brief', { n, max: limits.maxPerBrief }) : t('{n} files', { n: state.items.length });
    $('libraryDone').textContent = mode ? t('Cancel') : t('Done');
  }

  // ---------- Adding files ----------

  const extOf = (name) => /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase() || '';

  async function upload(files) {
    const taken = [];
    for (const file of files) {
      if (!limits.extensions.includes(extOf(file.name))) toast(t('“{name}” cannot be added: the library takes text, .docx, pictures and clips.', { name: file.name }));
      else if (file.size > limits.maxBytes) toast(t('“{name}” is larger than {max}.', { name: file.name, max: fileSize(limits.maxBytes) }));
      else taken.push(file);
    }
    if (!taken.length) return;
    state.uploading = taken.map((f) => f.name);
    state.filter = 'all';
    render();
    for (const file of taken) {
      try {
        const res = await fetch('/api/assets', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) }, body: file });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || t('Request failed ({status})', { status: res.status }));
        state.items.unshift(data.asset);
      } catch (err) {
        toast(`${file.name}: ${t(err.message)}`);
      }
      state.uploading = state.uploading.filter((n) => n !== file.name);
      render();
    }
    changed();
  }

  /** Add text as a document: what was pasted into the dialog, or the narration of a script. Returns the new asset, or null. */
  async function saveText(name, text) {
    try {
      const { asset } = await call('/api/assets', { method: 'POST', body: { name, text } });
      state.items.unshift(asset);
      render();
      changed();
      return asset;
    } catch (err) {
      toast(err.message);
      return null;
    }
  }

  function pasteText() {
    const name = el('input', { type: 'text', maxlength: 120, placeholder: t('Name (optional)'), 'aria-label': t('Name') });
    const area = el('textarea', { rows: 12, placeholder: t('Paste notes, an article, a transcript…'), 'aria-label': t('Text') });
    const add = async () => {
      if (!area.value.trim()) return area.focus();
      if (await saveText(name.value, area.value)) dlg.close();
    };
    const dlg = el(
      'dialog',
      { class: 'dialog', 'aria-label': t('Paste text') },
      el(
        'div',
        { class: 'dialog-shell' },
        el('header', { class: 'dialog-head' }, el('h2', {}, t('Paste text')), el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Close'), onclick: () => dlg.close() }, icon('x'))),
        el('div', { class: 'dialog-body' }, name, area),
        el('footer', { class: 'dialog-foot' }, el('div', { class: 'dialog-actions' }, el('span', { class: 'spacer' }), el('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, t('Cancel')), el('button', { class: 'btn primary', type: 'button', onclick: add }, t('Add to the library')))),
      ),
    );
    dlg.addEventListener('click', (e) => e.target === dlg && dlg.close());
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    area.focus();
  }

  // ---------- Opening it ----------

  async function load() {
    try {
      state.items = (await call('/api/assets')).items;
      state.loaded = true;
      state.selected = state.selected.filter(byId); // a file that was deleted elsewhere is no longer picked
    } catch (err) {
      toast(t('Could not load your library: {error}', { error: err.message }));
    }
    render();
    changed();
  }

  function open(mode = null) {
    state.mode = mode;
    state.filter = 'all';
    render();
    if (!dialog.open) dialog.showModal();
    load();
  }

  $('libraryFilter').replaceChildren(...FILTERS.map(([kind, label]) => el('button', { class: 'seg-btn', type: 'button', role: 'tab', 'data-kind': kind, onclick: () => ((state.filter = kind), render()) }, t(label))));
  $('libraryFile').accept = limits.extensions.map((e) => `.${e}`).join(',');
  $('libraryUpload').addEventListener('click', () => $('libraryFile').click());
  $('libraryFile').addEventListener('change', (e) => (upload([...e.target.files]), (e.target.value = '')));
  $('libraryPaste').addEventListener('click', pasteText);
  $('libraryDone').addEventListener('click', () => dialog.close());
  $('closeLibrary').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => (state.mode = null));
  // Files dropped anywhere on the dialog are uploaded.
  const drop = $('libraryDrop');
  for (const type of ['dragenter', 'dragover']) dialog.addEventListener(type, (e) => e.dataTransfer?.types.includes('Files') && (e.preventDefault(), drop.classList.add('over')));
  for (const type of ['dragleave', 'drop']) dialog.addEventListener(type, () => drop.classList.remove('over'));
  dialog.addEventListener('drop', (e) => e.dataTransfer?.files.length && (e.preventDefault(), upload([...e.dataTransfer.files])));
  renderChips();

  return {
    load,
    open: () => open(),
    /** Have one picture or clip chosen: `actions(asset)` gives the buttons under each file, [{ label, primary, icon, title, run }]. */
    pick: (mode) => open(mode),
    /** The ids picked for the brief. */
    selected: picked,
    setSelected(ids) {
      state.selected = [...new Set((Array.isArray(ids) ? ids : []).map(String))].slice(0, limits.maxPerBrief);
      if (state.loaded) state.selected = state.selected.filter(byId);
      renderChips();
    },
    /** True when the library holds a file of this kind. */
    has: (kind) => state.items.some((a) => a.kind === kind),
    /** A file that was added to the library from elsewhere in the app (a generated image that was kept). */
    added(asset) {
      state.items.unshift(asset);
      render();
      changed();
    },
    saveText,
  };
}
