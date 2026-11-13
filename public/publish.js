// Publish an image post or a video. Two ways, side by side:
//
//   YouTube, directly (src/youtube.mjs)   a person signs in to their own Google account in a small window and
//                                         the video is uploaded to their channel. Nothing else to sign up for.
//   Postiz (src/publish.mjs)              a person connects their own Postiz key once and picks among the
//                                         channels they have there: now, at a time they choose, or as a draft.
//
// The files go from this page through the server; no key or token ever comes back to the page.
//
//   wirePublish({ toast, isAdmin })  ->  { panel(options) }
//   panel({ run, platformId, kind: 'images' | 'video', ready, files, text, title, hashtags, ai })  ->  a section for the page
//     files()   resolves to [{ name, blob }], made when the person presses Publish

import { t, explain } from './i18n.js';
import { icon } from './icons.js';
import { el, call } from './account.js';

const NAMES = { youtube: 'YouTube', instagram: 'Instagram', 'instagram-standalone': 'Instagram', tiktok: 'TikTok', linkedin: 'LinkedIn', 'linkedin-page': 'LinkedIn Page', x: 'X', threads: 'Threads', facebook: 'Facebook', bluesky: 'Bluesky', pinterest: 'Pinterest', mastodon: 'Mastodon', reddit: 'Reddit', gmb: 'Google Business' };
// The channels a script written for a platform is most likely meant for: ticked to begin with.
const SUITS = { youtube_shorts: ['youtube'], instagram: ['instagram', 'instagram-standalone'], tiktok: ['tiktok'] };
// YouTube takes video only; everything else takes both.
const takes = (identifier, kind) => kind === 'video' || identifier !== 'youtube';
const HAS_VISIBILITY = ['youtube', 'tiktok'];

/** POST a body that is not JSON (a file, or a piece of one). */
async function raw(path, body, headers) {
  const res = await fetch(path, { method: 'POST', body, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(explain(t(data.error) || t('Request failed ({status})', { status: res.status }), data.cause));
  return data;
}

export function wirePublish({ toast, isAdmin = () => false }) {
  let yt = null; // YouTube as this person may see it: { configured, connected, channel, partBytes }, and for an administrator the OAuth client
  const loadYoutube = async (again = false) => (yt && !again ? yt : (yt = await call('/api/youtube/status').catch(() => ({ configured: false, connected: false }))));

  /** The administrator's dialog: the Google OAuth client everyone signs in through. */
  function youtubeSetup(done) {
    const dlg = el('dialog', { class: 'dialog' });
    const form = { clientId: yt.clientId || '', clientSecret: '' };
    const status = el('p', { class: 'hint', role: 'status' });
    const field = (label, node, hint) => el('label', { class: 'field' }, el('span', {}, label), node, hint && el('span', { class: 'hint' }, hint));
    const save = async (button) => {
      button.disabled = true;
      status.textContent = '';
      try {
        yt = { ...yt, ...(await call('/api/youtube/config', { method: 'PUT', body: form })) };
        dlg.close();
        toast(t('YouTube sign-in settings saved'));
        done();
      } catch (err) {
        status.textContent = err.message;
      }
      button.disabled = false;
    };
    dlg.append(
      el(
        'div',
        { class: 'dialog-shell' },
        el('header', { class: 'dialog-head' }, el('h2', {}, t('YouTube sign-in')), el('button', { class: 'icon-btn', type: 'button', 'aria-label': t('Close'), onclick: () => dlg.close() }, icon('x'))),
        el(
          'div',
          { class: 'dialog-body' },
          el('p', { class: 'hint' }, t('People connect their own YouTube channel through a Google OAuth client that belongs to this site. Create one in Google Cloud (APIs & Services → Credentials → OAuth client ID → Web application), switch on the YouTube Data API v3, and add the address below as an authorised redirect URI.')),
          field(t('Authorised redirect URI'), el('input', { type: 'text', readonly: true, value: yt.redirectUri || '', onfocus: (e) => e.target.select() })),
          field(t('Client ID'), el('input', { type: 'text', autocomplete: 'off', value: form.clientId, oninput: (e) => (form.clientId = e.target.value.trim()) }), t('Leave it empty and save to switch YouTube sign-in off.')),
          field(t('Client secret'), el('input', { type: 'password', autocomplete: 'off', placeholder: yt.secretPreview ? `${yt.secretPreview} ${t('(saved)')}` : '', oninput: (e) => (form.clientSecret = e.target.value.trim()) })),
          el('p', { class: 'hint' }, t('Until Google has verified the app, only the test users you list on its consent screen can connect, and they are asked again every week.')),
        ),
        el('footer', { class: 'dialog-foot' }, status, el('div', { class: 'dialog-actions' }, el('span', { class: 'spacer' }), el('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, t('Cancel')), el('button', { class: 'btn primary', type: 'button', onclick: (e) => save(e.currentTarget) }, t('Save')))),
      ),
    );
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('click', (e) => e.target === dlg && dlg.close());
    document.body.append(dlg);
    dlg.showModal();
  }
  let status = null; // { connected, keyPreview, channels, partBytes, error }: asked for once, and again after connecting
  const load = async (again = false) => (status && !again ? status : (status = await call('/api/publish/status').catch((err) => ({ connected: false, channels: [], error: err.message }))));

  /** Send one file to the person's Postiz library, in pieces when it is larger than one request may be. */
  async function send(file, onProgress) {
    const name = encodeURIComponent(file.name);
    const size = status.partBytes || 3.5 * 1048576;
    if (file.blob.size <= size) return raw('/api/publish/media', file.blob, { 'x-file-name': name, 'content-type': 'application/octet-stream' });
    const upload = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const count = Math.ceil(file.blob.size / size);
    for (let n = 0; n < count; n++) {
      await raw('/api/publish/part', file.blob.slice(n * size, (n + 1) * size), { 'x-upload-id': upload, 'x-part': String(n), 'content-type': 'application/octet-stream' });
      onProgress((n + 1) / (count + 1));
    }
    return raw('/api/publish/media', null, { 'x-upload-id': upload, 'x-parts': String(count), 'x-file-name': name });
  }

  function panel({ run, platformId, kind, ready = true, files, text, title = '', hashtags = [], ai = false }) {
    const ui = ((run.publishUi ??= {})[kind] ??= { picked: null, when: 'now', at: '', visibility: 'public', busy: '', error: '', sent: null, key: '', yt: { busy: '', error: '', title: '', visibility: 'public', made: null } });
    const root = el('div', { class: 'section publish' });

    async function connect(disconnect = false) {
      ui.busy = 'connect';
      ui.error = '';
      paint();
      try {
        status = { ...status, ...(await call('/api/publish/connect', { method: 'POST', body: disconnect ? { disconnect: true } : { apiKey: ui.key } })), ...(disconnect && { channels: [] }) };
        ui.key = '';
        ui.picked = null;
        toast(disconnect ? t('Postiz disconnected') : t('Postiz connected'));
      } catch (err) {
        ui.error = err.message;
      }
      ui.busy = '';
      paint();
    }

    async function publish(channels) {
      ui.busy = t('Preparing the files…');
      ui.error = '';
      ui.sent = null;
      paint();
      try {
        const list = await files();
        const media = [];
        for (const [i, file] of list.entries()) {
          const say = (part) => ((ui.busy = list.length > 1 ? t('Uploading {n} of {total}…', { n: i + 1, total: list.length }) : t('Uploading: {percent}%', { percent: Math.round(part * 100) })), ui.line && (ui.line.textContent = ui.busy));
          say(0);
          media.push(await send(file, say));
        }
        ui.busy = t('Sending the post to Postiz…');
        paint();
        const when = ui.when === 'at' ? new Date(ui.at).toISOString() : ui.when;
        const { sent } = await call('/api/publish/post', { method: 'POST', body: { historyId: run.historyId, kind, channelIds: channels.map((c) => c.id), when, text: valueOf(text), title: valueOf(title), hashtags, visibility: ui.visibility, ai, media } });
        ui.sent = sent;
        (run.published ??= []).push(sent);
      } catch (err) {
        ui.error = err.message;
      }
      ui.busy = '';
      paint();
    }

    const tube = ui.yt;
    const valueOf = (v) => (typeof v === 'function' ? v() : v);

    /** Sign in to Google in a small window, so the video that was just made stays on this page. */
    function connectYoutube() {
      const popup = window.open('/api/youtube/connect', 'youtube-connect', 'width=540,height=720');
      if (!popup) return (location.href = '/api/youtube/connect'); // no window allowed: sign in on this page and come back
      tube.busy = t('Waiting for you to sign in…');
      tube.error = '';
      paint();
      const timer = setInterval(async () => {
        const closed = popup.closed;
        await loadYoutube(true);
        if (!yt.connected && !closed) return;
        clearInterval(timer);
        tube.busy = '';
        if (yt.connected) toast(t('YouTube connected'));
        paint();
      }, 1500);
    }

    async function disconnectYoutube() {
      tube.busy = t('Disconnecting…');
      paint();
      yt = { ...yt, ...(await call('/api/youtube/disconnect', { method: 'POST', body: {} }).catch(() => ({}))) };
      tube.busy = '';
      tube.made = null;
      paint();
    }

    async function uploadToYoutube() {
      tube.busy = t('Preparing the files…');
      tube.error = '';
      tube.made = null;
      paint();
      try {
        const [file] = await files();
        const { uploadId, partBytes } = await call('/api/youtube/upload', { method: 'POST', body: { historyId: run.historyId, size: file.blob.size, title: tube.title, description: valueOf(text), tags: hashtags, visibility: tube.visibility, ai } });
        for (let at = 0; at < file.blob.size; at += partBytes) {
          tube.busy = t('Uploading: {percent}%', { percent: Math.round((at / file.blob.size) * 100) });
          if (tube.line) tube.line.textContent = tube.busy;
          const sent = await raw('/api/youtube/part', file.blob.slice(at, at + partBytes), { 'x-upload-id': uploadId, 'x-offset': String(at), 'x-history-id': run.historyId, 'content-type': 'application/octet-stream' });
          if (sent.done) {
            tube.made = sent;
            yt = { ...yt, channel: sent.channel || yt.channel };
            (run.published ??= []).push({ ts: Date.now(), kind: 'video', when: 'now', channels: [{ name: sent.channel || 'YouTube', identifier: 'youtube' }], url: sent.url, direct: true });
          }
        }
      } catch (err) {
        tube.error = err.message;
      }
      tube.busy = '';
      paint();
    }

    /** The YouTube part of the section: only for a video, and only where the site can sign people in (or the administrator can set that up). */
    function youtubeNodes() {
      if (kind !== 'video' || !yt || (!yt.configured && !isAdmin())) return [];
      const busy = Boolean(tube.busy);
      tube.title ||= [...String(valueOf(title) || '')].slice(0, 100).join('');
      const earlier = tube.made || (run.published || []).filter((p) => p.direct && p.url).at(-1);
      const setup = isAdmin() && el('button', { class: 'link-btn', type: 'button', disabled: busy, onclick: () => youtubeSetup(() => loadYoutube(true).then(paint)) }, yt.configured ? t('YouTube sign-in settings') : t('Set up YouTube sign-in'));
      const name = el('h4', { class: 'publish-via' }, 'YouTube', yt.connected && el('span', { class: 'hint' }, yt.channel ? t('Connected: {channel}', { channel: yt.channel }) : t('Connected')));
      if (!yt.configured) return [name, el('p', { class: 'hint' }, t('People could connect their own YouTube channel here and upload with one click. It needs a Google OAuth client for this site first.'), ' ', setup)];
      if (!yt.connected)
        return [
          name,
          el('p', { class: 'hint' }, t('Sign in to Google and allow uploads to your channel. This app can upload videos to it and nothing else: it cannot read your channel or your account.')),
          el('div', { class: 'actions' }, el('button', { class: `btn primary${busy ? ' busy' : ''}`, type: 'button', disabled: busy, onclick: connectYoutube }, icon(busy ? 'refresh' : 'video', 16), el('span', {}, busy ? tube.busy : t('Connect YouTube')))),
          tube.error && el('p', { class: 'error', role: 'alert' }, tube.error),
          setup && el('p', { class: 'hint' }, setup),
        ];
      const count = el('span', { class: 'count' }, `${[...tube.title].length} / 100`);
      return [
        name,
        el(
          'div',
          { class: 'post-look' },
          el('label', { class: 'pfield publish-title' }, el('span', {}, t('Title'), ' ', count), el('input', { type: 'text', maxlength: 100, value: tube.title, disabled: busy, oninput: (e) => ((tube.title = e.target.value), (count.textContent = `${[...tube.title].length} / 100`)) })),
          el(
            'label',
            { class: 'pfield' },
            el('span', {}, t('Who can see it')),
            el(
              'select',
              { disabled: busy, onchange: (e) => (tube.visibility = e.target.value) },
              el('option', { value: 'public', selected: tube.visibility === 'public' }, t('Everyone')),
              el('option', { value: 'unlisted', selected: tube.visibility === 'unlisted' }, t('Only people with the link')),
              el('option', { value: 'private', selected: tube.visibility === 'private' }, t('Only me')),
            ),
          ),
          el(
            'div',
            { class: 'actions' },
            el('button', { class: `btn primary${busy ? ' busy' : ''}`, type: 'button', disabled: busy || !ready || !tube.title.trim(), onclick: uploadToYoutube }, icon(busy ? 'refresh' : 'upload', 16), (tube.line = el('span', {}, busy ? tube.busy : t('Upload to YouTube')))),
          ),
        ),
        tube.error && el('p', { class: 'error', role: 'alert' }, tube.error),
        earlier && !busy && el('p', { class: 'finding ok' }, icon('check', 16), el('span', {}, t('Uploaded to YouTube:'), ' ', el('a', { href: earlier.url, target: '_blank', rel: 'noopener' }, earlier.url), ' ', t('YouTube takes a few minutes to process a new video.'))),
        el('p', { class: 'hint' }, t('The video goes up with the script’s description and hashtags, and is declared as containing synthetic media.'), ' ', el('button', { class: 'link-btn', type: 'button', disabled: busy, onclick: disconnectYoutube }, t('Disconnect YouTube')), setup && ' · ', setup),
      ];
    }

    function paint() {
      const head = el('div', { class: 'section-head' }, el('h3', {}, t('Publish')));
      if (!status || (kind === 'video' && !yt)) {
        root.replaceChildren(head, el('p', { class: 'hint' }, t('Loading…')));
        return Promise.all([load(), kind === 'video' ? loadYoutube() : null]).then(paint);
      }
      const tubeNodes = youtubeNodes();
      const via = el('h4', { class: 'publish-via' }, 'Postiz', status.connected && el('span', { class: 'hint' }, t('Connected with the key {key}', { key: status.keyPreview })));
      const put = (first, ...nodes) => root.replaceChildren(...[first, ...tubeNodes, via, ...nodes].filter(Boolean)); // a part that is not there leaves no trace
      const busy = Boolean(ui.busy);
      if (!status.connected) {
        put(
          head,
          el('p', { class: 'hint' }, t('Postiz posts to YouTube, Instagram, TikTok, LinkedIn, X and more from one account. Connect yours once: create an API key in Postiz under Settings, then paste it here. It is kept on the server and never shown again.')),
          el(
            'form',
            { class: 'post-ask', onsubmit: (e) => (e.preventDefault(), connect()) },
            el('input', { type: 'password', autocomplete: 'off', placeholder: t('Postiz API key'), 'aria-label': t('Postiz API key'), value: ui.key, disabled: busy, oninput: (e) => (ui.key = e.target.value.trim()) }),
            el('button', { class: `btn primary${busy ? ' busy' : ''}`, type: 'submit', disabled: busy }, icon(busy ? 'refresh' : 'key', 16), el('span', {}, busy ? t('Connecting…') : t('Connect Postiz'))),
          ),
          ui.error && el('p', { class: 'error', role: 'alert' }, ui.error),
          el('p', { class: 'hint' }, t('小红书, 抖音 and 视频号 let no outside service post for you, so they are not among Postiz’s channels: use the download and share buttons for those.')),
        );
        return;
      }
      const channels = (status.channels || []).filter((c) => !c.disabled && takes(c.identifier, kind));
      ui.picked ??= channels.filter((c) => (SUITS[platformId] || []).includes(c.identifier)).map((c) => c.id);
      const picked = channels.filter((c) => ui.picked.includes(c.id));
      const scheduled = ui.when === 'at';
      const timeOk = !scheduled || (ui.at && new Date(ui.at).getTime() > Date.now());
      const last = ui.sent || (run.published || []).filter((p) => p.kind === kind).at(-1);
      const said = (p) => {
        const names = p.channels.map((c) => `${NAMES[c.identifier] || c.identifier} · ${c.name}`).join(', ');
        if (p.when === 'draft') return t('Saved as a draft in Postiz for {channels}. Open Postiz to review and publish it.', { channels: names });
        if (p.when === 'now') return t('Sent to Postiz for {channels}. It publishes within a minute or two; Postiz shows whether each channel took it.', { channels: names });
        return t('Scheduled in Postiz for {channels} at {time}.', { channels: names, time: new Date(p.when).toLocaleString() });
      };
      put(
        head,
        status.error && el('p', { class: 'finding error' }, icon('info', 16), el('span', {}, status.error)),
        !channels.length &&
          !status.error && // Postiz did not answer: that is the trouble, not a lack of channels
          el('p', { class: 'finding warn' }, icon('info', 16), el('span', {}, kind === 'images' ? t('Your Postiz account has no channel that takes an image post yet. Connect one in Postiz, then reload.') : t('Your Postiz account has no channel yet. Connect one in Postiz, then reload.'))),
        channels.length > 0 &&
          el(
            'div',
            { class: 'publish-channels', role: 'group', 'aria-label': t('Channels') },
            channels.map((c) =>
              el(
                'label',
                { class: 'chip' },
                el('input', { type: 'checkbox', checked: ui.picked.includes(c.id), disabled: busy, onchange: (e) => ((ui.picked = e.target.checked ? [...ui.picked, c.id] : ui.picked.filter((id) => id !== c.id)), paint()) }),
                el('span', {}, `${NAMES[c.identifier] || c.identifier} · ${c.name}`),
              ),
            ),
          ),
        channels.length > 0 &&
          el(
            'div',
            { class: 'post-look' },
            el(
              'label',
              { class: 'pfield' },
              el('span', {}, t('When')),
              el(
                'select',
                { disabled: busy, onchange: (e) => ((ui.when = e.target.value), paint()) },
                el('option', { value: 'now', selected: ui.when === 'now' }, t('Publish now')),
                el('option', { value: 'at', selected: scheduled }, t('At a time I choose')),
                el('option', { value: 'draft', selected: ui.when === 'draft' }, t('Keep as a draft in Postiz')),
              ),
            ),
            scheduled && el('label', { class: 'pfield' }, el('span', {}, t('Date and time')), el('input', { type: 'datetime-local', value: ui.at, disabled: busy, onchange: (e) => ((ui.at = e.target.value), paint()) })),
            picked.some((c) => HAS_VISIBILITY.includes(c.identifier)) &&
              el(
                'label',
                { class: 'pfield' },
                el('span', {}, t('Who can see it')),
                el(
                  'select',
                  { disabled: busy, onchange: (e) => (ui.visibility = e.target.value) },
                  el('option', { value: 'public', selected: ui.visibility === 'public' }, t('Everyone')),
                  el('option', { value: 'unlisted', selected: ui.visibility === 'unlisted' }, t('Only people with the link (YouTube)')),
                  el('option', { value: 'private', selected: ui.visibility === 'private' }, t('Only me')),
                ),
              ),
            el(
              'div',
              { class: 'actions' },
              el(
                'button',
                { class: `btn primary${busy ? ' busy' : ''}`, type: 'button', disabled: busy || !ready || !picked.length || !timeOk, onclick: () => publish(picked) },
                icon(busy ? 'refresh' : 'upload', 16),
                (ui.line = el('span', {}, busy ? ui.busy : ui.when === 'draft' ? t('Save a draft for {n} channels', { n: picked.length }) : ui.when === 'at' ? t('Schedule for {n} channels', { n: picked.length }) : t('Publish to {n} channels', { n: picked.length }))),
              ),
            ),
          ),
        !ready && el('p', { class: 'hint' }, kind === 'video' ? t('Make the video first: the file that is published is the one you just watched.') : t('Write the image post first.')),
        ready && channels.length > 0 && !picked.length && el('p', { class: 'hint' }, t('Tick the channels this goes to.')),
        scheduled && !timeOk && el('p', { class: 'hint' }, t('Choose a time in the future.')),
        ui.error && el('p', { class: 'error', role: 'alert' }, ui.error),
        last && !busy && el('p', { class: 'finding ok' }, icon('check', 16), el('span', {}, said(last))),
        el('p', { class: 'hint' }, t('Publishing is done by your Postiz account: what it posts counts against its plan, and each platform’s own rules apply. 小红书, 抖音 and 视频号 are not among its channels.'), ' ', el('button', { class: 'link-btn', type: 'button', disabled: busy, onclick: () => connect(true) }, t('Disconnect Postiz'))),
      );
    }

    paint();
    return root;
  }

  return { panel };
}
