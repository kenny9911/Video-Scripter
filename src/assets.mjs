// The asset library (素材库): files a creator uploads once and uses in any script.
//
//   document   .txt .md .csv .tsv .json .srt .vtt .docx .pdf   read when it is uploaded: its text is kept, the file is not.
//                                                              (A scanned PDF has no text: a model reads its pages, src/vision.mjs.)
//                                                              A brief that uses it gives that text to the model as source material.
//   image      .png .jpg .webp .gif                            kept as a file. A scene can show it as it is, or have its image drawn from it.
//                                                              (The page turns other pictures, .heic .avif .bmp .tiff .svg, into one of these first.)
//   video      .mp4 .mov .webm                                 kept as a file. A scene can use it as its clip.
//
// Each user has a library of their own. Every asset is a document in the `assets` collection carrying the id
// of the user who added it, and nothing here reads, changes or counts an asset without that id: a list is
// the user's own, an id that belongs to someone else is "not in your library" (ownedAsset), and a picture or
// a clip, kept as the blob `lib-<id>.<ext>`, is served from /media/ to its owner alone (server.mjs), not even
// to an administrator. What a brief does with the assets it names is in src/materials.mjs.

import { randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { db } from './db.mjs';
import { MAX_MATERIALS } from './materials.mjs';
import { pdfText, pdfPictures, isPdf } from './pdf.mjs';

const MB = 1024 * 1024;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

const setMax = (env) => (Number(env.ASSET_MAX_MB) > 0 ? Number(env.ASSET_MAX_MB) : 0);
/**
 * A picture or a clip may be this large. A serverless host caps what one request can carry, in or out, at
 * about 4.5 MB, and a file that is kept has to be served back whole, so the limit is lower there.
 */
export const maxAssetBytes = (env = process.env) => Math.round((setMax(env) || (env.VERCEL ? 4 : 25)) * MB);
/** A document may be this large wherever the app runs: only its text is kept, and a large one is sent in parts. */
export const maxDocumentBytes = (env = process.env) => Math.round((setMax(env) || 25) * MB);
/** What one request may carry (`ASSET_BODY_MB`, for a host or a proxy with a cap of its own). A file larger than this comes in parts (addPart, takeParts). */
export const maxBodyBytes = (env = process.env) => (Number(env.ASSET_BODY_MB) > 0 ? Math.round(Number(env.ASSET_BODY_MB) * MB) : env.VERCEL ? 4 * MB : Math.max(maxAssetBytes(env), maxDocumentBytes(env)));
/** How large the parts of a file sent in parts are. */
export const partBytes = (env = process.env) => Math.min(maxBodyBytes(env), 3.5 * MB);
/** How many assets one library holds. */
export const MAX_ASSETS = 300;
/** How much of a document's text is kept, in characters. */
export const MAX_ASSET_TEXT = 200_000;

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// Extension -> [kind, content type, the extension the file is stored under].
const FORMATS = {
  txt: ['document', 'text/plain'],
  md: ['document', 'text/markdown'],
  markdown: ['document', 'text/markdown'],
  csv: ['document', 'text/csv'],
  tsv: ['document', 'text/tab-separated-values'],
  json: ['document', 'application/json'],
  srt: ['document', 'application/x-subrip'],
  vtt: ['document', 'text/vtt'],
  docx: ['document', DOCX],
  pdf: ['document', 'application/pdf'],
  png: ['image', 'image/png', 'png'],
  jpg: ['image', 'image/jpeg', 'jpg'],
  jpeg: ['image', 'image/jpeg', 'jpg'],
  jfif: ['image', 'image/jpeg', 'jpg'],
  webp: ['image', 'image/webp', 'webp'],
  gif: ['image', 'image/gif', 'gif'],
  mp4: ['video', 'video/mp4', 'mp4'],
  mov: ['video', 'video/quicktime', 'mov'],
  webm: ['video', 'video/webm', 'webm'],
};
/** The extensions the library takes, for the file picker and the error that names them. */
export const ASSET_EXTENSIONS = Object.keys(FORMATS);
/** The same, by what the file is: { document: [...], image: [...], video: [...] }. */
export const ASSET_KINDS = Object.entries(FORMATS).reduce((by, [ext, [kind]]) => ((by[kind] ||= []).push(ext), by), {});

const extOf = (name) => /\.([a-z0-9]+)$/i.exec(String(name || ''))?.[1].toLowerCase() || '';
const cleanName = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
const cleanNote = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);

// What a file of each stored type starts with: an upload is what its bytes say it is, not what its name says.
const SIGNED = {
  png: (b) => b.readUInt32BE(0) === 0x89504e47,
  jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  gif: (b) => b.toString('latin1', 0, 4) === 'GIF8',
  webp: (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP',
  mp4: (b) => b.toString('latin1', 4, 8) === 'ftyp',
  mov: (b) => ['ftyp', 'moov', 'mdat', 'free', 'wide'].includes(b.toString('latin1', 4, 8)),
  webm: (b) => b.readUInt32BE(0) === 0x1a45dfa3,
};

// ---------- Reading the text of a document ----------

/** Text from bytes: UTF-8, UTF-16 with a byte-order mark, or GB18030 (how Chinese Windows saves a .txt). */
export function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    try {
      return new TextDecoder('gb18030', { fatal: true }).decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}

/** One file out of a zip archive, or null. Enough of the format for the XML inside a .docx. */
export function unzipEntry(buf, wanted) {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  let p = buf.readUInt32LE(end + 16);
  for (let n = buf.readUInt16LE(end + 10); n > 0 && p + 46 <= buf.length; n--) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const nameLength = buf.readUInt16LE(p + 28);
    if (buf.toString('utf8', p + 46, p + 46 + nameLength) === wanted) {
      const local = buf.readUInt32LE(p + 42);
      if (local + 30 > buf.length) return null;
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + buf.readUInt32LE(p + 20));
      const method = buf.readUInt16LE(p + 10);
      return method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: 64 * MB }) : null;
    }
    p += 46 + nameLength + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return null;
}

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITY[e] ?? m)));

/** The text of a Word document, one line per paragraph. */
export function docxText(bytes) {
  let xml;
  try {
    xml = unzipEntry(bytes, 'word/document.xml')?.toString('utf8');
  } catch {}
  if (!xml) throw fail('This .docx could not be read. Save it as .txt, or paste its text instead.');
  const paragraphs = xml.split('</w:p>').map((p) => {
    let out = '';
    for (const m of p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/>/g)) out += m[1] != null ? m[1] : m[2] === 'tab' ? '\t' : '\n';
    return out.trim();
  });
  return unescapeXml(paragraphs.join('\n')).trim();
}

const tidy = (text) => text.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// ---------- The library ----------

/** An asset as the page gets it: never the whole text of a document, only how long it is and how it starts. */
export function publicAsset(a) {
  return {
    id: a.id,
    ts: a.ts,
    name: a.name,
    kind: a.kind,
    type: a.type,
    size: a.size,
    note: a.note || '',
    ...(a.file && { url: `/media/${a.file}` }),
    ...(a.kind === 'document' && { chars: a.chars || 0, excerpt: String(a.text || '').slice(0, 200), ...(a.pages && { pages: a.pages }), ...(a.cut && { cut: true }), ...(a.partial && { partial: true }), ...(a.scanned && { scanned: true }) }),
  };
}

export const listAssets = async (userId) => (await db.list('assets', { userId })).map(publicAsset);

/** One asset of this user's, as stored. Throws 404 when there is none. */
export async function ownedAsset(userId, id) {
  const asset = id ? await db.get('assets', String(id)) : null;
  if (!asset || asset.userId !== userId) throw fail('That file is no longer in your library', 404);
  return asset;
}

async function room(userId) {
  if ((await db.list('assets', { userId })).length >= MAX_ASSETS) throw fail(`Your library is full (${MAX_ASSETS} files). Delete some to add more.`);
}

function textAsset({ userId, name, type, size, text, note, pages, cut, partial, scanned }) {
  const whole = tidy(String(text || '').replace(/\u0000/g, ''));
  if (!whole) throw fail('No text could be read from this file');
  return {
    id: randomUUID().slice(0, 12),
    userId,
    ts: Date.now(),
    name,
    kind: 'document',
    type,
    size,
    note: cleanNote(note),
    text: whole.slice(0, MAX_ASSET_TEXT),
    chars: Math.min(whole.length, MAX_ASSET_TEXT),
    ...(pages && { pages }),
    ...((cut || whole.length > MAX_ASSET_TEXT) && { cut: true }),
    ...(partial && { partial: true }), // some of a PDF's text was in fonts that could not be read, or a page of a scan was not read
    ...(scanned && { scanned: true }), // its text was read off pictures of the pages by a model: likely right, not certain
  };
}

/**
 * The text of a PDF: its own when it has any, and for a scan what `readScan` reads off the pictures of its pages.
 * `readScan({ pictures, name })` looks at them with a model and returns { text, cut, partial } (src/vision.mjs);
 * without it a scan is refused, as a PDF that cannot be read at all always is. `lookBytes` is the largest picture
 * that model takes.
 */
async function readPdf(bytes, { name, readScan, lookBytes }) {
  let read = null;
  let refused = null;
  try {
    read = pdfText(bytes, { maxChars: MAX_ASSET_TEXT });
  } catch (err) {
    if (!err.scan || !readScan) throw err;
    refused = err;
  }
  // A scan often carries a line of text all the same (the scanning app's name at the foot of every page).
  const thin = read && read.text.replace(/\s/g, '').length < 40 * read.pages;
  if (!readScan || (read && !thin)) return read;
  const { pages, pictures, more, unread } = pdfPictures(bytes, { maxBytes: lookBytes });
  if (pictures.filter((p) => p.length).length < pages / 2) {
    if (read) return read;
    throw unread ? fail('This PDF is a scan whose pages are stored in a way that cannot be read here. Paste its text instead, or add its pages as pictures.') : refused;
  }
  try {
    const seen = await readScan({ pictures, name });
    if (seen.text.replace(/\s/g, '').length < 2) throw fail('No text was found on the pages of this scan.');
    return { text: seen.text, pages, cut: seen.cut || more, partial: seen.partial, scanned: true };
  } catch (err) {
    if (read) return read; // the little text it has is still its text
    if (!/^No text was found/.test(err.message)) err.message = `This PDF is a scan, and the model could not read its pages. ${err.message}`;
    throw err;
  }
}

/**
 * Add an uploaded file. `bytes` is the file as it was sent; its name says what it is, and its content has to agree.
 * `readScan` reads a scanned PDF with a model (see readPdf); the caller passes it when there is a model to read with.
 */
export async function addAsset({ userId, name, bytes, note, readScan, lookBytes }) {
  const clean = cleanName(name);
  const format = FORMATS[extOf(clean)];
  if (!clean || !format) throw fail(`This kind of file cannot be added. The library takes ${ASSET_EXTENSIONS.filter((e) => !['markdown', 'jpeg', 'jfif'].includes(e)).map((e) => `.${e}`).join(' ')}.`, 415);
  if (!bytes?.length) throw fail('The file is empty');
  const [kind, type, ext] = format;
  const max = kind === 'document' ? maxDocumentBytes() : maxAssetBytes();
  if (bytes.length > max) throw fail(`The file is larger than ${Math.round(max / MB)} MB`, 413);
  await room(userId);

  if (type === 'application/pdf') {
    if (!isPdf(bytes)) throw fail('This file is not a real .pdf document', 415);
    const read = await readPdf(bytes, { name: clean, readScan, lookBytes });
    return publicAsset(await db.put('assets', textAsset({ userId, name: clean, type, size: bytes.length, note, ...read })));
  }
  if (kind === 'document') {
    if (type !== DOCX && bytes.subarray(0, 4096).includes(0) && bytes[0] !== 0xff && bytes[0] !== 0xfe) throw fail('This file is not text');
    return publicAsset(await db.put('assets', textAsset({ userId, name: clean, type, size: bytes.length, text: type === DOCX ? docxText(bytes) : decodeText(bytes), note })));
  }
  if (bytes.length < 12 || !SIGNED[ext](bytes)) throw fail(`This file is not a real .${ext} ${kind}`, 415);
  const id = randomUUID().slice(0, 12);
  const file = `lib-${id}.${ext}`;
  await db.putBlob(file, { userId, type, bytes });
  return publicAsset(await db.put('assets', { id, userId, ts: Date.now(), name: clean, kind, type, size: bytes.length, note: cleanNote(note), file }));
}

// ---------- A file sent in parts ----------
//
// A host that caps a request at a few megabytes still has to take a 20 MB PDF: the page cuts it up, each
// part is kept as a blob of the user's (`up-<user>-<upload>-<n>`, a name /media/ never serves), and the last
// request puts them together and adds the file as usual. Starting a file clears whatever an earlier one left.

const partName = (userId, upload, n) => `up-${userId}-${upload}-${n}`;
const cleanUpload = (id) => (/^[\w-]{8,64}$/.test(String(id || '')) ? String(id) : '');
const maxParts = () => Math.ceil(Math.max(maxAssetBytes(), maxDocumentBytes()) / partBytes()) + 1; // so what waits to be put together stays small

/** Keep part `n` of the file being uploaded as `upload`. */
export async function addPart({ userId, upload, n, bytes }) {
  const id = cleanUpload(upload);
  const at = Number(n);
  if (!id || !Number.isInteger(at) || at < 0 || at >= maxParts()) throw fail('This upload cannot be followed. Try again.');
  if (!bytes?.length) throw fail('The file is empty');
  if (bytes.length > partBytes()) throw fail(`The file is larger than ${Math.round(partBytes() / MB)} MB`, 413);
  if (at === 0) await db.delBlobs(`up-${userId}-`);
  await db.putBlob(partName(userId, id, at), { userId, type: 'application/octet-stream', bytes });
}

/** The file that was sent as `count` parts, whole. The parts are gone afterwards. */
export async function takeParts({ userId, upload, count }) {
  const id = cleanUpload(upload);
  const n = Number(count);
  if (!id || !Number.isInteger(n) || n < 1 || n > maxParts()) throw fail('This upload cannot be followed. Try again.');
  try {
    const parts = [];
    for (let i = 0; i < n; i++) {
      const blob = await db.getBlob(partName(userId, id, i));
      if (!blob) throw fail('The upload was interrupted. Try again.');
      parts.push(await blob.bytes());
    }
    return Buffer.concat(parts);
  } finally {
    await db.delBlobs(`up-${userId}-${id}-`);
  }
}

/** Add text that was pasted or written, not uploaded: a note, an article, the narration of a script. */
export async function addTextAsset({ userId, name, text, note }) {
  await room(userId);
  const title = cleanName(name) || cleanName(String(text || '').trim().split('\n')[0]).slice(0, 40) || 'Note';
  return publicAsset(await db.put('assets', textAsset({ userId, name: title, type: 'text/plain', size: Buffer.byteLength(String(text || '')), text, note })));
}

/** Rename an asset or change its note: the note is what the scriptwriter is told about a picture it cannot see. */
export async function updateAsset(userId, id, { name, note }) {
  await ownedAsset(userId, id);
  const next = await db.update('assets', String(id), (a) => {
    if (name !== undefined && cleanName(name)) a.name = cleanName(name);
    if (note !== undefined) a.note = cleanNote(note);
  });
  return publicAsset(next);
}

export async function deleteAsset(userId, id) {
  const asset = await ownedAsset(userId, id);
  if (asset.file) await db.delBlobs(`lib-${asset.id}.`);
  await db.del('assets', asset.id);
}

/** Remove a user's whole library. Returns how many files went. */
export async function deleteUserAssets(userId) {
  const all = await db.list('assets', { userId });
  for (const a of all) {
    if (a.file) await db.delBlobs(`lib-${a.id}.`);
    await db.del('assets', a.id);
  }
  await db.delBlobs(`up-${userId}-`); // and an upload that never finished
  return all.length;
}

/** The assets a brief names, in the order it names them, as src/materials.mjs reads them. Ids that are not this user's are left out. */
export async function materialsFor(userId, ids) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(String))].slice(0, MAX_MATERIALS);
  if (!wanted.length) return [];
  const mine = new Map((await db.list('assets', { userId })).map((a) => [a.id, a]));
  return wanted.map((id) => mine.get(id)).filter(Boolean).map(({ id, kind, name, note, text }) => ({ id, kind, name, note, text }));
}

/** The id of the user a stored library file belongs to; '' when the name is not a library file or it is gone. */
export async function assetFileOwner(name) {
  const id = /^lib-([\w-]+)\.\w+$/.exec(String(name || ''))?.[1];
  return (id && (await db.get('assets', id))?.userId) || '';
}
export const isAssetFile = (name) => String(name || '').startsWith('lib-');

/** The bytes of a picture or a clip in the library: { bytes, type }. Throws when the file is gone. */
export async function assetBytes(asset) {
  const blob = asset.file ? await db.getBlob(asset.file) : null;
  if (!blob) throw fail('That file is no longer in your library', 404);
  return { bytes: await blob.bytes(), type: asset.type };
}

/** Copy a generated image or clip (a stored media file, by name) into the library, so it can be used in other scripts. */
export async function keepInLibrary({ userId, file, bytes, name, note }) {
  const format = FORMATS[extOf(file)];
  if (!format || format[0] === 'document') throw fail('Only a picture or a clip can be saved to the library');
  return addAsset({ userId, name: `${cleanName(name).replace(/\.[a-z0-9]+$/i, '') || 'Generated'}.${format[2]}`, bytes, note });
}
