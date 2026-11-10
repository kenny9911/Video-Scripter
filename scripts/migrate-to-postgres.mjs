// Copy what the file backend holds (data/*.json and data/media/*) into Postgres, so a hosted
// deployment starts with the same accounts, scripts, settings and generated media.
//
//   DATABASE_URL=postgres://... node scripts/migrate-to-postgres.mjs [--no-media] [--overwrite] [--dir data]
//
// Passwords travel as their scrypt hashes, so everyone keeps the password they already have.
// It is safe to run again: a document that is already in the database is left as it is there (the
// hosted copy may have changed since), and a media file already there with the same size is skipped,
// so a run that was cut short picks up where it stopped. --overwrite replaces existing documents with
// the local ones. Sessions are not copied, because a cookie from one address is no use at another.

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.resolve(option('--dir') || path.join(ROOT, 'data'));
const COLLECTIONS = ['users', 'history', 'usage', 'activity', 'config'];
const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };

if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
  console.error('Set DATABASE_URL to the Postgres database to copy into.');
  process.exit(1);
}

// Imported after the check: with DATABASE_URL set, `db` is the Postgres backend.
const { db } = await import('../src/db.mjs');

const readList = async (col) => {
  try {
    const list = JSON.parse(await readFile(path.join(SOURCE, `${col}.json`), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return [];
  }
};

/** Name -> size of every file already in the database, read without downloading the files. */
async function storedSizes() {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT name, octet_length(bytes) AS size FROM vs_blobs');
    return new Map(rows.map((r) => [r.name, Number(r.size)]));
  } finally {
    await client.end();
  }
}

let failed = 0;
try {
  for (const col of COLLECTIONS) {
    const docs = await readList(col);
    let copied = 0;
    let kept = 0;
    for (const doc of docs) {
      try {
        if (!flag('--overwrite') && (await db.get(col, doc.id))) {
          kept++;
          continue;
        }
        // An account that already exists there under another id keeps its own password and data.
        if (col === 'users') {
          const existing = await db.find('users', 'email', doc.email);
          if (existing && existing.id !== doc.id) {
            console.warn(`  users: skipped ${doc.email}, an account with that email already exists in the database`);
            continue;
          }
        }
        await db.put(col, doc);
        copied++;
      } catch (err) {
        failed++;
        console.warn(`  ${col}: could not copy ${doc.id}: ${err.message}`);
      }
    }
    console.log(`${col}: ${copied} of ${docs.length} copied${kept ? `, ${kept} already there` : ''}`);
  }

  if (!flag('--no-media')) {
    // A file is named <historyId>-s<scene>-<kind>-<stamp>.<ext>; its owner is the owner of that script.
    const owners = new Map((await readList('history')).map((e) => [e.id, e.userId || null]));
    const names = (await readdir(path.join(SOURCE, 'media')).catch(() => [])).filter((n) => TYPES[n.split('.').pop()]);
    const present = await storedSizes();
    let copied = 0;
    let skipped = 0;
    let bytesTotal = 0;
    for (const name of names) {
      try {
        const bytes = await readFile(path.join(SOURCE, 'media', name));
        if (present.get(name) === bytes.length) {
          skipped++;
          continue;
        }
        const historyId = [...owners.keys()].find((id) => name.startsWith(`${id}-s`));
        // A large upload over a slow link can lose its connection; the pool opens a new one on the next try.
        for (let attempt = 1; ; attempt++) {
          try {
            await db.putBlob(name, { userId: historyId ? owners.get(historyId) : null, type: TYPES[name.split('.').pop()], bytes });
            break;
          } catch (err) {
            if (attempt >= 3) throw err;
          }
        }
        copied++;
        bytesTotal += bytes.length;
      } catch (err) {
        failed++;
        console.warn(`  media: could not copy ${name}: ${err.message}`);
      }
    }
    console.log(`media: ${copied} of ${names.length} files copied (${(bytesTotal / 1_048_576).toFixed(1)} MB), ${skipped} already there`);
  }
} finally {
  await db.close();
}

if (failed) {
  console.error(`${failed} item(s) could not be copied.`);
  process.exit(1);
}
console.log('Done.');
