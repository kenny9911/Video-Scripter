// Draws the cards of an image post (图文) on a canvas, in the browser: what you see is the picture you
// download, pixel for pixel. No web font is fetched: the cards are set in the fonts of the device.
//
//   THEMES                 the looks a post can have
//   drawCard(canvas, card, options)   one card, at the size the platform takes
//   wrapText(measure, text, width)    line breaking for Chinese and Latin text, with **marked** phrases
//
// A card is { kind, kicker, title, body, bullets, image }. Its text is fitted: type shrinks until the card
// holds it, down to a floor below which a phone could not read it.

const SANS = '"PingFang SC","Hiragino Sans GB","Noto Sans SC","Source Han Sans SC","Microsoft YaHei","Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif';
const SERIF = '"Songti SC","Noto Serif SC","Source Han Serif SC",STSong,SimSun,Georgia,"Times New Roman",serif';

export const THEMES = [
  { id: 'paper', name: { en: 'Cream paper', zh: '奶油纸' }, bg: '#F5EFE3', ink: '#221D16', sub: '#7C7061', accent: '#C8432B', onAccent: '#FFFFFF', rule: 'rgba(34,29,22,0.16)', mark: { type: 'under', color: 'rgba(200,67,43,0.24)' }, title: SERIF, deco: 'frame' },
  { id: 'clean', name: { en: 'Clean white', zh: '极简白' }, bg: '#FFFFFF', ink: '#0B0B0F', sub: '#6B7280', accent: '#2563EB', onAccent: '#FFFFFF', rule: 'rgba(11,11,15,0.12)', mark: { type: 'under', color: 'rgba(37,99,235,0.2)' }, title: SANS, deco: 'bar' },
  { id: 'ink', name: { en: 'Dark', zh: '深色' }, bg: '#0E0F13', ink: '#F5F5F4', sub: '#9CA3AF', accent: '#D4F24A', onAccent: '#0E0F13', rule: 'rgba(245,245,244,0.16)', mark: { type: 'color' }, title: SANS, deco: 'glow' },
  {
    id: 'pop',
    name: { en: 'Bold colour', zh: '撞色大字' },
    bg: '#FFF6EF',
    ink: '#1A1210',
    sub: '#7A6A63',
    accent: '#FF5A36',
    onAccent: '#FFFFFF',
    rule: 'rgba(26,18,16,0.14)',
    mark: { type: 'under', color: 'rgba(255,90,54,0.28)' },
    title: SANS,
    deco: 'corner',
    cover: { bg: '#FF5A36', ink: '#FFFFFF', sub: 'rgba(255,255,255,0.86)', accent: '#1A1210', onAccent: '#FFFFFF', rule: 'rgba(255,255,255,0.3)', mark: { type: 'under', color: 'rgba(26,18,16,0.28)' }, deco: 'circles' },
  },
  { id: 'mist', name: { en: 'Soft gradient', zh: '柔和渐变' }, bg: ['#FDE7EF', '#E4E8FF'], ink: '#1F1B3A', sub: '#6B6790', accent: '#6D4AFF', onAccent: '#FFFFFF', rule: 'rgba(31,27,58,0.14)', mark: { type: 'under', color: 'rgba(109,74,255,0.2)' }, title: SANS, deco: 'blobs' },
  { id: 'memo', name: { en: 'Notebook', zh: '备忘录' }, bg: '#FFFDF4', ink: '#1C1C1E', sub: '#8A8578', accent: '#E0A100', onAccent: '#1C1C1E', rule: 'rgba(28,28,30,0.1)', mark: { type: 'under', color: 'rgba(255,214,10,0.6)' }, title: SANS, deco: 'ruled' },
];

export const themeOf = (id) => THEMES.find((t) => t.id === id) || THEMES[0];

// ---------- Line breaking ----------

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const graphemes = (s) => (segmenter ? Array.from(segmenter.segment(s), (x) => x.segment) : Array.from(s));
// Letters that make a word which is not broken: Latin and its neighbours, digits, and what sits inside "3.5%", "@name", "a/b".
const WORD = /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Nd}'’\-_.@#%&/+$:~]$/u;
const NO_START = /^[，。！？、；：）》」』】〉”’…—·～,.!?;:)\]}‰°]$/u; // never the first thing on a line
const NO_END = /^[（《「『【〈“‘([{￥¥]$/u; // never the last thing on a line

/**
 * Text as the pieces a line is made of: [{ parts: [{ text, mark }], space, br }]. A piece is never broken:
 * one Chinese character, one Latin word, or either with the punctuation that has to stay with it.
 * `**phrase**` marks a phrase; markers that do not pair up are dropped and nothing is marked.
 */
export function atomsOf(text) {
  const chunks = String(text ?? '').split('**');
  const paired = chunks.length % 2 === 1;
  const atoms = [];
  const push = (part) => {
    const prev = atoms.at(-1);
    const glued = prev && !prev.br && !prev.space && (NO_START.test(part.text) || NO_END.test(prev.parts.at(-1).text));
    if (glued) prev.parts.push(part);
    else atoms.push({ parts: [part] });
  };
  chunks.forEach((chunk, i) => {
    const mark = paired && i % 2 === 1;
    let word = '';
    const flush = () => (word && push({ text: word, mark }), (word = ''));
    for (const g of graphemes(chunk)) {
      if (g === '\n') flush(), atoms.push({ br: true });
      else if (/^\s$/.test(g)) flush(), atoms.push({ space: true, parts: [{ text: ' ', mark }] });
      else if (WORD.test(g)) word += g;
      else flush(), push({ text: g, mark });
    }
    flush();
  });
  return atoms;
}

/**
 * Break text into lines no wider than `maxW`. `measure(text)` gives a width in the type the text is set in.
 * Returns [{ atoms, w }]. A piece wider than a line (a long address) is broken wherever it has to be.
 */
export function wrapText(measure, text, maxW) {
  const lines = [{ atoms: [], w: 0 }];
  const widthOf = (atom) => atom.parts.reduce((n, p) => n + measure(p.text), 0);
  const place = (atom) => {
    const line = lines.at(-1);
    atom.w = widthOf(atom);
    if (atom.w > maxW && atom.parts.some((p) => graphemes(p.text).length > 1)) {
      for (const p of atom.parts) for (const g of graphemes(p.text)) place({ parts: [{ text: g, mark: p.mark }] });
    } else if (line.atoms.length && line.w + atom.w > maxW) lines.push({ atoms: [atom], w: atom.w });
    else line.atoms.push(atom), (line.w += atom.w);
  };
  for (const atom of atomsOf(text)) {
    if (atom.br) lines.push({ atoms: [], w: 0 });
    else if (!atom.space) place(atom);
    else {
      // A space never starts a line: one that does not fit is dropped, and the word after it starts the next line.
      const line = lines.at(-1);
      atom.w = widthOf(atom);
      if (line.atoms.length && line.w + atom.w <= maxW) line.atoms.push(atom), (line.w += atom.w);
    }
  }
  for (const line of lines) {
    while (line.atoms.at(-1)?.space) line.w -= line.atoms.pop().w; // nor ends one
  }
  return lines;
}

// ---------- Drawing ----------

const rounded = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

/** Text set in a box `maxW` wide: the largest size from `max` down to `min` at which it takes `maxLines` or fewer. */
function textBlock(ctx, text, o) {
  if (!String(text || '').trim()) return null;
  const font = (size) => `${o.weight || 400} ${size}px ${o.family}`;
  let size = o.max;
  let lines;
  for (;;) {
    ctx.font = font(size);
    lines = wrapText((s) => ctx.measureText(s).width, text, o.maxW);
    if (lines.length <= (o.maxLines || 99) || size <= o.min) break;
    size = Math.max(o.min, Math.floor(size * 0.94));
  }
  // A headline of several lines is set in lines of about the same length, so its last line is not one stray
  // word. Of the ways to do that, the best breaks after punctuation and never inside a marked phrase.
  if (o.balance && lines.length > 1) {
    const count = lines.length;
    const lastPart = (line) => line.atoms.at(-1)?.parts.at(-1);
    const cost = (set) => {
      const widths = set.map((l) => l.w);
      let c = (Math.max(...widths) - Math.min(...widths)) / o.maxW;
      set.slice(0, -1).forEach((line, i) => {
        if (/[，。！？、；：,.!?;:]$/u.test(lastPart(line)?.text || '')) c -= 0.3;
        if (lastPart(line)?.mark && set[i + 1].atoms[0]?.parts[0].mark) c += 0.5;
      });
      return c;
    };
    let best = cost(lines);
    for (let w = o.maxW * 0.45; w < o.maxW; w += o.maxW * 0.03) {
      const even = wrapText((s) => ctx.measureText(s).width, text, w);
      if (even.length !== count || cost(even) >= best) continue;
      best = cost(even);
      lines = even;
    }
  }
  const step = size * (o.lh || 1.4);
  return {
    h: lines.length * step,
    draw(x, y) {
      ctx.font = font(size);
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      lines.forEach((line, i) => {
        const base = y + i * step + (step - size) / 2 + size * 0.86;
        const parts = line.atoms.flatMap((atom) => atom.parts);
        const widths = parts.map((p) => ctx.measureText(p.text).width);
        // The highlight goes down first, one stroke under each marked run, so its pieces never overlap.
        if (o.mark?.type === 'under') {
          let at = x;
          let from = null;
          parts.forEach((part, j) => {
            if (part.mark && from == null) from = at;
            at += widths[j];
            if (from == null || parts[j + 1]?.mark) return;
            ctx.fillStyle = o.mark.color;
            ctx.fillRect(from - size * 0.04, base - size * 0.3, at - from + size * 0.08, size * 0.44);
            from = null;
          });
        }
        let at = x;
        parts.forEach((part, j) => {
          ctx.fillStyle = part.mark && o.mark?.type === 'color' ? o.accent : o.color;
          ctx.fillText(part.text, at, base);
          at += widths[j];
        });
      });
    },
  };
}

const gap = (h) => ({ h, draw() {} });

function bulletList(ctx, items, o) {
  const rows = items.map((b) => textBlock(ctx, b, { ...o, maxW: o.maxW - o.indent, balance: true })).filter(Boolean);
  if (!rows.length) return null;
  return {
    h: rows.reduce((n, r) => n + r.h, 0) + o.between * (rows.length - 1),
    draw(x, y) {
      let at = y;
      rows.forEach((row, i) => {
        o.bullet(x, at, i);
        row.draw(x + o.indent, at);
        at += row.h + o.between;
      });
    },
  };
}

function background(ctx, look, w, h, u, cover) {
  if (Array.isArray(look.bg)) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    look.bg.forEach((c, i) => g.addColorStop(i / (look.bg.length - 1), c));
    ctx.fillStyle = g;
  } else ctx.fillStyle = look.bg;
  ctx.fillRect(0, 0, w, h);
  const glow = (x, y, r, color) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };
  const decos = {
    frame() {
      ctx.strokeStyle = look.rule;
      ctx.lineWidth = 2 * u;
      ctx.strokeRect(36 * u, 36 * u, w - 72 * u, h - 72 * u);
    },
    bar() {
      ctx.fillStyle = look.accent;
      if (cover) ctx.fillRect(0, 0, 18 * u, h);
      else ctx.fillRect(92 * u, 0, 150 * u, 12 * u);
    },
    glow() {
      ctx.globalAlpha = 0.3;
      glow(w * 0.92, h * 0.06, 760 * u, look.accent);
      ctx.globalAlpha = 1;
    },
    corner() {
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = look.accent;
      ctx.beginPath();
      ctx.arc(w, h, 300 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    },
    circles() {
      ctx.fillStyle = 'rgba(255,255,255,0.13)';
      for (const [x, y, r] of [[w * 0.9, h * 0.1, 330], [w * 0.05, h * 0.92, 240]]) {
        ctx.beginPath();
        ctx.arc(x, y, r * u, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    blobs() {
      glow(w * 0.1, h * 0.08, 620 * u, 'rgba(255,255,255,0.85)');
      ctx.globalAlpha = 0.2;
      glow(w * 0.95, h * 0.95, 700 * u, look.accent);
      ctx.globalAlpha = 1;
    },
    ruled() {
      ctx.fillStyle = look.accent;
      ctx.fillRect(0, 0, w, 16 * u);
      ctx.fillStyle = look.rule;
      for (let y = 250 * u; y < h - 120 * u; y += 92 * u) ctx.fillRect(0, y, w, 2 * u);
    },
  };
  decos[look.deco]?.();
}

/** A picture drawn to fill the card, then darkened towards the bottom so white text reads on it. */
function pictureBackground(ctx, image, w, h) {
  const k = Math.max(w / image.naturalWidth, h / image.naturalHeight);
  const [iw, ih] = [image.naturalWidth * k, image.naturalHeight * k];
  ctx.drawImage(image, (w - iw) / 2, (h - ih) / 2, iw, ih);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0.28)');
  g.addColorStop(0.38, 'rgba(0,0,0,0.12)');
  g.addColorStop(1, 'rgba(0,0,0,0.82)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

/**
 * Draw `card` on `canvas`.
 *   theme     a theme of THEMES
 *   size      { w, h } in pixels
 *   index, total   the card's place in the post, for the page mark
 *   pointNo   which of the "point" cards this is, from 1: its number
 *   footer    a line at the foot of every card, such as the creator's name
 *   image     a loaded <img> for a cover that has a picture behind it
 * Returns { scale, clipped }: how far the type was shrunk to fit, and whether text was still cut off.
 */
export function drawCard(canvas, card, { theme, size, index = 0, total = 1, pointNo = 0, footer = '', image = null }) {
  const { w, h } = size;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  const u = w / 1080;
  const cover = card.kind === 'cover';
  const pictured = cover && image?.naturalWidth > 0;
  let look = cover && theme.cover ? { ...theme, ...theme.cover } : theme;
  if (pictured) look = { ...look, ink: '#FFFFFF', sub: 'rgba(255,255,255,0.86)', rule: 'rgba(255,255,255,0.3)', mark: { type: 'color' }, accent: theme.id === 'ink' ? theme.accent : '#FFFFFF', onAccent: '#111111' };

  ctx.clearRect(0, 0, w, h);
  if (pictured) pictureBackground(ctx, image, w, h);
  else background(ctx, look, w, h, u, cover);

  // A tall card is shown under the app's own buttons: keep clear of them.
  const tall = h / w > 1.6;
  const pad = 92 * u;
  const top = pad + (tall ? 130 * u : 0);
  const foot = h - pad - (tall ? 250 * u : 0);
  const maxW = w - pad * 2;
  const footRow = 64 * u;
  const bottom = foot - footRow - 28 * u;

  const blocks = (k) => {
    const px = (n) => n * u * k;
    const text = (value, o) => textBlock(ctx, value, { family: SANS, color: look.ink, accent: look.accent, mark: look.mark, maxW, ...o, max: px(o.max), min: px(o.min) });
    const out = [];
    const add = (block, space = 0) => block && (out.length && space && out.push(gap(px(space))), out.push(block));

    if (card.kind === 'cover') {
      if (card.kicker) {
        ctx.font = `700 ${px(34)}px ${SANS}`;
        const tw = Math.min(maxW - px(56), ctx.measureText(card.kicker).width);
        add({
          h: px(66),
          draw(x, y) {
            ctx.fillStyle = look.accent;
            rounded(ctx, x, y, tw + px(56), px(66), px(33));
            ctx.fill();
            ctx.font = `700 ${px(34)}px ${SANS}`;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            ctx.fillStyle = look.onAccent;
            ctx.fillText(card.kicker, x + px(28), y + px(35), tw);
          },
        });
      }
      add(text(card.title, { family: look.title, weight: 900, max: 148, min: 84, lh: 1.2, maxLines: 4, balance: true }), 46);
      if (card.body || card.bullets?.length) {
        add({ h: px(12), draw: (x, y) => ((ctx.fillStyle = pictured ? '#FFFFFF' : look.accent), ctx.fillRect(x, y, px(120), px(12))) }, 50);
        add(text(card.body, { weight: 500, max: 48, min: 38, lh: 1.5, maxLines: 4, color: look.sub }), 44);
      }
    } else if (card.kind === 'quote') {
      add({
        h: px(150),
        draw(x, y) {
          ctx.font = `900 ${px(300)}px ${SERIF}`;
          ctx.textBaseline = 'alphabetic';
          ctx.textAlign = 'left';
          ctx.fillStyle = look.accent;
          ctx.fillText('“', x - px(14), y + px(238));
        },
      });
      add(text(card.title, { family: look.title, weight: 700, max: 92, min: 58, lh: 1.42, maxLines: 7, balance: true }), 30);
      add(text(card.body && `— ${card.body}`, { weight: 500, max: 42, min: 34, lh: 1.5, maxLines: 3, color: look.sub }), 50);
    } else {
      const summary = card.kind === 'summary';
      if (!summary && pointNo)
        add({
          h: px(118),
          draw(x, y) {
            ctx.font = `800 ${px(128)}px ${SANS}`;
            ctx.textBaseline = 'alphabetic';
            ctx.textAlign = 'left';
            ctx.fillStyle = look.accent;
            const no = String(pointNo).padStart(2, '0');
            ctx.fillText(no, x - px(4), y + px(106));
            if (card.kicker) {
              const nw = ctx.measureText(no).width;
              ctx.font = `700 ${px(34)}px ${SANS}`;
              ctx.fillStyle = look.sub;
              ctx.fillText(card.kicker, x + nw + px(22), y + px(104), maxW - nw - px(22));
            }
          },
        });
      if (summary && card.kicker) add(text(card.kicker, { weight: 700, max: 34, min: 30, lh: 1.3, maxLines: 1, color: look.accent }));
      add(text(card.title, { family: look.title, weight: 800, max: 86, min: 58, lh: 1.28, maxLines: 4, balance: true }), summary ? 22 : 34);
      if (card.title && (card.body || card.bullets?.length)) add({ h: px(3), draw: (x, y) => ((ctx.fillStyle = look.rule), ctx.fillRect(x, y, maxW, px(3))) }, 42);
      const body = () => add(text(card.body, { weight: 400, max: summary ? 44 : 50, min: 38, lh: 1.62, maxLines: 10, color: summary ? look.sub : look.ink }), 42);
      if (!summary) body();
      add(
        bulletList(ctx, card.bullets || [], {
          family: SANS,
          weight: summary ? 600 : 500,
          max: px(48),
          min: px(38),
          lh: 1.45,
          maxLines: 4,
          maxW,
          color: look.ink,
          accent: look.accent,
          mark: look.mark,
          indent: px(summary ? 84 : 46),
          between: px(summary ? 34 : 24),
          bullet(x, y) {
            ctx.fillStyle = look.accent;
            if (!summary) {
              ctx.beginPath();
              ctx.arc(x + px(11), y + px(35), px(10), 0, Math.PI * 2);
              return ctx.fill();
            }
            rounded(ctx, x, y + px(9), px(52), px(52), px(14));
            ctx.fill();
            ctx.strokeStyle = look.onAccent;
            ctx.lineWidth = px(6);
            ctx.lineCap = ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(x + px(14), y + px(36));
            ctx.lineTo(x + px(23), y + px(45));
            ctx.lineTo(x + px(39), y + px(26));
            ctx.stroke();
          },
        }),
        42,
      );
      if (summary) body();
    }
    return out;
  };

  // Size everything together: a card with little on it is set larger, so it does not sit in a corner of an
  // empty page; one with a lot is set smaller until the card holds it. Below 0.62 it is cut off rather than
  // made unreadable.
  let k = 1;
  let set = blocks(k);
  const height = (list) => list.reduce((n, b) => n + b.h, 0);
  const avail = bottom - top;
  while (k < 1.45 && !pictured) {
    const larger = blocks(k + 0.09);
    if (height(larger) > avail * (card.kind === 'cover' ? 0.64 : 0.8)) break;
    set = larger;
    k += 0.09;
  }
  while (height(set) > avail && k > 0.62) set = blocks((k -= 0.06));
  const room = bottom - top - height(set);
  const bias = pictured ? 1 : card.kind === 'cover' ? 0.44 : card.kind === 'quote' ? 0.42 : 0.36;
  let y = top + Math.max(0, room) * bias;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, bottom + 10 * u);
  ctx.clip();
  for (const b of set) b.draw(pad, y), (y += b.h);
  ctx.restore();

  // The foot of the card: the creator's line on the left, the page on the right (an arrow on the cover: swipe).
  ctx.textBaseline = 'middle';
  const mid = foot - footRow / 2;
  if (footer) {
    ctx.font = `600 ${30 * u}px ${SANS}`;
    ctx.textAlign = 'left';
    ctx.fillStyle = look.sub;
    ctx.fillText(footer, pad, mid, maxW - 140 * u);
  }
  if (cover && total > 1) {
    const r = 30 * u;
    const cx = w - pad - r;
    ctx.strokeStyle = look.ink;
    ctx.lineWidth = 3 * u;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.arc(cx, mid, r, 0, Math.PI * 2);
    ctx.moveTo(cx - 11 * u, mid);
    ctx.lineTo(cx + 11 * u, mid);
    ctx.moveTo(cx + 3 * u, mid - 9 * u);
    ctx.lineTo(cx + 12 * u, mid);
    ctx.lineTo(cx + 3 * u, mid + 9 * u);
    ctx.stroke();
  } else if (total > 1) {
    ctx.font = `700 ${30 * u}px ${SANS}`;
    ctx.textAlign = 'right';
    ctx.fillStyle = look.sub;
    ctx.fillText(`${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, w - pad, mid);
  }
  ctx.textAlign = 'left';
  return { scale: k, clipped: room < -1 }; // clipped: the card has more text than it can hold at a readable size
}

/** The picture on a canvas as a file: PNG, or JPEG where the platform takes nothing else. */
export const canvasBlob = (canvas, fileType = 'png') => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be made'))), fileType === 'jpg' ? 'image/jpeg' : 'image/png', 0.92));
