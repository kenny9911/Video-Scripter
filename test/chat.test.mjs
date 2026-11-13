// The chat through its real HTTP API, in demo mode: conversations, who may open them, the pictures made in
// them, the canvas's edits, skills, and the narration agent asked from a conversation. Then the pieces a
// conversation is built from: its turns, its prompt, and a model that is sent them.
import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { completeChat } from '../src/gateway/client.mjs';
import { systemPrompt, turnsFor, briefFromPrompt } from '../src/chat/prompt.mjs';
import { titleFrom } from '../src/chat/store.mjs';
import { readSkillFile, cleanSkill } from '../src/chat/skills.mjs';
import { textConfig, mediaConfig } from '../src/chat/routes.mjs';

const PORT = 4000 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${PORT}`;
const ADMIN = { email: 'boss@example.test', password: 'correct-horse-battery' };

/** A browser-like client: remembers the session cookie between calls. */
function client() {
  let cookie = '';
  const raw = async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { ...(body && { 'content-type': 'application/json' }), ...(cookie && { cookie }) }, body: body && JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return res;
  };
  const call = async (method, url, body) => {
    const res = await raw(method, url, body);
    return { status: res.status, body: await res.json() };
  };
  /** A prompt, answered with server-sent events: [{ event, data }], and the `done` data as `.done`. */
  const send = async (body) => {
    const text = await (await raw('POST', '/api/chat/send', body)).text();
    const events = text.split('\n\n').filter(Boolean).map((block) => ({ event: /^event: (.*)$/m.exec(block)?.[1], data: JSON.parse(/^data: (.*)$/m.exec(block)?.[1] || 'null') }));
    return Object.assign(events, { done: events.find((e) => e.event === 'done')?.data, names: [...new Set(events.map((e) => e.event))] });
  };
  return { raw, call, send };
}

test('conversations, their pictures, the canvas, skills and the narration agent', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scripter-chat-'));
  const env = { ...process.env, PORT: String(PORT), DATA_DIR: dir, GATEWAY_CONFIG_FILE: path.join(dir, 'none.json'), DATABASE_URL: '', POSTGRES_URL: '', LLM_PROVIDER: '', API_KEY: '', LLM_API_KEY: '', IMAGE_BASE_URL_API: '', VIDEO_BASE_URL_API: '', ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, ALLOW_SIGNUP: '' };
  const child = spawn(process.execPath, ['server.mjs'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(async () => {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise((resolve) => child.stdout.once('data', resolve));

  // ---------- Signed out ----------
  const anon = client();
  for (const [method, url] of [['GET', '/api/chat/meta'], ['GET', '/api/chats'], ['POST', '/api/chat/send'], ['GET', '/api/skills'], ['POST', '/api/skills']]) {
    assert.equal((await anon.call(method, url, method === 'POST' ? {} : undefined)).status, 401, url);
  }
  assert.equal((await anon.raw('GET', '/chat.html')).status, 200); // the page itself is public; it sends a visitor to sign in

  const admin = client();
  await admin.call('POST', '/api/auth/login', ADMIN);
  const other = client();
  assert.equal((await other.call('POST', '/api/auth/signup', { email: 'ann@example.test', password: 'another-long-password', name: 'Ann' })).status, 200);

  // ---------- What a conversation can be sent to ----------
  let r = await other.call('GET', '/api/chat/meta'); // a member sees the models by name, and nothing of where they live
  assert.deepEqual([r.status, r.body.gateways.map((g) => [g.models, g.demo, g.image?.model, g.video]), r.body.default.model, r.body.targets], [200, [[['demo'], true, 'demo', null]], 'demo', ['assistant', 'narrator', 'image', 'video']]);
  assert.ok(!/baseUrl|apiKey|keyPreview/.test(JSON.stringify(r.body)));

  // ---------- A prompt, answered ----------
  assert.equal((await admin.call('POST', '/api/chat/send', { text: '   ' })).status, 400);
  assert.equal((await admin.call('POST', '/api/chat/send', { text: 'x'.repeat(24_001) })).status, 400);
  assert.equal((await admin.call('GET', '/api/chats')).body.items.length, 0); // a prompt that was refused leaves no conversation behind

  let events = await admin.send({ text: '# Please **draw** a picture of a red fox\nand say why' });
  assert.deepEqual(events.names, ['chat', 'delta', 'media', 'done']);
  const opened = events[0].data;
  assert.deepEqual([opened.chat.title, opened.user.role, opened.user.content.slice(0, 8), opened.reply.model], ['Please draw a picture of a red fox', 'user', '# Please', 'demo']);
  let { message, chat } = events.done;
  const chatId = chat.id;
  assert.equal(events.filter((e) => e.event === 'delta').map((e) => e.data.text).join(''), message.content); // what was streamed is what was saved
  assert.deepEqual([message.id, message.role, message.target, message.gateway, chat.count], [opened.reply.id, 'assistant', 'assistant', 'Demo (offline, no key)', 2]);
  assert.deepEqual([message.media.length, message.media[0].kind, message.media[0].status, message.media[0].aspect, /^Demo picture for/.test(message.media[0].prompt)], [1, 'image', 'done', '16:9', true]);
  const picture = message.media[0].url;
  assert.match(picture, new RegExp(`^/media/chat-${chatId}-image-\\w+\\.svg$`));

  // The picture is its owner's alone, and so is the conversation: not another member's, and not a visitor's.
  r = await admin.raw('GET', picture);
  assert.deepEqual([r.status, r.headers.get('content-type')], [200, 'image/svg+xml']);
  assert.equal((await other.raw('GET', picture)).status, 404);
  assert.equal((await anon.raw('GET', picture)).status, 401);
  assert.equal((await other.call('GET', `/api/chats/get?id=${chatId}`)).status, 404);
  assert.equal((await other.call('POST', '/api/chat/send', { chatId, text: 'let me in' })).status, 404);
  assert.equal((await other.call('POST', '/api/chats/delete', { id: chatId })).status, 404);
  assert.equal((await other.call('GET', '/api/chats')).body.items.length, 0);

  // ---------- The next turn, the history, search and a new title ----------
  events = await admin.send({ chatId, text: 'What is a lighthouse for?' });
  assert.deepEqual([events.done.chat.count, events.done.message.media], [4, undefined]); // no picture was asked for, so none was made
  r = await admin.call('GET', `/api/chats/get?id=${chatId}`);
  assert.deepEqual([r.body.chat.messages.map((m) => m.role), r.body.chat.model, r.body.chat.userId], [['user', 'assistant', 'user', 'assistant'], { gatewayId: 'default', model: 'demo' }, undefined]);
  await admin.send({ text: 'A second conversation, about tides' });
  r = await admin.call('GET', '/api/chats');
  assert.deepEqual([r.body.items.map((c) => c.title), r.body.items.some((c) => 'messages' in c)], [['A second conversation, about tides', 'Please draw a picture of a red fox'], false]);
  r = await admin.call('GET', '/api/chats?q=LIGHTHOUSE');
  assert.deepEqual([r.body.items.map((c) => c.id), /lighthouse/i.test(r.body.items[0].match)], [[chatId], true]);
  assert.equal((await admin.call('POST', '/api/chats/rename', { id: chatId, title: '   ' })).status, 400);
  assert.equal((await admin.call('POST', '/api/chats/rename', { id: chatId, title: '  Foxes and   lighthouses ' })).body.chat.title, 'Foxes and lighthouses');

  // ---------- Answer again, and edit a prompt ----------
  events = await admin.send({ chatId, regenerate: true });
  assert.deepEqual([events.done.chat.count, events[0].data.user.content, events.done.message.id === r.body.items[0].id], [4, 'What is a lighthouse for?', false]);
  const firstPrompt = (await admin.call('GET', `/api/chats/get?id=${chatId}`)).body.chat.messages[0];
  events = await admin.send({ chatId, editId: firstPrompt.id, text: 'Now only this' });
  assert.deepEqual([events.done.chat.count, events.done.chat.title, events[0].data.user.content], [2, 'Foxes and lighthouses', 'Now only this']); // a title someone gave stays
  assert.equal((await admin.raw('GET', picture)).status, 404); // the picture of the reply that went is deleted with it
  assert.equal((await admin.call('POST', '/api/chat/send', { chatId, editId: 'nope', text: 'x' })).status, 404);

  // ---------- Straight to the image model, and to a video model that is not there ----------
  events = await admin.send({ chatId, target: 'image', text: 'a lighthouse ``` at dusk', aspect: '1:1' });
  message = events.done.message;
  assert.deepEqual([message.target, message.model, message.media.map((m) => [m.kind, m.status, m.aspect, m.prompt])], ['image', undefined, [['image', 'done', '1:1', 'a lighthouse ``` at dusk']]]);
  assert.match(message.content, /^````image\naspect: 1:1\n\na lighthouse ``` at dusk\n````$/); // the fence is longer than the one in the prompt
  events = await admin.send({ chatId, target: 'video', text: 'waves', seconds: 12 });
  message = events.done.message;
  assert.deepEqual([message.error, message.media[0].status, message.media[0].seconds, message.media[0].cause?.side, /No video model is set/.test(message.media[0].error)], [undefined, 'failed', 12, 'settings', true]);
  r = await admin.call('POST', '/api/chat/media/status', { chatId, messageId: message.id, index: 0 });
  assert.equal(r.body.item.status, 'failed'); // nothing to ask about: it is told as it stands
  events = await admin.send({ chatId, regenerate: true }); // answered again, it goes where it went the first time
  assert.deepEqual([events.done.message.target, events.done.message.media[0].seconds], ['video', 12]);

  // ---------- The canvas saves a reply ----------
  events = await admin.send({ text: 'draw an image of the sea' });
  const canvasChat = events.done.chat.id;
  const reply = events.done.message;
  const kept = reply.media[0];
  r = await admin.call('POST', '/api/chat/message/update', { chatId: canvasChat, messageId: reply.id, content: `# Edited\n\n${'```'}image\nA new block\n${'```'}\n\n${reply.content.slice(reply.content.indexOf('```image'))}` });
  assert.deepEqual([r.status, r.body.message.content.startsWith('# Edited'), typeof r.body.message.edited, r.body.message.media.map((m) => [m.status, m.url || ''])], [200, true, 'number', [['idle', ''], ['done', kept.url]]]); // the picture stays with its block; the new block has none yet
  r = await admin.call('POST', '/api/chat/media/make', { chatId: canvasChat, messageId: reply.id, index: 0 });
  assert.deepEqual([r.body.item.status, r.body.item.prompt, r.body.item.url !== kept.url], ['done', 'A new block', true]);
  r = await admin.call('POST', '/api/chat/message/update', { chatId: canvasChat, messageId: reply.id, content: 'Only words now.' });
  assert.equal(r.body.message.media, undefined);
  assert.equal((await admin.raw('GET', kept.url)).status, 404); // a block that was removed takes its picture with it
  assert.equal((await admin.call('POST', '/api/chat/message/update', { chatId: canvasChat, messageId: reply.id, content: ' ' })).status, 400);
  assert.equal((await other.call('POST', '/api/chat/message/update', { chatId: canvasChat, messageId: reply.id, content: 'mine now' })).status, 404);
  assert.equal((await admin.call('POST', '/api/chat/media/make', { chatId: canvasChat, messageId: reply.id, index: 0 })).status, 404);

  // ---------- Skills ----------
  r = await admin.call('GET', '/api/skills');
  assert.ok(r.body.items.length >= 8 && r.body.items.every((s) => s.builtin && !('body' in s) && s.id.startsWith('builtin:') && s.title.zh)); // a playbook is named, never shown
  assert.equal((await admin.call('POST', '/api/skills', { name: 'No body' })).status, 400);
  assert.equal((await admin.call('POST', '/api/skills', { body: 'No name' })).status, 400);
  r = await admin.call('POST', '/api/skills', { name: '  House   style ', description: 'For every post', body: '## Rules\nNever say "revolutionary".' });
  const skill = r.body.skill;
  assert.deepEqual([r.status, skill.name, skill.description, skill.builtin], [200, 'House style', 'For every post', false]);
  r = await admin.call('POST', '/api/skills', { body: '---\nname: weekly-report\ntitle-en: Weekly report\ndescription: "What a weekly report covers"\n---\n# Weekly report\nThree sections.' }); // a whole SKILL.md, pasted
  assert.deepEqual([r.body.skill.name, r.body.skill.description, r.body.skill.body], ['Weekly report', 'What a weekly report covers', '# Weekly report\nThree sections.']);
  r = await admin.call('POST', '/api/skills', { id: skill.id, name: 'House style', body: 'Short sentences.' });
  assert.deepEqual([r.body.skill.id, r.body.skill.body, r.body.skill.description], [skill.id, 'Short sentences.', '']);
  assert.equal((await other.call('POST', '/api/skills', { id: skill.id, name: 'Taken', body: 'x' })).status, 404);
  assert.equal((await other.call('POST', '/api/skills/delete', { id: skill.id })).status, 404);
  assert.ok((await other.call('GET', '/api/skills')).body.items.every((s) => s.builtin)); // nobody sees another person's skills

  events = await admin.send({ text: 'Write a post about tides', skillIds: [skill.id, 'builtin:honest-sourcing', 'gone', skill.id] });
  assert.deepEqual([events.done.message.skills.map((s) => s.name), events.done.chat.skillIds], [['House style', 'honest-sourcing'], [skill.id, 'builtin:honest-sourcing', 'gone']]);
  events = await other.send({ text: 'Write a post about tides', skillIds: [skill.id] }); // someone else's skill is not theirs to use
  assert.equal(events.done.message.skills, undefined);
  assert.equal((await admin.call('POST', '/api/skills/delete', { id: skill.id })).status, 200);
  assert.equal((await admin.call('GET', '/api/skills')).body.items.filter((s) => !s.builtin).length, 1);

  // ---------- The narration agent, asked from a conversation ----------
  events = await admin.send({ text: '一条 60 秒的抖音视频：为什么企业买了大模型却用不起来', target: 'narrator' });
  message = events.done.message;
  assert.deepEqual(events.names, ['chat', 'step', 'trace', 'delta', 'done']);
  assert.deepEqual(message.steps.map((s) => [s.id, s.status]), [['skills', 'done'], ['write', 'done'], ['review', 'done']]);
  assert.ok(message.steps[0].skills.every((s) => s.zh && s.en) && !JSON.stringify(message.steps).includes('"card"'));
  assert.match(message.content, /^# 【演示】.+\n\n> 抖音 · .+ · 60 s · \d+ 汉字/);
  assert.ok(['## 旁白', '## 观点卡', '## 审稿', '**黄金钩子** `00:00–00:03`'].every((part) => message.content.includes(part)));

  // ---------- Usage and activity know of the chat; an account that goes takes its conversations along ----------
  r = await admin.call('GET', '/api/usage?days=1');
  const kinds = Object.fromEntries(r.body.byKind.map((k) => [k.key, k.calls]));
  assert.ok(kinds.chat >= 6 && kinds.image >= 3 && kinds.narration >= 2 && kinds.video === undefined, JSON.stringify(kinds)); // a clip no gateway could start is not a call
  assert.ok(r.body.byTask.some((task) => task.title === 'Foxes and lighthouses' && task.platformId === 'chat'));
  r = await admin.call('GET', '/api/usage?days=1&scope=all');
  assert.ok(r.body.byTask.every((task) => task.platformId !== 'chat' || task.title === 'Conversation')); // in the totals for everyone a conversation has no title
  r = await admin.call('GET', '/api/activity');
  assert.ok(['chat.send', 'skill.create', 'skill.update', 'skill.delete'].every((type) => r.body.items.some((a) => a.type === type)));

  assert.equal((await admin.call('POST', '/api/chats/delete', { id: canvasChat })).status, 200);
  assert.equal((await admin.call('GET', `/api/chats/get?id=${canvasChat}`)).status, 404);
  const ann = (await admin.call('GET', '/api/admin/users')).body.users.find((u) => u.email === 'ann@example.test');
  assert.equal((await admin.call('POST', '/api/admin/users/delete', { id: ann.id })).status, 200);
  const left = JSON.parse(await readFile(path.join(dir, 'chats.json'), 'utf8')); // what the server kept, read from its own file
  assert.ok(left.length > 0 && left.every((c) => c.userId !== ann.id));
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'skills.json'), 'utf8')).map((sk) => sk.name), ['Weekly report']);
});

test('a conversation becomes turns: in order, joined, trimmed to what fits', () => {
  const said = (role, content) => ({ role, content });
  const { history, user } = turnsFor([said('user', 'one'), said('assistant', 'two'), said('user', 'three'), said('assistant', ''), said('user', 'four')]);
  assert.deepEqual([history, user], [[said('user', 'one'), said('assistant', 'two')], 'three\n\nfour']); // a reply that never came leaves two prompts, which go as one
  assert.deepEqual(turnsFor([said('assistant', 'stray'), said('user', 'hello')]), { history: [said('assistant', 'stray')].slice(1), user: 'hello', dropped: 1 }); // the first turn is the person's
  const long = Array.from({ length: 40 }, (_, i) => said(i % 2 ? 'assistant' : 'user', `${i} ${'word '.repeat(400)}`));
  const fit = turnsFor([...long, said('user', 'last')], { budget: 2500 });
  assert.ok(fit.history.length >= 2 && fit.history.length < 40 && fit.history[0].role === 'user' && fit.history.at(-1).content.startsWith('39 ') && fit.user === 'last');
  assert.deepEqual(turnsFor([said('user', 'x'.repeat(50_000))], { budget: 10 }).history, []); // the prompt itself always goes
});

test('the prompt of a conversation: tools it has, skills it was given', () => {
  const plain = systemPrompt({ now: new Date('2026-11-13T10:00:00Z') });
  assert.ok(plain.includes('Today is 2026-11-13.') && !plain.includes('```image') && !plain.includes('# Skills'));
  const drawing = systemPrompt({ tools: { image: true } });
  assert.ok(drawing.includes('# Making pictures') && drawing.includes('```image') && !drawing.includes('```video'));
  const both = systemPrompt({ tools: { image: true, video: true }, skills: [{ name: 'House style', description: 'For posts', body: '# Rules\nShort sentences.' }] });
  assert.ok(both.includes('pictures and short video clips') && both.includes('```video') && both.includes('## Skill: House style\nWhen to use it: For posts') && both.includes('### Rules')); // a skill's headings sit below the prompt's
});

test('a prompt as a brief for the narration agent', () => {
  assert.deepEqual(briefFromPrompt('一条 90 秒的小红书视频：通勤穿搭'), { topic: '一条 90 秒的小红书视频：通勤穿搭', platformId: 'xiaohongshu', duration: 90 });
  assert.deepEqual(briefFromPrompt('Why sourdough fails, a 2 min TikTok'), { topic: 'Why sourdough fails, a 2 min TikTok', platformId: 'tiktok', duration: 120 });
  assert.deepEqual(briefFromPrompt('为什么企业买了大模型却用不起来'), { topic: '为什么企业买了大模型却用不起来', platformId: 'wechat_channels' });
  assert.deepEqual(briefFromPrompt('The 3 steps of a good hook'), { topic: 'The 3 steps of a good hook', platformId: 'youtube_shorts' }); // "3 steps" is not three seconds
  const long = briefFromPrompt(`Topic. ${'detail '.repeat(200)}`);
  assert.deepEqual([long.topic.length, long.reference.length > 500], [500, true]);
});

test('titles and skill files', () => {
  assert.equal(titleFrom('\n\n## **Plan** the `launch`\nmore'), 'Plan the launch');
  assert.equal([...titleFrom('字'.repeat(80))].length, 49);
  assert.deepEqual(readSkillFile('just instructions'), { name: '', description: '', body: 'just instructions' });
  assert.deepEqual(readSkillFile('---\r\nname: a-b\r\ndescription: What for\r\n---\r\nBody'), { name: 'a-b', description: 'What for', body: 'Body' });
  assert.deepEqual(cleanSkill({ name: 'Given', body: '---\nname: from-file\n---\nBody' }), { name: 'Given', description: '', body: 'Body' }); // what the form says wins
  assert.throws(() => cleanSkill({ name: 'x', body: '---\nname: only-a-header\n---\n' }), /needs instructions/);
});

test('the model of a conversation is the one asked for when it is enabled, and pictures find a gateway that draws', () => {
  const blank = { baseUrl: '', apiKey: '', model: '', size: '' };
  const store = {
    activeId: 'a',
    profiles: [
      { id: 'a', name: 'A', provider: 'custom', baseUrl: 'https://a.test/v1', apiKey: 'k', model: 'a1', models: ['a2'], image: blank, video: blank },
      { id: 'b', name: 'B', provider: 'custom', baseUrl: 'https://b.test/v1', apiKey: 'k', model: 'b1', models: [], image: { ...blank, model: 'draw-1' }, video: blank },
    ],
  };
  assert.deepEqual([textConfig(store, { gatewayId: 'b', model: 'b1' }), textConfig(store, { gatewayId: 'a', model: 'a2' }), textConfig(store, { gatewayId: 'a', model: 'b1' }), textConfig(store, { gatewayId: 'gone', model: 'x' }), textConfig(store)].map((c) => `${c.id}/${c.model}`), ['b/b1', 'a/a2', 'a/a1', 'a/a1', 'a/a1']);
  assert.deepEqual([mediaConfig(store, 'image', 'a')?.id, mediaConfig(store, 'image', 'b')?.id, mediaConfig(store, 'video', 'a')], ['b', 'b', null]);
});

test('a model is sent the turns before the prompt, and a reply in prose is never taken for one cut short', async (t) => {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    seen.push(JSON.parse(body));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const text = 'An open bracket { is "just text here';
    if (req.url.endsWith('/chat/completions')) res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`);
    else res.end(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const history = [{ role: 'user', content: 'one' }, { role: 'assistant', content: 'two' }];

  const openai = await completeChat({ provider: 'custom', baseUrl: `${baseUrl}/v1`, apiKey: 'k', model: 'm' }, { system: 'S', user: 'three', history, json: false });
  assert.equal(openai, 'An open bracket { is "just text here');
  assert.deepEqual([seen.length, seen[0].messages], [1, [{ role: 'system', content: 'S' }, ...history, { role: 'user', content: 'three' }]]); // asked once: nothing was "picked up"

  await completeChat({ provider: 'custom-anthropic', baseUrl, apiKey: 'k', model: 'm' }, { system: 'S', user: 'three', history, json: false });
  assert.deepEqual([seen.length, seen[1].system, seen[1].messages], [2, 'S', [...history, { role: 'user', content: 'three' }]]);
});
