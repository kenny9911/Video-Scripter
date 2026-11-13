// Markdown for the chat and its canvas. No dependency, and no innerHTML: a reply is parsed into blocks and
// every node is then built by hand, so nothing a model writes can inject markup into the page.
//
//   parse(text)                -> blocks      the document as data (also what the tests read)
//   render(blocks, options)    -> a DocumentFragment (browser only)
//   toHtml(blocks)             -> the same as HTML text, escaped (for a file to download, and for tests)
//   embeds(blocks)             -> the ```image and ```video blocks of a reply, in the order they appear
//   highlight(code, lang)      -> [[class, text]]: a light colouring of code, by family of language
//
// What is read: headings, paragraphs, **strong**, *emphasis*, ~~strike~~, `code`, fenced code, quotes,
// bullet / numbered / task lists (nested), tables, rules, links, pictures and bare addresses. A line break
// inside a paragraph is kept as one, which is how chat text is written. HTML in the text is shown as text.
// A reply that is still being written is read as far as it goes: an open code fence runs to the end.
//
// The server reads replies with the same parser (src/chat/media.mjs), so both agree on which block is which.

const FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*([^`]*?)[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>[ \t]?/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*)|[ \t]*$)/;
const TABLE_RULE = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const TASK = /^\[([ xX])\][ \t]+/;

const indentOf = (line) => line.length - line.trimStart().length;
const isOrdered = (marker) => /\d/.test(marker);

/** True when a line begins something that is not the next line of a paragraph. */
function startsBlock(line, next) {
  if (FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line)) return true;
  const item = indentOf(line) <= 3 && ITEM.exec(line);
  if (item && item[4] && (!isOrdered(item[2]) || /^1[.)]$/.test(item[2]))) return true; // only a list that starts at 1 interrupts a paragraph
  return isTableStart(line, next);
}

/** The cells of a table row: the pipes at either end are optional, and a pipe in `code` or after a backslash is text. */
function cells(line) {
  const out = [];
  let cell = '';
  let ticks = 0;
  const s = line.trim().replace(/^\|/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') {
      cell += '|';
      i++;
    } else if (c === '`') {
      ticks ^= 1;
      cell += c;
    } else if (c === '|' && !ticks) {
      out.push(cell.trim());
      cell = '';
    } else cell += c;
  }
  if (cell.trim() || !out.length) out.push(cell.trim());
  return out;
}

function isTableStart(line, next) {
  if (!line.includes('|') || next == null || !TABLE_RULE.test(next) || !next.includes('-')) return false;
  return cells(line).length === cells(next).length;
}

function parseBlocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    let m = FENCE.exec(line);
    if (m) {
      const [, pad, fence, info] = m;
      const end = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`);
      const body = [];
      for (i++; i < lines.length && !end.test(lines[i]); i++) body.push(lines[i].slice(Math.min(pad.length, indentOf(lines[i]))));
      const closed = i < lines.length;
      i++;
      out.push({ type: 'code', lang: info.split(/\s+/)[0].toLowerCase(), text: body.join('\n'), closed });
      continue;
    }

    m = HEADING.exec(line);
    if (m) {
      out.push({ type: 'heading', level: m[1].length, inline: inline((m[2] || '').trim()) });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      out.push({ type: 'rule' });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const body = [];
      // A quote runs on over lines that have no marker but only carry its last paragraph on.
      while (i < lines.length && lines[i].trim() && (QUOTE.test(lines[i]) || (body.at(-1)?.trim() && !startsBlock(lines[i], lines[i + 1])))) body.push(lines[i++].replace(QUOTE, ''));
      out.push({ type: 'quote', blocks: parseBlocks(body) });
      continue;
    }

    if (indentOf(line) <= 3 && ITEM.test(line)) {
      const list = parseList(lines, i);
      out.push(list.block);
      i = list.next;
      continue;
    }

    if (isTableStart(line, lines[i + 1])) {
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''));
      const rows = [];
      for (i += 2; i < lines.length && lines[i].trim() && lines[i].includes('|') && !FENCE.test(lines[i]); i++) {
        const row = cells(lines[i]).slice(0, head.length);
        while (row.length < head.length) row.push('');
        rows.push(row.map(inline));
      }
      out.push({ type: 'table', align, head: head.map(inline), rows });
      continue;
    }

    const para = [line.trim()];
    for (i++; i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1]); i++) para.push(lines[i].trim());
    out.push({ type: 'paragraph', inline: inline(para.join('\n')) });
  }
  return out;
}

/** A list that starts at line `i`: its items, each parsed as blocks of its own, and the line after it. */
function parseList(lines, i) {
  const first = ITEM.exec(lines[i]);
  const ordered = isOrdered(first[2]);
  const base = first[1].length;
  const items = [];
  let loose = false;
  let reach = base + 4; // an item marker further in than this belongs to the item before it

  while (i < lines.length) {
    const m = ITEM.exec(lines[i]);
    if (!m || m[1].length >= reach || isOrdered(m[2]) !== ordered || RULE.test(lines[i])) break;
    const markerEnd = m[1].length + m[2].length;
    const padding = (m[3] || ' ').replace(/\t/g, ' ').length;
    let depth = markerEnd + (m[4] && padding <= 4 ? padding : 1); // how far in the item's own text sits
    const body = [m[4] ? lines[i].slice(depth).trimEnd() : ''];
    let gap = false; // a blank line inside the item
    i++;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j >= lines.length || indentOf(lines[j]) < depth) break;
        gap = true;
        for (; i < j; i++) body.push('');
        continue;
      }
      const ind = indentOf(line);
      if (ind >= depth) body.push(line.slice(depth));
      else if (ITEM.test(line)) {
        // A marker a little further in than this one's is a list inside the item, however it was indented.
        if (ind <= m[1].length) break;
        depth = ind;
        body.push(line.slice(depth));
      } else if (startsBlock(line, lines[i + 1])) break;
      else body.push(line.trim()); // the paragraph carries on without its indent
      i++;
    }
    reach = Math.max(depth, m[1].length + 1);
    const task = TASK.exec(body[0]);
    if (task) body[0] = body[0].slice(task[0].length);
    items.push({ blocks: parseBlocks(body), ...(task && { checked: task[1] !== ' ' }) });
    if (gap) loose = true;

    let j = i;
    while (j < lines.length && !lines[j].trim()) j++;
    if (j > i) {
      const next = j < lines.length ? ITEM.exec(lines[j]) : null;
      if (!next || next[1].length >= reach || isOrdered(next[2]) !== ordered || RULE.test(lines[j])) break;
      loose = true;
      i = j;
    }
  }
  const start = ordered ? Number(/\d+/.exec(first[2])[0]) : 1;
  return { block: { type: 'list', ordered, ...(ordered && start !== 1 && { start }), tight: !loose, items }, next: i };
}

// ---------- Inline ----------

const PUNCT = /[!-/:-@[-`{-~]/;
const WORD = /[\p{L}\p{N}]/u;
const URL_AT = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/y;
const AUTOLINK_AT = /<((?:https?:\/\/|mailto:)[^\s<>]+)>/y;
const BREAK_AT = /<br\s*\/?>/iy;
const ENTITY_AT = /&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]{2,8});/y;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', hellip: '…', mdash: '—', ndash: '–', times: '×', rarr: '→', larr: '←' };

const runOf = (s, i, c) => {
  let n = 0;
  while (s[i + n] === c) n++;
  return n;
};
const at = (re, s, i) => ((re.lastIndex = i), re.exec(s));

/** Where a run of exactly `n` backticks begins after `from`, or -1. */
function closingTicks(s, from, n) {
  for (let k = from; k < s.length; k++) {
    if (s[k] !== '`') continue;
    const run = runOf(s, k, '`');
    if (run === n) return k;
    k += run - 1;
  }
  return -1;
}

/** Where the delimiter that closes emphasis opened with `n` of `c` begins, or -1. Code spans and escapes are stepped over. */
function closer(s, from, c, n) {
  for (let k = from; k < s.length; ) {
    const ch = s[k];
    if (ch === '\\') k += 2;
    else if (ch === '`') {
      const run = runOf(s, k, '`');
      const end = closingTicks(s, k + run, run);
      k = end < 0 ? k + run : end + run;
    } else if (ch === c) {
      const run = runOf(s, k, c);
      const closes = k > from && !/\s/.test(s[k - 1]) && !(c === '_' && WORD.test(s[k + run] || ''));
      // A longer run closes what is inside it first: the last `n` of it are this delimiter.
      if (closes && run >= n && !(n === 1 && run === 2)) return k + run - n;
      k += run;
    } else k++;
  }
  return -1;
}

/** A link or picture whose `[` is at `i`: { text, href, title, end }, or null when it is not one. */
function linkAt(s, i) {
  let depth = 0;
  let close = -1;
  for (let k = i; k < s.length; k++) {
    const ch = s[k];
    if (ch === '\\') k++;
    else if (ch === '`') {
      const run = runOf(s, k, '`');
      const end = closingTicks(s, k + run, run);
      k = end < 0 ? k + run - 1 : end + run - 1;
    } else if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) {
      close = k;
      break;
    }
  }
  if (close < 0 || s[close + 1] !== '(') return null;
  let k = close + 2;
  while (s[k] === ' ' || s[k] === '\n') k++;
  let href = '';
  if (s[k] === '<') {
    const end = s.indexOf('>', k);
    if (end < 0) return null;
    href = s.slice(k + 1, end);
    k = end + 1;
  } else {
    let parens = 0;
    const from = k;
    for (; k < s.length; k++) {
      const ch = s[k];
      if (ch === '\\') k++;
      else if (ch === '(') parens++;
      else if (ch === ')') {
        if (!parens) break;
        parens--;
      } else if (/\s/.test(ch)) break;
    }
    href = s.slice(from, k).replace(/\\([!-/:-@[-`{-~])/g, '$1');
  }
  while (s[k] === ' ' || s[k] === '\n') k++;
  let title = '';
  if (s[k] === '"' || s[k] === "'") {
    const end = s.indexOf(s[k], k + 1);
    if (end < 0) return null;
    title = s.slice(k + 1, end);
    k = end + 1;
    while (s[k] === ' ') k++;
  }
  if (s[k] !== ')') return null;
  return { text: s.slice(i + 1, close), href: href.trim(), title, end: k + 1 };
}

/** The text of a paragraph, a heading or a cell as inline nodes. */
export function inline(s) {
  const out = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ type: 'text', text: buf });
    buf = '';
  };
  const push = (node) => (flush(), out.push(node));

  for (let i = 0; i < s.length; ) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && (PUNCT.test(s[i + 1]) || s[i + 1] === '\n')) {
      if (s[i + 1] === '\n') push({ type: 'break' });
      else buf += s[i + 1];
      i += 2;
    } else if (c === '\n') {
      buf = buf.trimEnd();
      push({ type: 'break' });
      i++;
    } else if (c === '`') {
      const run = runOf(s, i, '`');
      const end = closingTicks(s, i + run, run);
      if (end < 0) {
        buf += s.slice(i, i + run);
        i += run;
      } else {
        let text = s.slice(i + run, end).replace(/\n/g, ' ');
        if (text.length > 2 && text.startsWith(' ') && text.endsWith(' ') && text.trim()) text = text.slice(1, -1);
        push({ type: 'code', text });
        i = end + run;
      }
    } else if (c === '!' && s[i + 1] === '[' && linkAt(s, i + 1)) {
      const link = linkAt(s, i + 1);
      push({ type: 'image', src: link.href, alt: link.text, ...(link.title && { title: link.title }) });
      i = link.end;
    } else if (c === '[' && linkAt(s, i)) {
      const link = linkAt(s, i);
      push({ type: 'link', href: link.href, ...(link.title && { title: link.title }), children: inline(link.text) });
      i = link.end;
    } else if (c === '<' && at(AUTOLINK_AT, s, i)) {
      const m = at(AUTOLINK_AT, s, i);
      push({ type: 'link', href: m[1], children: [{ type: 'text', text: m[1].replace(/^mailto:/, '') }] });
      i += m[0].length;
    } else if (c === '<' && at(BREAK_AT, s, i)) {
      push({ type: 'break' });
      i += at(BREAK_AT, s, i)[0].length;
    } else if (c === '&' && at(ENTITY_AT, s, i)) {
      const m = at(ENTITY_AT, s, i);
      const code = m[1][0] === '#' ? Number(/[xX]/.test(m[1][1]) ? `0x${m[1].slice(2)}` : m[1].slice(1)) : 0;
      const char = code ? (code <= 0x10ffff && code !== 0 ? String.fromCodePoint(code) : '') : ENTITIES[m[1]];
      buf += char ?? m[0];
      i += m[0].length;
    } else if (c === 'h' && !/[\w/]/.test(s[i - 1] || '') && at(URL_AT, s, i)) {
      let url = at(URL_AT, s, i)[0];
      // The full stop that ends the sentence is not part of the address, and neither is a bracket that closes one around it.
      for (;;) {
        const last = url.at(-1);
        if (/[.,;:!?'"*_~]/.test(last) || (last === ')' && url.split(')').length > url.split('(').length)) url = url.slice(0, -1);
        else break;
      }
      push({ type: 'link', href: url, children: [{ type: 'text', text: url }] });
      i += url.length;
    } else if (c === '*' || c === '_' || c === '~') {
      const run = runOf(s, i, c);
      const opens = !/\s/.test(s[i + run] || ' ') && !(c === '_' && WORD.test(s[i - 1] || '')) && (c !== '~' || run >= 2);
      let done = false;
      for (const n of !opens ? [] : c === '~' ? [2] : run >= 3 ? [3, 2, 1] : run === 2 ? [2, 1] : [1]) {
        const end = closer(s, i + run, c, n);
        if (end < 0) continue;
        buf += s.slice(i, i + run - n); // the delimiters this emphasis did not use are text
        const children = inline(s.slice(i + run, end));
        push(c === '~' ? { type: 'strike', children } : n === 3 ? { type: 'strong', children: [{ type: 'em', children }] } : { type: n === 2 ? 'strong' : 'em', children });
        i = end + n;
        done = true;
        break;
      }
      if (!done) {
        buf += s.slice(i, i + run);
        i += run;
      }
    } else {
      buf += c;
      i++;
    }
  }
  flush();
  return out;
}

/** Markdown text as blocks. */
export function parse(text) {
  const lines = String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^[ \t]+/, (ws) => ws.replace(/\t/g, '    '))); // a tab indents by four
  return parseBlocks(lines);
}

// ---------- What the blocks say ----------

const walk = (blocks, visit) => {
  for (const b of blocks) {
    visit(b);
    if (b.type === 'quote') walk(b.blocks, visit);
    else if (b.type === 'list') for (const item of b.items) walk(item.blocks, visit);
  }
};

export const EMBED_KINDS = ['image', 'video'];
const HEADER = /^(aspect|ratio|seconds|length|duration)[ \t]*[:：][ \t]*(.+)$/i;

/** What a ```image or ```video block asks for: { kind, prompt, aspect, seconds }. Its first lines may set `aspect:` and `seconds:`. */
export function embedOf(block) {
  const lines = block.text.split('\n');
  const asked = { kind: block.lang, prompt: '', aspect: '', seconds: 0 };
  // The settings come first, one to a line; the first line that is not one, or a blank line, ends them.
  while (lines.length) {
    const m = HEADER.exec(lines[0].trim());
    if (!m && lines[0].trim()) break;
    lines.shift();
    if (!m) break;
    if (/^(aspect|ratio)$/i.test(m[1])) asked.aspect = m[2].trim().replace(/[：x×]/g, ':').replace(/\s+/g, '');
    else asked.seconds = Number(/\d+/.exec(m[2])?.[0]) || 0;
  }
  asked.prompt = lines.join('\n').trim();
  return asked;
}

/** The pictures and clips a reply asks for, in the order they appear. An open fence (a reply still being written) is not one yet. */
export function embeds(blocks) {
  const found = [];
  walk(blocks, (b) => b.type === 'code' && EMBED_KINDS.includes(b.lang) && b.closed && found.push(embedOf(b)));
  return found;
}

/** The text of inline nodes, without their markup. */
export const textOf = (nodes) => nodes.map((n) => (n.type === 'text' || n.type === 'code' ? n.text : n.type === 'break' ? ' ' : n.type === 'image' ? n.alt : textOf(n.children || []))).join('');

/** The first heading of a document, or '' when it has none. */
export function titleOf(blocks) {
  let title = '';
  walk(blocks, (b) => !title && b.type === 'heading' && (title = textOf(b.inline).trim()));
  return title;
}

// ---------- Addresses a page may point at ----------

/** A link target that is safe to follow: the web, mail, a phone number, or a place on this site. Anything else is ''. */
export function safeHref(href) {
  const url = String(href || '').trim();
  if (/^(https?:\/\/|mailto:|tel:)/i.test(url)) return url;
  if (/^[/#.?]/.test(url) && !url.startsWith('//')) return url;
  return /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(url) ? `https://${url}` : '';
}

/** A picture address that is safe to load: the web, a file this app stores, or an image carried in the text itself. */
export function safeSrc(src) {
  const url = String(src || '').trim();
  if (/^https?:\/\//i.test(url) || /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(url)) return url;
  return /^\/media\/[\w-]+\.\w+$/.test(url) ? url : '';
}

// ---------- Colouring code ----------

const words = (list) => new Set(list.split(' '));
const C_LIKE = {
  line: ['//'],
  block: [['/*', '*/']],
  strings: ['"', "'", '`'],
  keywords: words(
    'abstract any as async await bool boolean break case catch char class const constructor continue debugger default defer delete do double else enum export extends false final finally float fn for from func function get go if impl implements import in instanceof int interface let long match mut namespace new nil null number of package private protected pub public readonly return self set static string struct super switch this throw true try type typeof undefined use var void while yield',
  ),
};
const HASH = {
  line: ['#'],
  block: [['"""', '"""'], ["'''", "'''"]],
  strings: ['"', "'"],
  keywords: words(
    'and as assert async await begin break case class continue def del do done echo elif else elsif end esac except export false False fi finally for from function global if import in is lambda local module nil None nonlocal not null or pass raise require rescue return self then true True try unless until when while with yield',
  ),
};
const SQL = { line: ['--'], block: [['/*', '*/']], strings: ["'", '"'], ci: true, keywords: words('select from where and or not null is in as on join left right inner outer full group by order having limit offset insert into values update set delete create table alter drop index view primary key foreign references unique default distinct union all case when then else end with exists between like asc desc count sum avg min max') };
const JSON_LIKE = { line: [], block: [], strings: ['"'], keys: true, keywords: words('true false null') };
const CSS = { line: [], block: [['/*', '*/']], strings: ['"', "'"], keywords: new Set() };
const MARKUP = { markup: true };
const FAMILY = {};
for (const [family, names] of [
  [C_LIKE, 'js javascript jsx ts typescript tsx mjs java c cpp c++ h cs csharp go rust rs swift kotlin kt php dart scala'],
  [HASH, 'py python rb ruby sh bash zsh shell console yaml yml toml ini dockerfile makefile r perl'],
  [SQL, 'sql mysql postgres postgresql sqlite'],
  [JSON_LIKE, 'json jsonc json5'],
  [CSS, 'css scss less'],
  [MARKUP, 'html xml svg vue'],
])
  for (const name of names.split(' ')) FAMILY[name] = family;

/**
 * Code as [[class, text]] pieces, coloured by its family of language: c comment, s string, n number, k keyword,
 * f a name that is called, p a key, t a tag. A language that is not known comes back as one plain piece.
 */
export function highlight(code, lang) {
  const family = FAMILY[String(lang || '').toLowerCase()];
  if (!family || code.length > 60_000) return [['', code]];
  const out = [];
  let plain = '';
  const push = (cls, text) => {
    if (plain) out.push(['', plain]);
    plain = '';
    out.push([cls, text]);
  };

  if (family.markup) {
    for (let i = 0; i < code.length; ) {
      if (code.startsWith('<!--', i)) {
        const end = code.indexOf('-->', i + 4);
        const stop = end < 0 ? code.length : end + 3;
        push('c', code.slice(i, stop));
        i = stop;
      } else if (code[i] === '<' && /[A-Za-z/!?]/.test(code[i + 1] || '')) {
        const end = code.indexOf('>', i);
        const stop = end < 0 ? code.length : end + 1;
        const tag = code.slice(i, stop);
        const name = /^<\/?[\w:-]*/.exec(tag)[0];
        push('t', name);
        for (const part of tag.slice(name.length).split(/("[^"]*"|'[^']*')/)) if (part) /^["']/.test(part) ? push('s', part) : push('p', part);
        i = stop;
      } else plain += code[i++];
    }
    if (plain) out.push(['', plain]);
    return out;
  }

  for (let i = 0; i < code.length; ) {
    const line = family.line.find((mark) => code.startsWith(mark, i));
    const block = family.block.find(([open]) => code.startsWith(open, i));
    const c = code[i];
    if (block) {
      const end = code.indexOf(block[1], i + block[0].length);
      const stop = end < 0 ? code.length : end + block[1].length;
      push(block[0] === '/*' ? 'c' : 's', code.slice(i, stop));
      i = stop;
    } else if (line && (line !== '#' || i === 0 || /[\s;]/.test(code[i - 1]))) {
      const end = code.indexOf('\n', i);
      const stop = end < 0 ? code.length : end;
      push('c', code.slice(i, stop));
      i = stop;
    } else if (family.strings.includes(c)) {
      let k = i + 1;
      while (k < code.length && code[k] !== c && (c === '`' || code[k] !== '\n')) k += code[k] === '\\' ? 2 : 1;
      const stop = Math.min(code.length, k + 1);
      const text = code.slice(i, stop);
      push(family.keys && /^\s*:/.test(code.slice(stop, stop + 8)) ? 'p' : 's', text);
      i = stop;
    } else if (/\d/.test(c) && !/[\w$]/.test(code[i - 1] || '')) {
      const m = /^(0[xX][\da-fA-F_]+|\d[\d_]*(\.\d+)?([eE][+-]?\d+)?)[a-zA-Z%]*/.exec(code.slice(i, i + 40));
      push('n', m[0]);
      i += m[0].length;
    } else if (/[A-Za-z_$]/.test(c)) {
      const m = /^[\w$]+/.exec(code.slice(i, i + 80));
      const word = m[0];
      if (family.keywords.has(family.ci ? word.toLowerCase() : word)) push('k', word);
      else if (code[i + word.length] === '(' && !family.ci) push('f', word);
      else plain += word;
      i += word.length;
    } else {
      plain += c;
      i++;
    }
  }
  if (plain) out.push(['', plain]);
  return out;
}

// ---------- HTML text ----------

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function inlineHtml(nodes) {
  return nodes
    .map((n) => {
      if (n.type === 'text') return esc(n.text);
      if (n.type === 'break') return '<br>\n';
      if (n.type === 'code') return `<code>${esc(n.text)}</code>`;
      if (n.type === 'strong') return `<strong>${inlineHtml(n.children)}</strong>`;
      if (n.type === 'em') return `<em>${inlineHtml(n.children)}</em>`;
      if (n.type === 'strike') return `<del>${inlineHtml(n.children)}</del>`;
      if (n.type === 'link') {
        const href = safeHref(n.href);
        return href ? `<a href="${esc(href)}"${/^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${inlineHtml(n.children)}</a>` : inlineHtml(n.children);
      }
      if (n.type === 'image') return safeSrc(n.src) ? `<img src="${esc(safeSrc(n.src))}" alt="${esc(n.alt)}">` : esc(n.alt);
      return '';
    })
    .join('');
}

/** The blocks as HTML text. `embed(asked, index)` may return the HTML that stands for a ```image or ```video block. */
export function toHtml(blocks, { embed } = {}) {
  let embedded = 0;
  const html = (list, tight = false) =>
    list
      .map((b) => {
        if (b.type === 'heading') return `<h${b.level}>${inlineHtml(b.inline)}</h${b.level}>`;
        if (b.type === 'paragraph') return tight ? inlineHtml(b.inline) : `<p>${inlineHtml(b.inline)}</p>`;
        if (b.type === 'rule') return '<hr>';
        if (b.type === 'quote') return `<blockquote>\n${html(b.blocks)}\n</blockquote>`;
        if (b.type === 'code') {
          if (EMBED_KINDS.includes(b.lang) && b.closed) {
            const made = embed?.(embedOf(b), embedded++);
            if (made != null) return made;
          }
          return `<pre><code${b.lang ? ` class="language-${esc(b.lang)}"` : ''}>${esc(b.text)}</code></pre>`;
        }
        if (b.type === 'list') {
          const tag = b.ordered ? 'ol' : 'ul';
          const items = b.items.map((item) => `<li>${item.checked == null ? '' : `<input type="checkbox" disabled${item.checked ? ' checked' : ''}> `}${html(item.blocks, b.tight)}</li>`);
          return `<${tag}${b.start ? ` start="${b.start}"` : ''}>\n${items.join('\n')}\n</${tag}>`;
        }
        if (b.type === 'table') {
          const cell = (tag, nodes, i) => `<${tag}${b.align[i] ? ` style="text-align:${b.align[i]}"` : ''}>${inlineHtml(nodes)}</${tag}>`;
          return `<table>\n<thead><tr>${b.head.map((c, i) => cell('th', c, i)).join('')}</tr></thead>\n<tbody>\n${b.rows.map((r) => `<tr>${r.map((c, i) => cell('td', c, i)).join('')}</tr>`).join('\n')}\n</tbody>\n</table>`;
        }
        return '';
      })
      .join('\n');
  return html(blocks);
}

// ---------- The page ----------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c.nodeType ? c : document.createTextNode(String(c)));
  return node;
}

function inlineNodes(nodes, options) {
  return nodes.map((n) => {
    if (n.type === 'text') return document.createTextNode(n.text);
    if (n.type === 'break') return el('br');
    if (n.type === 'code') return el('code', {}, n.text);
    if (n.type === 'strong') return el('strong', {}, inlineNodes(n.children, options));
    if (n.type === 'em') return el('em', {}, inlineNodes(n.children, options));
    if (n.type === 'strike') return el('del', {}, inlineNodes(n.children, options));
    if (n.type === 'link') {
      const href = safeHref(n.href);
      if (!href) return el('span', {}, inlineNodes(n.children, options));
      return el('a', { href, title: n.title, ...(/^https?:/i.test(href) && { target: '_blank', rel: 'noopener noreferrer' }) }, inlineNodes(n.children, options));
    }
    if (n.type === 'image') {
      const src = safeSrc(n.src);
      if (!src) return document.createTextNode(n.alt);
      return el('img', { class: 'md-img', src, alt: n.alt, title: n.title, loading: 'lazy', onclick: options.onImage && (() => options.onImage(src, n.alt)) });
    }
    return null;
  });
}

function codeBlock(b, options) {
  const label = options.label || ((s) => s);
  const copy = el('button', { class: 'md-copy', type: 'button' }, label('Copy'));
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(b.text);
      copy.textContent = label('Copied');
    } catch {
      copy.textContent = label('Copy failed');
    }
    setTimeout(() => (copy.textContent = label('Copy')), 1600);
  });
  const code = el('code', {}, highlight(b.text, b.lang).map(([cls, text]) => (cls ? el('span', { class: `tok-${cls}` }, text) : text)));
  return el('figure', { class: 'md-code' }, el('figcaption', {}, el('span', {}, b.lang || label('text')), copy), el('pre', {}, code));
}

/**
 * The blocks as nodes for the page.
 *   options.embed(asked, index)   the node that stands for a ```image or ```video block (null: show it as code)
 *   options.onImage(src, alt)     called when a picture in the text is clicked
 *   options.label(text)           translates the few words on a code block ("Copy", "Copied")
 */
export function render(blocks, options = {}) {
  let embedded = 0;
  const nodes = (list, tight = false) =>
    list.map((b) => {
      if (b.type === 'heading') return el(`h${b.level}`, {}, inlineNodes(b.inline, options));
      if (b.type === 'paragraph') return tight ? el('span', { class: 'md-tight' }, inlineNodes(b.inline, options)) : el('p', {}, inlineNodes(b.inline, options));
      if (b.type === 'rule') return el('hr');
      if (b.type === 'quote') return el('blockquote', {}, nodes(b.blocks));
      if (b.type === 'code') {
        if (EMBED_KINDS.includes(b.lang) && (b.closed || options.embedOpen)) {
          const made = b.closed ? options.embed?.(embedOf(b), embedded++) : options.embedOpen(embedOf(b));
          if (made) return made;
        }
        return codeBlock(b, options);
      }
      if (b.type === 'list') {
        const items = b.items.map((item) => el('li', { class: item.checked == null ? null : 'md-task' }, item.checked != null && el('input', { type: 'checkbox', disabled: true, checked: item.checked }), nodes(item.blocks, b.tight)));
        return el(b.ordered ? 'ol' : 'ul', { start: b.start }, items);
      }
      if (b.type === 'table') {
        const cell = (tag, c, i) => el(tag, { style: b.align[i] ? `text-align:${b.align[i]}` : null }, inlineNodes(c, options));
        return el('div', { class: 'md-table' }, el('table', {}, el('thead', {}, el('tr', {}, b.head.map((c, i) => cell('th', c, i)))), el('tbody', {}, b.rows.map((r) => el('tr', {}, r.map((c, i) => cell('td', c, i)))))));
      }
      return null;
    });
  const fragment = document.createDocumentFragment();
  fragment.append(...nodes(blocks).filter(Boolean));
  return fragment;
}
