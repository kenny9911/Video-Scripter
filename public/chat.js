// The chat page: conversations with the model and the agents, the model picker, the history in the sidebar,
// the canvas that shows a reply as a document, and the skills people write. Plain ES modules, no build step.
//
// A prompt goes to POST /api/chat/send and the reply comes back as a stream of events (src/chat/routes.mjs).
// Replies are Markdown, read and drawn by markdown.js; a ```image or ```video block in one is shown as the
// picture or the clip the server made for it.

import { autosize as growBox } from './autosize.js';
import './chat.zh.js';
import { t, lang, applyI18n, explain } from './i18n.js';
import { icon, hydrateIcons } from './icons.js';
import { el, call, when } from './account.js';
import { wireTheme, wireLang } from './shell.js';
import { parse, render, titleOf } from './markdown.js';
import { sourcesNode, readingNote, webAbility } from './web.js';

const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  meta: null,
  skills: [], // the person's own, then the built-in ones
  chats: [], // summaries, the latest first
  chat: null, // the conversation on screen: { id, title, messages } (id is null until its first prompt is saved)
  model: null, // { gatewayId, model }
  target: 'assistant',
  skillIds: [],
  aspect: '9:16',
  seconds: 8,
  web: false, // search the web for each prompt (the links in a prompt are read either way)
  webCan: { search: false, read: false }, // what the web can do on this server
  busy: null, // { abort, chat, reply } while a reply is being written
  editId: null, // the prompt being edited
  canvas: null, // { id, mode: 'preview' | 'source', dirty }
  skillEdit: null, // the skill in the dialog: an id, or null for a new one
};

const nodes = new Map(); // message id -> its element in the thread
const TARGETS = {
  assistant: { icon: 'sparkles', name: 'Assistant', about: 'The model answers, with the skills you picked. Ask for a picture or a clip and it makes one.', hint: 'Ask anything. Type / to use a skill.' },
  narrator: { icon: 'bot', name: 'Narration agent', about: 'Plans what a video says, writes its narration and reviews it. Give it the topic; name the platform and the length if you like.', hint: 'What is the video about? e.g. 90 秒的视频号视频：为什么企业买了大模型却用不起来' },
  image: { icon: 'image', name: 'Image', about: 'Your prompt goes straight to the image model.', hint: 'Describe the picture: the subject, the setting, the style and the light.' },
  video: { icon: 'video', name: 'Video', about: 'Your prompt goes straight to the video model. A clip takes a few minutes.', hint: 'Describe the clip: the subject, the action and how the camera moves.' },
};
const STEP_NAMES = { skills: 'Skills', write: 'Plan and write', review: 'Review' };
const DROPPED = { side: 'app', code: 'dropped' };

// ---------- Small things ----------

function toast(msg) {
  const node = $('toast');
  node.textContent = msg;
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (node.hidden = true), 2200);
}

async function copy(text, label = t('Copied')) {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    toast(t('Copy failed: select the text and copy manually'));
  }
}

function download(name, text, type = 'text/markdown;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  el('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const fileName = (title, ext = 'md') => `${(title || 'chat').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'chat'}.${ext}`;
const clip = (text, n) => ([...text].length > n ? `${[...text].slice(0, n).join('')}…` : text);
const iconBtn = (name, label, attrs = {}) => el('button', { class: 'msg-btn', type: 'button', title: label, 'aria-label': label, ...attrs }, icon(name, 16));
const fault = (data, status) => new Error(explain(t(data.error) || t('Request failed ({status})', { status }), data.cause));
const offline = (err) => err instanceof TypeError && /fetch|network|load failed|input stream/i.test(err.message);
const isMobile = () => matchMedia('(max-width: 899px)').matches;
const skillName = (s) => (s.title ? s.title[lang] || s.title.en : s.name);
const closeMenus = (except) => document.querySelectorAll('details.menu[open]').forEach((m) => m !== except && (m.open = false));

/** A question in a dialog: answers true (or the text typed, when `input` is set), or null when it is cancelled. */
function ask({ title, text = '', input, ok = t('OK'), danger = false }) {
  const dialog = $('askDialog');
  $('askTitle').textContent = title;
  $('askText').textContent = text;
  $('askText').hidden = !text;
  $('askInput').hidden = input == null;
  $('askInput').value = input ?? '';
  $('askOk').textContent = ok;
  $('askOk').className = `btn ${danger ? 'danger' : 'primary'}`;
  dialog.returnValue = '';
  dialog.showModal();
  if (input != null) $('askInput').select();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok' ? (input == null ? true : $('askInput').value.trim()) : null), { once: true });
  });
}

// What the person last chose stays chosen: the model, who answers, the shape of a picture, the sidebar.
const prefsKey = () => `video-scripter.chat.${state.user.id}`;
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(prefsKey()) || '{}') || {};
  } catch {
    return {};
  }
}
function savePrefs() {
  try {
    localStorage.setItem(prefsKey(), JSON.stringify({ model: state.model, target: state.target, aspect: state.aspect, seconds: state.seconds, web: state.web, side: document.body.dataset.side }));
  } catch {}
}

// ---------- The model, and who answers ----------

const gatewayOf = (id) => state.meta.gateways.find((g) => g.id === id);
const validModel = (m) => (gatewayOf(m?.gatewayId)?.models.includes(m.model) ? { gatewayId: m.gatewayId, model: m.model } : null);
const mediaModel = (kind) => gatewayOf(state.model?.gatewayId)?.[kind] || null;
const targetReady = (id) => (id === 'image' || id === 'video' ? Boolean(mediaModel(id)) : Boolean(state.model));

function renderModel() {
  const gateway = gatewayOf(state.model?.gatewayId);
  $('modelDot').className = `dot ${!gateway ? '' : gateway.demo ? 'warn' : 'ok'}`;
  $('modelLabel').textContent = !gateway ? t('No model connected') : gateway.demo ? t('Demo mode') : state.model.model;
  $('demoBanner').hidden = !gateway?.demo;
  const made = (kind, label) => {
    const m = mediaModel(kind);
    return el('span', {}, `${t(label)}: ${m ? m.model : t('none set')}`);
  };
  $('modelPanel').replaceChildren(
    ...[
      ...state.meta.gateways.flatMap((g) => [
      el('p', { class: 'menu-label' }, g.name, g.active && el('span', { class: 'badge' }, t('Default'))),
      ...g.models.map((model) => {
        const on = g.id === state.model?.gatewayId && model === state.model?.model;
        return el('button', { class: 'menu-item', type: 'button', role: 'menuitemradio', 'aria-checked': String(on), onclick: () => chooseModel({ gatewayId: g.id, model }) }, el('span', { class: 'menu-text' }, g.demo ? t('Demo (offline, no key)') : model), on && icon('check', 16));
      }),
      ]),
      !state.meta.gateways.length && el('p', { class: 'hint menu-note' }, t('No model is connected yet. An administrator can add one in LLM settings.')),
      el('p', { class: 'hint menu-note media-note' }, made('image', 'Pictures'), made('video', 'Clips')),
    ].filter(Boolean),
  );
}

function chooseModel(model) {
  state.model = model;
  if (!targetReady(state.target)) state.target = 'assistant';
  $('modelMenu').open = false;
  savePrefs();
  renderModel();
  renderTarget();
}

function renderTarget() {
  const target = TARGETS[state.target];
  const media = state.target === 'image' || state.target === 'video';
  $('targetChip').replaceChildren(icon(target.icon, 16), el('span', {}, t(target.name)), icon('chevron', 14));
  $('targetPanel').replaceChildren(
    ...state.meta.targets.map((id) => {
      const ready = targetReady(id);
      const model = id === 'image' || id === 'video' ? mediaModel(id)?.model : state.model?.model;
      return el(
        'button',
        { class: 'menu-item target-item', type: 'button', role: 'menuitemradio', 'aria-checked': String(id === state.target), disabled: !ready, onclick: () => chooseTarget(id) },
        icon(TARGETS[id].icon, 18),
        el('span', { class: 'menu-text' }, el('b', {}, t(TARGETS[id].name), model && ready && el('span', { class: 'hint' }, ` · ${model}`)), el('span', { class: 'hint' }, ready ? t(TARGETS[id].about) : t(id === 'image' ? 'No image model is set. An administrator can add one in LLM settings.' : 'No video model is set. An administrator can add one in LLM settings.'))),
        id === state.target && icon('check', 16),
      );
    }),
  );
  $('prompt').placeholder = t(target.hint);
  $('aspect').hidden = !media;
  $('seconds').hidden = state.target !== 'video';
  $('skillMenu').hidden = media; // a picture is made from its description alone
  $('webToggle').hidden = media;
  renderWebToggle();
  renderSkillChips();
}

/** The Web switch under the box: on, the web is searched for every prompt before it is answered. */
function renderWebToggle() {
  const on = state.web && state.webCan.search;
  $('webToggle').setAttribute('aria-pressed', String(on));
  $('webToggle').classList.toggle('on', on);
}

function toggleWeb() {
  if (!state.webCan.search) return toast(t('Web search is not set up. An administrator can add a Tavily or Firecrawl key under LLM settings, Web search.'));
  state.web = !state.web;
  renderWebToggle();
  savePrefs();
}

function chooseTarget(id) {
  state.target = id;
  $('targetMenu').open = false;
  savePrefs();
  renderTarget();
  $('prompt').focus();
}

// ---------- Skills in the composer ----------

const skillOf = (id) => state.skills.find((s) => s.id === id);

function renderSkillChips() {
  state.skillIds = state.skillIds.filter(skillOf);
  const media = state.target === 'image' || state.target === 'video';
  const picked = media ? [] : state.skillIds.map(skillOf);
  $('skillChips').hidden = !picked.length;
  $('skillChips').replaceChildren(...picked.map((s) => el('span', { class: 'skill-chip' }, icon('book', 14), el('span', {}, skillName(s)), el('button', { type: 'button', 'aria-label': t('Remove {name}', { name: skillName(s) }), title: t('Remove'), onclick: () => toggleSkill(s.id) }, icon('x', 14)))));
  $('skillChipLabel').textContent = state.skillIds.length ? t('Skills · {n}', { n: state.skillIds.length }) : t('Skills');
  $('skillChip').classList.toggle('on', state.skillIds.length > 0);
  const own = state.skills.filter((s) => !s.builtin).length;
  $('skillCount').hidden = !own;
  $('skillCount').textContent = own;
}

function toggleSkill(id) {
  if (state.skillIds.includes(id)) state.skillIds = state.skillIds.filter((x) => x !== id);
  else if (state.skillIds.length >= state.meta.limits.skills) return toast(t('A conversation takes up to {n} skills', { n: state.meta.limits.skills }));
  else state.skillIds = [...state.skillIds, id];
  renderSkillChips();
  renderSkillOptions();
}

function renderSkillOptions() {
  const q = $('skillFilter').value.trim().toLowerCase();
  const shown = state.skills.filter((s) => !q || `${skillName(s)} ${s.name} ${s.description}`.toLowerCase().includes(q));
  const row = (s) =>
    el(
      'label',
      { class: 'skill-option' },
      el('input', { type: 'checkbox', checked: state.skillIds.includes(s.id), onchange: () => toggleSkill(s.id) }),
      el('span', { class: 'menu-text' }, el('b', {}, skillName(s)), s.description && el('span', { class: 'hint' }, s.description)),
    );
  const own = shown.filter((s) => !s.builtin);
  const builtin = shown.filter((s) => s.builtin);
  $('skillOptions').replaceChildren(
    ...(own.length ? [el('p', { class: 'menu-label' }, t('Your skills')), ...own.map(row)] : []),
    ...(builtin.length ? [el('p', { class: 'menu-label' }, t('Built in')), ...builtin.map(row)] : []),
    ...(shown.length ? [] : [el('p', { class: 'hint menu-note' }, state.skills.length ? t('No skill matches.') : t('You have no skills yet.'))]),
  );
}

// ---------- The sidebar ----------

function groupName(ts) {
  const day = (d) => new Date(d).setHours(0, 0, 0, 0);
  const days = Math.round((day(Date.now()) - day(ts)) / 86_400_000);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days <= 7 ? 'Previous 7 days' : days <= 30 ? 'Previous 30 days' : 'Earlier';
}

function renderChats() {
  const list = $('chatList');
  const searching = $('chatSearch').value.trim();
  if (!state.chats.length) return list.replaceChildren(el('p', { class: 'hint side-empty' }, searching ? t('No conversation matches.') : t('Your conversations will be listed here.')));
  const out = [];
  let group = '';
  for (const c of state.chats) {
    const name = groupName(c.ts);
    if (name !== group && !searching) out.push(el('p', { class: 'side-group' }, t((group = name))));
    out.push(
      el(
        'div',
        { class: 'chat-item', 'aria-current': String(c.id === state.chat?.id) },
        el('button', { class: 'chat-open', type: 'button', title: `${c.title}\n${when(c.ts)}`, onclick: () => openChat(c.id) }, el('span', { class: 'chat-name' }, c.title), c.match && el('span', { class: 'chat-match' }, c.match)),
        el('button', { class: 'chat-del', type: 'button', 'aria-label': t('Delete conversation'), title: t('Delete conversation'), onclick: () => removeChat(c) }, icon('trash', 14)),
      ),
    );
  }
  list.replaceChildren(...out);
}

const upsertChat = (summary) => {
  if (!summary) return;
  state.chats = [summary, ...state.chats.filter((c) => c.id !== summary.id)].sort((a, b) => b.ts - a.ts);
  renderChats();
};

async function loadChats() {
  const q = $('chatSearch').value.trim();
  state.chats = (await call(`/api/chats${q ? `?q=${encodeURIComponent(q)}` : ''}`)).items;
  renderChats();
}

function setSide(open) {
  document.body.dataset.side = open ? 'open' : 'closed';
  if (!isMobile()) savePrefs();
}

// ---------- Opening, starting and removing conversations ----------

const blankChat = () => ({ id: null, title: t('New chat'), messages: [] });

function showChat(chat) {
  clearInterval(watchClips.timer);
  state.chat = chat;
  state.editId = null;
  $('editNote').hidden = true;
  closeCanvas(true);
  if (chat.id) {
    state.model = validModel(chat.model) || state.model;
    if (state.meta.targets.includes(chat.target) && targetReady(chat.target)) state.target = chat.target;
    state.skillIds = (chat.skillIds || []).filter(skillOf);
  }
  history.replaceState(null, '', chat.id ? `#${chat.id}` : location.pathname);
  renderModel();
  renderTarget();
  renderThread();
  renderChats();
  syncBusy();
  scrollDown(true);
  watchClips();
  if (isMobile()) setSide(false);
  else $('prompt').focus();
}

function newChat() {
  if (!state.chat?.id && !state.chat?.messages.length) return $('prompt').focus();
  state.skillIds = [];
  showChat(blankChat());
}

async function openChat(id) {
  if (state.chat?.id === id) return isMobile() && setSide(false);
  if (state.busy?.chat.id === id) return showChat(state.busy.chat); // its reply is still being written: show it as it stands
  try {
    showChat((await call(`/api/chats/get?id=${encodeURIComponent(id)}`)).chat);
  } catch (err) {
    toast(err.message);
    history.replaceState(null, '', location.pathname);
    loadChats().catch(() => {});
  }
}

async function removeChat(c) {
  if (!(await ask({ title: t('Delete this conversation?'), text: t('“{title}” and the pictures and clips made in it are deleted for good.', { title: c.title }), ok: t('Delete'), danger: true }))) return;
  try {
    if (state.busy?.chat.id === c.id) state.busy.abort.abort();
    await call('/api/chats/delete', { method: 'POST', body: { id: c.id } });
    state.chats = state.chats.filter((x) => x.id !== c.id);
    if (state.chat?.id === c.id) showChat(blankChat());
    else renderChats();
  } catch (err) {
    toast(err.message);
  }
}

async function renameChat() {
  $('chatMenu').open = false;
  const chat = state.chat;
  if (!chat?.id) return;
  const title = await ask({ title: t('Rename conversation'), input: chat.title, ok: t('Save') });
  if (!title || title === chat.title) return;
  try {
    const { chat: saved } = await call('/api/chats/rename', { method: 'POST', body: { id: chat.id, title } });
    chat.title = saved.title;
    $('chatTitle').textContent = saved.title;
    upsertChat(saved);
  } catch (err) {
    toast(err.message);
  }
}

/** The conversation as one Markdown file: pictures and clips are linked where they were made. */
function chatMarkdown(chat) {
  const out = [`# ${chat.title}`, ''];
  for (const m of chat.messages) {
    out.push(m.role === 'user' ? `## ${t('You')}` : `## ${t(TARGETS[m.target]?.name || 'Assistant')}${m.model ? ` (${m.model})` : ''}`, '', m.role === 'user' ? m.content : withLinks(m), '');
  }
  return out.join('\n');
}

/** A reply's Markdown with each ```image / ```video block that was made replaced by a link to the file. */
function withLinks(m) {
  if (!m.media?.length) return m.content;
  let index = 0;
  return m.content.replace(/^(`{3,})(image|video)[ \t]*\n[\s\S]*?\n\1[ \t]*$/gm, (block) => {
    const item = m.media[index++];
    if (item?.status !== 'done') return block;
    const url = new URL(item.url, location.href).href;
    return item.kind === 'image' ? `![${item.prompt.replace(/[\[\]\n]/g, ' ')}](${url})` : `[${t('Video')}: ${item.prompt.replace(/[\[\]\n]/g, ' ')}](${url})`;
  });
}

// ---------- The thread ----------

const thread = () => $('thread');
const nearBottom = () => thread().scrollHeight - thread().scrollTop - thread().clientHeight < 120;
function scrollDown(force = false) {
  if (force || scrollDown.stuck) thread().scrollTop = thread().scrollHeight;
  $('toBottom').hidden = nearBottom();
}
scrollDown.stuck = true;

function renderThread() {
  const chat = state.chat;
  nodes.clear();
  $('chatTitle').textContent = chat.title;
  document.title = `${chat.id ? chat.title : t('Chat')} · Video Scripter`;
  $('welcome').hidden = chat.messages.length > 0;
  $('messages').replaceChildren(...chat.messages.map(messageNode));
  for (const id of ['renameChat', 'exportChat', 'deleteChat']) $(id).disabled = !chat.id;
}

function messageNode(m) {
  const node = el('article', { class: `msg ${m.role}` });
  nodes.set(m.id, node);
  fill(node, m);
  return node;
}

/** Draw a message again where it stands: called for every piece of a reply as it arrives. */
function paint(m) {
  const node = nodes.get(m.id);
  if (!node) return;
  const stuck = nearBottom();
  fill(node, m);
  if (state.canvas?.id === m.id && state.canvas.mode === 'preview') renderCanvas();
  scrollDown.stuck = stuck;
  scrollDown();
}
const paintSoon = (m) => {
  if (paintSoon.waiting.has(m)) return;
  paintSoon.waiting.add(m);
  requestAnimationFrame(() => (paintSoon.waiting.delete(m), paint(m)));
};
paintSoon.waiting = new Set();

const isLastReply = (m) => state.chat?.messages.at(-1) === m;

function fill(node, m) {
  if (m.role === 'user') {
    const mine = TARGETS[m.target] && m.target !== 'assistant' ? el('span', { class: 'msg-to' }, icon(TARGETS[m.target].icon, 14), t(TARGETS[m.target].name)) : null;
    node.replaceChildren(
      el('div', { class: 'bubble' }, m.content),
      el(
        'div',
        { class: 'msg-actions' },
        mine,
        iconBtn('copy', t('Copy'), { onclick: () => copy(m.content) }),
        !String(m.id).startsWith('local-') && iconBtn('edit', t('Edit and send again'), { onclick: () => startEdit(m), disabled: Boolean(state.busy) }),
      ),
    );
    return;
  }
  const target = TARGETS[m.target] || TARGETS.assistant;
  const who = el('div', { class: 'msg-who' }, el('span', { class: 'msg-avatar' }, icon(target.icon, 14)), el('b', {}, t(target.name)), (m.model || m.media?.[0]?.model) && el('span', { class: 'hint' }, m.model || m.media[0].model));
  const parts = [who];
  if (m.target === 'narrator' && (m.steps?.length || m.pending)) parts.push(stepsNode(m));
  const { thinking, text } = splitThinking(m.content);
  if (thinking) parts.push(el('details', { class: 'think', open: m.pending && !text }, el('summary', {}, t(m.pending && !text ? 'Thinking…' : 'Thought it through')), el('div', { class: 'think-text' }, thinking)));
  if (text) {
    const body = el('div', { class: `md${m.pending ? ' streaming' : ''}` });
    body.append(render(parse(text), mdOptions(m)));
    parts.push(body);
  } else if (m.pending && m.target !== 'narrator') parts.push(el('div', { class: 'typing', 'aria-label': t('Writing…') }, el('i'), el('i'), el('i')));
  if (m.sources) parts.push(sourcesNode(m.sources));
  if (m.pending && m.notice) parts.push(el('p', { class: 'msg-notice' }, el('span', { class: 'spin' }), m.notice));
  if (m.error) parts.push(el('div', { class: 'msg-error', role: 'alert' }, el('p', {}, explain(t(m.error.error), m.error.cause)), isLastReply(m) && el('button', { class: 'btn small', type: 'button', onclick: () => send({ regenerate: true }), disabled: Boolean(state.busy) }, icon('refresh', 14), el('span', {}, t('Try again')))));
  if (m.stopped && !m.error) parts.push(el('p', { class: 'hint msg-stopped' }, t('Stopped.')));
  if (!m.pending) {
    parts.push(
      el(
        'div',
        { class: 'msg-actions' },
        text && iconBtn('copy', t('Copy'), { onclick: () => copy(m.content) }),
        text && el('button', { class: 'msg-btn labelled', type: 'button', title: t('Open in the canvas'), onclick: () => openCanvas(m.id) }, icon('panel', 16), el('span', {}, t('Canvas'))),
        isLastReply(m) && !String(m.id).startsWith('local-') && iconBtn('refresh', t('Answer again'), { onclick: () => send({ regenerate: true }), disabled: Boolean(state.busy) }),
        m.skills?.length && el('span', { class: 'msg-meta', title: t('Skills this reply was written with') }, icon('book', 13), m.skills.map(skillName).join(lang === 'zh' ? '、' : ', ')),
        m.edited && el('span', { class: 'msg-meta' }, t('Edited')),
      ),
    );
  }
  node.replaceChildren(...parts.filter(Boolean));
}

/** A model that reasons aloud wraps that in <think>: it is folded away above the answer. */
function splitThinking(content) {
  const m = /^\s*<think>([\s\S]*?)(?:<\/think>|$)/.exec(content || '');
  return m ? { thinking: m[1].trim(), text: content.slice(m[0].length).trim() } : { thinking: '', text: (content || '').trim() };
}

/** What the narration agent has done so far, step by step. */
function stepsNode(m) {
  const known = new Map((m.steps || []).map((s) => [s.id, s]));
  const live = m.pending ? state.meta.agentSteps.find((id) => known.get(id)?.status !== 'done') : null;
  return el(
    'ol',
    { class: 'steps' },
    state.meta.agentSteps.map((id) => {
      const s = known.get(id);
      const done = s?.status === 'done';
      const about = [id === 'skills' && s?.skills?.length && s.skills.map((x) => x[lang] || x.en).join(lang === 'zh' ? '、' : ', '), id === 'write' && s?.beats && t('{n} beats', { n: s.beats }), id === 'review' && done && (s.errors || s.warns ? t('{errors} to fix, {warns} to look at', { errors: s.errors || 0, warns: s.warns || 0 }) : t('nothing to fix')), id === live && id !== 'skills' && m.trace && t('{n} characters', { n: m.trace.toLocaleString() }), s?.note]
        .filter(Boolean)
        .join(' · ');
      return el('li', { class: `step-row ${done ? 'done' : id === live ? 'live' : ''}` }, el('span', { class: 'step-mark' }, done ? icon('check', 13) : id === live ? el('span', { class: 'spin' }) : null), el('b', {}, t(STEP_NAMES[id] || id)), about && el('span', { class: 'hint' }, about));
    }),
  );
}

// ---------- Pictures and clips in a reply ----------

const mdOptions = (m) => ({ label: t, onImage: viewImage, embed: (asked, index) => mediaNode(m, asked, index), embedOpen: (asked) => (m.pending ? mediaShell(asked.kind, 'running', asked.prompt, t(asked.kind === 'image' ? 'A picture is on its way…' : 'A clip is on its way…')) : null) });

function viewImage(src, alt = '') {
  $('viewerImage').src = src;
  $('viewerImage').alt = alt;
  $('viewer').showModal();
}

/** The frame a picture or a clip sits in while it is not there: being made, failed, or not made yet. */
function mediaShell(kind, status, prompt, note, ...actions) {
  return el(
    'figure',
    { class: `media-card ${status}` },
    el('div', { class: 'media-state' }, status === 'running' ? el('span', { class: 'spin' }) : icon(kind, 20), el('span', {}, note)),
    prompt && el('figcaption', {}, clip(prompt, 220)),
    actions.filter(Boolean).length ? el('div', { class: 'media-actions' }, actions) : null,
  );
}

function mediaNode(m, asked, index) {
  const item = m.media?.[index];
  const again = (label, name = 'refresh') => !m.pending && !String(m.id).startsWith('local-') && el('button', { class: 'btn small', type: 'button', onclick: () => makeMedia(m, index) }, icon(name, 14), el('span', {}, label));
  if (!item) return m.pending ? mediaShell(asked.kind, 'running', asked.prompt, t(asked.kind === 'image' ? 'Drawing the picture…' : 'Starting the clip…')) : null;
  if (item.status === 'done' && item.url) {
    const tools = el('div', { class: 'media-actions' }, el('a', { class: 'btn small', href: item.url, download: fileName(clip(item.prompt, 30), item.url.split('.').pop()) }, icon('download', 14), el('span', {}, t('Download'))), again(t(item.kind === 'image' ? 'Draw again' : 'Make again')));
    const shown = item.kind === 'image' ? el('img', { src: item.url, alt: item.prompt, loading: 'lazy', onclick: () => viewImage(item.url, item.prompt) }) : el('video', { src: item.url, controls: true, playsinline: true, preload: 'metadata' });
    // The frame is the shape that was asked for from the start, so the thread does not jump when the file arrives.
    return el('figure', { class: `media-card done ${item.kind}`, 'data-aspect': item.aspect, style: `--ar: ${String(item.aspect || '9:16').replace(':', ' / ')}` }, shown, el('figcaption', {}, clip(item.prompt, 220)), tools);
  }
  if (item.status === 'running') {
    const note = item.kind === 'image' ? t('Drawing the picture…') : item.checkError ? t('Could not check on the clip: {error}', { error: item.checkError }) : `${t('Making the clip. This takes a few minutes; you can keep working.')}${item.progress ? ` ${Math.round(item.progress)}%` : ''}`;
    return mediaShell(item.kind, item.checkError ? 'failed' : 'running', item.prompt, note, item.checkError && el('button', { class: 'btn small', type: 'button', onclick: () => ((item.checkError = ''), paint(m), watchClips()) }, t('Check again')));
  }
  if (item.status === 'idle') return mediaShell(item.kind, 'idle', item.prompt, t(item.kind === 'image' ? 'This picture has not been made yet.' : 'This clip has not been made yet.'), again(t(item.kind === 'image' ? 'Draw it' : 'Make it'), 'sparkles'));
  return mediaShell(item.kind, 'failed', item.prompt, explain(t(item.error || 'It could not be made'), item.cause), again(t('Try again')));
}

/** Make a picture or a clip of a reply again (or for the first time, for a block written in the canvas). */
async function makeMedia(m, index) {
  const chat = state.chat;
  const before = m.media[index];
  m.media[index] = { ...before, status: 'running', url: '', error: '', jobId: '' };
  paint(m);
  try {
    m.media[index] = (await call('/api/chat/media/make', { method: 'POST', body: { chatId: chat.id, messageId: m.id, index } })).item;
  } catch (err) {
    m.media[index] = { ...before, status: 'failed', error: err.message, cause: null };
  }
  if (state.chat === chat) (paint(m), watchClips());
}

/** Ask how the clips of this conversation are coming on, until none is left in the making. */
function watchClips() {
  clearInterval(watchClips.timer);
  const chat = state.chat;
  const running = () => chat.messages.flatMap((m) => (m.media || []).map((item, index) => ({ m, item, index }))).filter((x) => x.item.kind === 'video' && x.item.status === 'running' && x.item.jobId && !x.item.checkError);
  if (!chat?.id || !running().length) return;
  let checking = false;
  watchClips.timer = setInterval(async () => {
    if (state.chat !== chat) return clearInterval(watchClips.timer);
    if (checking) return;
    checking = true;
    for (const { m, item, index } of running()) {
      try {
        const next = (await call('/api/chat/media/status', { method: 'POST', body: { chatId: chat.id, messageId: m.id, index } })).item;
        const changed = next.status !== item.status || next.progress !== item.progress;
        m.media[index] = next;
        if (changed && state.chat === chat) paint(m);
        if (next.status === 'done') toast(t('Your clip is ready'));
      } catch (err) {
        // A check that fails now and then is the provider's moment; one that keeps failing is shown, with a way to ask again.
        item.misses = (item.misses || 0) + 1;
        if (item.misses >= 5) {
          Object.assign(item, { checkError: err.message.split('\n')[0], misses: 0 });
          if (state.chat === chat) paint(m);
        }
      }
    }
    checking = false;
    if (!running().length) clearInterval(watchClips.timer);
  }, 6000);
}

// ---------- Sending ----------

async function* sse(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (event && data) yield { event, data: JSON.parse(data) };
    }
  }
}

function syncBusy() {
  const busy = Boolean(state.busy);
  $('send').hidden = busy;
  $('stop').hidden = !busy;
  const elsewhere = busy && state.busy.chat !== state.chat;
  $('stop').title = elsewhere ? t('Stop the reply being written in another conversation') : t('Stop');
  $('send').disabled = !$('prompt').value.trim();
}

function retryNotice(info) {
  const seconds = Math.max(1, Math.round((info.waitMs || 0) / 1000));
  return info.resumed ? t('The provider broke off; picking the reply up where it stopped…') : t('The provider is busy; trying again in {n} s (attempt {attempt} of {of})…', { n: seconds, attempt: info.attempt, of: info.of });
}

async function send({ regenerate = false } = {}) {
  if (state.busy) return;
  const input = $('prompt');
  const text = regenerate ? '' : input.value.trim();
  if (!regenerate && !text) return;
  const chat = state.chat;
  const editId = regenerate ? null : state.editId;
  const before = chat.messages.slice();
  if (regenerate) chat.messages.length = chat.messages.findLastIndex((m) => m.role === 'user') + 1;
  else {
    const editAt = editId ? chat.messages.findIndex((m) => m.id === editId) : -1;
    if (editAt >= 0) chat.messages.length = editAt;
    chat.messages.push({ id: `local-${Date.now()}`, role: 'user', content: text, ts: Date.now(), target: state.target });
  }
  const asked = chat.messages.at(-1);
  if (!asked) return void (chat.messages = before);
  const target = regenerate ? (TARGETS[asked.target] ? asked.target : 'assistant') : state.target;
  const media = target === 'image' || target === 'video';
  const reply = { id: `local-reply-${Date.now()}`, role: 'assistant', content: '', ts: Date.now(), target, pending: true, ...(!media && { model: state.model?.model }) };
  chat.messages.push(reply);
  input.value = '';
  cancelEdit();
  if (state.canvas && !chat.messages.some((m) => m.id === state.canvas.id)) closeCanvas(true);
  renderThread();
  scrollDown(true);

  const abort = new AbortController();
  state.busy = { abort, chat, reply };
  syncBusy();
  let saved = false; // the server has the prompt
  let finished = false;
  const onScreen = () => state.chat === chat;
  try {
    const body = { chatId: chat.id || undefined, model: state.model, skillIds: media ? [] : state.skillIds, ...(regenerate ? { regenerate: true } : { text, target, editId: editId || undefined, ...(media ? { aspect: state.aspect, seconds: state.seconds } : { web: (state.web && state.webCan.search) || undefined }) }) };
    const res = await fetch('/api/chat/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: abort.signal });
    if (res.status === 401) return location.replace('app.html?next=chat');
    if (!res.ok) throw fault(await res.json().catch(() => ({})), res.status);
    for await (const { event, data } of sse(res)) {
      if (event === 'chat') {
        saved = true;
        Object.assign(chat, { id: data.chat.id, title: data.chat.title });
        nodes.delete(asked.id);
        nodes.delete(reply.id);
        Object.assign(asked, data.user);
        Object.assign(reply, data.reply);
        upsertChat(data.chat);
        if (onScreen()) {
          history.replaceState(null, '', `#${chat.id}`);
          renderThread();
          scrollDown(true);
        }
      } else if (event === 'delta') {
        reply.content += data.text;
        reply.notice = '';
        if (onScreen()) paintSoon(reply);
      } else if (event === 'trace') {
        reply.trace = (reply.trace || 0) + data.text.length;
        reply.notice = '';
        if (onScreen()) paintSoon(reply);
      } else if (event === 'step') {
        const known = (reply.steps ||= []).find((s) => s.id === data.id);
        if (known) Object.assign(known, data);
        else reply.steps.push(data);
        if (data.status === 'start') reply.trace = 0;
        if (onScreen()) paintSoon(reply);
      } else if (event === 'retry') {
        reply.notice = retryNotice(data);
        if (onScreen()) paintSoon(reply);
      } else if (event === 'web') {
        // The web is being read for the prompt; then what was read, which the reply lists as its sources.
        if (data.status === 'reading') reply.notice = readingNote(data);
        else {
          const { status: _, ...sources } = data;
          Object.assign(reply, { sources, notice: '' });
        }
        if (onScreen()) paintSoon(reply);
      } else if (event === 'media') {
        (reply.media ||= [])[data.index] = data.item;
        if (onScreen()) paintSoon(reply);
      } else if (event === 'error') throw fault(data);
      else if (event === 'done') {
        finished = true;
        for (const key of ['trace', 'notice']) delete reply[key];
        Object.assign(reply, data.message, { pending: false });
        upsertChat(data.chat);
      }
    }
    if (!finished) throw new TypeError('network: the reply ended early');
  } catch (err) {
    if (err.name === 'AbortError') reply.stopped = true; // the server keeps what was written, marked the same way
    else if (!saved) {
      // Nothing was saved: the conversation is as it was, and the prompt goes back in the box.
      chat.messages = before;
      if (!regenerate) input.value = text;
      if (editId) state.editId = editId;
      $('editNote').hidden = !state.editId;
      toast(offline(err) ? explain(err.message, DROPPED) : err.message);
    } else reply.error = { error: offline(err) ? explain(t('The connection dropped before the reply was finished'), DROPPED) : err.message };
  }
  reply.pending = false;
  state.busy = null;
  if (onScreen()) {
    const stuck = nearBottom();
    renderThread();
    scrollDown(stuck);
    autosize();
    watchClips();
    if (state.canvas) renderCanvas();
  }
  syncBusy();
}

function startEdit(m) {
  state.editId = m.id;
  $('editNote').hidden = false;
  $('prompt').value = m.content;
  if (TARGETS[m.target] && targetReady(m.target)) (state.target = m.target), renderTarget();
  autosize();
  syncBusy();
  $('prompt').focus();
}

function cancelEdit() {
  state.editId = null;
  $('editNote').hidden = true;
  autosize();
  syncBusy();
}

function autosize() {
  const area = $('prompt');
  area.style.height = 'auto';
  area.style.height = `${Math.min(area.scrollHeight, 220)}px`;
}

// ---------- The canvas ----------

const canvasMessage = () => state.chat?.messages.find((m) => m.id === state.canvas?.id);

async function openCanvas(id) {
  if (state.canvas?.dirty && state.canvas.id !== id && !(await ask({ title: t('Discard your changes?'), text: t('The changes you made in the canvas have not been saved.'), ok: t('Discard'), danger: true }))) return;
  state.canvas = { id, mode: 'preview', dirty: false };
  if (document.body.dataset.canvas === 'closed') document.body.dataset.canvas = 'open';
  renderCanvas();
  $('canvasBody').scrollTop = 0;
}

async function closeCanvas(silent = false) {
  if (!silent && state.canvas?.dirty && !(await ask({ title: t('Discard your changes?'), text: t('The changes you made in the canvas have not been saved.'), ok: t('Discard'), danger: true }))) return;
  state.canvas = null;
  document.body.dataset.canvas = 'closed';
}

function renderCanvas() {
  const m = canvasMessage();
  if (!m) return closeCanvas(true);
  const { text } = splitThinking(m.content);
  const blocks = parse(text);
  $('canvasTitle').textContent = titleOf(blocks) || state.chat.title;
  const source = state.canvas.mode === 'source' && !m.pending;
  for (const b of $('canvasMode').children) {
    b.setAttribute('aria-selected', String((b.dataset.mode === 'source') === source));
    if (b.dataset.mode === 'source') b.disabled = Boolean(m.pending);
  }
  $('canvasDoc').hidden = source;
  $('canvasSource').hidden = !source;
  if (source) {
    if (!state.canvas.dirty) $('canvasSource').value = m.content;
  } else {
    const doc = $('canvasDoc');
    doc.className = `md doc${m.pending ? ' streaming' : ''}`;
    doc.replaceChildren(render(state.canvas.dirty ? parse($('canvasSource').value) : blocks, mdOptions(m)));
  }
  $('canvasFoot').hidden = !state.canvas.dirty;
}

function setCanvasMode(mode) {
  if (!state.canvas) return;
  state.canvas.mode = mode;
  renderCanvas();
  if (mode === 'source') $('canvasSource').focus();
}

async function saveCanvas() {
  const m = canvasMessage();
  if (!m || !state.canvas.dirty) return;
  $('canvasSave').disabled = true;
  try {
    const { message } = await call('/api/chat/message/update', { method: 'POST', body: { chatId: state.chat.id, messageId: m.id, content: $('canvasSource').value } });
    Object.assign(m, message);
    if (!message.media) delete m.media;
    state.canvas.dirty = false;
    paint(m);
    renderCanvas();
    toast(t('Saved'));
  } catch (err) {
    toast(err.message);
  }
  $('canvasSave').disabled = false;
}

/** The text the canvas shows: what is in the editor when it has unsaved changes, otherwise the reply. */
const canvasText = () => (state.canvas?.dirty ? $('canvasSource').value : canvasMessage()?.content || '');

// ---------- The skills dialog ----------

function renderSkillList() {
  const item = (s) =>
    el('button', { class: 'gw-item', type: 'button', 'aria-current': String(s.id === state.skillEdit), onclick: () => editSkill(s.id) }, el('span', { class: 'gw-name' }, skillName(s)), el('span', { class: 'gw-sub' }, s.builtin ? t('Built in') : s.description || t('No description')), state.skillIds.includes(s.id) && el('span', { class: 'gw-badge' }, t('In use')));
  $('skillList').replaceChildren(...state.skills.map(item));
}

function editSkill(id) {
  const skill = id ? skillOf(id) : null;
  state.skillEdit = skill?.id || null;
  const builtin = Boolean(skill?.builtin);
  $('skillFormTitle').textContent = skill ? skillName(skill) : t('New skill');
  $('skillBuiltin').hidden = !builtin;
  $('skillBuiltin').textContent = builtin ? `${skill.description} ${t('This skill comes with the app. You can use it in a conversation; its playbook is not shown.')}` : '';
  $('skillFields').hidden = builtin;
  $('skillName').value = skill?.name || '';
  $('skillDescription').value = skill?.description || '';
  $('skillBody').value = skill?.body || '';
  $('skillStatus').hidden = true;
  $('saveSkill').hidden = builtin;
  $('deleteSkill').hidden = builtin || !skill;
  $('useSkill').hidden = !skill;
  $('useSkill').textContent = skill && state.skillIds.includes(skill.id) ? t('Remove from this chat') : t('Use in this chat');
  countSkillBody();
  renderSkillList();
}

function countSkillBody() {
  const n = $('skillBody').value.length;
  $('skillBodyCount').textContent = t('{n} of {max} characters', { n: n.toLocaleString(), max: state.meta.limits.skillBody.toLocaleString() });
}

function openSkills(id) {
  closeMenus();
  editSkill(id === undefined ? state.skills.find((s) => !s.builtin)?.id || null : id);
  $('skillsDialog').showModal();
  if (!state.skillEdit) $('skillName').focus();
}

async function saveSkill() {
  const status = $('skillStatus');
  status.hidden = true;
  try {
    const { skill } = await call('/api/skills', { method: 'POST', body: { id: state.skillEdit || undefined, name: $('skillName').value, description: $('skillDescription').value, body: $('skillBody').value } });
    const fresh = !state.skillEdit;
    state.skills = [skill, ...state.skills.filter((s) => s.id !== skill.id)];
    if (fresh && state.skillIds.length < state.meta.limits.skills) state.skillIds = [...state.skillIds, skill.id]; // a skill just written is one to use
    editSkill(skill.id);
    renderSkillChips();
    renderSkillOptions();
    toast(t(fresh ? 'Skill saved and added to this chat' : 'Skill saved'));
  } catch (err) {
    status.textContent = err.message;
    status.hidden = false;
  }
}

async function removeSkill() {
  const skill = skillOf(state.skillEdit);
  if (!skill || !(await ask({ title: t('Delete this skill?'), text: t('“{title}” is deleted for good. Conversations that used it keep their replies.', { title: skill.name }), ok: t('Delete'), danger: true }))) return;
  try {
    await call('/api/skills/delete', { method: 'POST', body: { id: skill.id } });
    state.skills = state.skills.filter((s) => s.id !== skill.id);
    renderSkillChips();
    renderSkillOptions();
    editSkill(state.skills.find((s) => !s.builtin)?.id || null);
  } catch (err) {
    toast(err.message);
  }
}

// ---------- Start ----------

const STARTERS = [
  { target: 'assistant', icon: 'sparkles', title: 'Ten hooks', text: 'Give me ten opening lines for a short video about why most people quit learning to code in week three. One technique per line, and name the technique.' },
  { target: 'narrator', icon: 'bot', title: 'A narration, planned and reviewed', text: '90 秒的视频号视频：为什么企业买了大模型却用不起来' },
  { target: 'image', icon: 'image', title: 'A cover picture', text: 'A clean editorial cover for a video about AI in small business: a shop owner at a counter with a laptop, warm morning light, shallow depth of field, room for a title at the top.' },
  { target: 'assistant', icon: 'script', title: 'Notes into a post', text: 'Turn my notes below into a post of about 300 words, with a headline, three sub-headings and a closing question.\n\nNotes:\n' },
];

function renderStarters() {
  $('starters').replaceChildren(
    ...STARTERS.filter((s) => targetReady(s.target)).map((s) =>
      el(
        'button',
        {
          class: 'starter',
          type: 'button',
          onclick: () => {
            state.target = s.target;
            renderTarget();
            $('prompt').value = t(s.text);
            autosize();
            syncBusy();
            $('prompt').focus();
          },
        },
        icon(s.icon, 18),
        el('b', {}, t(s.title)),
        el('span', { class: 'hint' }, clip(t(s.text), 70)),
      ),
    ),
  );
}

function wire() {
  wireTheme($('themeToggle'));
  wireLang($('langToggle'));
  const name = state.user.name || state.user.email;
  $('userAvatar').textContent = name.trim()[0] || '?';
  $('userName').textContent = name;

  $('webToggle').addEventListener('click', toggleWeb);
  $('aspect').replaceChildren(...state.meta.aspects.map((a) => el('option', { value: a.id }, `${a.id} · ${a.name[lang] || a.name.en}`)));
  $('aspect').value = state.aspect;
  $('seconds').replaceChildren(...state.meta.clipSeconds.map((s) => el('option', { value: s }, t('{n} s', { n: s }))));
  $('seconds').value = state.seconds;
  $('aspect').addEventListener('change', () => ((state.aspect = $('aspect').value), savePrefs()));
  $('seconds').addEventListener('change', () => ((state.seconds = Number($('seconds').value)), savePrefs()));

  // The sidebar
  $('newChat').addEventListener('click', newChat);
  $('headNew').addEventListener('click', newChat);
  $('sideClose').addEventListener('click', () => setSide(false));
  $('sideOpen').addEventListener('click', () => setSide(true));
  $('sideScrim').addEventListener('click', () => setSide(false));
  $('chatSearch').addEventListener('input', () => (clearTimeout(loadChats.timer), (loadChats.timer = setTimeout(() => loadChats().catch((err) => toast(err.message)), 250))));
  $('openSkills').addEventListener('click', () => openSkills());

  // The head of the conversation
  $('renameChat').addEventListener('click', renameChat);
  $('exportChat').addEventListener('click', () => (($('chatMenu').open = false), download(fileName(state.chat.title), chatMarkdown(state.chat))));
  $('deleteChat').addEventListener('click', () => (($('chatMenu').open = false), state.chat.id && removeChat(state.chat)));

  // The composer
  const input = $('prompt');
  input.addEventListener('input', () => {
    autosize();
    syncBusy();
    // "/" at the start asks for a skill: the list opens, filtered by what follows.
    const slash = /^\/(\S*)$/.exec(input.value);
    if (slash && state.target !== 'image' && state.target !== 'video') {
      closeMenus($('skillMenu'));
      $('skillMenu').open = true;
      $('skillMenu').dataset.slash = '1';
      $('skillFilter').value = slash[1];
      renderSkillOptions();
    } else if ($('skillMenu').dataset.slash) {
      delete $('skillMenu').dataset.slash;
      $('skillMenu').open = false;
    }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
    if (isMobile() && !e.metaKey && !e.ctrlKey) return; // on a phone Enter is a new line; the button sends
    e.preventDefault();
    if ($('skillMenu').dataset.slash) {
      // Enter on "/name" takes the first skill that matches.
      const first = $('skillOptions').querySelector('input[type="checkbox"]');
      if (first && !first.checked) first.click();
      delete $('skillMenu').dataset.slash;
      $('skillMenu').open = false;
      input.value = '';
      autosize();
      return syncBusy();
    }
    $('composer').requestSubmit();
  });
  $('composer').addEventListener('submit', (e) => (e.preventDefault(), send()));
  $('stop').addEventListener('click', () => state.busy?.abort.abort());
  $('cancelEdit').addEventListener('click', () => (($('prompt').value = ''), cancelEdit()));
  $('skillMenu').addEventListener('toggle', () => {
    if (!$('skillMenu').open) return;
    if (!$('skillMenu').dataset.slash) ($('skillFilter').value = ''), setTimeout(() => $('skillFilter').focus());
    renderSkillOptions();
  });
  $('skillFilter').addEventListener('input', renderSkillOptions);
  $('manageSkills').addEventListener('click', () => openSkills());
  thread().addEventListener('scroll', () => (($('toBottom').hidden = nearBottom()), (scrollDown.stuck = nearBottom())), { passive: true });
  $('toBottom').addEventListener('click', () => scrollDown(true));

  // The canvas
  $('canvasClose').addEventListener('click', () => closeCanvas());
  $('canvasWide').addEventListener('click', () => (document.body.dataset.canvas = document.body.dataset.canvas === 'wide' ? 'open' : 'wide'));
  for (const b of $('canvasMode').children) b.addEventListener('click', () => setCanvasMode(b.dataset.mode));
  $('canvasSource').addEventListener('input', () => {
    state.canvas.dirty = $('canvasSource').value !== canvasMessage()?.content;
    $('canvasFoot').hidden = !state.canvas.dirty;
  });
  $('canvasSave').addEventListener('click', saveCanvas);
  $('canvasDiscard').addEventListener('click', () => ((state.canvas.dirty = false), renderCanvas()));
  $('canvasCopy').addEventListener('click', () => copy(canvasText()));
  $('canvasDownload').addEventListener('click', () => {
    const m = canvasMessage();
    download(fileName($('canvasTitle').textContent), state.canvas.dirty ? canvasText() : withLinks(m));
  });
  $('canvasPrint').addEventListener('click', () => {
    if (state.canvas.mode === 'source') setCanvasMode('preview');
    print();
  });

  // The skills dialog
  $('closeSkills').addEventListener('click', () => $('skillsDialog').close());
  $('newSkill').addEventListener('click', () => (editSkill(null), $('skillName').focus()));
  $('skillForm').addEventListener('submit', (e) => (e.preventDefault(), saveSkill()));
  $('deleteSkill').addEventListener('click', removeSkill);
  $('useSkill').addEventListener('click', () => (toggleSkill(state.skillEdit), editSkill(state.skillEdit)));
  $('skillBody').addEventListener('input', countSkillBody);

  // Dialogs and menus
  $('askForm').addEventListener('submit', (e) => (e.preventDefault(), $('askDialog').close('ok')));
  $('askCancel').addEventListener('click', () => $('askDialog').close(''));
  $('viewerClose').addEventListener('click', () => $('viewer').close());
  $('viewerImage').addEventListener('click', () => $('viewer').close());
  for (const d of document.querySelectorAll('dialog')) d.addEventListener('click', (e) => e.target === d && d.close());
  for (const m of document.querySelectorAll('details.menu')) m.addEventListener('toggle', () => m.open && closeMenus(m));
  document.addEventListener('click', (e) => document.querySelectorAll('details.menu[open]').forEach((m) => m.contains(e.target) || (m.open = false)));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenus();
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && state.canvas?.dirty) (e.preventDefault(), saveCanvas());
  });
  addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (id && id !== state.chat?.id) openChat(id);
    else if (!id && state.chat?.id) showChat(blankChat());
  });
  addEventListener('beforeunload', (e) => state.canvas?.dirty && e.preventDefault());
}

async function boot() {
  applyI18n();
  hydrateIcons();
  growBox($('skillBody')); // the instructions of a skill fit their text and can be dragged taller; the prompt box sizes itself (autosize)
  const me = await call('/api/auth/me');
  if (!me.user) return location.replace('app.html?next=chat');
  state.user = me.user;
  document.body.dataset.role = me.user.role;
  const [meta, skills, chats] = await Promise.all([call('/api/chat/meta'), call('/api/skills'), call('/api/chats')]);
  state.meta = meta;
  state.skills = skills.items;
  state.chats = chats.items;
  const prefs = loadPrefs();
  state.model = validModel(prefs.model) || validModel(meta.default) || (meta.gateways[0] ? { gatewayId: meta.gateways[0].id, model: meta.gateways[0].models[0] } : null);
  state.aspect = meta.aspects.some((a) => a.id === prefs.aspect) ? prefs.aspect : meta.aspects[0].id;
  state.seconds = meta.clipSeconds.includes(prefs.seconds) ? prefs.seconds : 8;
  state.webCan = await webAbility();
  state.web = Boolean(prefs.web);
  state.target = meta.targets.includes(prefs.target) && targetReady(prefs.target) ? prefs.target : 'assistant';
  document.body.dataset.side = isMobile() || prefs.side === 'closed' ? 'closed' : 'open';
  document.body.dataset.auth = 'in';
  const id = location.hash.slice(1); // read before the blank conversation clears it
  wire();
  renderStarters();
  showChat(blankChat());
  if (id) await openChat(id);
}

boot().catch((err) => {
  document.body.dataset.auth = 'in';
  $('messages').replaceChildren(el('p', { class: 'error' }, t('Could not start: {error}. Is the server running?', { error: err.message })));
});
