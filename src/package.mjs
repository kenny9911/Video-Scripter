// Builds the downloadable package for one saved script: the script in three text forms plus
// every image and video generated for it, under one predictable naming scheme.
//
//   2026-11-10_douyin_为什么企业买了大模型.zip
//   └─ 2026-11-10_douyin_为什么企业买了大模型/
//      ├─ script.md                     full script, readable
//      ├─ script.json                   brief, plan, script and a manifest of the media files
//      ├─ voiceover.txt                 spoken text only, one scene per paragraph
//      ├─ images/scene-01_00m00s-00m04s.png      (…_1.png, …_2.png when a scene has several)
//      └─ videos/scene-01_00m00s-00m04s.mp4

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { MEDIA_DIR } from './store.mjs';
import { zip } from './zip.mjs';

const pad = (n) => String(n).padStart(2, '0');
const stamp = (s) => `${pad(Math.floor(s / 60))}m${pad(Math.round(s % 60))}s`;

/** File-system safe on every OS, keeps Chinese and other letters, no spaces. */
export function slug(text, max = 40) {
  const out = String(text || '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return [...out].slice(0, max).join('').replace(/-+$/, '') || 'script';
}

export function packageName(entry) {
  const d = new Date(entry.ts);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `${date}_${slug(entry.platformId, 20)}_${slug(entry.script.title || entry.brief?.topic)}`;
}

const sceneFile = (sc, i, ext, n = '') => `scene-${pad(i + 1)}_${stamp(sc.start)}-${stamp(sc.end)}${n && `_${n}`}.${ext}`;
const spoken = (s) => String(s || '').replace(/\[\[|\]\]/g, '').replace(/\s*⏸\s*/g, ' ').trim();

/** Returns { name, buffer } for a history entry. `markdown` is the script as the page renders it. */
export async function buildPackage(entry, { markdown } = {}) {
  const root = packageName(entry);
  const files = [];
  const manifest = [];

  for (const [i, sc] of entry.script.scenes.entries()) {
    for (const [kind, dir] of [['image', 'images'], ['video', 'videos']]) {
      const m = entry.media?.[sc.id]?.[kind];
      const urls = m?.urls?.length ? m.urls : m?.url ? [m.url] : [];
      for (const [n, url] of urls.entries()) {
        const stored = /^\/media\/([\w-]+\.(\w+))$/.exec(url);
        if (!stored) continue; // only a provider link that could not be saved
        try {
          const name = `${dir}/${sceneFile(sc, i, stored[2], urls.length > 1 ? n + 1 : '')}`;
          files.push({ name: `${root}/${name}`, data: await readFile(path.join(MEDIA_DIR, stored[1])), store: stored[2] !== 'svg' });
          manifest.push({ scene: sc.id, kind, file: name });
        } catch {} // the file was removed from disk: leave it out
      }
    }
  }

  const json = { platform: entry.platformId, created: new Date(entry.ts).toISOString(), brief: entry.brief, plan: entry.plan, ...entry.script, media: manifest };
  const text = [
    markdown && { name: 'script.md', data: String(markdown) },
    { name: 'script.json', data: JSON.stringify(json, null, 2) },
    { name: 'voiceover.txt', data: `${entry.script.scenes.map((sc) => spoken(sc.voiceover)).join('\n\n')}\n` },
  ].filter(Boolean);
  files.unshift(...text.map((f) => ({ ...f, name: `${root}/${f.name}` })));

  return { name: `${root}.zip`, buffer: zip(files, new Date(entry.ts)), files: files.map((f) => f.name) };
}
