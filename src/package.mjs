// Builds the downloadable package for one saved script: the script in three text forms plus
// every image and video generated for it, under one predictable naming scheme.
//
//   2026-11-10_douyin_为什么企业买了大模型.zip
//   └─ 2026-11-10_douyin_为什么企业买了大模型/
//      ├─ script.md                     full script, readable
//      ├─ script.html                   the same as a styled page that shows the images and clips
//      ├─ script.json                   brief, plan, script and a manifest of the media files
//      ├─ voiceover.txt                 spoken text only, one scene per paragraph
//      ├─ post.md                       the image post, when one was written: the note to paste and what each card says
//      ├─ images/scene-01_00m00s-00m04s.png      (…_1.png, …_2-end.png when a scene has several)
//      ├─ images/host-A.png             the reference portrait of each on-screen host
//      └─ videos/scene-01_00m00s-00m04s.mp4

import { readMedia } from './store.mjs';
import { zip } from './zip.mjs';
import { scriptHtml } from './html.mjs';
import { getPlatform } from './platforms.mjs';
import { postFormat, postMarkdown } from './post.mjs';

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

/** A shot's id as part of a file name: "wide", "clay" for a style, "custom-illustration" for a custom one. */
export const shotTag = (shot) =>
  String(shot || '')
    .replace(/^style-/, '')
    .replace(/^custom:([^:]+):[\s\S]*$/, 'custom-$1')
    .replace(/[^\w-]/g, '');

const sceneFile = (sc, i, ext, n = '') => `scene-${pad(i + 1)}_${stamp(sc.start)}-${stamp(sc.end)}${n && `_${n}`}.${ext}`;
const spoken = (s) => String(s || '').replace(/\[\[|\]\]/g, '').replace(/\s*⏸\s*/g, ' ').trim();

/** Returns { name, buffer } for a history entry. `markdown` is the script as the page renders it. */
export async function buildPackage(entry, { markdown, lang } = {}) {
  const root = packageName(entry);
  const files = [];
  const manifest = [];

  // The hosts' reference portraits come first: they are what every scene with a host was drawn from.
  for (const host of entry.script.cast || []) {
    const stored = /^\/media\/([\w-]+\.(\w+))$/.exec(entry.media?.[`host${host.id}`]?.image?.url || '');
    const data = stored && (await readMedia(stored[1]).catch(() => null));
    if (!data) continue;
    const name = `images/host-${host.id}.${stored[2]}`;
    files.push({ name: `${root}/${name}`, data, store: stored[2] !== 'svg' });
    manifest.push({ host: host.id, kind: 'image', file: name });
  }

  for (const [i, sc] of entry.script.scenes.entries()) {
    for (const [kind, dir] of [['image', 'images'], ['video', 'videos']]) {
      const m = entry.media?.[sc.id]?.[kind];
      const urls = m?.urls?.length ? m.urls : m?.url ? [m.url] : [];
      for (const [n, url] of urls.entries()) {
        const stored = /^\/media\/([\w-]+\.(\w+))$/.exec(url);
        if (!stored) continue; // only a provider link that could not be saved
        const data = await readMedia(stored[1]).catch(() => null);
        if (!data) continue; // the file is gone from storage: leave it out
        const shot = shotTag(m.shots?.[n]);
        const name = `${dir}/${sceneFile(sc, i, stored[2], urls.length > 1 ? `${n + 1}${shot && `-${shot}`}` : '')}`;
        files.push({ name: `${root}/${name}`, data, store: stored[2] !== 'svg' });
        manifest.push({ scene: sc.id, kind, file: name, ...(shot && { shot }) });
      }
    }
  }

  const json = { platform: entry.platformId, created: new Date(entry.ts).toISOString(), brief: entry.brief, plan: entry.plan, ...entry.script, media: manifest };
  const text = [
    markdown && { name: 'script.md', data: String(markdown) },
    { name: 'script.html', data: scriptHtml(entry, { media: manifest, platformName: getPlatform(entry.platformId)?.name, lang: lang === 'zh' ? 'zh' : 'en' }) },
    { name: 'script.json', data: JSON.stringify(json, null, 2) },
    { name: 'voiceover.txt', data: `${entry.script.scenes.map((sc) => spoken(sc.voiceover)).join('\n\n')}\n` },
    entry.post?.cards?.length && postFormat(entry.platformId) && { name: 'post.md', data: postMarkdown(entry.post, postFormat(entry.platformId)) },
  ].filter(Boolean);
  files.unshift(...text.map((f) => ({ ...f, name: `${root}/${f.name}` })));

  return { name: `${root}.zip`, buffer: zip(files, new Date(entry.ts)), files: files.map((f) => f.name) };
}
