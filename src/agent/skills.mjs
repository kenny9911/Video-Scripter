// Skills: the playbooks the narration agent works from. Each one is a Markdown file,
// skills/<id>/SKILL.md, with a short header that says when it applies and at which steps it is read:
//
//   ---
//   name: wechat-channels-growth
//   title-zh: 视频号双引擎与合规获客        shown in the app
//   title-en: WeChat Channels growth and compliance
//   description: one sentence on what it is for
//   lang: zh                               only for narration in this language
//   platforms: wechat_channels             only for these platforms
//   frameworks: consultant_lecture         only for these structures or styles ...
//   groups: tech                           ... or for every one in these groups
//   keywords: Palantir, Ontology, 本体      only when the brief mentions one of these
//   min-duration: 180                      only for videos at least this long (seconds)
//   steps: plan, write, review, script     which steps read it
//   ---
//   the playbook, in Markdown
//
// A condition that is left out always holds, so a skill with none of them is used for every video.
// To teach the agent something new, add a folder here: no code changes are needed.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILLS_DIR = process.env.SKILLS_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills');

// plan: the viewpoint card. write: the narration. review: the edit. script: scenes, visuals and the publishing package.
export const STEPS = ['plan', 'write', 'review', 'script'];

const list = (v) => String(v || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
const squash = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');

/** A SKILL.md file as a skill. Throws when the header is missing or names a step that does not exist. */
export function parseSkill(source, id) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(String(source));
  if (!m) throw new Error(`Skill "${id}" has no header`);
  const head = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) head[kv[1]] = kv[2].trim();
  }
  const steps = head.steps ? list(head.steps) : STEPS.slice(0, 3);
  const unknown = steps.find((s) => !STEPS.includes(s));
  if (unknown) throw new Error(`Skill "${id}" names an unknown step "${unknown}"`);
  const body = m[2].trim();
  if (!body) throw new Error(`Skill "${id}" is empty`);
  const name = head.name || id;
  return {
    id,
    name,
    title: { zh: head['title-zh'] || name, en: head['title-en'] || name },
    description: head.description || '',
    lang: head.lang || '',
    platforms: list(head.platforms),
    frameworks: list(head.frameworks),
    groups: list(head.groups),
    keywords: list(head.keywords),
    minDuration: Number(head['min-duration']) || 0,
    steps,
    body,
  };
}

/** Every skill in a folder, by id. A file that cannot be read as a skill is reported and left out. */
export function loadSkills(dir = SKILLS_DIR) {
  let ids = [];
  try {
    ids = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch (err) {
    console.warn(`[skills] could not read ${dir}: ${err.message}`);
  }
  const skills = [];
  for (const id of ids) {
    try {
      skills.push(parseSkill(readFileSync(path.join(dir, id, 'SKILL.md'), 'utf8'), id));
    } catch (err) {
      console.warn(`[skills] ${id} was skipped: ${err.message}`);
    }
  }
  return skills;
}

export const SKILLS = loadSkills();

/** The skills that apply to a brief (as normalizeBrief returns it), in a stable order. */
export function selectSkills(brief, all = SKILLS) {
  const said = squash([brief.topic, brief.keyMessage, brief.brand, brief.experience, brief.reference, ...(brief.materials?.docs || []).map((d) => d.text)].join('\n'));
  const group = brief.framework.group || 'general';
  return all.filter((s) => {
    // A playbook for one language is for that language: "zh" covers both scripts of Chinese, "en" is English alone.
    if (s.lang && (s.lang === 'zh' ? brief.lang !== 'zh' : s.lang !== (brief.language || brief.lang))) return false;
    if (s.platforms.length && !s.platforms.includes(brief.platform.id)) return false;
    if ((s.frameworks.length || s.groups.length) && !s.frameworks.includes(brief.framework.id) && !s.groups.includes(group)) return false;
    if (s.minDuration && brief.duration < s.minDuration) return false;
    if (s.keywords.length && !s.keywords.some((k) => said.includes(squash(k)))) return false;
    return true;
  });
}

const INTRO = {
  plan: 'These playbooks apply to this video. Plan to them.',
  write: 'These playbooks apply to this video. Write to them. Where one conflicts with a rule further down, the more specific instruction wins.',
  review: 'These playbooks are what the narration is held to. Use them as the standard when you review it.',
  script: 'These playbooks apply to this video. Follow what they say about visuals, on-screen text, the board and the publishing package.',
};

/** The skills a step reads, as a block of a system prompt (an empty list when none applies). */
export function skillSection(skills, step) {
  const used = skills.filter((s) => s.steps.includes(step));
  if (!used.length) return [];
  // A playbook's own headings sit two levels below the prompt's.
  const nested = (body) => body.replace(/^(#{1,4}) /gm, '##$1 ');
  return [`# Skills\n${INTRO[step]}\n\n${used.map((s) => `## Skill: ${s.name}\n${nested(s.body).replace(/^### .*\n+/, '')}`).join('\n\n')}`, ''];
}

/** What the app shows of a skill: its name and what it is for, never the playbook itself. */
export const publicSkill = (s) => ({ id: s.id, title: s.title, description: s.description });
