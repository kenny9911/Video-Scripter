// Saved work: every finished script goes into data/history.json, and every generated
// image or video is written to data/media/ and linked from its history entry.
// Nothing here is ever pruned automatically.

import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const HISTORY = path.join(DATA, 'history.json');
export const MEDIA_DIR = path.join(DATA, 'media');

// Extension -> content type for everything we are willing to store and serve back.
const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };

async function readHistory() {
  try {
    const list = JSON.parse(await readFile(HISTORY, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[history] could not read ${HISTORY}: ${err.message}`);
    return [];
  }
}

// Writes are serialised and atomic so two scripts finishing together cannot lose one.
let queue = Promise.resolve();
function update(fn) {
  const next = queue.then(async () => {
    const list = await readHistory();
    const result = await fn(list);
    await mkdir(DATA, { recursive: true });
    await writeFile(`${HISTORY}.tmp`, JSON.stringify(list, null, 1));
    await rename(`${HISTORY}.tmp`, HISTORY);
    return result;
  });
  queue = next.catch(() => {});
  return next;
}

/** Newest first. */
export const listHistory = () => queue.then(readHistory);

export function addHistory({ platformId, brief, plan, script, ts }) {
  if (!script || !Array.isArray(script.scenes)) throw new Error('A history entry needs a script');
  const entry = { id: randomUUID().slice(0, 12), ts: Number(ts) || Date.now(), platformId: String(platformId || ''), brief: brief || null, plan: plan || null, script, media: {} };
  return update((list) => {
    list.unshift(entry);
    list.sort((a, b) => b.ts - a.ts);
    return entry;
  });
}

/**
 * Store generated media on disk and link it from its history entry (when there is one).
 * `source` is a data: URI, or a fetch Response for a file the provider hosts.
 * Returns { url } pointing at this server, or null when the content is not a type we keep.
 */
export async function saveMedia({ historyId, sceneId, kind, source, demo = false, link = true }) {
  let type;
  let bytes;
  if (typeof source === 'string') {
    const m = /^data:([\w/+.-]+)(;base64)?,(.*)$/s.exec(source);
    if (!m) return null;
    type = m[1];
    bytes = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
  } else {
    type = (source.headers.get('content-type') || '').split(';')[0].trim();
    bytes = Buffer.from(await source.arrayBuffer());
  }
  // Providers do not always label files; fall back on what was asked for. SVG is only kept for our own placeholder.
  const ext = EXT[type] || (demo && type === 'image/svg+xml' ? 'svg' : kind === 'video' ? 'mp4' : type.startsWith('image/') || !type ? 'png' : null);
  if (!ext || !bytes.length) return null;

  const safe = (v) => String(v ?? '').replace(/[^\w-]/g, '').slice(0, 24) || 'x';
  const file = `${safe(historyId || 'unsaved')}-s${safe(sceneId)}-${kind}-${Date.now().toString(36)}${randomBytes(2).toString('hex')}.${ext}`;
  await mkdir(MEDIA_DIR, { recursive: true });
  await writeFile(path.join(MEDIA_DIR, file), bytes);
  const url = `/media/${file}`;
  if (link) await linkMedia({ historyId, sceneId, kind, urls: [url] });
  return { url };
}

/** Point a scene of a history entry at its current media: `url` is the first file, `urls` all of them (up to 3 images). */
export async function linkMedia({ historyId, sceneId, kind, urls }) {
  if (!historyId || !urls.length) return;
  await update((list) => {
    const entry = list.find((e) => e.id === historyId);
    if (entry) ((entry.media ??= {})[sceneId] ??= {})[kind] = { url: urls[0], urls, ts: Date.now() };
  });
}

/** Serve a stored file, with Range support so videos can be scrubbed. */
export async function serveMedia(req, res, name) {
  const type = TYPES[path.extname(name).slice(1)];
  if (!/^[\w-]+\.\w+$/.test(name) || !type) return false;
  const file = path.join(MEDIA_DIR, name);
  let size;
  try {
    size = (await stat(file)).size;
  } catch {
    return false;
  }
  const headers = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", // stored files never run script
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
      return true;
    }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    createReadStream(file, { start, end }).pipe(res);
    return true;
  }
  res.writeHead(200, { ...headers, 'content-length': size });
  createReadStream(file).pipe(res);
  return true;
}
