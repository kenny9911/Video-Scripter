// Skills people write for themselves. A skill is a named set of instructions, in Markdown: how to write a
// product page, what the house style is, how a weekly report is laid out. Picked for a conversation, it is
// handed to the model with every prompt (src/chat/prompt.mjs), and to the narration agent when that answers.
//
//   `skills` collection   { id, userId, ts, name, description, body }
//
// A person sees their own skills and the app's built-in playbooks (skills/<id>/SKILL.md, src/agent/skills.mjs).
// A built-in can be used like any other, but it is shown by name and purpose only, never the playbook itself.
// A skill pasted as a whole SKILL.md file gives its name and description from the header.

import { db } from '../db.mjs';
import { SKILLS, STEPS } from '../agent/skills.mjs';
import { newId } from './store.mjs';

export const MAX_SKILLS = 100; // per person
export const MAX_SKILL_BODY = 20_000; // characters
export const MAX_SKILLS_PER_CHAT = 8;
const BUILTIN = 'builtin:';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const line = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** A SKILL.md header, when the text starts with one: { name, description, body }. Otherwise the text is the body. */
export function readSkillFile(text) {
  const source = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(source);
  if (!m) return { name: '', description: '', body: source };
  const head = {};
  for (const row of m[1].split('\n')) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(row);
    if (kv) head[kv[1].toLowerCase()] = kv[2].trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return { name: head.title || head['title-en'] || head.name || '', description: head.description || '', body: m[2].trim() };
}

/** A skill as it is saved, from what the form sent. Throws when it has no name or no instructions. */
export function cleanSkill(input = {}) {
  const file = readSkillFile(input.body);
  const name = line(input.name || file.name, 60);
  const body = file.body.slice(0, MAX_SKILL_BODY);
  if (!name) throw fail('A skill needs a name');
  if (!body) throw fail('A skill needs instructions');
  return { name, description: line(input.description || file.description, 300), body };
}

const mine = (s) => ({ id: s.id, name: s.name, description: s.description, body: s.body, ts: s.ts, builtin: false });
const builtin = (s) => ({ id: `${BUILTIN}${s.id}`, name: s.title.en, title: s.title, description: s.description, builtin: true });

/** A person's own skills, the latest first, then the built-in playbooks. */
export async function listSkills(userId) {
  return [...(await db.list('skills', { userId })).map(mine), ...SKILLS.map(builtin)];
}

/** Create a skill (no `id`) or change one of this person's. */
export async function saveSkill(userId, input) {
  const skill = cleanSkill(input);
  if (input.id) {
    const next = await db.update('skills', String(input.id), (s) => (s.userId === userId ? Object.assign(s, skill, { ts: Date.now() }) : s));
    if (!next || next.userId !== userId) throw fail('That skill no longer exists', 404);
    return mine(next);
  }
  if ((await db.list('skills', { userId })).length >= MAX_SKILLS) throw fail(`A person can keep ${MAX_SKILLS} skills. Delete one first.`);
  return mine(await db.put('skills', { id: newId(12), userId, ts: Date.now(), ...skill }));
}

export async function deleteSkill(userId, id) {
  const skill = await db.get('skills', String(id || ''));
  if (!skill || skill.userId !== userId) throw fail('That skill no longer exists', 404);
  await db.del('skills', skill.id);
  return skill;
}

export async function deleteUserSkills(userId) {
  const skills = await db.list('skills', { userId });
  for (const s of skills) await db.del('skills', s.id);
  return skills.length;
}

/** The ids a conversation may carry: strings, each once, no more than a conversation takes. */
export const cleanSkillIds = (ids) => [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id).slice(0, 80)).filter(Boolean))].slice(0, MAX_SKILLS_PER_CHAT);

/**
 * The skills behind a list of ids, in that order, with their instructions: [{ id, name, description, body, builtin }].
 * Only this person's own and the built-in ones are found; an id that is gone is left out.
 */
export async function skillsFor(userId, ids) {
  const wanted = cleanSkillIds(ids);
  if (!wanted.length) return [];
  const own = new Map((await db.list('skills', { userId })).map((s) => [s.id, s]));
  return wanted
    .map((id) => {
      if (id.startsWith(BUILTIN)) {
        const s = SKILLS.find((x) => x.id === id.slice(BUILTIN.length));
        return s && { id, name: s.name, title: s.title, description: s.description, body: s.body, builtin: true };
      }
      const s = own.get(id);
      return s && { id, name: s.name, description: s.description, body: s.body, builtin: false };
    })
    .filter(Boolean);
}

/** A skill of a conversation in the shape the narration agent's playbooks have, read at every one of its steps. */
export const asPlaybook = (s) => ({ id: s.id, name: s.name, title: s.title || { zh: s.name, en: s.name }, description: s.description, lang: '', platforms: [], frameworks: [], groups: [], keywords: [], minDuration: 0, steps: STEPS, body: s.body });
