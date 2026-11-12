// The text of a PDF, read without a PDF library: enough of the format for what people actually upload
// (a report, a product sheet, an article saved from a browser or exported from Word, WPS, Keynote, LaTeX).
//
//   the file      every `n g obj` is found by scanning, so a broken cross-reference table does not matter;
//                 object streams are unpacked; a file that is protected but opens without a password is unlocked
//   the fonts     a font says which characters its codes draw in its ToUnicode map; without one, its encoding
//                 is used (WinAnsi, MacRoman, glyph names, and the GBK / Big5 / Shift-JIS / UTF-16 CMaps)
//   the page      text is taken in the order the page draws it. Where it is drawn tells a space from a
//                 new line from a new paragraph
//
// A scan has no text to take, and a font with neither a map nor a known encoding cannot be read: both are
// said plainly (the errors at the end), never answered with garbage.

import { inflateSync, inflateRawSync, deflateSync, constants as Z } from 'node:zlib';
import { createHash, createCipheriv, createDecipheriv } from 'node:crypto';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const MAX_STREAM = 64 * 1024 * 1024; // one stream may unpack to this much
const MAX_UNPACKED = 256 * 1024 * 1024; // and all the streams of one file to this much
const MAX_PAGES = 3000;
const MAX_MS = 20_000; // reading stops here, with what it has: the server does nothing else meanwhile

class Ref {
  constructor(num, gen) {
    this.num = num;
    this.gen = gen;
  }
}
/** A string of the file: its bytes, one character each. */
class Str {
  constructor(v) {
    this.v = v;
  }
}
class Op {
  constructor(op) {
    this.op = op;
  }
}
const isDict = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Ref) && !(v instanceof Str) && !(v instanceof Op);
const num = (v, otherwise = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : otherwise);

// ---------- Reading objects ----------

const isSpace = (c) => c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0;
const isDelimiter = (c) => c === 40 || c === 41 || c === 60 || c === 62 || c === 91 || c === 93 || c === 123 || c === 125 || c === 47 || c === 37;
const REF = /[\0\t\n\f\r ]+(\d{1,5})[\0\t\n\f\r ]+R(?![^\0\t\n\f\r ()<>[\]{}/%])/y;
const ESCAPE = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };

/**
 * Values out of PDF syntax, one at a time. `s` holds the bytes as one character each. Names come back as
 * '/Name', dictionaries as plain objects, strings as Str, anything else that is a word as Op.
 */
class Lexer {
  constructor(s, pos = 0, refs = false) {
    this.s = s;
    this.pos = pos;
    this.refs = refs; // `12 0 R` is a reference (in the file), or three tokens (in a page's drawing)
  }

  skip() {
    const { s } = this;
    for (;;) {
      const c = s.charCodeAt(this.pos);
      if (isSpace(c)) this.pos++;
      else if (c === 37) while (this.pos < s.length && s.charCodeAt(this.pos) !== 10 && s.charCodeAt(this.pos) !== 13) this.pos++;
      else return;
    }
  }

  /** The next value, or undefined at the end. */
  next() {
    this.skip();
    const { s } = this;
    if (this.pos >= s.length) return undefined;
    const c = s.charCodeAt(this.pos);
    if (c === 47) return this.name();
    if (c === 40) return this.literal();
    if (c === 60) return s.charCodeAt(this.pos + 1) === 60 ? this.dict() : this.hex();
    if (c === 91) return this.array();
    if (isDelimiter(c)) {
      // A closing bracket with nothing open: step over it.
      this.pos += c === 62 && s.charCodeAt(this.pos + 1) === 62 ? 2 : 1;
      return new Op(c === 62 ? '>>' : String.fromCharCode(c));
    }
    let end = this.pos + 1;
    while (end < s.length && !isSpace(s.charCodeAt(end)) && !isDelimiter(s.charCodeAt(end))) end++;
    const word = s.slice(this.pos, end);
    this.pos = end;
    if ((c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46) {
      const n = Number.parseFloat(word.replace(/^[+-]+(?=[+-])/, ''));
      if (!Number.isNaN(n)) {
        if (this.refs && Number.isInteger(n) && n >= 0) {
          REF.lastIndex = end;
          const m = REF.exec(s);
          if (m) {
            this.pos = REF.lastIndex;
            return new Ref(n, Number(m[1]));
          }
        }
        return n;
      }
    }
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (word === 'null') return null;
    return new Op(word);
  }

  name() {
    const { s } = this;
    let end = this.pos + 1;
    while (end < s.length && !isSpace(s.charCodeAt(end)) && !isDelimiter(s.charCodeAt(end))) end++;
    const raw = s.slice(this.pos, end);
    this.pos = end;
    return raw.includes('#') ? raw.replace(/#([0-9a-fA-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16))) : raw;
  }

  literal() {
    const { s } = this;
    let out = '';
    let depth = 1;
    let from = ++this.pos;
    for (; this.pos < s.length; this.pos++) {
      const c = s.charCodeAt(this.pos);
      if (c === 92) {
        out += s.slice(from, this.pos);
        const e = s[++this.pos];
        if (e >= '0' && e <= '7') {
          let oct = e;
          while (oct.length < 3 && s[this.pos + 1] >= '0' && s[this.pos + 1] <= '7') oct += s[++this.pos];
          out += String.fromCharCode(parseInt(oct, 8) & 255);
        } else if (e === '\r') {
          if (s[this.pos + 1] === '\n') this.pos++; // a backslash at the end of a line continues it
        } else if (e !== '\n') out += ESCAPE[e] ?? e ?? '';
        from = this.pos + 1;
      } else if (c === 40) depth++;
      else if (c === 41 && --depth === 0) break;
    }
    out += s.slice(from, this.pos);
    this.pos++;
    return new Str(out);
  }

  hex() {
    const { s } = this;
    let end = s.indexOf('>', this.pos);
    if (end < 0) end = s.length;
    let digits = s.slice(this.pos + 1, end).replace(/[^0-9a-fA-F]/g, '');
    if (digits.length % 2) digits += '0';
    this.pos = end + 1;
    return new Str(Buffer.from(digits, 'hex').toString('latin1'));
  }

  array() {
    const { s } = this;
    const out = [];
    this.pos++;
    for (;;) {
      this.skip();
      if (this.pos >= s.length) break;
      if (s.charCodeAt(this.pos) === 93) {
        this.pos++;
        break;
      }
      out.push(this.next());
    }
    return out;
  }

  dict() {
    const { s } = this;
    const out = Object.create(null);
    this.pos += 2;
    for (;;) {
      this.skip();
      if (this.pos >= s.length) break;
      if (s.startsWith('>>', this.pos)) {
        this.pos += 2;
        break;
      }
      const key = this.next();
      if (typeof key !== 'string') continue;
      this.skip();
      if (s.startsWith('>>', this.pos)) continue; // a key with no value
      out[key.slice(1)] = this.next();
    }
    return out;
  }
}

// ---------- Unpacking streams ----------

function inflate(buf) {
  for (const unpack of [inflateSync, inflateRawSync]) {
    try {
      // Z_SYNC_FLUSH: a stream that was cut short still gives what it holds.
      return unpack(buf, { maxOutputLength: MAX_STREAM, finishFlush: Z.Z_SYNC_FLUSH });
    } catch {}
  }
  return null;
}

/** Undo the PNG row filters some writers put under Flate. */
function unpredict(data, parms) {
  if (num(parms?.Predictor, 1) < 10) return data;
  const colors = num(parms.Colors, 1);
  const bits = num(parms.BitsPerComponent, 8);
  const bpp = Math.max(1, Math.ceil((colors * bits) / 8));
  const row = Math.ceil((colors * bits * num(parms.Columns, 1)) / 8);
  const rows = Math.floor(data.length / (row + 1));
  const out = Buffer.alloc(rows * row);
  for (let r = 0; r < rows; r++) {
    const filter = data[r * (row + 1)];
    const at = r * row;
    for (let i = 0; i < row; i++) {
      const x = data[r * (row + 1) + 1 + i];
      const a = i >= bpp ? out[at + i - bpp] : 0;
      const b = r ? out[at - row + i] : 0;
      const c = r && i >= bpp ? out[at - row + i - bpp] : 0;
      let v = x;
      if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[at + i] = v & 255;
    }
  }
  return out;
}

function ascii85(data) {
  const out = [];
  let group = [];
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    if (c === 126) break; // ~>
    if (isSpace(c)) continue;
    if (c === 122 && !group.length) {
      out.push(0, 0, 0, 0);
      continue;
    }
    if (c < 33 || c > 117) continue;
    group.push(c - 33);
    if (group.length === 5) {
      const v = group.reduce((n, d) => n * 85 + d, 0);
      out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
      group = [];
    }
  }
  if (group.length > 1) {
    const kept = group.length - 1;
    while (group.length < 5) group.push(84);
    const v = group.reduce((n, d) => n * 85 + d, 0);
    out.push(...[(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].slice(0, kept));
  }
  return Buffer.from(out);
}

function lzw(data, early = 1) {
  const out = [];
  let size = 0;
  let table;
  let width;
  const reset = () => {
    table = [];
    for (let i = 0; i < 256; i++) table.push(Buffer.from([i]));
    table.push(null, null); // 256 clears the table, 257 ends the data
    width = 9;
  };
  reset();
  let previous = null;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < data.length; i++) {
    acc = (acc << 8) | data[i];
    bits += 8;
    while (bits >= width) {
      const code = (acc >>> (bits - width)) & ((1 << width) - 1);
      bits -= width;
      acc &= (1 << bits) - 1;
      if (code === 257) return Buffer.concat(out);
      if (code === 256) {
        reset();
        previous = null;
        continue;
      }
      let entry = table[code];
      if (!entry) {
        if (!previous) return Buffer.concat(out);
        entry = Buffer.concat([previous, previous.subarray(0, 1)]);
      }
      out.push(entry);
      size += entry.length;
      if (size > MAX_STREAM) return Buffer.concat(out);
      if (previous && table.length < 4096) table.push(Buffer.concat([previous, entry.subarray(0, 1)]));
      previous = entry;
      const filled = table.length + early;
      width = filled >= 2048 ? 12 : filled >= 1024 ? 11 : filled >= 512 ? 10 : 9;
    }
  }
  return Buffer.concat(out);
}

function runLength(data) {
  const out = [];
  for (let i = 0; i < data.length; ) {
    const n = data[i++];
    if (n === 128) break;
    if (n < 128) {
      out.push(data.subarray(i, i + n + 1));
      i += n + 1;
    } else out.push(Buffer.alloc(257 - n, data[i++]));
  }
  return Buffer.concat(out);
}

// ---------- Opening a protected file ----------

const PAD = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');
const digest = (how, ...parts) => parts.reduce((h, p) => h.update(p), createHash(how)).digest();

function rc4(key, data) {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 255;
    [S[i], S[j]] = [S[j], S[i]];
  }
  const out = Buffer.allocUnsafe(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + S[i]) & 255;
    [S[i], S[j]] = [S[j], S[i]];
    out[k] = data[k] ^ S[(S[i] + S[j]) & 255];
  }
  return out;
}

/** AES in CBC mode as a PDF stores it: sixteen bytes of IV, then the blocks, the last one padded. */
function aes(key, data) {
  const body = data.subarray(16, data.length - (data.length % 16));
  if (data.length < 32 || !body.length) return Buffer.alloc(0);
  const d = createDecipheriv(`aes-${key.length * 8}-cbc`, key, data.subarray(0, 16)).setAutoPadding(false);
  const out = Buffer.concat([d.update(body), d.final()]);
  const pad = out[out.length - 1];
  return pad >= 1 && pad <= 16 ? out.subarray(0, out.length - pad) : out;
}

/** The hash of the newest security handler (revision 6), for the empty password. */
function hash6(input) {
  let k = digest('sha256', input);
  for (let i = 0; ; ) {
    const c = createCipheriv('aes-128-cbc', k.subarray(0, 16), k.subarray(16, 32)).setAutoPadding(false);
    const e = Buffer.concat([c.update(Buffer.concat(Array(64).fill(k))), c.final()]);
    let sum = 0;
    for (let j = 0; j < 16; j++) sum += e[j];
    k = digest(['sha256', 'sha384', 'sha512'][sum % 3], e);
    if (++i >= 64 && e[e.length - 1] <= i - 32) break;
  }
  return k.subarray(0, 32);
}

const LOCKED = 'This PDF needs a password to open. Save a copy without the password, or paste its text instead.';

/**
 * How to decrypt the streams of a protected file, or null when it is not protected. Many PDFs are protected
 * only against copying or printing and open without a password; those are read. One that asks for a password is not.
 */
function unlock(trailer, get) {
  const enc = get(trailer.Encrypt);
  if (!isDict(enc)) return null;
  if (get(enc.Filter) !== '/Standard') throw fail(LOCKED);
  const bytes = (v) => Buffer.from(get(v)?.v ?? '', 'latin1');
  const V = num(get(enc.V));
  const R = num(get(enc.R));
  const U = bytes(enc.U);
  let how = 'rc4';
  let filter = null;
  if (V >= 4) {
    const name = get(enc.StmF);
    filter = typeof name === 'string' && name !== '/Identity' ? get(get(enc.CF)?.[name.slice(1)]) : null;
    how = { '/AESV2': 'aes', '/AESV3': 'aes256', '/V2': 'rc4' }[filter && get(filter.CFM)] || 'none';
  }
  let key;
  if (R >= 5) {
    const hash = R === 5 ? (input) => digest('sha256', input) : hash6;
    if (U.length < 48 || !hash(U.subarray(32, 40)).equals(U.subarray(0, 32))) throw fail(LOCKED);
    const d = createDecipheriv('aes-256-cbc', hash(U.subarray(40, 48)), Buffer.alloc(16)).setAutoPadding(false);
    key = Buffer.concat([d.update(bytes(enc.UE).subarray(0, 32)), d.final()]);
  } else {
    let bits = num(get(enc.Length)) || (V >= 4 ? num(filter && get(filter.Length)) || 128 : 40);
    if (bits < 40) bits *= 8; // some writers give it in bytes
    const n = R === 2 ? 5 : Math.min(16, Math.max(5, bits >> 3));
    const P = Buffer.alloc(4);
    P.writeInt32LE(num(get(enc.P)) | 0);
    const id = bytes(get(trailer.ID)?.[0]);
    let k = digest('md5', PAD, bytes(enc.O).subarray(0, 32), P, id, R >= 4 && get(enc.EncryptMetadata) === false ? Buffer.alloc(4, 255) : Buffer.alloc(0));
    if (R >= 3) for (let i = 0; i < 50; i++) k = digest('md5', k.subarray(0, n));
    key = k.subarray(0, n);
    // Does the empty password open it? (What the file keeps in /U says so.)
    let check = rc4(key, R === 2 ? PAD : digest('md5', PAD, id));
    if (R >= 3) for (let i = 1; i <= 19; i++) check = rc4(key.map((b) => b ^ i), check);
    const same = R === 2 ? 32 : 16;
    if (!check.subarray(0, same).equals(U.subarray(0, same))) throw fail(LOCKED);
  }
  return (n, gen, data) => {
    if (how === 'none') return data;
    if (how === 'aes256') return aes(key, data);
    const own = digest('md5', key, Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, gen & 255, (gen >> 8) & 255]), how === 'aes' ? Buffer.from('sAlT') : Buffer.alloc(0)).subarray(0, Math.min(key.length + 5, 16));
    return how === 'aes' ? aes(own, data) : rc4(own, data);
  };
}

// ---------- The document ----------

/** Every object in the file: Map of number -> { num, gen, value, stream: [start, end] | null, pos }. Later ones win. */
function scan(s) {
  const objs = new Map();
  const re = /(\d{1,10})[\0\t\n\f\r ]+(\d{1,5})[\0\t\n\f\r ]+obj(?![A-Za-z])/g;
  let m;
  while ((m = re.exec(s))) {
    const lx = new Lexer(s, re.lastIndex, true);
    const value = lx.next();
    lx.skip();
    let stream = null;
    if (isDict(value) && s.startsWith('stream', lx.pos)) {
      let start = lx.pos + 6;
      if (s.charCodeAt(start) === 13) start++;
      if (s.charCodeAt(start) === 10) start++;
      let end = -1;
      const length = value.Length;
      if (typeof length === 'number' && length >= 0 && start + length <= s.length && /^[\r\n\t ]{0,4}endstream/.test(s.substr(start + length, 16))) end = start + length;
      if (end < 0) {
        // The length is kept elsewhere, or is wrong: the data runs to the word that ends it.
        const at = s.indexOf('endstream', start);
        end = at < 0 ? s.length : at;
        if (at >= 0 && s.charCodeAt(end - 1) === 10) end--;
        if (at >= 0 && s.charCodeAt(end - 1) === 13) end--;
      }
      stream = [start, Math.max(start, end)];
      re.lastIndex = Math.max(re.lastIndex, end);
    } else re.lastIndex = Math.max(re.lastIndex, Math.min(lx.pos, s.length));
    objs.set(Number(m[1]), { num: Number(m[1]), gen: Number(m[2]), value, stream, pos: m.index });
  }
  return objs;
}

/** What the trailers (or, in newer files, the cross-reference streams) say: where the document starts, and how it is protected. */
function readTrailer(s, objs) {
  const found = [];
  for (const m of s.matchAll(/trailer[\0\t\n\f\r ]*<</g)) {
    const value = new Lexer(s, m.index + 7, true).next();
    if (isDict(value)) found.push([m.index, value]);
  }
  for (const o of objs.values()) if (isDict(o.value) && o.value.Type === '/XRef') found.push([o.pos, o.value]);
  const trailer = {};
  for (const [, t] of found.sort((a, b) => a[0] - b[0])) for (const k of ['Root', 'Encrypt', 'ID']) if (t[k] !== undefined) trailer[k] = t[k];
  return trailer;
}

function open(bytes) {
  const s = bytes.toString('latin1');
  const objs = scan(s);
  const get = (v) => {
    for (let i = 0; v instanceof Ref && i < 20; i++) v = objs.get(v.num)?.value;
    return v instanceof Ref ? undefined : v;
  };
  const trailer = readTrailer(s, objs);
  const decrypt = unlock(trailer, get);
  let left = MAX_UNPACKED;

  /** The unpacked bytes of a stream object (given as a reference or as its entry), or null. */
  /**
   * A stream object (a reference, or its entry) with its packing undone as far as this reader can:
   * { bytes, packed } or null. `packed` names the filters that are left, which only a picture has (a JPEG stays a JPEG).
   */
  const unpack = (ref) => {
    const o = ref instanceof Ref ? objs.get(ref.num) : ref;
    if (!o?.stream) return null;
    if (left <= 0) return null; // a file built to unpack without end
    let out = bytes.subarray(o.stream[0], o.stream[1]);
    if (decrypt && o.value.Type !== '/XRef') out = decrypt(o.num, o.gen, out);
    const filters = [].concat(get(o.value.Filter) ?? []);
    const parms = [].concat(get(o.value.DecodeParms) ?? []);
    for (let i = 0; i < filters.length && out; i++) {
      const name = get(filters[i]);
      const p = get(parms[i]);
      if (name === '/FlateDecode' || name === '/Fl') {
        const raw = inflate(out);
        out = raw && unpredict(raw, p);
      } else if (name === '/LZWDecode' || name === '/LZW') out = unpredict(lzw(out, num(p?.EarlyChange, 1)), p);
      else if (name === '/ASCII85Decode' || name === '/A85') out = ascii85(out);
      else if (name === '/ASCIIHexDecode' || name === '/AHx') out = Buffer.from(out.toString('latin1').replace(/[^0-9a-fA-F]/g, '').replace(/^((?:..)*).$/, '$1'), 'hex');
      else if (name === '/RunLengthDecode' || name === '/RL') out = runLength(out);
      else if (name !== '/Crypt') return { bytes: out, packed: filters.slice(i).map(get) };
    }
    if (!out) return null;
    left -= out.length;
    return { bytes: out, packed: [] };
  };
  /** The unpacked bytes of a stream that holds text or data, or null (a picture is not that). */
  const data = (ref) => {
    const got = unpack(ref);
    return got && !got.packed.length ? got.bytes : null;
  };

  // Objects packed into object streams (most files since PDF 1.5). One that was written again later in the file wins.
  for (const o of [...objs.values()]) {
    if (!isDict(o.value) || o.value.Type !== '/ObjStm' || !o.stream) continue;
    const inner = data(o)?.toString('latin1');
    if (!inner) continue;
    const head = new Lexer(inner, 0);
    const first = num(get(o.value.First));
    for (let i = num(get(o.value.N)); i > 0; i--) {
      const n = head.next();
      const offset = head.next();
      if (typeof n !== 'number' || typeof offset !== 'number' || head.pos > first + 1) break;
      const known = objs.get(n);
      if (known && known.pos > o.pos) continue;
      objs.set(n, { num: n, gen: 0, value: new Lexer(inner, first + offset, true).next(), stream: null, pos: o.pos });
    }
  }

  // The pages, in order, each with the resources it inherits.
  const pages = [];
  const seen = new Set();
  const walk = (node, inherited) => {
    const d = get(node);
    if (!isDict(d) || seen.has(d) || pages.length >= MAX_PAGES) return;
    seen.add(d);
    const resources = get(d.Resources) ?? inherited;
    const kids = get(d.Kids);
    if (Array.isArray(kids)) for (const kid of kids) walk(kid, resources);
    else if (d.Contents !== undefined || d.Type === '/Page') pages.push({ dict: d, resources });
  };
  const root = get(trailer.Root) ?? [...objs.values()].find((o) => isDict(o.value) && o.value.Type === '/Catalog')?.value;
  if (isDict(root)) walk(root.Pages, undefined);
  if (!pages.length) for (const o of [...objs.values()].sort((a, b) => a.num - b.num)) if (isDict(o.value) && o.value.Type === '/Page' && pages.length < MAX_PAGES) pages.push({ dict: o.value, resources: get(o.value.Resources) });
  return { get, data, unpack, pages, entry: (ref) => (ref instanceof Ref ? objs.get(ref.num) : null) };
}

// ---------- Fonts: which characters a string draws ----------

/** UTF-16BE, as hex digits, to text. */
const utf16 = (hex) => {
  let out = '';
  for (let i = 0; i + 4 <= hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  return hex.length === 2 ? String.fromCharCode(parseInt(hex, 16)) : out;
};
const key = (bytes, code) => bytes * 0x100000000 + code;

/** A ToUnicode map: { map: (bytes, code) -> text, lengths: how many bytes a code may have }. */
function parseCMap(src) {
  const map = new Map();
  const lengths = new Set();
  const hexes = (block) => [...block.matchAll(/<([0-9a-fA-F\s]*)>/g)].map((m) => m[1].replace(/\s/g, ''));
  /** What stands between each `begin…` and its `end…`. A block that is never closed ends the search. */
  const blocks = (kind) => {
    const out = [];
    for (let at = src.indexOf(`begin${kind}`); at >= 0; ) {
      const end = src.indexOf(`end${kind}`, at);
      if (end < 0) break;
      out.push(src.slice(at + 5 + kind.length, end));
      at = src.indexOf(`begin${kind}`, end);
    }
    return out;
  };
  for (const block of blocks('codespacerange')) for (const h of hexes(block)) if (h.length) lengths.add(h.length / 2);
  for (const block of blocks('bfchar')) {
    const h = hexes(block);
    for (let i = 0; i + 1 < h.length; i += 2) map.set(key(h[i].length / 2, parseInt(h[i], 16)), utf16(h[i + 1]));
  }
  for (const block of blocks('bfrange')) {
    const tokens = [...block.matchAll(/<([0-9a-fA-F\s]*)>|\[([^\]]*)\]/g)];
    for (let i = 0; i + 2 < tokens.length && map.size < 400_000; i += 3) {
      if (tokens[i][1] === undefined || tokens[i + 1][1] === undefined) break;
      const size = tokens[i][1].replace(/\s/g, '').length / 2;
      const lo = parseInt(tokens[i][1], 16);
      const hi = Math.min(parseInt(tokens[i + 1][1], 16), lo + 65_535);
      if (tokens[i + 2][2] !== undefined) {
        const each = hexes(tokens[i + 2][2]);
        for (let c = lo; c <= hi && c - lo < each.length; c++) map.set(key(size, c), utf16(each[c - lo]));
      } else {
        const start = utf16(tokens[i + 2][1].replace(/\s/g, ''));
        if (!start) continue;
        const head = start.slice(0, -1);
        const last = start.charCodeAt(start.length - 1);
        for (let c = lo; c <= hi; c++) map.set(key(size, c), head + String.fromCharCode((last + c - lo) & 0xffff));
      }
    }
  }
  return { map, lengths: [...lengths].sort() };
}

// Names of glyphs, for a font that lists them (/Differences) instead of giving a map.
const GLYPHS = {
  space: ' ', nbspace: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'", parenleft: '(', parenright: ')',
  asterisk: '*', plus: '+', comma: ',', hyphen: '-', minus: '−', period: '.', slash: '/', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
  seven: '7', eight: '8', nine: '9', colon: ':', semicolon: ';', less: '<', equal: '=', greater: '>', question: '?', at: '@', bracketleft: '[', backslash: '\\',
  bracketright: ']', asciicircum: '^', underscore: '_', grave: '`', braceleft: '{', bar: '|', braceright: '}', asciitilde: '~', quoteleft: '‘', quoteright: '’',
  quotedblleft: '“', quotedblright: '”', quotesinglbase: '‚', quotedblbase: '„', endash: '–', emdash: '—', bullet: '•', ellipsis: '…', periodcentered: '·',
  degree: '°', copyright: '©', registered: '®', trademark: '™', section: '§', paragraph: '¶', dagger: '†', daggerdbl: '‡', fi: 'fi', fl: 'fl', ff: 'ff', ffi: 'ffi',
  ffl: 'ffl', guillemotleft: '«', guillemotright: '»', guilsinglleft: '‹', guilsinglright: '›', multiply: '×', divide: '÷', plusminus: '±', mu: 'µ', Euro: '€',
  euro: '€', sterling: '£', yen: '¥', cent: '¢', currency: '¤', exclamdown: '¡', questiondown: '¿', germandbls: 'ß', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ',
  oslash: 'ø', Oslash: 'Ø', lslash: 'ł', Lslash: 'Ł', eth: 'ð', Eth: 'Ð', thorn: 'þ', Thorn: 'Þ', dotlessi: 'ı', fraction: '⁄', florin: 'ƒ', perthousand: '‰',
  onehalf: '½', onequarter: '¼', threequarters: '¾', onesuperior: '¹', twosuperior: '²', threesuperior: '³', ordfeminine: 'ª', ordmasculine: 'º', logicalnot: '¬',
  brokenbar: '¦', acute: '´', dieresis: '¨', cedilla: '¸', macron: '¯', circumflex: 'ˆ', tilde: '˜', caron: 'ˇ', breve: '˘', ring: '˚', sfthyphen: '­',
};
const ACCENT = { acute: '́', grave: '̀', circumflex: '̂', tilde: '̃', dieresis: '̈', ring: '̊', cedilla: '̧', caron: '̌', macron: '̄', breve: '̆', ogonek: '̨', dotaccent: '̇' };

function glyphText(name) {
  if (GLYPHS[name] !== undefined) return GLYPHS[name];
  if (name.length === 1) return name;
  let m = /^([A-Za-z])([a-z]+)$/.exec(name);
  if (m && ACCENT[m[2]]) return (m[1] + ACCENT[m[2]]).normalize('NFC');
  m = /^uni([0-9A-Fa-f]{4})+$/.test(name) ? name.slice(3).match(/.{4}/g) : /^u([0-9A-Fa-f]{4,6})$/.exec(name)?.slice(1);
  if (m) return String.fromCodePoint(...m.map((h) => parseInt(h, 16)).filter((c) => c <= 0x10ffff));
  if (name.includes('.')) return glyphText(name.split('.')[0]); // "a.sc", "one.oldstyle"
  if (!name.includes('_')) return undefined;
  const parts = name.split('_').map(glyphText); // "t_i", "f_f_i": a ligature, named by its letters
  return parts.includes(undefined) ? undefined : parts.join('');
}

// Where Adobe's standard encoding differs from Windows-1252.
const STANDARD = { 0x27: '’', 0x60: '‘', 0xa4: '⁄', 0xa6: 'ƒ', 0xa8: '¤', 0xa9: "'", 0xaa: '“', 0xac: '‹', 0xad: '›', 0xae: 'fi', 0xaf: 'fl', 0xb1: '–', 0xb2: '†', 0xb3: '‡', 0xb4: '·', 0xb7: '•', 0xb8: '‚', 0xb9: '„', 0xba: '”', 0xbc: '…', 0xbd: '‰', 0xd0: '—', 0xe1: 'Æ', 0xe3: 'ª', 0xe8: 'Ł', 0xe9: 'Ø', 0xea: 'Œ', 0xeb: 'º', 0xf1: 'æ', 0xf5: 'ı', 0xf8: 'ł', 0xf9: 'ø', 0xfa: 'œ', 0xfb: 'ß' };
const WIN = new TextDecoder('windows-1252');
const MAC = new TextDecoder('macintosh');
const byteTable = (decoder) => Array.from({ length: 256 }, (_, i) => (i < 32 ? '' : decoder.decode(Uint8Array.of(i))));

// How wide the letters of the standard fonts are (codes 32 to 126), for a file that uses them without saying:
// what tells a gap between words from the space inside one.
const SANS = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const SERIF = [250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444, 921, 722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722, 556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333, 469, 500, 333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500, 500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541];

/** Glyph number -> character, from the `cmap` table of an embedded TrueType or OpenType font. */
function glyphChars(b) {
  const out = new Map();
  try {
    let cmap = -1;
    for (let i = 0, n = b.readUInt16BE(4); i < n; i++) if (b.toString('latin1', 12 + i * 16, 16 + i * 16) === 'cmap') cmap = b.readUInt32BE(20 + i * 16);
    if (cmap < 0) return out;
    const tables = [];
    for (let i = 0, n = b.readUInt16BE(cmap + 2); i < n; i++) {
      const platform = b.readUInt16BE(cmap + 4 + i * 8);
      const encoding = b.readUInt16BE(cmap + 6 + i * 8);
      if (platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))) tables.push(cmap + b.readUInt32BE(cmap + 8 + i * 8));
    }
    const put = (glyph, code) => glyph && !out.has(glyph) && code < 0x110000 && out.set(glyph, String.fromCodePoint(code));
    for (const at of tables.sort((x, y) => b.readUInt16BE(y) - b.readUInt16BE(x))) {
      const format = b.readUInt16BE(at);
      if (format === 12) {
        for (let i = 0, n = Math.min(b.readUInt32BE(at + 12), 100_000); i < n; i++) {
          const first = b.readUInt32BE(at + 16 + i * 12);
          const last = Math.min(b.readUInt32BE(at + 20 + i * 12), first + 65_535);
          for (let c = first; c <= last; c++) put(b.readUInt32BE(at + 24 + i * 12) + c - first, c);
        }
      } else if (format === 4) {
        const segments = b.readUInt16BE(at + 6) / 2;
        for (let i = 0; i < segments; i++) {
          const last = b.readUInt16BE(at + 14 + i * 2);
          const first = b.readUInt16BE(at + 16 + segments * 2 + i * 2);
          const delta = b.readUInt16BE(at + 16 + segments * 4 + i * 2);
          const where = at + 16 + segments * 6 + i * 2;
          const offset = b.readUInt16BE(where);
          for (let c = first; c <= last && c < 0xffff; c++) {
            const g = offset ? b.readUInt16BE(where + offset + (c - first) * 2) : c;
            put(offset && !g ? 0 : (g + delta) & 0xffff, c);
          }
        }
      }
    }
  } catch {} // a table that runs off the end of the font: what was read so far stands
  return out;
}

// Fonts for East Asian text that name a ready-made encoding instead of carrying a map.
const NAMED = [
  [/^Uni.*-(UCS2|UTF16)-/, 'utf-16be'],
  [/^Uni.*-UTF8-/, 'utf-8'],
  [/^(GB|GBK|GBpc|GBT|GBTpc|GBKp|GBK2K)-/, 'gb18030'],
  [/^(B5|B5pc|ETen|ETenms|HKscs|HKdl[ab]|HKgccs|HKm\d+)-/, 'big5'],
  [/^(\d\dms|\d\dmsp|\d\dpv|Ext|Add)-RKSJ-|^RKSJ-/, 'shift_jis'],
  [/^EUC-[HV]$/, 'euc-jp'],
  [/^(KSC|KSCms|KSCpc)-/, 'euc-kr'],
];

/**
 * A font as the page uses it: `each(str, show)` calls show(text, width, isSpace) for every character code in
 * a string, width in thousandths of the font size. `missing` counts the codes it could not turn into text.
 */
function makeFont(doc, d) {
  const { get, data } = doc;
  const font = { vertical: false, missing: 0, each: () => {} };
  if (!isDict(d)) return font;
  const toUnicode = d.ToUnicode instanceof Ref ? data(d.ToUnicode) : null;
  const cmap = toUnicode ? parseCMap(toUnicode.toString('latin1')) : null;
  const encoding = get(d.Encoding);

  if (get(d.Subtype) === '/Type0') {
    const name = typeof encoding === 'string' ? encoding.slice(1) : '';
    const identity = /^Identity-[HV]$/.test(name);
    const descendant = get(get(d.DescendantFonts)?.[0]);
    font.vertical = /-V$/.test(name);
    const widths = new Map();
    const w = isDict(descendant) ? get(descendant.W) : null;
    if (Array.isArray(w)) {
      for (let i = 0; i < w.length; ) {
        const first = get(w[i]);
        const second = get(w[i + 1]);
        if (Array.isArray(second)) {
          second.forEach((x, k) => widths.set(first + k, num(get(x))));
          i += 2;
        } else {
          for (let c = first; c <= second && c - first < 65_536; c++) widths.set(c, num(get(w[i + 2])));
          i += 3;
        }
      }
    }
    const usual = num(isDict(descendant) ? get(descendant.DW) : undefined, 1000);
    const decoder = !cmap && NAMED.find(([re]) => re.test(name))?.[1];
    if (decoder) {
      const td = new TextDecoder(decoder);
      font.each = (v, show) => {
        for (const ch of td.decode(Buffer.from(v, 'latin1'))) show(ch === '�' ? (font.missing++, '') : ch, ch.codePointAt(0) < 0x2e80 ? usual / 2 : usual, false);
      };
      return font;
    }
    const lengths = identity || !cmap?.lengths.length ? [2] : cmap.lengths;
    // Some writers (macOS printing a slide deck) leave the map empty. The font itself, when it is embedded,
    // still knows which character each glyph is.
    let glyphs;
    const fromFont = (cid) => {
      if (glyphs === undefined) {
        const descriptor = isDict(descendant) ? get(descendant.FontDescriptor) : null;
        const file = isDict(descriptor) && (descriptor.FontFile2 instanceof Ref ? data(descriptor.FontFile2) : get(get(descriptor.FontFile3)?.Subtype) === '/OpenType' ? data(descriptor.FontFile3) : null);
        const toGlyph = descendant?.CIDToGIDMap instanceof Ref ? data(descendant.CIDToGIDMap) : null;
        const chars = file && identity ? glyphChars(file) : new Map();
        glyphs = { chars, toGlyph };
      }
      const g = glyphs.toGlyph ? (cid * 2 + 1 < glyphs.toGlyph.length ? glyphs.toGlyph.readUInt16BE(cid * 2) : 0) : cid;
      return glyphs.chars.get(g);
    };
    font.each = (v, show) => {
      for (let i = 0; i < v.length; ) {
        let size = 0;
        let code = 0;
        let text;
        for (const n of lengths) {
          if (i + n > v.length) break;
          let c = 0;
          for (let k = 0; k < n; k++) c = c * 256 + v.charCodeAt(i + k);
          text = cmap?.map.get(key(n, c));
          [size, code] = [n, c]; // with no match, the longest code that fits is taken
          if (text !== undefined) break;
        }
        if (!size) break;
        if (text === undefined) text = fromFont(code);
        if (text === undefined) font.missing++;
        show(text ?? '', widths.get(code) ?? usual, false);
        i += size;
      }
    };
    return font;
  }

  // A simple font: one byte is one character.
  const base = get(isDict(encoding) ? encoding.BaseEncoding : encoding);
  const subtype = get(d.Subtype);
  const named = /Symbol|Dingbats|Wingdings|Webdings/i.test(String(get(d.BaseFont) || ''));
  const table = byteTable(base === '/MacRomanEncoding' ? MAC : WIN);
  if (base === '/StandardEncoding' || (!base && (subtype === '/Type1' || subtype === '/MMType1'))) {
    Object.entries(STANDARD).forEach(([c, t]) => (table[c] = t));
    if (!encoding) ['ff', 'fi', 'fl', 'ffi', 'ffl'].forEach((t, i) => (table[11 + i] = t)); // where TeX's own fonts keep them
  }
  if (!encoding && !cmap && named) table.fill(''); // ornaments and bullets drawn with letters: not text
  const differences = isDict(encoding) ? get(encoding.Differences) : null;
  if (Array.isArray(differences)) {
    let code = 0;
    for (const item of differences) {
      const x = get(item);
      if (typeof x === 'number') code = x;
      else if (typeof x === 'string') {
        const t = glyphText(x.slice(1));
        if (t !== undefined) table[code & 255] = t;
        else if (!cmap && x !== '/.notdef') table[code & 255] = null; // a glyph this reader has no name for
        code++;
      }
    }
  }
  // A font with a map and no encoding numbers its glyphs as it pleases: a code the map leaves out is not the letter at that place.
  if (cmap) for (let c = 0; c < 256; c++) table[c] = cmap.map.get(key(1, c)) ?? cmap.map.get(key(2, c)) ?? (!encoding && cmap.map.size ? null : table[c]);
  const first = num(get(d.FirstChar));
  const list = get(d.Widths);
  const scale = subtype === '/Type3' ? num(get(d.FontMatrix)?.[0], 0.001) * 1000 : 1;
  const usual = num(get(get(d.FontDescriptor)?.MissingWidth)) || 500;
  const face = String(get(d.BaseFont) || '');
  const standard = /Courier|Mono/i.test(face) ? null : /Times|Serif|Roman|Georgia|Song|Ming/i.test(face) ? SERIF : SANS;
  const width = Array.from({ length: 256 }, (_, c) => (Array.isArray(list) ? num(get(list[c - first])) * scale || usual : standard ? (standard[c - 32] ?? 556) : 600));
  font.each = (v, show) => {
    for (let i = 0; i < v.length; i++) {
      const c = v.charCodeAt(i) & 255;
      if (table[c] === null) font.missing++;
      show(table[c] ?? '', width[c], c === 32);
    }
  };
  return font;
}

// ---------- A page: the text it draws, and where ----------

// Matrices are [a b c d e f]; mul(m, n) applies m, then n.
const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
const IDENTITY = [1, 0, 0, 1, 0, 0];

/**
 * Run a content stream and collect what it writes: [{ text, a0, a1, line, h, dx, dy }], in drawing order.
 * `a0`..`a1` is where the run starts and ends along its own baseline, `line` where that baseline sits,
 * `h` the size of its letters, all in the units of the page.
 */
function draw(doc, content, resources, runs, ctm = IDENTITY, depth = 0) {
  const { get, data } = doc;
  const fonts = isDict(resources) ? get(resources.Font) : null;
  const xobjects = isDict(resources) ? get(resources.XObject) : null;
  let st = { ctm, font: null, size: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0 };
  const stack = [];
  let tm = IDENTITY;
  let tlm = IDENTITY;
  const lx = new Lexer(content, 0);

  const marks = []; // marked content that is open: for a span with /ActualText, { actual, from }
  const show = (str) => {
    if (!(str instanceof Str) || !st.font) return;
    let text = '';
    let advance = 0;
    const vertical = st.font.vertical;
    const spoken = marks.some(Boolean); // inside a span that says what it reads as
    const missing = st.font.missing;
    st.font.each(str.v, (t, w, space) => {
      text += t;
      advance += vertical ? st.size + st.tc : ((w / 1000) * st.size + st.tc + (space ? st.tw : 0)) * st.th;
    });
    if (spoken) st.font.missing = missing; // a glyph the font cannot name is no loss there
    const m = mul(tm, st.ctm);
    // The direction the text runs in, on the page: along the baseline, or down it for vertical writing.
    const [ux, uy] = vertical ? [-m[2], -m[3]] : [m[0], m[1]];
    const stretch = Math.hypot(ux, uy) || 1;
    const dx = ux / stretch;
    const dy = uy / stretch;
    const x = m[4] + st.rise * m[2];
    const y = m[5] + st.rise * m[3];
    const a0 = x * dx + y * dy;
    if (text || spoken) runs.push({ text, a0, a1: a0 + advance * stretch, line: y * dx - x * dy, h: Math.abs(st.size) * (Math.hypot(m[2], m[3]) || 1), dx, dy });
    tm = mul(vertical ? [1, 0, 0, 1, 0, -advance] : [1, 0, 0, 1, advance, 0], tm);
  };
  const move = (x, y) => {
    tlm = mul([1, 0, 0, 1, num(x), num(y)], tlm);
    tm = tlm;
  };

  let args = [];
  for (let tok = lx.next(); tok !== undefined; tok = lx.next()) {
    if (!(tok instanceof Op)) {
      if (args.length < 64) args.push(tok);
      continue;
    }
    const a = args;
    args = [];
    switch (tok.op) {
      case 'BT': tm = tlm = IDENTITY; break;
      case 'Tf': {
        const name = typeof a[0] === 'string' ? a[0].slice(1) : '';
        const ref = fonts?.[name];
        const id = ref instanceof Ref ? ref.num : (ref ?? name); // one font is read once, however many pages use it
        if (!doc.fonts.has(id)) doc.fonts.set(id, makeFont(doc, get(ref)));
        st.font = doc.fonts.get(id);
        st.size = num(a[1]);
        break;
      }
      case 'Td': move(a[0], a[1]); break;
      case 'TD': st.tl = -num(a[1]); move(a[0], a[1]); break;
      case 'Tm': if (a.length >= 6) tm = tlm = a.slice(0, 6).map((x) => num(x)); break;
      case 'T*': move(0, -st.tl); break;
      case 'Tj': show(a[0]); break;
      case "'": move(0, -st.tl); show(a[0]); break;
      case '"': st.tw = num(a[0]); st.tc = num(a[1]); move(0, -st.tl); show(a[2]); break;
      case 'TJ':
        for (const part of Array.isArray(a[0]) ? a[0] : []) {
          if (part instanceof Str) show(part);
          else if (typeof part === 'number') tm = mul(st.font?.vertical ? [1, 0, 0, 1, 0, (part / 1000) * st.size] : [1, 0, 0, 1, (-part / 1000) * st.size * st.th, 0], tm);
        }
        break;
      case 'Tc': st.tc = num(a[0]); break;
      case 'Tw': st.tw = num(a[0]); break;
      case 'Tz': st.th = num(a[0], 100) / 100; break;
      case 'TL': st.tl = num(a[0]); break;
      case 'Ts': st.rise = num(a[0]); break;
      case 'q': if (stack.length < 200) stack.push({ ...st }); break;
      case 'Q': if (stack.length) st = stack.pop(); break;
      case 'cm': if (a.length >= 6) st.ctm = mul(a.slice(0, 6).map((x) => num(x)), st.ctm); break;
      case 'Do': {
        // A form: a piece of page kept apart and drawn here (a letterhead, a whole slide).
        const ref = xobjects?.[typeof a[0] === 'string' ? a[0].slice(1) : ''];
        const form = get(ref);
        if (ref instanceof Ref && isDict(form) && get(form.Subtype) === '/Image') doc.shown?.push(ref); // a picture the page shows (pdfPictures)
        if (depth >= 6 || !(ref instanceof Ref) || !isDict(form) || get(form.Subtype) !== '/Form' || doc.drawing.has(ref.num)) break;
        const inner = data(ref);
        if (!inner) break;
        const matrix = get(form.Matrix);
        doc.drawing.add(ref.num);
        draw(doc, inner.toString('latin1'), get(form.Resources) ?? resources, runs, Array.isArray(matrix) && matrix.length >= 6 ? mul(matrix.slice(0, 6).map((x) => num(get(x))), st.ctm) : st.ctm, depth + 1);
        doc.drawing.delete(ref.num);
        break;
      }
      case 'BMC': marks.push(null); break;
      case 'BDC': {
        // A span may say what its glyphs read as (a ligature, a character the font has no code for).
        const props = isDict(a[1]) ? a[1] : typeof a[1] === 'string' && isDict(resources) ? get(get(resources.Properties)?.[a[1].slice(1)]) : null;
        const actual = isDict(props) ? get(props.ActualText) : null;
        marks.push(actual instanceof Str ? { actual: textString(actual.v), from: runs.length } : null);
        break;
      }
      case 'EMC': {
        const mark = marks.pop();
        if (!mark || runs.length <= mark.from) break;
        const [first, ...rest] = runs.splice(mark.from);
        if (mark.actual) runs.push({ ...first, text: mark.actual, a1: rest.at(-1)?.a1 ?? first.a1 });
        break;
      }
      case 'ID': {
        // A picture written into the page itself: step over its bytes.
        const end = /[\0\t\n\f\r ]EI(?=[\0\t\n\f\r ]|$)/g;
        end.lastIndex = lx.pos;
        lx.pos = end.exec(content) ? end.lastIndex : content.length;
        break;
      }
    }
    if (runs.length > 400_000) return;
  }
}

/** A text string of the file (not of a page): UTF-16 with a byte-order mark, or one byte per character. */
const textString = (v) => (v.startsWith('\u00fe\u00ff') ? new TextDecoder('utf-16be').decode(Buffer.from(v.slice(2), 'latin1')) : v.startsWith('\u00ef\u00bb\u00bf') ? Buffer.from(v.slice(3), 'latin1').toString('utf8') : v);

const hasSpace = (c) => c === ' ' || c === '\n' || c === '\t' || c === ' ' || c === '　';

/** The runs of one page as text: a gap along the line is a space, a step to another line a new line. */
function layout(runs) {
  let out = '';
  let prev = null;
  for (const r of runs) {
    if (prev) {
      const h = Math.max(r.h, prev.h) || 1;
      const sameWay = Math.abs(r.dx - prev.dx) + Math.abs(r.dy - prev.dy) < 0.2;
      const step = r.line - prev.line; // below zero: further down the page
      if (sameWay && Math.abs(step) < 0.45 * h) {
        // Drawn twice in the same place (how some writers fake bold): once is enough.
        if (r.text === prev.text && Math.abs(r.a0 - prev.a0) < Math.min(0.08 * h, 0.5 * Math.abs(r.a1 - r.a0))) continue;
        const gap = r.a0 - prev.a1;
        if (r.a0 < prev.a0 - 0.5 * h) out += '\n';
        else if (gap > 0.2 * h && !hasSpace(out.at(-1)) && !hasSpace(r.text[0])) out += gap > 2.5 * h ? '\t' : ' ';
      } else out += !sameWay || step < -1.9 * h || step > 0.9 * h ? '\n\n' : '\n';
    }
    out += r.text;
    prev = r;
  }
  return out;
}

// Characters some writers map text to that read the same but search and compare differently.
const LIGATURE = { ﬀ: 'ff', ﬁ: 'fi', ﬂ: 'fl', ﬃ: 'ffi', ﬄ: 'ffl', ﬅ: 'st', ﬆ: 'st' };
const clean = (text) =>
  text
    .replace(/[ﬀ-ﬆ]/g, (c) => LIGATURE[c])
    .replace(/[⺀-⿟豈-﫿]/g, (c) => c.normalize('NFKC')) // 一 written as the radical ⼀, and the like
    .replace(/ /g, ' ')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f�﻿-]/g, '');

const NO_TEXT = 'This PDF has no text to read: it is a scan or a set of pictures. Paste its text instead, or add its pages as pictures.';

// ---------- The pictures of a scan ----------

const CRC = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
/** One chunk of a PNG file: its length, its name, its bytes and their checksum. */
function pngChunk(name, body) {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(name, 4, 'latin1');
  body.copy(out, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < body.length + 8; i++) crc = CRC[(crc ^ out[i]) & 255] ^ (crc >>> 8);
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, body.length + 8);
  return out;
}

/** How a picture's samples are to be read: { n: values per pixel, palette: Buffer of RGB triples | null }, or null for a kind this reader leaves. */
function colours(doc, space) {
  const { get, data } = doc;
  const cs = get(space);
  const name = Array.isArray(cs) ? get(cs[0]) : cs;
  if (name === '/DeviceGray' || name === '/CalGray' || name === '/G') return { n: 1 };
  if (name === '/DeviceRGB' || name === '/CalRGB' || name === '/RGB') return { n: 3 };
  if (name === '/DeviceCMYK' || name === '/CMYK') return { n: 4 };
  if (name === '/ICCBased' && Array.isArray(cs)) {
    const n = num(get(doc.entry(cs[1])?.value?.N));
    return n === 1 || n === 3 || n === 4 ? { n } : null;
  }
  if ((name === '/Indexed' || name === '/I') && Array.isArray(cs)) {
    const base = colours(doc, cs[1]);
    const table = cs[3] instanceof Ref ? data(cs[3]) : get(cs[3]) instanceof Str ? Buffer.from(get(cs[3]).v, 'latin1') : null;
    if (!base || base.palette || !table) return null;
    const entries = Math.min(256, num(get(cs[2])) + 1, Math.floor(table.length / base.n));
    const palette = Buffer.alloc(entries * 3);
    for (let i = 0; i < entries; i++) toRgb(table, i * base.n, base.n, palette, i * 3);
    return { n: 1, palette };
  }
  return null;
}

/** One pixel, grey, RGB or CMYK, written as RGB. */
function toRgb(from, at, n, to, out) {
  if (n === 1) to[out] = to[out + 1] = to[out + 2] = from[at];
  else if (n === 3) from.copy(to, out, at, at + 3);
  else for (let k = 0; k < 3; k++) to[out + k] = 255 - Math.min(255, from[at + k] + from[at + 3]);
}

/**
 * A picture of the file as a picture a model can be shown: { type, bytes, width, height }, or null.
 * A JPEG is handed over as it is. Plain samples (what a scanner writes for a page in black and white or
 * in grey, and what a screenshot is kept as) are wrapped as a PNG. Fax and JBIG2 pages and JPEG 2000 are
 * left: undoing them takes a decoder this reader does not have.
 */
function pictureOf(doc, ref) {
  const { get } = doc;
  const d = doc.entry(ref)?.value;
  if (!isDict(d)) return null;
  const width = num(get(d.Width));
  const height = num(get(d.Height));
  if (width < 1 || height < 1 || width * height > 60_000_000) return null;
  const got = doc.unpack(ref);
  if (!got) return null;
  if (got.packed.length) return got.packed.length === 1 && (got.packed[0] === '/DCTDecode' || got.packed[0] === '/DCT') ? { type: 'image/jpeg', bytes: got.bytes, width, height } : null;

  const mask = get(d.ImageMask) === true;
  const bits = mask ? 1 : num(get(d.BitsPerComponent), 8);
  const space = mask ? { n: 1 } : colours(doc, d.ColorSpace);
  if (!space || ![1, 2, 4, 8].includes(bits) || (space.n > 1 && bits !== 8)) return null;
  const row = Math.ceil((width * space.n * bits) / 8);
  if (got.bytes.length < row * height) return null;
  const decode = get(d.Decode);
  const inverted = !space.palette && space.n === 1 && Array.isArray(decode) && num(get(decode[0])) > num(get(decode[1]));
  const outRow = space.n === 4 ? width * 3 : row;
  const lines = Buffer.alloc((outRow + 1) * height); // each line of a PNG opens with a byte that says how it is packed: 0, as it is
  for (let y = 0; y < height; y++) {
    const from = y * row;
    const to = y * (outRow + 1) + 1;
    if (space.n === 4) for (let x = 0; x < width; x++) toRgb(got.bytes, from + x * 4, 4, lines, to + x * 3);
    else if (inverted) for (let i = 0; i < row; i++) lines[to + i] = 255 - got.bytes[from + i];
    else got.bytes.copy(lines, to, from, from + row);
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = bits;
  head[9] = space.palette ? 3 : space.n === 1 ? 0 : 2; // palette, grey, or RGB
  const bytes = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', head), ...(space.palette ? [pngChunk('PLTE', space.palette)] : []), pngChunk('IDAT', deflateSync(lines)), pngChunk('IEND', Buffer.alloc(0))]);
  return { type: 'image/png', bytes, width, height };
}

/**
 * The pictures a PDF's pages are made of, for a file that is a scan: { pages, pictures, more, unread }.
 * `pictures` has one list per page, in the order the page shows them ([{ type, bytes, width, height }]); a page
 * whose picture cannot be handed over has an empty list. Small pictures (a logo, a stamp) and one that sits on
 * many pages (a letterhead) are not the page. `maxPages` pages with pictures are taken; `more` says there were others.
 * `maxBytes` is the largest picture worth handing over. `unread` counts the page pictures that could not be handed
 * over (too large, or packed in a way this reader cannot undo).
 */
export function pdfPictures(bytes, { maxPages = 40, maxBytes = 12 * 1024 * 1024 } = {}) {
  if (!isPdf(bytes)) throw fail('This file is not a real .pdf document', 415);
  let doc;
  try {
    doc = open(bytes);
  } catch (err) {
    if (err.status) throw err;
    return { pages: 0, pictures: [], more: false, unread: 0 };
  }
  doc.fonts = new Map();
  doc.drawing = new Set();
  const shown = doc.pages.map((page) => {
    doc.shown = [];
    const contents = doc.get(page.dict.Contents);
    const streams = (Array.isArray(contents) ? contents : [page.dict.Contents]).map((c) => doc.data(c)?.toString('latin1')).filter(Boolean);
    try {
      draw(doc, streams.join('\n'), page.resources, []);
    } catch {}
    return [...new Map(doc.shown.map((ref) => [ref.num, ref])).values()];
  });
  const uses = new Map();
  for (const refs of shown) for (const ref of refs) uses.set(ref.num, (uses.get(ref.num) || 0) + 1);
  const size = (ref) => num(doc.get(doc.entry(ref)?.value?.Width)) * num(doc.get(doc.entry(ref)?.value?.Height));
  const pictures = [];
  let taken = 0;
  let more = false;
  let unread = 0;
  for (const refs of shown) {
    const own = refs.filter((ref) => uses.get(ref.num) <= 2 && size(ref) >= 90_000);
    const largest = Math.max(0, ...own.map(size));
    const page = [];
    if (taken >= maxPages) more ||= own.length > 0;
    else for (const ref of own.filter((r) => size(r) >= 0.2 * largest).slice(0, 4)) {
      const picture = pictureOf(doc, ref);
      if (picture && picture.bytes.length <= maxBytes) page.push(picture);
      else unread++;
    }
    if (page.length) taken++;
    pictures.push(page);
  }
  return { pages: doc.pages.length, pictures, more, unread };
}

/** True when the bytes are a PDF. Some writers put a few bytes before the header. */
export const isPdf = (bytes) => bytes.subarray(0, 1024).includes('%PDF-');

/**
 * The text of a PDF: { text, pages, cut, partial }. Pages are separated by a blank line; `cut` says reading
 * stopped at `maxChars`, `partial` that some of the text could not be read. Throws (status 400) when it is not a PDF, needs a password, or holds no text that can be read.
 */
export function pdfText(bytes, { maxChars = 400_000 } = {}) {
  if (!isPdf(bytes)) throw fail('This file is not a real .pdf document', 415);
  const started = Date.now();
  let doc;
  try {
    doc = open(bytes);
  } catch (err) {
    if (err.status) throw err;
    throw fail('This PDF could not be read. Paste its text instead.'); // broken beyond following, or built to be
  }
  doc.fonts = new Map();
  doc.drawing = new Set();
  // What every page writes, then what is not part of the text: a mark laid across the pages (a slanted
  // "confidential", a tracking code tiled over a résumé) is drawn many times and says nothing.
  const drawn = [];
  let size = 0;
  let cut = false;
  for (const page of doc.pages) {
    const contents = doc.get(page.dict.Contents);
    const streams = (Array.isArray(contents) ? contents : [page.dict.Contents]).map((c) => doc.data(c)?.toString('latin1')).filter(Boolean);
    const runs = [];
    try {
      draw(doc, streams.join('\n'), page.resources, runs);
    } catch {} // one page that cannot be followed does not lose the rest
    drawn.push(runs.filter((r) => r.text));
    size += runs.reduce((n, r) => n + r.text.length, 0);
    if (size > maxChars * 2 || Date.now() - started > MAX_MS) {
      cut = true;
      break;
    }
  }
  const slanted = (r) => Math.min(Math.abs(r.dx), Math.abs(r.dy)) > 0.17;
  const times = new Map();
  for (const runs of drawn) for (const r of runs) if (slanted(r)) times.set(r.text.trim(), (times.get(r.text.trim()) || 0) + 1);
  const mark = (r) => times.get(r.text.trim()) >= 2 && (slanted(r) || r.text.trim().length >= 8);
  const parts = [];
  size = 0;
  for (const runs of drawn) {
    const text = clean(layout(runs.filter((r) => !mark(r)))).replace(/[ \t]+\n/g, '\n').trim();
    if (!text) continue;
    parts.push(text);
    size += text.length;
    if (size > maxChars) {
      cut = true;
      break;
    }
  }
  const text = parts.join('\n\n');
  const missing = [...doc.fonts.values()].reduce((n, f) => n + f.missing, 0);
  const letters = text.replace(/\s/g, '').length;
  if (missing > letters) throw fail('The text of this PDF cannot be read: its fonts do not say which characters they draw. Paste its text instead.');
  if (letters < 2) throw doc.pages.length ? Object.assign(fail(NO_TEXT), { scan: true }) : fail('This PDF could not be read. Paste its text instead.');
  // `partial`: a real share of the letters were drawn in a font this reader cannot name the characters of.
  return { text, pages: doc.pages.length, cut, partial: missing > 0.05 * (missing + letters) };
}
