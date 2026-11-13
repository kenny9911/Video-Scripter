// Conversations. Each one is a document in the `chats` collection, owned by the person who started it:
//
//   { id, userId, ts, created, title, target, model: { gatewayId, model }, skillIds: [], messages: [...] }
//
//   message   { id, role: 'user' | 'assistant', content, ts,
//               target, model, gateway,        who answered (an assistant's reply)
//               skills: [{ id, name }],        the skills the reply was written with
//               media: [{ kind, prompt, aspect, seconds, status, url, error, jobId, gatewayId }],
//                                              the pictures and clips of the reply, one per ```image / ```video
//                                              block of its text, in order (public/markdown.js, embeds)
//               steps: [...],                  what an agent did on the way
//               error: { error, cause },       the reply failed; `content` is what was written before it did
//               stopped, edited }
//
// A conversation is private: nobody else can open it, an administrator included. The pictures and clips made in
// one are blobs named chat-<conversation id>-…, served only to its owner, and deleted with it.

import { randomUUID, randomBytes } from 'node:crypto';
import { db } from '../db.mjs';
import { mediaFile } from '../store.mjs';

export const MAX_PROMPT = 24_000; // characters in one prompt
export const MAX_CONTENT = 200_000; // characters in one reply, as the canvas may save it
export const MAX_MESSAGES = 400; // per conversation
export const MAX_CHATS = 1000; // per person
const MAX_TITLE = 80;

export const newId = (n = 16) => randomUUID().replace(/-/g, '').slice(0, n);
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

/** A title for a conversation, from the prompt that opens it. */
export function titleFrom(text) {
  const line = String(text || '').split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').replace(/[*_`]/g, '').trim()).find(Boolean) || '';
  const chars = [...line.replace(/\s+/g, ' ')];
  return chars.length > 48 ? `${chars.slice(0, 48).join('').trimEnd()}…` : line;
}

const cleanTitle = (title) => String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);

/** What the list shows of a conversation: never its messages. */
export function summary(chat) {
  return { id: chat.id, title: chat.title, ts: chat.ts, created: chat.created, target: chat.target, model: chat.model, skillIds: chat.skillIds || [], count: chat.messages.length };
}

/** A stretch of a message around the first place `q` is found, for the search results. */
function snippet(chat, q) {
  for (const m of chat.messages) {
    const at = m.content.toLowerCase().indexOf(q);
    if (at >= 0) return `${at > 30 ? '…' : ''}${m.content.slice(Math.max(0, at - 30), at + 90).replace(/\s+/g, ' ').trim()}`;
  }
  return '';
}

/** A person's conversations, the latest first. `q` keeps those whose title or messages contain it. */
export async function listChats(userId, { q = '' } = {}) {
  const chats = await db.list('chats', { userId, limit: MAX_CHATS });
  const asked = String(q).trim().toLowerCase().slice(0, 100);
  if (!asked) return chats.map(summary);
  return chats.filter((c) => c.title.toLowerCase().includes(asked) || c.messages.some((m) => m.content.toLowerCase().includes(asked))).map((c) => ({ ...summary(c), match: snippet(c, asked) }));
}

/** A conversation of this person's. Throws 404 for anyone else's, and for one that is gone. */
export async function ownedChat(userId, id) {
  const chat = id ? await db.get('chats', String(id)) : null;
  if (!chat || chat.userId !== userId) throw fail('That conversation no longer exists', 404);
  return chat;
}

export async function createChat({ userId, title, target, model, skillIds }) {
  const now = Date.now();
  return db.put('chats', { id: newId(), userId, ts: now, created: now, title: cleanTitle(title) || 'New chat', target: target || 'assistant', model: model || null, skillIds: skillIds || [], messages: [] });
}

/** Change a conversation of this person's under a lock: `change(chat)` edits it in place. `touch: false` keeps its place in the list. */
export async function changeChat(userId, id, change, { touch = true } = {}) {
  const next = await db.update('chats', String(id || ''), async (chat) => {
    if (chat.userId !== userId) return chat;
    await change(chat);
    if (touch) chat.ts = Date.now();
    return chat;
  });
  if (!next || next.userId !== userId) throw fail('That conversation no longer exists', 404);
  return next;
}

export const renameChat = (userId, id, title) => {
  const clean = cleanTitle(title);
  if (!clean) throw fail('A conversation needs a title');
  return changeChat(userId, id, (chat) => void Object.assign(chat, { title: clean, renamed: true }), { touch: false }); // a title someone gave is not replaced by the first prompt
};

/** Remove a conversation and every picture and clip made in it. */
export async function deleteChat(userId, id) {
  const chat = await ownedChat(userId, id);
  await db.delBlobs(`chat-${chat.id}-`);
  await db.del('chats', chat.id);
  return chat;
}

/** Remove all of a person's conversations. Returns how many went. */
export async function deleteUserChats(userId) {
  const chats = await db.list('chats', { userId });
  for (const c of chats) {
    await db.delBlobs(`chat-${c.id}-`);
    await db.del('chats', c.id);
  }
  return chats.length;
}

export const newMessage = (role, content, extra = {}) => ({ id: newId(12), role, content: String(content ?? ''), ts: Date.now(), ...extra });

// ---------- The files of a conversation ----------

export const isChatFile = (name) => String(name || '').startsWith('chat-');

/** The id of the person a stored file of a conversation belongs to ('' when the conversation is gone). */
export async function chatFileOwner(name) {
  const id = /^chat-([a-z0-9]+)-/.exec(String(name || ''))?.[1];
  return (id && (await db.get('chats', id))?.userId) || '';
}

/**
 * Store a picture or a clip made in a conversation: `source` is a data: URI, or a fetch Response for a file the
 * provider hosts. Returns { url } on this server, or null when it is not a type we keep.
 */
export async function saveChatMedia({ chatId, userId, kind, source, demo = false }) {
  const file = await mediaFile(source, { kind, demo });
  if (!file) return null;
  const name = `chat-${chatId}-${kind}-${Date.now().toString(36)}${randomBytes(3).toString('hex')}.${file.ext}`;
  await db.putBlob(name, { userId, type: file.type, bytes: file.bytes });
  return { url: `/media/${name}` };
}
