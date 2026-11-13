// The image post (图文) of a script: picture cards and the text that goes under them, for platforms that
// publish posts as well as video (小红书 图文笔记, 抖音图文, TikTok Photo Mode, an Instagram carousel).
//
// The server writes the words (src/post.mjs) and keeps them on the script. This page draws the cards
// (cards.js), lets every word and the look be changed, counts the text against the platform's limits, and
// hands the finished pictures over: one .zip, or the phone's share sheet straight into the platform's app.

import { t, lang } from './i18n.js';
import { icon } from './icons.js';
import { el, call } from './account.js';
import { THEMES, themeOf, drawCard, canvasBlob } from './cards.js';
import { zipStore } from './zip.js';

const KIND_NAME = { cover: 'Cover', point: 'Point', quote: 'Quote', summary: 'Summary' };
const DEFAULT_THEME = 'paper';
const count = (s) => [...String(s || '')].length;
const plain = (s) => String(s || '').replace(/\*\*/g, '');
const slug = (s) => String(s || '').normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'post';
const btn = (name, label, attrs = {}) => el('button', { class: 'btn', type: 'button', ...attrs }, icon(name, 16), el('span', {}, label));

// Pictures of the script that a cover can sit on: loaded once, then drawn from memory.
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

/** Whether this browser can hand picture files to another app (a phone's share sheet). */
const canShareFiles = () => {
  try {
    return Boolean(navigator.canShare?.({ files: [new File([new Uint8Array(1)], 'a.png', { type: 'image/png' })] }));
  } catch {
    return false;
  }
};

/** The text of a post as it is pasted under the pictures: the body, then the hashtags. */
const noteText = (post) => [post.body.trim(), post.hashtags.join(' ')].filter(Boolean).join('\n\n');

/**
 * What stands between this post and the platform taking it: [{ level: 'error' | 'warn', text }].
 * `fits` is what drawing each card reported ({ clipped }).
 */
export function postFindings(post, platform, fits = []) {
  const f = platform.post;
  const out = [];
  const say = (level, text, vars) => out.push({ level, text: t(text, { platform: platform.name, ...vars }) });
  if (f.titleMax) {
    if (!post.title.trim()) say('error', 'The post has no title.');
    else if (count(post.title) > f.titleMax) say('error', 'The title is {n} characters long; {platform} takes {max}.', { n: count(post.title), max: f.titleMax });
  }
  const noteLength = count(noteText(post));
  if (noteLength > f.bodyMax) say('error', 'The text with its hashtags is {n} characters long; {platform} takes {max}.', { n: noteLength, max: f.bodyMax });
  if (post.hashtags.length > f.hashtagMax) say('warn', '{n} hashtags: {platform} posts work best with {max} or fewer.', { n: post.hashtags.length, max: f.hashtagMax });
  if (post.cards.length < 3) say('warn', 'With fewer than three cards this reads as a single picture: aim for 6 to 9.');
  fits.forEach((fit, i) => fit?.clipped && say('error', 'Card {n} has more text than it can hold: shorten it, or split it into two cards.', { n: i + 1 }));
  const all = [post.title, post.body, ...post.cards.flatMap((c) => [c.kicker, c.title, c.body, ...c.bullets])].join('\n');
  for (const word of platform.banned || []) if (all.includes(word)) say('error', '“{word}” gets a post throttled on {platform}: take it out.', { word });
  return out;
}

/**
 * `toast(message)` and `copy(text, label)` are the app's own; `platformOf(id)` gives a platform with its
 * `post` format; `publish` is the panel that sends a post out (publish.js), where there is one; `changed(run)`
 * hears when a run's post was written or edited.
 * Returns { has(platformId), view(platformId, run) }.
 */
export function wirePost({ toast, copy, platformOf, publish = null, changed = () => {} }) {
  const has = (platformId) => Boolean(platformOf(platformId)?.post);

  function view(platformId, run) {
    const platform = platformOf(platformId);
    const format = platform.post;
    const formatName = lang === 'zh' ? format.name : format.nameEn; // 图文笔记 / Image note
    const ui = (run.postUi ??= { busy: false, error: '', ask: '' });
    const root = el('div', { class: 'post' });

    const save = () => {
      clearTimeout(ui.saving);
      ui.saving = setTimeout(async () => {
        try {
          await call('/api/post/save', { method: 'POST', body: { historyId: run.historyId, post: run.post } });
          changed(run);
        } catch (err) {
          toast(t('Could not save the image post: {error}', { error: err.message }));
        }
      }, 700);
    };

    async function write() {
      ui.busy = true;
      ui.error = '';
      paint();
      try {
        const { post } = await call('/api/post/generate', { method: 'POST', body: { historyId: run.historyId, instruction: ui.ask } });
        run.post = post;
        ui.ask = '';
        changed(run);
      } catch (err) {
        ui.error = err.message;
      }
      ui.busy = false;
      paint();
    }

    const askRow = (label) =>
      el(
        'form',
        { class: 'post-ask', onsubmit: (e) => (e.preventDefault(), write()) },
        el('input', { type: 'text', maxlength: 500, value: ui.ask, placeholder: t('Anything in particular? For example: for beginners, more steps, a bolder cover (optional)'), 'aria-label': t('What the image post should be like'), oninput: (e) => (ui.ask = e.target.value), disabled: ui.busy }),
        el('button', { class: `btn primary${ui.busy ? ' busy' : ''}`, type: 'submit', disabled: ui.busy }, icon(ui.busy ? 'refresh' : 'sparkles', 16), el('span', {}, ui.busy ? t('Writing the image post…') : label)),
      );

    function paint() {
      const post = run.post;
      if (!post?.cards?.length) {
        root.replaceChildren(
          el(
            'div',
            { class: 'post-empty' },
            el('span', { class: 'empty-art', 'aria-hidden': 'true' }, icon('image', 28)),
            el('p', { class: 'empty-title' }, t('No image post yet')),
            el('p', {}, t('Turn this script into an image post for {platform} ({format}): six to nine picture cards and the text that goes under them, written from the same idea and the same facts.', { format: formatName, platform: platform.name })),
            askRow(t('Write the image post')),
            ui.error && el('p', { class: 'error', role: 'alert' }, ui.error),
          ),
        );
        return;
      }
      post.theme ||= DEFAULT_THEME;
      const size = format.sizes.find((s) => s.id === post.size) || format.sizes[0];
      const theme = themeOf(post.theme);
      const fits = [];
      const tiles = [];

      // ---- What the checks say, and the counters: refreshed as text changes, without redrawing the form ----
      const checks = el('div', { class: 'post-checks' });
      const counters = [];
      const counter = (value, max) => {
        const node = el('span', { class: 'count' });
        const refresh = () => {
          const n = value();
          node.textContent = `${n} / ${max}`;
          node.classList.toggle('bad', n > max);
        };
        counters.push(refresh);
        refresh();
        return node;
      };
      const recheck = () => {
        counters.forEach((r) => r());
        const found = postFindings(post, platform, fits);
        checks.replaceChildren(
          ...(found.length
            ? found.map((f) => el('p', { class: `finding ${f.level}` }, icon('info', 16), el('span', {}, f.text)))
            : [el('p', { class: 'finding ok' }, icon('check', 16), el('span', {}, t('The title, the text and the cards fit what {platform} takes.', { platform: platform.name })))]),
        );
      };
      const edited = () => (recheck(), save());

      // ---- Drawing ----
      const draw = (i) => {
        const card = post.cards[i];
        const tile = tiles[i];
        if (!card || !tile) return;
        const options = { theme, size, index: i, total: post.cards.length, pointNo: post.cards.slice(0, i + 1).filter((c) => c.kind === 'point').length, footer: post.footer };
        fits[i] = drawCard(tile.canvas, card, options);
        tile.warn.hidden = !fits[i].clipped;
        if (card.kind === 'cover' && card.image)
          picture(card.image).then((image) => {
            if (!image || post.cards[i] !== card || !tile.canvas.isConnected) return;
            fits[i] = drawCard(tile.canvas, card, { ...options, image });
            tile.warn.hidden = !fits[i].clipped;
            recheck();
          });
      };
      const drawAll = () => (post.cards.forEach((_, i) => draw(i)), recheck());

      // ---- Files ----
      const fileName = (i) => `${String(i + 1).padStart(2, '0')}${post.cards[i].kind === 'cover' ? '-cover' : ''}.${format.fileType}`;
      const blobs = (type = format.fileType) => Promise.all(tiles.map((tile) => canvasBlob(tile.canvas, type)));
      const saveFile = (name, blob) => {
        const url = URL.createObjectURL(blob);
        el('a', { href: url, download: name }).click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
      const downloadAll = async (button) => {
        button.disabled = true;
        try {
          const files = await Promise.all((await blobs()).map(async (b, i) => ({ name: fileName(i), data: new Uint8Array(await b.arrayBuffer()) })));
          files.push({ name: 'post.txt', data: [post.title, noteText(post)].filter(Boolean).join('\n\n') });
          const name = `${platformId}-${slug(post.title || run.script.title)}.zip`;
          saveFile(name, new Blob([zipStore(files)], { type: 'application/zip' }));
          toast(t('Downloaded {name}', { name }));
        } catch (err) {
          toast(err.message);
        }
        button.disabled = false;
      };
      const share = async () => {
        try {
          const type = format.fileType === 'jpg' ? 'image/jpeg' : 'image/png';
          const files = (await blobs()).map((b, i) => new File([b], fileName(i), { type }));
          await navigator.clipboard?.writeText([post.title, noteText(post)].filter(Boolean).join('\n\n')).catch(() => {}); // most apps take the pictures and drop the text: it is on the clipboard to paste
          await navigator.share({ files });
        } catch (err) {
          if (err.name !== 'AbortError') toast(t('Sharing did not work here: download the images instead.'));
        }
      };

      // ---- One card: its picture and its words ----
      const move = (i, by) => {
        const j = i + by;
        if (j < 1 || j >= post.cards.length) return; // the cover stays first
        [post.cards[i], post.cards[j]] = [post.cards[j], post.cards[i]];
        save();
        paint();
      };
      const field = (label, node) => el('label', { class: 'pfield' }, el('span', {}, label), node);
      const area = (card, key, i, rows) => el('textarea', { rows, maxlength: key === 'title' ? 120 : 400, oninput: (e) => ((card[key] = e.target.value), draw(i), edited()) }, card[key]);
      const tileOf = (card, i) => {
        const canvas = el('canvas', { class: 'pcard-canvas', role: 'img', 'aria-label': t('Card {n}: {title}', { n: i + 1, title: plain(card.title) }), style: `aspect-ratio:${size.w}/${size.h}` });
        const warn = el('p', { class: 'finding error', hidden: true }, icon('info', 16), el('span', {}, t('Too much text for one card.')));
        tiles[i] = { canvas, warn };
        const cover = i === 0;
        return el(
          'div',
          { class: 'pcard' },
          canvas,
          el(
            'div',
            { class: 'pcard-bar' },
            el('b', {}, String(i + 1).padStart(2, '0')),
            cover
              ? el('span', { class: 'hint' }, t(KIND_NAME.cover))
              : el(
                  'select',
                  { class: 'compact', 'aria-label': t('Kind of card'), onchange: (e) => ((card.kind = e.target.value), save(), paint()) },
                  ['point', 'quote', 'summary'].map((k) => el('option', { value: k, selected: card.kind === k }, t(KIND_NAME[k]))),
                ),
            el('span', { class: 'spacer' }),
            !cover && el('button', { class: 'icon-btn small', type: 'button', title: t('Move earlier'), 'aria-label': t('Move earlier'), disabled: i <= 1, onclick: () => move(i, -1) }, icon('back', 14)),
            !cover && el('button', { class: 'icon-btn small flip', type: 'button', title: t('Move later'), 'aria-label': t('Move later'), disabled: i >= post.cards.length - 1, onclick: () => move(i, 1) }, icon('back', 14)),
            el('button', { class: 'icon-btn small', type: 'button', title: t('Download this card'), 'aria-label': t('Download this card'), onclick: async () => saveFile(fileName(i), await canvasBlob(canvas, format.fileType)) }, icon('download', 14)),
            !cover && el('button', { class: 'icon-btn small', type: 'button', title: t('Delete this card'), 'aria-label': t('Delete this card'), onclick: () => (post.cards.splice(i, 1), save(), paint()) }, icon('trash', 14)),
          ),
          warn,
          el(
            'div',
            { class: 'pcard-fields' },
            cover && field(t('Label'), el('input', { type: 'text', maxlength: 40, value: card.kicker, oninput: (e) => ((card.kicker = e.target.value), draw(i), edited()) })),
            field(t(card.kind === 'quote' ? 'Quote' : 'Headline'), area(card, 'title', i, 2)),
            card.kind !== 'summary' && field(t(card.kind === 'quote' ? 'Whose words' : cover ? 'Line under it' : 'Body text'), area(card, 'body', i, card.kind === 'point' ? 3 : 2)),
            (card.kind === 'point' || card.kind === 'summary') &&
              field(
                t('List, one item a line'),
                el('textarea', { rows: card.kind === 'summary' ? 4 : 2, oninput: (e) => ((card.bullets = e.target.value.split('\n').map((b) => b.trim()).filter(Boolean).slice(0, 6)), draw(i), edited()) }, card.bullets.join('\n')),
              ),
            card.kind === 'summary' && field(t('Closing line'), area(card, 'body', i, 2)),
          ),
        );
      };

      // ---- The look ----
      const covers = Object.entries(run.media || {})
        .flatMap(([, kinds]) => kinds.image?.urls || [])
        .filter((url) => /^\/media\/[\w-]+\.(?:png|jpe?g|webp)$/.test(url));
      const cover = post.cards[0];
      const look = el(
        'div',
        { class: 'post-look' },
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
                { class: 'swatch', type: 'button', role: 'radio', 'aria-checked': String(th.id === post.theme), title: th.name[lang] || th.name.en, onclick: () => ((post.theme = th.id), save(), paint()) },
                el('i', { style: `background:${Array.isArray((th.cover || th).bg) ? `linear-gradient(135deg, ${(th.cover || th).bg.join(',')})` : (th.cover || th).bg}; border-color:${th.accent}` }, el('b', { style: `background:${(th.cover || th).ink}` })),
                el('span', {}, th.name[lang] || th.name.en),
              ),
            ),
          ),
        ),
        format.sizes.length > 1 &&
          el(
            'div',
            { class: 'pfield' },
            el('span', {}, t('Shape')),
            el('div', { class: 'seg', role: 'radiogroup', 'aria-label': t('Shape') }, format.sizes.map((s) => el('button', { class: 'seg-btn', type: 'button', role: 'radio', 'aria-checked': String(s.id === size.id), onclick: () => ((post.size = s.id), save(), paint()) }, s.id))),
          ),
        field(t('Line at the foot of every card'), el('input', { type: 'text', maxlength: 40, value: post.footer, placeholder: t('Your name or account, or nothing'), oninput: (e) => ((post.footer = e.target.value), drawAll(), save()) })),
        covers.length > 0 &&
          field(
            t('Picture behind the cover'),
            el(
              'select',
              { onchange: (e) => (e.target.value ? (cover.image = e.target.value) : delete cover.image, draw(0), edited()) },
              el('option', { value: '' }, t('None: the theme alone')),
              covers.map((url, n) => el('option', { value: url, selected: cover.image === url }, t('Image {n} of this script', { n: n + 1 }))),
            ),
          ),
      );

      // ---- The text under the pictures ----
      const heading = el('h2', {}, post.title || run.script.title);
      const titleInput = el('input', { type: 'text', maxlength: 200, value: post.title, oninput: (e) => ((post.title = e.target.value), (heading.textContent = post.title || run.script.title), edited()) });
      const text = el(
        'div',
        { class: 'pub' },
        format.titleMax > 0 &&
          el(
            'div',
            { class: 'pub-item' },
            el('div', { class: 'label' }, el('span', {}, t('Title'), ' ', counter(() => count(post.title), format.titleMax)), el('button', { class: 'btn small', type: 'button', onclick: () => copy(post.title) }, t('Copy'))),
            titleInput,
            post.titles.length > 1 && el('div', { class: 'post-options' }, post.titles.map((option) => el('button', { class: 'chip', type: 'button', title: t('Use this title'), onclick: () => ((post.title = titleInput.value = heading.textContent = option), edited()) }, option))),
          ),
        el(
          'div',
          { class: 'pub-item' },
          el('div', { class: 'label' }, el('span', {}, t('Body text'), ' ', counter(() => count(noteText(post)), format.bodyMax)), el('button', { class: 'btn small', type: 'button', onclick: () => copy(noteText(post)) }, t('Copy with hashtags'))),
          el('textarea', { rows: 9, maxlength: 8000, oninput: (e) => ((post.body = e.target.value), edited()) }, post.body),
        ),
        el(
          'div',
          { class: 'pub-item' },
          el('div', { class: 'label' }, el('span', {}, t('Hashtags'), ' ', counter(() => post.hashtags.length, format.hashtagMax)), el('button', { class: 'btn small', type: 'button', onclick: () => copy(post.hashtags.join(' ')) }, t('Copy'))),
          el('input', {
            type: 'text',
            value: post.hashtags.join(' '),
            oninput: (e) => ((post.hashtags = [...new Set(e.target.value.split(/[\s,，]+/).map((x) => x.replace(/^#+/, '')).filter(Boolean).map((x) => `#${x}`))]), edited()),
          }),
        ),
      );

      const sharing = canShareFiles();
      const meta = [platform.name, formatName, t('{n} cards', { n: post.cards.length }), `${size.id} · ${size.w}×${size.h}`, post.by && post.by !== 'demo' && post.by].filter(Boolean);
      root.replaceChildren(
        el(
          'div',
          { class: 'script-head' },
          el('div', {}, heading, el('div', { class: 'meta' }, meta.map((m) => el('span', {}, m)))),
          el(
            'div',
            { class: 'actions' },
            btn('package', t('Download images (.zip)'), { class: 'btn primary', title: t('Every card as a picture, numbered in order, with the title and the text in post.txt'), onclick: (e) => downloadAll(e.currentTarget) }),
            sharing && btn('upload', t('Share to an app'), { title: t('Sends the pictures to an app on this device, such as {platform}. The title and the text are copied, ready to paste.', { platform: platform.name }), onclick: share }),
            btn('copy', t('Copy title and text'), { onclick: () => copy([post.title, noteText(post)].filter(Boolean).join('\n\n')) }),
          ),
          askRow(t('Write it again')),
          ui.error && el('p', { class: 'error', role: 'alert' }, ui.error),
        ),
        el('div', { class: 'section' }, el('div', { class: 'section-head' }, el('h3', {}, t('Look of the cards'))), look),
        el(
          'div',
          { class: 'section' },
          el('div', { class: 'section-head' }, el('h3', {}, t('Cards')), el('span', { class: 'hint' }, t('Wrap a phrase in ** ** to mark it.'))),
          el(
            'div',
            { class: 'post-grid' },
            post.cards.map(tileOf),
            post.cards.length < format.maxCards &&
              el('button', { class: 'pcard-add', type: 'button', onclick: () => (post.cards.splice(Math.max(1, post.cards.length - (post.cards.at(-1).kind === 'summary' ? 1 : 0)), 0, { kind: 'point', kicker: '', title: '', body: '', bullets: [] }), save(), paint()) }, icon('plus', 20), el('span', {}, t('Add a card'))),
          ),
        ),
        el('div', { class: 'section' }, el('div', { class: 'section-head' }, el('h3', {}, t('Text of the post'))), text),
        el(
          'div',
          { class: 'section' },
          el('div', { class: 'section-head' }, el('h3', {}, t('Before you post'))),
          checks,
          el(
            'ol',
            { class: 'post-steps' },
            el('li', {}, sharing ? t('On your phone, Share to an app sends the pictures straight to {platform}. On a computer, download the images and send them to your phone.', { platform: platform.name }) : t('Download the images and send them to your phone. Opened on a phone, this page can share them straight to {platform}.', { platform: platform.name })),
            el('li', {}, t('In {platform}, start a new post ({format}) and add the pictures in their numbered order.', { platform: platform.name, format: formatName })),
            el('li', {}, t('Paste the title and the text. They are counted here against what {platform} takes.', { platform: platform.name })),
            el('li', {}, t('If a picture in the post was made by AI, tick the platform’s own “AI-generated” declaration when you post.')),
          ),
        ),
        // Straight to the channels the person connected, as JPEG: the one picture format every platform takes.
        ...(publish
          ? [
              publish.panel({
                run,
                platformId,
                kind: 'images',
                files: async () => (await blobs('jpg')).map((blob, i) => ({ name: `${String(i + 1).padStart(2, '0')}.jpg`, blob })),
                text: () => [post.title, noteText(post)].filter(Boolean).join('\n\n'),
                title: () => post.title || run.script.title,
                hashtags: post.hashtags,
                ai: Boolean(post.cards[0].image),
              }),
            ]
          : []),
      );
      drawAll();
    }

    paint();
    return root;
  }

  return { has, view };
}
