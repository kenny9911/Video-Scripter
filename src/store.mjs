// Saved work: every finished script is a document in the `history` collection, owned by the user who
// made it, and every generated image or video is a blob linked from its script. Nothing is pruned.

import { randomUUID, randomBytes } from 'node:crypto';
import path from 'node:path';
import { db } from './db.mjs';

// Extension -> content type for everything we are willing to store and serve back.
const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };

/** A user's scripts, newest first. */
export const listHistory = (userId) => db.list('history', { userId });
export const getHistory = (id) => db.get('history', String(id || ''));
export const newHistoryId = () => randomUUID().slice(0, 12);

export async function addHistory({ id, userId, platformId, brief, plan, script, ts }) {
  if (!script || !Array.isArray(script.scenes)) throw new Error('A history entry needs a script');
  const entry = { id: id || newHistoryId(), ts: Number(ts) || Date.now(), userId: userId || '', platformId: String(platformId || ''), brief: brief || null, plan: plan || null, script, media: {} };
  return db.put('history', entry);
}

/**
 * A generated file as it can be stored: { ext, type, bytes }, or null when it is not a type we keep.
 * `source` is a data: URI, or a fetch Response for a file the provider hosts.
 */
export async function mediaFile(source, { kind, demo = false } = {}) {
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
  return { ext, type: TYPES[ext], bytes };
}

/**
 * Store generated media and link it from its history entry (when there is one).
 * `source` is a data: URI, or a fetch Response for a file the provider hosts.
 * Returns { url } pointing at this server, or null when the content is not a type we keep.
 */
export async function saveMedia({ historyId, sceneId, kind, source, demo = false, link = true, userId }) {
  const file = await mediaFile(source, { kind, demo });
  if (!file) return null;
  const { ext, bytes } = file;

  const safe = (v) => String(v ?? '').replace(/[^\w-]/g, '').slice(0, 24) || 'x';
  const name = `${safe(historyId || 'unsaved')}-s${safe(sceneId)}-${kind}-${Date.now().toString(36)}${randomBytes(2).toString('hex')}.${ext}`;
  await db.putBlob(name, { userId, type: TYPES[ext], bytes });
  const url = `/media/${name}`;
  if (link) await linkMedia({ historyId, sceneId, kind, urls: [url] });
  return { url };
}

/** Point a scene of a history entry at its current media: `url` is the first file, `urls` all of them (up to 3 images). */
export async function linkMedia({ historyId, sceneId, kind, urls, shots }) {
  if (!historyId || !urls.length) return;
  await db.update('history', historyId, (entry) => {
    ((entry.media ??= {})[sceneId] ??= {})[kind] = { url: urls[0], urls, ...(shots?.some(Boolean) && { shots }), ts: Date.now() };
  });
}

/** Remove a script and every file generated for it, including earlier versions of redone media. */
export async function deleteHistory(id) {
  await db.delBlobs(`${id}-s`);
  await db.del('history', id);
}

/** Remove all of a user's scripts and media. Returns how many scripts went. */
export async function deleteUserHistory(userId) {
  const entries = await db.list('history', { userId });
  for (const e of entries) await deleteHistory(e.id);
  return entries.length;
}

/** Hand all of one user's scripts (and so their media) to another user. Returns how many moved. */
export async function transferHistory(fromUserId, toUserId) {
  const entries = await db.list('history', { userId: fromUserId });
  for (const e of entries) await db.update('history', e.id, (x) => Object.assign(x, { userId: toUserId }));
  return entries.length;
}

const validName = (name) => /^[\w-]+\.\w+$/.test(name) && TYPES[path.extname(name).slice(1)];

/** The id of the script a stored file belongs to ('' for files made outside a saved script). */
export const mediaOwner = (name) => /^(.+)-s[\w]+-(?:image|video)-/.exec(name)?.[1].replace(/^unsaved$/, '') || '';

/** The bytes of a stored file, or null. */
export async function readMedia(name) {
  if (!validName(name)) return null;
  const blob = await db.getBlob(name);
  return blob ? blob.bytes() : null;
}

/** Serve a stored file, with Range support so videos can be scrubbed. */
export async function serveMedia(req, res, name) {
  const type = validName(name);
  if (!type) return false;
  const blob = await db.getBlob(name);
  if (!blob) return false;
  const { size } = blob;
  const headers = {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=31536000, immutable',
    vary: 'cookie', // a file is its owner's: the browser's own copy must not be handed to whoever signs in next on the same computer
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", // stored files never run script
  };
  const send = (status, extra, start, end) => {
    res.writeHead(status, { ...headers, ...extra, 'content-length': end - start + 1 });
    const body = blob.read(start, end);
    if (Buffer.isBuffer(body)) res.end(body);
    else body.pipe(res);
    return true;
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
      return true;
    }
    return send(206, { 'content-range': `bytes ${start}-${end}/${size}` }, start, end);
  }
  return send(200, {}, 0, size - 1);
}
