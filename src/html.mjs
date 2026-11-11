// The script as one self-contained HTML page for the download package: opens offline from the
// unzipped folder, shows each scene's generated images and clips from the folders next to it,
// follows the reader's light or dark setting, and prints cleanly.

import { SHOT_LABELS } from './shots.mjs';
import { getAspect } from './aspects.mjs';

const LABELS = {
  en: {
    platform: 'Platform', length: 'Length', scenes: 'scenes', hooks: 'Hook options', script: 'Script', voiceover: 'Voiceover only', onScreen: 'On screen', visual: 'Visual', camera: 'Camera', sound: 'Sound',
    publish: 'Publishing package', titles: 'Titles', cover: 'Cover text', description: 'Description', hashtags: 'Hashtags', pinned: 'Pinned comment', notes: 'Production notes', made: 'Made with Video Scripter', pause: 'pause',
    card: 'Viewpoint card', board: 'Whiteboard blueprint', share: 'Line for sharing', chapters: 'Chapters', persona: 'Speaking as', viewer: 'For', insight: 'Core insight', against: 'Overturns', insider: 'Insider explanation', experience: 'First-hand experience', drafted: 'Drafted: confirm or replace', analogy: 'Analogy', mustSay: 'Must be spoken', verify: 'Before you record',
  },
  zh: {
    platform: '平台', length: '时长', scenes: '个场景', hooks: '开场钩子备选', script: '脚本', voiceover: '纯旁白', onScreen: '屏幕文字', visual: '画面', camera: '镜头', sound: '声音',
    publish: '发布素材', titles: '标题', cover: '封面文字', description: '描述文案', hashtags: '话题标签', pinned: '置顶评论', notes: '制作备注', made: '由 Video Scripter 生成', pause: '停顿',
    card: '三维观点卡', board: '板书蓝图', share: '转发导语', chapters: '章节', persona: '人设', viewer: '受众', insight: '核心认知', against: '推翻的共识', insider: '内行解说', experience: '顾问经验', drafted: '草拟：请确认或替换', analogy: '类比', mustSay: '必须说出口', verify: '录制前核实',
  },
};

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n) => String(n).padStart(2, '0');
const clock = (s) => `${pad(Math.floor(s / 60))}:${pad(Math.round(s % 60))}`;
const spoken = (s) => String(s || '').replace(/\[\[|\]\]/g, '').replace(/\s*⏸\s*/g, ' ').trim();

/** Voiceover markup: [[stressed words]] become <mark>, ⏸ becomes a visible beat. Everything else is escaped. */
const voice = (text, L) =>
  esc(text)
    .replace(/\[\[(.+?)\]\]/g, '<mark>$1</mark>')
    .replace(/\s*⏸\s*/g, ` <span class="pause" title="${L.pause}">⏸</span> `);

const CSS = `
:root{--bg:#fafafa;--panel:#fff;--soft:#f4f4f5;--ink:#09090b;--muted:#52525b;--line:#e4e4e7;--accent:#be185d;--accent-soft:#fdf2f8;--mark:#fef08a;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#09090b;--panel:#18181b;--soft:#27272a;--ink:#fafafa;--muted:#a1a1aa;--line:#27272a;--accent:#f9a8d4;--accent-soft:#3b1029;--mark:#713f12}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Noto Sans SC","Microsoft YaHei",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:860px;margin:0 auto;padding:40px 20px 64px}
h1{font-size:30px;line-height:1.2;letter-spacing:-.02em;margin:0 0 8px;text-wrap:balance}
h2{font-size:12px;font-weight:650;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:36px 0 12px}
p{margin:0}
.logline{color:var(--muted);font-size:17px;max-width:70ch}
.meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}
.meta span{padding:2px 10px;border-radius:999px;background:var(--soft);color:var(--muted);font-size:13px;font-weight:550}
.meta span:first-child{background:var(--accent-soft);color:var(--accent)}
.grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr))}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.card .k{font-size:12px;font-weight:650;color:var(--accent);margin-bottom:4px}
.scene{margin-bottom:12px;break-inside:avoid}
.scene header{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.time,.stage{font-size:12px;font-weight:600;border-radius:6px;padding:2px 8px}
.time{font-family:ui-monospace,"SF Mono",Menlo,monospace;background:var(--soft)}
.stage{background:var(--accent-soft);color:var(--accent)}
.vo{font-size:18px;line-height:1.7}
mark{background:var(--mark);color:inherit;border-radius:3px;padding:0 2px}
.pause{color:var(--muted);font-size:.8em}
dl{display:grid;grid-template-columns:auto minmax(0,1fr);gap:5px 14px;margin:12px 0 0;padding-top:12px;border-top:1px dashed var(--line);font-size:15px}
dt{font-size:11px;font-weight:650;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);padding-top:4px}
dd{margin:0}
dd.screen{font-weight:650}
.media{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}
.media figure{margin:0}
.media img,.media video{display:block;width:180px;aspect-ratio:9/16;object-fit:cover;border-radius:12px;border:1px solid var(--line);background:var(--soft)}
.media figcaption{font-size:11px;font-weight:650;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-top:4px}
.teleprompter{white-space:pre-wrap;font-size:18px;line-height:1.9}
.vc{display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px 16px;margin:0;padding:0;border:0;font-size:15px}
.vc dt{padding-top:3px}
.vc ul{padding-left:18px}
.claim{font-weight:650;font-size:17px}
.tag{display:inline-block;margin-left:8px;padding:0 7px;border-radius:999px;background:var(--mark);font-size:11px;font-weight:650}
.board{margin:0;font:13px/1.5 ui-monospace,"SF Mono",Menlo,monospace;white-space:pre;overflow-x:auto}
.value{white-space:pre-wrap;word-break:break-word}
ol,ul{margin:0;padding-left:22px}
footer{margin-top:48px;color:var(--muted);font-size:13px}
.media.a-16-9 img,.media.a-16-9 video{width:300px;aspect-ratio:16/9}
.media.a-1-1 img,.media.a-1-1 video{width:220px;aspect-ratio:1}
.media.a-3-4 img,.media.a-3-4 video{width:200px;aspect-ratio:3/4}
.media.a-4-3 img,.media.a-4-3 video{width:270px;aspect-ratio:4/3}
@media (max-width:560px){h1{font-size:24px}dl{grid-template-columns:1fr;gap:2px}dd{margin-bottom:8px}.media img,.media video{width:44vw}.media.a-16-9 img,.media.a-16-9 video{width:84vw}.media.a-1-1 img,.media.a-1-1 video{width:60vw}.media.a-3-4 img,.media.a-3-4 video{width:50vw}.media.a-4-3 img,.media.a-4-3 video{width:76vw}}
@media print{body{background:#fff}main{padding:0}.card{border-color:#ddd}.media video{display:none}}
`;

/**
 * entry: a history entry. media: [{ scene, kind, file, shot? }] with paths relative to the page.
 * platformName: display name of the platform. lang: 'en' | 'zh' for the labels (script text is as written).
 */
export function scriptHtml(entry, { media = [], platformName = '', lang = 'en' } = {}) {
  const L = LABELS[lang] || LABELS.en;
  const s = entry.script;
  const pub = s.publish || {};
  const last = s.scenes.at(-1);
  const aspect = getAspect(entry.brief?.aspectRatio); // the shape the script was written in; vertical before the option existed
  const meta = [platformName || entry.platformId, last && `${last.end}s`, aspect.id, `${s.scenes.length} ${L.scenes}`, entry.plan?.model, new Date(entry.ts).toISOString().slice(0, 10)].filter(Boolean);
  const section = (title, body) => (body ? `<h2>${esc(title)}</h2>\n${body}` : '');
  const card = (key, body) => `<div class="card">${key ? `<div class="k">${esc(key)}</div>` : ''}${body}</div>`;

  const scenes = s.scenes
    .map((sc) => {
      const files = media.filter((m) => m.scene === sc.id);
      const cues = [[L.onScreen, sc.onScreenText, 'screen'], [L.visual, sc.visual], [L.camera, sc.camera], [L.sound, sc.sfx]].filter(([, v]) => v);
      return `<article class="card scene">
<header><span class="time">${clock(sc.start)}–${clock(sc.end)}</span>${sc.stage ? `<span class="stage">${esc(sc.stage)}</span>` : ''}</header>
<p class="vo">${voice(sc.voiceover, L)}</p>
${cues.length ? `<dl>${cues.map(([k, v, cls]) => `<dt>${esc(k)}</dt><dd${cls ? ` class="${cls}"` : ''}>${esc(v)}</dd>`).join('')}</dl>` : ''}
${
  files.length
    ? `<div class="media a-${aspect.w}-${aspect.h}">${files
        .map((m) => {
          const src = esc(encodeURI(m.file));
          const tag = m.kind === 'video' ? `<video src="${src}" controls playsinline preload="metadata"></video>` : `<img src="${src}" alt="${esc(L.visual)}: ${esc(sc.visual || '')}" loading="lazy">`;
          return `<figure>${tag}${m.shot ? `<figcaption>${esc(SHOT_LABELS[m.shot]?.[lang] || m.shot)}</figcaption>` : ''}</figure>`;
        })
        .join('')}</div>`
    : ''
}
</article>`;
    })
    .join('\n');

  const publish = [
    pub.titles?.length && card(L.titles, `<ol>${pub.titles.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`),
    pub.coverText && card(L.cover, `<div class="value">${esc(pub.coverText)}</div>`),
    pub.description && card(L.description, `<div class="value">${esc(pub.description)}</div>`),
    pub.shareLine && card(L.share, `<div class="value">${esc(pub.shareLine)}</div>`),
    pub.hashtags?.length && card(L.hashtags, `<div class="value">${esc(pub.hashtags.join(' '))}</div>`),
    pub.pinnedComment && card(L.pinned, `<div class="value">${esc(pub.pinnedComment)}</div>`),
    pub.chapters?.length && card(L.chapters, `<ul>${pub.chapters.map((c) => `<li>${c.time ? `<span class="time">${esc(c.time)}</span> ` : ''}${esc(c.title)}</li>`).join('')}</ul>`),
  ].filter(Boolean);

  // The viewpoint card the narration was written to: the first page of the package.
  const vc = s.card;
  const items = (list) => (list?.length ? `<ul>${list.map((x) => `<li>${x}</li>`).join('')}</ul>` : '');
  const viewpoint = vc
    ? card(
        '',
        `<dl class="vc">${[
          [L.persona, esc(vc.persona)],
          [L.viewer, esc(vc.viewer)],
          [L.insight, vc.insight?.claim ? `<div class="claim">${esc(vc.insight.claim)}</div>${vc.insight.against ? `<div>${esc(L.against)}: ${esc(vc.insight.against)}</div>` : ''}` : ''],
          [L.insider, items((vc.insider || []).map(esc))],
          [L.experience, items((vc.experience || []).map((e) => `${esc(e.point)}${e.source === 'draft' ? `<span class="tag">${esc(L.drafted)}</span>` : ''}`))],
          [L.analogy, esc(vc.analogy)],
          [L.mustSay, esc((vc.mustSay || []).join(' · '))],
          [L.verify, items((vc.toVerify || []).map(esc))],
        ]
          .filter(([, v]) => v)
          .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`)
          .join('')}</dl>`,
      )
    : '';

  return `<!doctype html>
<html lang="${lang === 'zh' ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(s.title || 'Script')}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1>${esc(s.title)}</h1>
${s.logline ? `<p class="logline">${esc(s.logline)}</p>` : ''}
<div class="meta">${meta.map((m) => `<span>${esc(m)}</span>`).join('')}</div>
${section(L.card, viewpoint)}
${section(L.board, s.whiteboard ? `<pre class="card board">${esc(s.whiteboard)}</pre>` : '')}
${section(L.hooks, s.hookOptions?.length ? `<div class="grid">${s.hookOptions.map((o) => card(o.type, `<div>${voice(o.line, L)}</div>`)).join('')}</div>` : '')}
${section(L.script, scenes)}
${section(L.voiceover, `<div class="card teleprompter">${esc(s.scenes.map((sc) => spoken(sc.voiceover)).join('\n\n'))}</div>`)}
${section(L.publish, publish.length ? `<div class="grid" style="grid-template-columns:1fr">${publish.join('')}</div>` : '')}
${section(L.notes, s.productionNotes?.length ? `<div class="card"><ul>${s.productionNotes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>` : '')}
<footer>${esc(L.made)}</footer>
</main>
</body>
</html>
`;
}
