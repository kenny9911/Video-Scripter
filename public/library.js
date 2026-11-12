// The asset library (素材库): the creator's own files, uploaded once and used in any script.
//
// One dialog does three jobs:
//   keep the library      upload files or paste text, name them, say what each one is, delete them
//   pick for the brief    tick the files the next script is written from (the chips under the topic)
//   pick for a scene      choose one picture or clip, with the buttons the caller gives (see `pick`)
//
// The page cannot show a model what is in a picture, so every picture and clip has a note: the note is
// what the scriptwriter is told about it. A document needs none; its text is read.
//
// The library is the signed-in user's own: the server gives this page that user's files and no one else's.

import { t, lang } from './i18n.js';
import { icon } from './icons.js';
import { el, call } from './account.js';

const $ = (id) => document.getElementById(id);
const KIND_ICON = { document: 'script', image: 'image', video: 'video' };
// Pictures the library does not keep as they are. A browser that can open one turns it into a JPEG or a PNG first.
const OTHER_PICTURES = ['heic', 'heif', 'avif', 'bmp', 'tif', 'tiff', 'svg'];
const OPAQUE = ['jpg', 'jpeg', 'jfif', 'bmp']; // kinds of picture with nothing see-through in them
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
      area.value = (r.partial ? `${t('[Part of this PDF could not be read: some of its fonts do not say which characters they draw. Check what is here before you use it.]')}\n\n` : '') + r.text + (r.cut ? `\n\n${t('[The rest of this document was not kept: it is longer than the library reads.]')}` : '');
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
      el(
        'div',
        { class: 'lib-body' },
        name,
        note,
        el('span', { class: 'lib-meta' }, icon(KIND_ICON[a.kind], 12), a.kind === 'document' ? [a.pages && (a.pages === 1 ? t('1 page') : t('{n} pages', { n: a.pages })), t('{n} characters', { n: a.chars.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US') })].filter(Boolean).join(' · ') : fileSize(a.size)),
        a.partial && el('span', { class: 'lib-meta warn', title: t('Some of its fonts do not say which characters they draw. Read it before you use it.') }, t('Part of this PDF could not be read')),
        el('div', { class: 'lib-actions' }, actions),
      ),
    );
  }

  function render() {
    const mode = state.mode;
    $('libraryTitle').textContent = mode?.title || t('Library');
    $('libraryHint').textContent =
      mode?.hint ||
      t('Upload your own files once and use them in any script: only you can see them. Documents (text, Word, PDF) are read by the scriptwriter as source material; pictures and clips are placed in the scenes that show them. A model cannot see a picture, so say in a few words what each one shows.');
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
        : t('Your library is empty. Upload notes, articles, PDFs, product pictures or clips: drop them here, or use the button above.');
    const n = picked().filter(byId).length;
    $('libraryCount').textContent = mode ? '' : n ? t('{n} of {max} picked for this brief', { n, max: limits.maxPerBrief }) : t('{n} files', { n: state.items.length });
    $('libraryDone').textContent = mode ? t('Cancel') : t('Done');
  }

  // ---------- Adding files ----------

  const extOf = (name) => /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase() || '';

  const kindOf = (name) => Object.keys(limits.kinds).find((kind) => limits.kinds[kind].includes(extOf(name)));
  const isPicture = (file) => kindOf(file.name) === 'image' || OTHER_PICTURES.includes(extOf(file.name)) || (!kindOf(file.name) && /^image\//.test(file.type));
  const tooLarge = (file, max) => new Error(t('“{name}” is larger than {max}.', { name: file.name, max: fileSize(max) }));

  /**
   * A picture as the library keeps it. One it takes, at a size it takes, goes up as it is. A phone photo that
   * is too large is drawn smaller, and a kind the library does not keep (HEIC, AVIF, BMP, TIFF, SVG) is drawn
   * as a JPEG, or as a PNG when part of it is see-through. All of that happens here, in the browser.
   */
  async function fitPicture(file) {
    const ext = extOf(file.name);
    if (kindOf(file.name) === 'image' && file.size <= limits.maxBytes) return file;
    if (ext === 'gif') throw tooLarge(file, limits.maxBytes); // drawn again, it would stop moving
    const cannot = () => new Error(t('This browser cannot open “{name}”. Save it as a JPEG or a PNG and add that.', { name: file.name }));
    const img = new Image();
    const url = URL.createObjectURL(file);
    try {
      img.src = url;
      await img.decode();
    } catch {
      throw cannot();
    } finally {
      URL.revokeObjectURL(url);
    }
    const [w, h] = [img.naturalWidth, img.naturalHeight];
    if (!w || !h) throw cannot();
    for (const edge of [2560, 1920, 1280, 960]) {
      const k = ext === 'svg' ? Math.min(edge, 2048) / Math.max(w, h) : Math.min(1, edge / Math.max(w, h));
      const canvas = Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) });
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      // Is any of it see-through? A small copy is enough to tell.
      const small = Object.assign(document.createElement('canvas'), { width: 64, height: 64 });
      const ctx = small.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(canvas, 0, 0, 64, 64);
      const clear = !OPAQUE.includes(ext) && ctx.getImageData(0, 0, 64, 64).data.some((v, i) => i % 4 === 3 && v < 250);
      const type = clear ? 'image/png' : 'image/jpeg';
      const blob = await new Promise((done) => canvas.toBlob(done, type, 0.9));
      if (blob && blob.size <= limits.maxBytes) return new File([blob], `${file.name.replace(/\.[a-z0-9]+$/i, '')}.${clear ? 'png' : 'jpg'}`, { type });
    }
    throw tooLarge(file, limits.maxBytes);
  }

  /** Send one file to the library; the new asset comes back. A file larger than one request may carry goes in parts. */
  async function send(file) {
    const post = async (path, headers, body) => {
      const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name), ...headers }, body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(t(data.error || 'Request failed ({status})', { status: res.status }));
      return data;
    };
    if (file.size <= limits.bodyBytes) return (await post('/api/assets', {}, file)).asset;
    const upload = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    const parts = Math.ceil(file.size / limits.partBytes);
    for (let i = 0; i < parts; i++) await post('/api/assets/part', { 'x-upload-id': upload, 'x-part': String(i) }, file.slice(i * limits.partBytes, (i + 1) * limits.partBytes));
    return (await post('/api/assets', { 'x-upload-id': upload, 'x-parts': String(parts) }, '')).asset;
  }

  async function upload(files) {
    const taken = [];
    for (const file of files) {
      const kind = isPicture(file) ? 'image' : kindOf(file.name);
      const max = kind === 'document' ? limits.maxDocumentBytes : limits.maxBytes;
      if (!kind) toast(t('“{name}” cannot be added: the library takes text, Word and PDF documents, pictures and clips.', { name: file.name }));
      else if (kind !== 'image' && file.size > max) toast(tooLarge(file, max).message);
      else taken.push(file);
    }
    if (!taken.length) return;
    state.uploading = taken.map((f) => f.name);
    state.filter = 'all';
    render();
    for (const file of taken) {
      try {
        state.items.unshift(await send(isPicture(file) ? await fitPicture(file) : file));
      } catch (err) {
        toast(err.message.includes(file.name) ? err.message : `${file.name}: ${err.message}`);
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
  $('libraryFile').accept = [...limits.extensions.map((e) => `.${e}`), 'image/*'].join(','); // image/*: a phone hands over a photo as a JPEG
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
