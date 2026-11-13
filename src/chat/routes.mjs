// The chat: conversations with the model and the agents, the pictures and clips made in them, and the skills
// people write. server.mjs adds these routes to its own and hands over the helpers they share with the rest.
//
//   GET  /api/chat/meta            what a conversation can be sent to: the models, what can be drawn and filmed
//   GET  /api/chats                the person's conversations (?q= searches titles and messages)
//   GET  /api/chats/get            one conversation in full
//   POST /api/chats/rename         { id, title }
//   POST /api/chats/delete         { id }
//   POST /api/chat/send            a prompt, answered as a stream of events (below)
//   POST /api/chat/message/update  { chatId, messageId, content }: a reply as it was edited in the canvas
//   POST /api/chat/media/make      { chatId, messageId, index }: make a picture or a clip again, or for the first time
//   POST /api/chat/media/status    { chatId, messageId, index }: how a clip is coming on; it is stored once it is ready
//   GET  /api/skills               the person's skills, then the built-in ones
//   POST /api/skills               create a skill (no id) or change one
//   POST /api/skills/delete        { id }
//
// A prompt that links to pages has them read first, and with `web: true` the web is searched for it as well
// (src/web): what was found is given to the model after the prompt, and the reply lists it as its `sources`.
//
// A prompt goes to one of four `target`s:
//   assistant   the model picked for the conversation, with its skills. It can make pictures and clips by
//               writing ```image / ```video blocks, which are made once the reply is whole (src/chat/prompt.mjs)
//   narrator    the narration agent: it plans a viewpoint card, writes the narration and reviews it (src/agent)
//   image       straight to the image model
//   video       straight to the video model
//
// POST /api/chat/send answers with server-sent events:
//   chat     { chat, user, reply }    the conversation, the prompt as it was saved and the id of the reply
//   delta    { text }                 the next piece of the reply
//   step     { id, status, … }        what the agent is doing        trace { text }: what it is writing
//   retry    { … }                    the provider failed and the call is being tried again
//   web      { status, … }            the web is being read for the prompt, then what was read (src/web/routes.mjs)
//   media    { index, item }          a picture or a clip of the reply, made or failed
//   done     { message, chat }        the reply as it was saved (with `error` or `stopped` when it did not finish)
// The reply is saved however the request ends, so the conversation reads the same after a reload.

import { loadStore, activeProfile, enabledModels, mediaTarget, validateConfig } from '../gateway/config.mjs';
import { getProvider } from '../gateway/providers.mjs';
import { streamChat, request, GatewayError } from '../gateway/client.mjs';
import { generateImage, createVideo, videoStatus, videoContent, clipSeconds } from '../gateway/media.mjs';
import { recordUsage, logActivity, estimateTokens } from '../audit.mjs';
import { ASPECTS, DEFAULT_ASPECT } from '../aspects.mjs';
import { buildPlan } from '../prompt.mjs';
import { writeNarration, reviseNarration, AGENT_STEPS } from '../agent/narrator.mjs';
import { SKILLS } from '../agent/skills.mjs';
import { db } from '../db.mjs';
import { parse, embeds } from '../../public/markdown.js';
import { listChats, ownedChat, createChat, changeChat, renameChat, deleteChat, summary, newMessage, titleFrom, saveChatMedia, MAX_PROMPT, MAX_CONTENT, MAX_MESSAGES } from './store.mjs';
import { listSkills, saveSkill, deleteSkill, skillsFor, cleanSkillIds, asPlaybook, MAX_SKILLS_PER_CHAT, MAX_SKILL_BODY } from './skills.mjs';
import { systemPrompt, turnsFor, briefFromPrompt, narrationMarkdown, MAX_EMBEDS } from './prompt.mjs';
import { promptWeb, publicSources, briefWeb } from '../web/routes.mjs';
import { webSummary } from '../web/brief.mjs';

export const TARGETS = ['assistant', 'narrator', 'image', 'video'];
const CLIP_SECONDS = [4, 8, 12];
const REVIEW_SECOND_PASS_MS = 100_000; // as for a narration reviewed on the script page (server.mjs)

const isDemo = (profile) => getProvider(profile.provider)?.protocol === 'mock';
const aspectOf = (id) => ASPECTS.find((a) => a.id === id)?.id || DEFAULT_ASPECT;

/** The gateway and model a conversation is answered with: the one asked for when it is enabled, otherwise the one in use. */
export function textConfig(store, wanted) {
  const profile = store.profiles.find((p) => p.id === wanted?.gatewayId) || activeProfile(store);
  return { ...profile, model: enabledModels(profile).includes(wanted?.model) ? wanted.model : profile.model };
}

/** The gateway that draws or films for a conversation: its own when that can, then the one in use, then any that can. */
export function mediaConfig(store, kind, gatewayId) {
  const order = [store.profiles.find((p) => p.id === gatewayId), activeProfile(store), ...store.profiles].filter(Boolean);
  return order.find((p) => mediaTarget(p, kind).ready) || null;
}

/** What the page is told about the gateways: names and models, never an address or a key. */
function chatMeta(store) {
  const active = activeProfile(store);
  const made = (profile, kind) => (profile && mediaTarget(profile, kind).ready ? { gatewayId: profile.id, gateway: profile.name, model: mediaTarget(profile, kind).model || 'demo' } : null);
  return {
    gateways: store.profiles
      .filter((p) => !validateConfig(p, { requireModel: false }) && enabledModels(p).length)
      .map((p) => ({ id: p.id, name: p.name, demo: isDemo(p), active: p.id === active.id, models: enabledModels(p), image: made(mediaConfig(store, 'image', p.id), 'image'), video: made(mediaConfig(store, 'video', p.id), 'video') })),
    default: { gatewayId: active.id, model: active.model },
    targets: TARGETS,
    agentSteps: AGENT_STEPS,
    aspects: ASPECTS.map(({ id, w, h, name }) => ({ id, w, h, name })),
    clipSeconds: CLIP_SECONDS,
    limits: { prompt: MAX_PROMPT, content: MAX_CONTENT, skills: MAX_SKILLS_PER_CHAT, skillBody: MAX_SKILL_BODY, embeds: MAX_EMBEDS },
  };
}

/** A message as the page gets it: the text the web gave the model stays on the server, its sources are in the reply. */
const publicMessage = ({ web, ...m }) => m;
const publicChat = (chat) => ({ ...summary(chat), messages: chat.messages.map(publicMessage) });

/** A fenced block that asks for a picture or a clip, as the assistant would write it. The fence is longer than any in the description. */
function embedBlock({ kind, prompt, aspect, seconds }) {
  const fence = '`'.repeat(Math.max(3, ...(prompt.match(/`+/g) || []).map((run) => run.length + 1)));
  return [`${fence}${kind}`, `aspect: ${aspect}`, ...(kind === 'video' ? [`seconds: ${seconds}`] : []), '', prompt, fence].join('\n');
}

/** The stored files of pictures and clips that are no longer part of a conversation. */
async function dropFiles(items) {
  for (const item of items) {
    const name = /^\/media\/(chat-[\w-]+\.\w+)$/.exec(item?.url || '')?.[1];
    if (name) await db.delBlobs(name).catch(() => {});
  }
}

export function chatRoutes({ route, json, readJson, eventStream, fail, failure, tokens }) {
  /** What went wrong with a picture or a clip, in the words the page shows: { error, cause }. */
  const mediaFailure = (req, err, seconds) => failure(req, err, err.name === 'TimeoutError' ? `Timed out after ${seconds}s` : err.message);

  /**
   * Make one picture, or start one clip, for a conversation. Returns the item as the reply keeps it: a picture
   * is `done` with its `url`; a clip is `running` with the `jobId` the page then asks about; either is `failed`
   * with an `error` when it could not be made. Never throws, except when the request was stopped.
   */
  async function makeMedia(req, { user, store, chat, gatewayId, asked, signal }) {
    const item = { kind: asked.kind, prompt: asked.prompt, aspect: aspectOf(asked.aspect), ...(asked.kind === 'video' && { seconds: clipSeconds(Number(asked.seconds) || 8) }), status: 'running' };
    const config = mediaConfig(store, item.kind, gatewayId);
    const target = config && mediaTarget(config, item.kind);
    const limit = item.kind === 'image' ? 180 : 60;
    const usage = { user, taskId: chat.id, kind: item.kind, config, model: target?.model || 'demo' };
    const started = Date.now();
    try {
      if (!item.prompt) throw fail('There is no description to make it from');
      if (!config) throw new GatewayError(`No ${item.kind} model is set. An administrator can add one under "Images and videos" in LLM settings.`, 400);
      const within = signal ? AbortSignal.any([signal, AbortSignal.timeout(limit * 1000)]) : AbortSignal.timeout(limit * 1000);
      if (item.kind === 'image') {
        const made = await generateImage(config, { prompt: item.prompt, aspectRatio: item.aspect, signal: within });
        await recordUsage({ ...usage, images: 1, inputTokens: made.usage?.inputTokens ?? estimateTokens(item.prompt), outputTokens: made.usage?.outputTokens, estimated: !made.usage, ms: Date.now() - started });
        // A picture the provider hosts is fetched and kept here, so it is still there when the provider's link has run out.
        const source = /^https?:/.test(made.url) ? await request(made.url, { signal: AbortSignal.timeout(300_000) }) : made.url;
        const saved = await saveChatMedia({ chatId: chat.id, userId: user.id, kind: 'image', source, demo: target.demo });
        if (!saved) throw new GatewayError('The provider returned a file that cannot be kept', 502);
        return { ...item, status: 'done', url: saved.url, model: usage.model };
      }
      const job = await createVideo(config, { prompt: item.prompt, seconds: item.seconds, aspectRatio: item.aspect, signal: within });
      await recordUsage({ ...usage, videoSeconds: item.seconds, inputTokens: estimateTokens(item.prompt), estimated: true, ms: Date.now() - started });
      if (job.status === 'failed') return { ...item, status: 'failed', error: job.error || 'The provider could not make the clip', model: usage.model };
      return { ...item, status: 'running', jobId: job.id, gatewayId: config.id, model: usage.model };
    } catch (err) {
      if (err.name === 'AbortError' && signal?.aborted) throw err;
      if (config) await recordUsage({ ...usage, ok: false, error: err.message, ms: Date.now() - started });
      return { ...item, status: 'failed', ...mediaFailure(req, err, limit) };
    }
  }

  /** The pictures and clips a finished reply asks for, each made (a picture) or started (a clip); `send` hears of each. */
  async function makeEmbeds(req, { user, store, chat, gatewayId, content, signal, send }) {
    const counts = { image: 0, video: 0 };
    return Promise.all(
      embeds(parse(content)).map(async (asked, index) => {
        const over = ++counts[asked.kind] > MAX_EMBEDS[asked.kind];
        const item = over ? { kind: asked.kind, prompt: asked.prompt, aspect: aspectOf(asked.aspect), status: 'failed', error: `Only ${MAX_EMBEDS[asked.kind]} ${asked.kind === 'image' ? 'pictures are' : 'clip is'} made for one reply` } : await makeMedia(req, { user, store, chat, gatewayId, asked, signal });
        send?.('media', { index, item });
        return item;
      }),
    );
  }

  /** The assistant: the model answers the conversation, and what its reply asks to be drawn or filmed is made. */
  async function converse(req, { user, store, config, chat, reply, skills, send, signal }) {
    const tools = { image: Boolean(mediaConfig(store, 'image', config.id)), video: Boolean(mediaConfig(store, 'video', config.id)) };
    const system = systemPrompt({ skills, tools });
    const { history, user: prompt } = turnsFor(chat.messages);
    const sent = { system, user: [...history.map((turn) => turn.content), prompt].join('\n') };
    const started = Date.now();
    let usage = null;
    const record = (extra) => recordUsage({ user, taskId: chat.id, kind: 'chat', config, ...tokens(usage, sent, reply.content), ms: Date.now() - started, ...extra });
    try {
      for await (const text of streamChat(config, { system, user: prompt, history, signal, json: false, meta: { kind: 'chat', prompt, tools }, onUsage: (u) => (usage = u), onRetry: (info) => send('retry', info) })) {
        reply.content += text;
        send('delta', { text });
      }
      if (!reply.content.trim()) throw new GatewayError('The model answered with an empty reply', 502);
      await record({});
    } catch (err) {
      await record({ ok: false, error: err.name === 'AbortError' ? 'Stopped by the user' : err.message });
      throw err;
    }
    const made = await makeEmbeds(req, { user, store, chat, gatewayId: config.id, content: reply.content, signal, send });
    if (made.length) reply.media = made;
  }

  /** A prompt sent straight to the image or the video model: the reply is the picture or the clip. */
  async function direct(req, { user, store, config, chat, reply, asked, send, signal }) {
    reply.content = embedBlock(asked);
    send('delta', { text: reply.content });
    const item = await makeMedia(req, { user, store, chat, gatewayId: config.id, asked, signal });
    reply.media = [item];
    send('media', { index: 0, item });
  }

  /**
   * The narration agent: it plans and writes, then reviews. The skills picked for the conversation are added to
   * the playbooks its brief calls for. A review that cannot finish (out of time, a failing provider) leaves the
   * draft, which says so.
   */
  async function narrate(req, { user, config, chat, reply, skills, prompt, search, send, signal }) {
    const brief = briefFromPrompt(prompt);
    buildPlan(brief); // a prompt that is no brief fails here, before the web is asked
    const web = await briefWeb(req, user, { ...brief, reference: prompt, webSearch: search }, { signal, send });
    const plan = buildPlan({ ...brief, ...(web && { web }) });
    if (web) reply.sources = webSummary(web);
    for (const s of skills) {
      const playbook = s.builtin ? SKILLS.find((x) => `builtin:${x.id}` === s.id) : asPlaybook(s);
      if (playbook && !plan.skills.some((x) => x.id === playbook.id)) plan.skills.push(playbook);
    }
    reply.steps = [];
    const emit = (event, data) => {
      if (event === 'delta') return send('trace', { text: data.text });
      if (event !== 'step') return send(event, data);
      const { card: _card, skills: used, ...step } = data; // the card is in the reply itself
      if (used) step.skills = used.map((s) => s.title);
      const known = reply.steps.find((s) => s.id === step.id);
      if (known) Object.assign(known, step);
      else reply.steps.push(step);
      send('step', step);
    };
    const onCall = ({ prompts, raw, usage, ms, ok, error }) => recordUsage({ user, taskId: chat.id, kind: 'narration', config, ...tokens(usage, prompts, raw), ms, ...(!ok && { ok: false, error }) });
    const written = await writeNarration({ config, plan, signal, emit, onCall });
    let result = written;
    let reviewed = false;
    let stopped = null;
    try {
      const revised = await reviseNarration({ config, plan, beats: written.beats, card: written.card, signal, emit, onCall, until: Date.now() + REVIEW_SECOND_PASS_MS });
      result = { ...written, beats: revised.beats, report: revised.report };
      reviewed = revised.report.reviewed;
    } catch (err) {
      if (err.name === 'AbortError') stopped = err;
      else emit('step', { id: 'review', status: 'note', note: err.name === 'TimeoutError' ? 'The review ran out of time; the draft is kept.' : `The review failed (${err.message}); the draft is kept.` });
    }
    reply.content = narrationMarkdown(result, plan, { reviewed });
    send('delta', { text: reply.content });
    if (stopped) throw stopped;
  }

  return {
    'GET /api/chat/meta': route('user', async (req, res) => {
      json(res, 200, chatMeta(await loadStore()));
    }),

    'GET /api/chats': route('user', async (req, res, user, query) => {
      json(res, 200, { items: await listChats(user.id, { q: query.get('q') || '' }) });
    }),

    'GET /api/chats/get': route('user', async (req, res, user, query) => {
      json(res, 200, { chat: publicChat(await ownedChat(user.id, query.get('id'))) });
    }),

    'POST /api/chats/rename': route('user', async (req, res, user) => {
      const { id, title } = await readJson(req);
      json(res, 200, { chat: summary(await renameChat(user.id, id, title)) });
    }),

    'POST /api/chats/delete': route('user', async (req, res, user) => {
      const chat = await deleteChat(user.id, (await readJson(req)).id);
      await logActivity(req, user, 'chat.delete', { title: chat.title });
      json(res, 200, { ok: true });
    }),

    'POST /api/chat/send': route('user', async (req, res, user) => {
      const body = await readJson(req);
      const regenerate = Boolean(body.regenerate);
      const text = regenerate ? '' : String(body.text ?? '').trim();
      if (!regenerate && !text) throw fail('Write a prompt first');
      const existing = body.chatId ? await ownedChat(user.id, body.chatId) : null;
      // A prompt that is answered again goes where it went the first time, in the shape it asked for.
      const again = regenerate ? existing?.messages.findLast((m) => m.role === 'user') : null;
      if (regenerate && !again) throw fail('There is no prompt to answer again');
      const target = TARGETS.includes(body.target) ? body.target : TARGETS.includes(again?.target) ? again.target : 'assistant';
      if (text.length > MAX_PROMPT) throw fail(`A prompt can be ${MAX_PROMPT.toLocaleString('en-US')} characters long; this one has ${text.length.toLocaleString('en-US')}`);
      const store = await loadStore();
      const config = textConfig(store, body.model);
      if (target === 'assistant' || target === 'narrator') {
        const invalid = validateConfig(config);
        if (invalid) return json(res, 400, { error: `LLM gateway is not configured: ${invalid}` });
      }
      const skillIds = cleanSkillIds(body.skillIds);
      const skills = await skillsFor(user.id, skillIds);
      const model = { gatewayId: config.id, model: config.model };
      const media = target === 'image' || target === 'video';
      const options = media ? { aspect: aspectOf(body.aspect || again?.aspect), ...(target === 'video' && { seconds: clipSeconds(Number(body.seconds || again?.seconds) || 8) }) } : {};

      // The prompt is saved before anything is asked, so it is there whatever becomes of the reply.
      const opened = existing || (await createChat({ userId: user.id, title: titleFrom(text), target, model, skillIds }));
      const gone = [];
      let chat;
      try {
        chat = await changeChat(user.id, opened.id, (c) => {
          const cut = (at) => gone.push(...c.messages.splice(at).flatMap((m) => m.media || []));
          if (regenerate) {
            // Answer the last prompt again: the reply it had goes.
            cut(c.messages.findLastIndex((m) => m.role === 'user') + 1);
          } else {
            if (body.editId) {
              // A prompt that was edited replaces itself and everything after it.
              const at = c.messages.findIndex((m) => m.id === body.editId && m.role === 'user');
              if (at < 0) throw fail('That message is no longer in the conversation', 404);
              cut(at);
            }
            if (c.messages.length >= MAX_MESSAGES) throw fail(`A conversation holds ${MAX_MESSAGES} messages. Start a new one.`);
            c.messages.push(newMessage('user', text, { target, ...options }));
            if (c.messages.length === 1 && !c.renamed) c.title = titleFrom(text) || c.title;
          }
          Object.assign(c, { target, model, skillIds });
        });
      } catch (err) {
        if (!existing) await deleteChat(user.id, opened.id).catch(() => {});
        throw err;
      }
      await dropFiles(gone);

      const asked = chat.messages.at(-1);
      const reply = newMessage('assistant', '', { target, ...(!media && { model: config.model, gateway: config.name, ...(skills.length && { skills: skills.map((s) => ({ id: s.id, name: s.name, ...(s.title && { title: s.title }) })) }) }) });
      const { send, signal } = eventStream(req, res);
      send('chat', { chat: summary(chat), user: publicMessage(asked), reply: { id: reply.id, target, model: reply.model, gateway: reply.gateway, skills: reply.skills } });
      const started = Date.now();
      try {
        const run = { user, store, config, chat, reply, skills, send, signal };
        if (media) await direct(req, { ...run, asked: { kind: target, prompt: asked.content, ...options } });
        else if (target === 'narrator') await narrate(req, { ...run, prompt: asked.content, search: body.web === true });
        else {
          // The pages the prompt links to are read, and the web searched when asked, before the model answers.
          // What was read stays with the prompt, so a later turn, or the same prompt answered again, still has it.
          if (!regenerate) {
            const web = await promptWeb(req, user, asked.content, { search: body.web === true, signal, send, title: chat.title });
            if (web) {
              asked.web = web;
              await changeChat(user.id, chat.id, (c) => void Object.assign(c.messages.find((m) => m.id === asked.id) || {}, { web }), { touch: false }).catch(() => {});
            }
          }
          if (asked.web) reply.sources = publicSources(asked.web);
          await converse(req, run);
        }
      } catch (err) {
        if (err.name === 'AbortError') reply.stopped = true;
        else reply.error = err.unreadable ? failure(req, err, 'The agent could not read the model\'s reply') : failure(req, err);
      }
      reply.ms = Date.now() - started;
      let saved = null;
      try {
        saved = await changeChat(user.id, chat.id, (c) => void c.messages.push(reply));
      } catch {
        await dropFiles(reply.media || []); // the conversation was deleted while it was being answered
      }
      await logActivity(req, user, reply.error ? 'chat.failed' : 'chat.send', { title: chat.title, to: target, model: media ? reply.media?.[0]?.model : config.model, ...(reply.error && { error: reply.error.error.slice(0, 200) }) });
      send('done', { message: reply, chat: saved ? summary(saved) : null });
      res.end();
    }),

    // A reply as the canvas saved it. The pictures and clips it had stay with the blocks that asked for them;
    // a block that is new has nothing yet (the page offers to make it), and what a removed block made is deleted.
    'POST /api/chat/message/update': route('user', async (req, res, user) => {
      const { chatId, messageId, content } = await readJson(req);
      const text = String(content ?? '').replace(/\r\n?/g, '\n');
      if (!text.trim()) throw fail('A reply cannot be empty');
      if (text.length > MAX_CONTENT) throw fail(`A reply can be ${MAX_CONTENT.toLocaleString('en-US')} characters long`);
      const gone = [];
      let message;
      await changeChat(
        user.id,
        chatId,
        (c) => {
          message = c.messages.find((m) => m.id === messageId && m.role === 'assistant');
          if (!message) throw fail('That reply is no longer in the conversation', 404);
          const had = embeds(parse(message.content)).map((asked, i) => ({ asked, item: message.media?.[i] }));
          const media = embeds(parse(text)).map((asked) => {
            const at = had.findIndex((h) => h.item && h.asked.kind === asked.kind && h.asked.prompt === asked.prompt);
            return at >= 0 ? had.splice(at, 1)[0].item : { kind: asked.kind, prompt: asked.prompt, aspect: aspectOf(asked.aspect), ...(asked.kind === 'video' && { seconds: clipSeconds(Number(asked.seconds) || 8) }), status: 'idle' };
          });
          gone.push(...had.map((h) => h.item).filter(Boolean));
          Object.assign(message, { content: text, edited: Date.now() });
          if (media.length) message.media = media;
          else delete message.media;
        },
        { touch: false },
      );
      await dropFiles(gone);
      json(res, 200, { message });
    }),

    // Make a picture or a clip of a reply: one that failed, or one whose block was written in the canvas.
    'POST /api/chat/media/make': route('user', async (req, res, user) => {
      const { chatId, messageId, index } = await readJson(req);
      const chat = await ownedChat(user.id, chatId);
      const message = chat.messages.find((m) => m.id === messageId);
      const asked = message && embeds(parse(message.content))[Number(index)];
      const had = message?.media?.[Number(index)];
      if (!asked || !had) throw fail('That block is no longer in the conversation', 404);
      if (had.status === 'running') return json(res, 200, { item: had });
      const item = await makeMedia(req, { user, store: await loadStore(), chat, gatewayId: chat.model?.gatewayId, asked });
      await changeChat(user.id, chat.id, (c) => void (c.messages.find((m) => m.id === messageId).media[Number(index)] = item), { touch: false });
      if (had.url && had.url !== item.url) await dropFiles([had]);
      json(res, 200, { item });
    }),

    // A clip takes minutes: the page asks here until it is ready, and the file is then stored with the conversation.
    'POST /api/chat/media/status': route('user', async (req, res, user) => {
      const { chatId, messageId, index } = await readJson(req);
      const chat = await ownedChat(user.id, chatId);
      const item = chat.messages.find((m) => m.id === messageId)?.media?.[Number(index)];
      if (!item) throw fail('That clip is no longer in the conversation', 404);
      if (item.kind !== 'video' || item.status !== 'running' || !item.jobId) return json(res, 200, { item });
      const store = await loadStore();
      const config = store.profiles.find((p) => p.id === item.gatewayId) || mediaConfig(store, 'video');
      let patch;
      try {
        if (!config) throw new GatewayError('The gateway this clip was started on is no longer set up', 400);
        const job = await videoStatus(config, item.jobId, { signal: AbortSignal.timeout(30_000) });
        if (job.status === 'running') return json(res, 200, { item: { ...item, progress: job.progress } });
        if (job.status === 'failed') patch = { status: 'failed', error: job.error || 'The provider could not make the clip' };
        else {
          const source = job.url ? await request(job.url, { signal: AbortSignal.timeout(300_000) }) : await videoContent(config, job.id, { signal: AbortSignal.timeout(300_000) });
          const saved = await saveChatMedia({ chatId: chat.id, userId: user.id, kind: 'video', source });
          patch = saved ? { status: 'done', url: saved.url } : { status: 'failed', error: 'The provider returned a file that cannot be kept' };
        }
      } catch (err) {
        // The job is gone, or cannot be asked about at all: the clip has failed. Anything else is the provider's moment, and the page asks again.
        if (!(err.upstream && [400, 401, 403, 404, 410].includes(err.status)) && config) return json(res, 502, mediaFailure(req, err, 30));
        patch = { status: 'failed', ...mediaFailure(req, err, 30) };
      }
      const next = await changeChat(user.id, chat.id, (c) => void Object.assign(c.messages.find((m) => m.id === messageId).media[Number(index)], patch), { touch: false });
      json(res, 200, { item: next.messages.find((m) => m.id === messageId).media[Number(index)] });
    }),

    // ---------- Skills ----------

    'GET /api/skills': route('user', async (req, res, user) => {
      json(res, 200, { items: await listSkills(user.id) });
    }),

    'POST /api/skills': route('user', async (req, res, user) => {
      const body = await readJson(req);
      const skill = await saveSkill(user.id, body);
      await logActivity(req, user, body.id ? 'skill.update' : 'skill.create', { title: skill.name });
      json(res, 200, { skill });
    }),

    'POST /api/skills/delete': route('user', async (req, res, user) => {
      const skill = await deleteSkill(user.id, (await readJson(req)).id);
      await logActivity(req, user, 'skill.delete', { title: skill.name });
      json(res, 200, { ok: true });
    }),
  };
}
