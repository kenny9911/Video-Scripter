// Storage. Everything the app keeps is a JSON document in a named collection
// (users, sessions, history, usage, activity, config) or a binary blob (generated media).
//
//   file      data/<collection>.json and data/media/<name>     local development, single machine
//   postgres  two tables, vs_docs and vs_blobs                  any hosted deployment (set DATABASE_URL)
//
// A serverless host such as Vercel has no durable disk, so without DATABASE_URL the file backend
// falls back to a temporary folder there and `storage.durable` is false: the app says so to admins.

import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
export const DATA_DIR = process.env.DATA_DIR || (SERVERLESS ? '/tmp/video-scripter' : path.join(ROOT, 'data'));
export const storage = { kind: DATABASE_URL ? 'postgres' : 'file', durable: Boolean(DATABASE_URL) || !SERVERLESS };

const matches = (doc, { userId, since, where }) =>
  (userId === undefined || doc.userId === userId) && (since === undefined || (doc.ts || 0) >= since) && (!where || Object.entries(where).every(([k, v]) => doc[k] === v));

// ---------- File backend ----------

function fileDb() {
  const queues = new Map();
  const fileOf = (col) => path.join(DATA_DIR, `${col}.json`);
  const read = async (col) => {
    try {
      const list = JSON.parse(await readFile(fileOf(col), 'utf8'));
      return Array.isArray(list) ? list : [];
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`[db] could not read ${fileOf(col)}: ${err.message}`);
      return [];
    }
  };
  const write = async (col, list) => {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(`${fileOf(col)}.tmp`, JSON.stringify(list, null, 1), { mode: 0o600 });
    await rename(`${fileOf(col)}.tmp`, fileOf(col));
  };
  // One writer at a time per collection, and writes are atomic, so concurrent requests cannot lose data.
  const run = (col, fn) => {
    const next = (queues.get(col) || Promise.resolve()).then(fn);
    queues.set(col, next.catch(() => {}));
    return next;
  };

  return {
    get: (col, id) => run(col, async () => (await read(col)).find((d) => d.id === id) || null),
    put: (col, doc) =>
      run(col, async () => {
        const list = await read(col);
        const i = list.findIndex((d) => d.id === doc.id);
        if (i < 0) list.push(doc);
        else list[i] = doc;
        await write(col, list);
        return doc;
      }),
    del: (col, id) =>
      run(col, async () => {
        const list = await read(col);
        const keep = list.filter((d) => d.id !== id);
        if (keep.length !== list.length) await write(col, keep);
      }),
    update: (col, id, fn) =>
      run(col, async () => {
        const list = await read(col);
        const i = list.findIndex((d) => d.id === id);
        if (i < 0) return null;
        list[i] = (await fn(list[i])) ?? list[i];
        await write(col, list);
        return list[i];
      }),
    list: (col, opts = {}) =>
      run(col, async () =>
        (await read(col))
          .filter((d) => matches(d, opts))
          .sort((a, b) => (b.ts || 0) - (a.ts || 0))
          .slice(0, opts.limit || Infinity),
      ),
    find: (col, field, value) => run(col, async () => (await read(col)).find((d) => d[field] === value) || null),
    async putBlob(name, { bytes }) {
      await mkdir(path.join(DATA_DIR, 'media'), { recursive: true });
      await writeFile(path.join(DATA_DIR, 'media', name), bytes);
    },
    async getBlob(name) {
      const file = path.join(DATA_DIR, 'media', name);
      try {
        const { size } = await stat(file);
        return { size, read: (start, end) => createReadStream(file, { start, end }), bytes: () => readFile(file) };
      } catch {
        return null;
      }
    },
    close: async () => {},
  };
}

// ---------- Postgres backend ----------

async function postgresDb(url) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: SERVERLESS ? 2 : 5, idleTimeoutMillis: 10_000 });
  pool.on('error', (err) => console.warn(`[db] idle connection error: ${err.message}`));
  const schema = `
    CREATE TABLE IF NOT EXISTS vs_docs (col text NOT NULL, id text NOT NULL, user_id text, ts bigint NOT NULL DEFAULT 0, data jsonb NOT NULL, PRIMARY KEY (col, id));
    CREATE INDEX IF NOT EXISTS vs_docs_user ON vs_docs (col, user_id, ts DESC);
    CREATE INDEX IF NOT EXISTS vs_docs_ts ON vs_docs (col, ts DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS vs_users_email ON vs_docs ((data->>'email')) WHERE col = 'users';
    CREATE TABLE IF NOT EXISTS vs_blobs (name text PRIMARY KEY, user_id text, type text, bytes bytea NOT NULL, ts bigint NOT NULL DEFAULT 0);`;
  try {
    await pool.query(schema);
  } catch {
    await pool.query(schema); // two instances starting at once can collide on CREATE; the second attempt sees the tables
  }
  const q = (text, params) => pool.query(text, params);
  const upsert = 'INSERT INTO vs_docs (col, id, user_id, ts, data) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (col, id) DO UPDATE SET user_id = EXCLUDED.user_id, ts = EXCLUDED.ts, data = EXCLUDED.data';
  const row = (col, doc) => [col, doc.id, doc.userId ?? null, Math.round(doc.ts || 0), JSON.stringify(doc)];

  return {
    get: async (col, id) => (await q('SELECT data FROM vs_docs WHERE col = $1 AND id = $2', [col, id])).rows[0]?.data || null,
    put: async (col, doc) => (await q(upsert, row(col, doc)), doc),
    del: async (col, id) => void (await q('DELETE FROM vs_docs WHERE col = $1 AND id = $2', [col, id])),
    async update(col, id, fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const cur = (await client.query('SELECT data FROM vs_docs WHERE col = $1 AND id = $2 FOR UPDATE', [col, id])).rows[0]?.data;
        if (!cur) return (await client.query('ROLLBACK'), null);
        const next = (await fn(cur)) ?? cur;
        await client.query(upsert, row(col, next));
        await client.query('COMMIT');
        return next;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    async list(col, opts = {}) {
      const params = [col];
      let sql = 'SELECT data FROM vs_docs WHERE col = $1';
      if (opts.userId !== undefined) sql += ` AND user_id = $${params.push(opts.userId)}`;
      if (opts.since !== undefined) sql += ` AND ts >= $${params.push(Math.round(opts.since))}`;
      for (const [k, v] of Object.entries(opts.where || {})) sql += ` AND data->>$${params.push(k)} = $${params.push(String(v))}`;
      sql += ' ORDER BY ts DESC';
      if (opts.limit) sql += ` LIMIT $${params.push(opts.limit)}`;
      return (await q(sql, params)).rows.map((r) => r.data);
    },
    find: async (col, field, value) => (await q('SELECT data FROM vs_docs WHERE col = $1 AND data->>$2 = $3 LIMIT 1', [col, field, String(value)])).rows[0]?.data || null,
    putBlob: async (name, { userId, type, bytes }) =>
      void (await q('INSERT INTO vs_blobs (name, user_id, type, bytes, ts) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (name) DO UPDATE SET bytes = EXCLUDED.bytes, type = EXCLUDED.type', [name, userId ?? null, type || '', bytes, Date.now()])),
    async getBlob(name) {
      const r = (await q('SELECT bytes FROM vs_blobs WHERE name = $1', [name])).rows[0];
      if (!r) return null;
      return { size: r.bytes.length, read: (start = 0, end = r.bytes.length - 1) => r.bytes.subarray(start, end + 1), bytes: async () => r.bytes };
    },
    close: () => pool.end(),
  };
}

// Connect on first use, so importing this module never fails and a bad DATABASE_URL surfaces as a request error.
let ready;
const backend = () => (ready ??= DATABASE_URL ? postgresDb(DATABASE_URL) : Promise.resolve(fileDb()));
const call = (method) => async (...args) => (await backend())[method](...args);

export const db = {
  /** One document, or null. */
  get: call('get'),
  /** Insert or replace by `doc.id`. `doc.userId` and `doc.ts` are indexed. */
  put: call('put'),
  del: call('del'),
  /** Read-modify-write under a lock: fn(doc) returns the new doc (or mutates it). Null when missing. */
  update: call('update'),
  /** Newest first. opts: { userId, since, where: { field: value }, limit } */
  list: call('list'),
  /** First document whose top-level `field` equals `value`. */
  find: call('find'),
  putBlob: call('putBlob'),
  /** { size, read(start, end), bytes() } or null. */
  getBlob: call('getBlob'),
  close: async () => ready && (await ready).close(),
};
