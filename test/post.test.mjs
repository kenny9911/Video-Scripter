// The image post (图文): what each platform takes, the prompt, reading the model's reply, the draft made
// without a model, line breaking for the cards, the browser's zip writer, and the HTTP routes end to end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { PLATFORMS } from '../src/platforms.mjs';
import { POST_SIZES, postFormat, publicFormat, buildPostPrompts, parsePost, postFromScript, normalizePost, postMarkdown, MAX_CARDS } from '../src/post.mjs';
import { atomsOf, wrapText, THEMES, themeOf } from '../public/cards.js';
import { zipStore, crc32 } from '../public/zip.js';
import { crc32 as serverCrc } from '../src/zip.mjs';

const entry = {
  brief: { topic: 'AI 落地', audience: '企业老板', brand: '老周' },
  script: {
    title: '为什么买了大模型没用',
    logline: '差的不是模型，是业务本体。',
    scenes: [
      { voiceover: '你买了大模型，[[却没用起来]]。⏸ 为什么？', onScreenText: '买了≠用上' },
      { voiceover: 'A：第二点。B：数据没有打通！', onScreenText: '数据没打通' },
      { voiceover: '同一张卡片不出现两次。', onScreenText: '数据没打通' },
      { voiceover: '没有字幕的场景不成卡片。', onScreenText: '' },
    ],
    publish: { titles: ['标题一', '标题二'], coverText: '大模型白买了？', description: '这是正文。', hashtags: ['#AI', '#企业', '#落地'] },
  },
};

test('every platform with an image post names sizes the cards can be drawn in, and limits', () => {
  const withPost = PLATFORMS.filter((p) => p.post);
  assert.deepEqual(withPost.map((p) => p.id), ['wechat_channels', 'douyin', 'xiaohongshu', 'tiktok', 'instagram']);
  for (const p of withPost) {
    const f = postFormat(p.id);
    assert.ok(f.sizes.length === p.post.sizes.length && f.sizes.every((s) => POST_SIZES.includes(s)), `${p.id}: a size it lists is not one the cards are drawn in`);
    assert.ok(f.maxImages > 0 && f.bodyMax > 0 && f.hashtagMax > 0 && f.notes.length > 0 && f.maxCards <= MAX_CARDS, p.id);
    assert.ok(['png', 'jpg'].includes(f.fileType), p.id);
    assert.deepEqual(Object.keys(publicFormat(f)).sort(), ['bodyMax', 'fileType', 'hashtagMax', 'maxCards', 'maxImages', 'name', 'nameEn', 'sizes', 'titleMax']);
  }
  assert.equal(postFormat('youtube_shorts'), null);
  assert.equal(publicFormat(null), null);
  const xhs = postFormat('xiaohongshu');
  assert.deepEqual([xhs.sizes[0], xhs.titleMax, xhs.bodyMax], [{ id: '3:4', w: 1080, h: 1440 }, 20, 1000]);
  assert.deepEqual([postFormat('instagram').titleMax, postFormat('instagram').fileType], [0, 'jpg']);
});

test('the prompt carries the platform limits, its guidance, the script and what the creator asked for', () => {
  const format = postFormat('xiaohongshu');
  const { system, user } = buildPostPrompts(entry, format, { instruction: '写给新手' });
  assert.match(system, /at most 20 characters/);
  assert.match(system, /图文笔记靠封面和标题拿点击/);
  assert.match(system, /加微信/); // the words that get a post throttled
  assert.match(system, /Simplified Chinese/);
  assert.match(user, /1\. 你买了大模型，却没用起来。 为什么？\n {2}\[on screen: 买了≠用上\]/); // delivery marks are gone
  assert.match(user, /Audience: 企业老板/);
  assert.match(user, /<<<ASK\n写给新手\nASK>>>/);
  assert.ok(!user.includes('Tone:') && !user.includes('undefined') && !user.includes('null'));
  // A platform with no title asks for none; an English platform writes in English.
  const ig = buildPostPrompts(entry, postFormat('instagram'));
  assert.match(ig.system, /"titles": an empty array/);
  assert.match(ig.system, /every value in the JSON in English/);
  assert.ok(!ig.user.includes('ASK'));
});

test('a reply becomes a post: fenced JSON is read, the shape is settled, nothing is cut to the platform limit', () => {
  const format = postFormat('xiaohongshu');
  const reply = `Here you go:\n\`\`\`json\n${JSON.stringify({
    titles: ['一个很长很长很长很长很长很长很长很长的标题超过二十个字', '短标题'],
    body: '正文第一行\r\n第二行',
    hashtags: ['AI', '#AI', '# 企业 数字化', ''],
    cards: [
      { kind: 'point', title: '第一张' },
      { kind: 'nonsense', title: '第二张', bullets: ['一', '', '二', '三', '四', '五', '六', '七'] },
      { kind: 'summary', title: '', body: '', bullets: [] },
      { kind: 'cover', title: '封面只在第一张', image: 'https://evil.example/x.png' },
    ],
    theme: '<script>',
    size: '16:9',
  })}\n\`\`\``;
  const post = parsePost(reply, format);
  assert.equal(post.title, post.titles[0]); // too long for 小红书, and kept: the page says so and the creator shortens it
  assert.equal([...post.title].length, 27);
  assert.equal(post.body, '正文第一行\n第二行');
  assert.deepEqual(post.hashtags, ['#AI', '#企业数字化']);
  assert.deepEqual(post.cards.map((c) => c.kind), ['cover', 'point', 'cover']); // the first card is the cover; an empty card is dropped
  assert.deepEqual(post.cards[1].bullets, ['一', '二', '三', '四', '五', '六']);
  assert.ok(!('image' in post.cards[2]));
  assert.deepEqual([post.theme, post.size, post.footer], ['', '3:4', '']);
  assert.throws(() => parsePost('{"cards": []}', format), /no cards/);
  assert.throws(() => parsePost('no json here', format));
  // What the page sends back is kept: the look, a picture of the script behind the cover, never more cards than the page shows.
  const saved = normalizePost({ ...post, title: '短标题', theme: 'ink', size: '1:1', footer: '@老周', cards: Array.from({ length: 40 }, (_, i) => ({ title: `卡片${i}`, image: '/media/abc-s1-image-x1.png' })) }, format);
  assert.deepEqual([saved.title, saved.theme, saved.size, saved.footer, saved.cards.length, saved.cards[0].image], ['短标题', 'ink', '1:1', '@老周', MAX_CARDS, '/media/abc-s1-image-x1.png']);
});

test('without a model, a post is drafted from the script: cover, one point per on-screen line, a summary', () => {
  const format = postFormat('xiaohongshu');
  const post = postFromScript(entry, format);
  assert.deepEqual(post.cards.map((c) => [c.kind, c.title]), [['cover', '大模型白买了？'], ['point', '买了≠用上'], ['point', '数据没打通'], ['summary', '收藏这份清单']]);
  assert.equal(post.cards[0].kicker, '企业老板');
  assert.equal(post.cards[1].body, '你买了大模型，却没用起来。');
  assert.equal(post.cards[2].body, '第二点。'); // the speaker label is not part of what is said
  assert.deepEqual(post.cards[3].bullets, ['买了≠用上', '数据没打通']);
  assert.deepEqual([post.title, post.body, post.hashtags], ['标题一', '这是正文。', ['#AI', '#企业', '#落地']]);
  assert.equal(postFromScript(entry, postFormat('tiktok')).cards.at(-1).title, 'Save this list');
  const md = postMarkdown(post, format);
  assert.match(md, /^# 标题一\n/);
  assert.match(md, /## 01 · cover · 企业老板\n\n\*\*大模型白买了？\*\*/);
  assert.match(md, /- 买了≠用上\n- 数据没打通/);
});

test('card text breaks between Chinese characters and Latin words, and keeps punctuation where it belongs', () => {
  const measure = (s) => [...s].length * 10; // every character 10 wide
  const text = (lines) => lines.map((l) => l.atoms.map((a) => a.parts.map((p) => p.text).join('')).join(''));
  assert.deepEqual(text(wrapText(measure, '大模型落地，先做本体。', 50)), ['大模型落', '地，先做本', '体。']); // a comma or a full stop never starts a line
  assert.deepEqual(text(wrapText(measure, '他说“本体”是关键', 30)), ['他说', '“本', '体”是', '关键']); // an opening quote never ends one
  assert.deepEqual(text(wrapText(measure, 'Save this list for later', 100)), ['Save this', 'list for', 'later']); // words stay whole, no space at either end
  assert.deepEqual(text(wrapText(measure, '第一行\n第二行', 500)), ['第一行', '第二行']);
  assert.deepEqual(text(wrapText(measure, 'aaaa bbbb cc', 40)), ['aaaa', 'bbbb', 'cc']); // a space that does not fit is dropped, not carried over
  assert.deepEqual(text(wrapText(measure, 'https://example.com/a-very-long-address', 100)).every((l) => measure(l) <= 100), true); // a word wider than the line is broken
  assert.deepEqual(wrapText(measure, 'a b', 100)[0].w, 30);
  // **marked** phrases; markers that do not pair up mark nothing and are not drawn.
  assert.deepEqual(atomsOf('提升**30%**效率').flatMap((a) => a.parts).filter((p) => p.mark).map((p) => p.text), ['30%']);
  assert.ok(atomsOf('坏的**标记').every((a) => a.parts.every((p) => !p.mark && !p.text.includes('*'))));
  assert.equal(themeOf('nope'), THEMES[0]);
  assert.equal(new Set(THEMES.map((t) => t.id)).size, THEMES.length);
});

test('the browser writes a zip that unzip reads, with UTF-8 names', async (t) => {
  assert.equal(crc32(new TextEncoder().encode('hello')), serverCrc(Buffer.from('hello')));
  const dir = await mkdtemp(path.join(os.tmpdir(), 'post-zip-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'p.zip');
  await writeFile(file, zipStore([{ name: '01-cover.png', data: new Uint8Array([137, 80, 78, 71]) }, { name: 'post.txt', data: '标题\n\n正文' }]));
  let listing;
  try {
    listing = execFileSync('unzip', ['-p', file, 'post.txt'], { encoding: 'utf8' });
  } catch (err) {
    if (err.code === 'ENOENT') return t.skip('no unzip on this machine');
    throw err;
  }
  assert.equal(listing, '标题\n\n正文');
  assert.match(execFileSync('unzip', ['-t', file], { encoding: 'utf8' }), /No errors detected/);
});

test('image posts over HTTP: written from a script, edited, packaged, and only for their owner', async (t) => {
  const PORT = 4000 + Math.floor(Math.random() * 90);
  const base = `http://127.0.0.1:${PORT}`;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scripter-post-'));
  const env = { ...process.env, PORT: String(PORT), DATA_DIR: dir, GATEWAY_CONFIG_FILE: path.join(dir, 'none.json'), DATABASE_URL: '', POSTGRES_URL: '', LLM_PROVIDER: '', API_KEY: '', LLM_API_KEY: '', ADMIN_EMAIL: 'boss@example.test', ADMIN_PASSWORD: 'correct-horse-battery', ALLOW_SIGNUP: '' };
  const child = spawn(process.execPath, ['server.mjs'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(async () => {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise((resolve) => child.stdout.once('data', resolve));

  const client = () => {
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
    const script = async (brief) => {
      const text = await (await raw('POST', '/api/generate', brief)).text();
      return JSON.parse(/^event: done\ndata: (.*)$/m.exec(text)[1]).historyId;
    };
    return { raw, call, script };
  };

  const ann = client();
  assert.equal((await ann.call('POST', '/api/auth/signup', { email: 'ann@example.test', password: 'ann-password-1' })).status, 200);
  assert.equal((await client().call('POST', '/api/post/generate', { historyId: 'x' })).status, 401);

  // The page is told what each platform's image post takes, and which words get one throttled.
  const meta = (await ann.call('GET', '/api/meta')).body;
  const xhs = meta.platforms.find((p) => p.id === 'xiaohongshu');
  assert.deepEqual([xhs.post.titleMax, xhs.post.sizes[0].id, xhs.post.notes, xhs.banned.includes('加微信')], [20, '3:4', undefined, true]);
  assert.equal(meta.platforms.find((p) => p.id === 'youtube_shorts').post, null);

  // Demo mode drafts the post from the script, with no model call.
  const id = await ann.script({ platformId: 'xiaohongshu', topic: '企业 AI 落地', duration: 30 });
  let r = await ann.call('POST', '/api/post/generate', { historyId: id });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.post.cards[0].kind, r.body.post.cards.at(-1).kind, r.body.post.by, r.body.post.size], ['cover', 'summary', 'demo', '3:4']);
  assert.ok(r.body.post.cards.length >= 3 && r.body.post.title && r.body.post.hashtags.length);

  // Edits are kept, in shape; the look survives writing the post again.
  const edited = { ...r.body.post, title: '我的标题', theme: 'ink', size: '1:1', footer: '@ann', cards: [...r.body.post.cards.slice(0, 2), { kind: 'quote', title: '一句**金句**', junk: 1 }] };
  r = await ann.call('POST', '/api/post/save', { historyId: id, post: edited });
  assert.deepEqual([r.status, r.body.post.title, r.body.post.cards.length, r.body.post.cards[2], r.body.post.theme], [200, '我的标题', 3, { kind: 'quote', kicker: '', title: '一句**金句**', body: '', bullets: [] }, 'ink']);
  const history = (await ann.call('GET', '/api/history')).body;
  assert.equal(history.find((e) => e.id === id).post.title, '我的标题');
  r = await ann.call('POST', '/api/post/generate', { historyId: id, instruction: 'bolder' });
  assert.deepEqual([r.body.post.theme, r.body.post.size, r.body.post.footer, r.body.post.cards.at(-1).kind], ['ink', '1:1', '@ann', 'summary']);

  // The package carries the post as text.
  const zip = Buffer.from(await (await ann.raw('POST', '/api/history/package', { id, markdown: '# x' })).arrayBuffer());
  assert.ok(zip.includes(Buffer.from('/post.md')));

  // Someone else's script, and a platform with no image post.
  const bob = client();
  await bob.call('POST', '/api/auth/signup', { email: 'bob@example.test', password: 'bob-password-1' });
  assert.equal((await bob.call('POST', '/api/post/generate', { historyId: id })).status, 404);
  assert.equal((await bob.call('POST', '/api/post/save', { historyId: id, post: edited })).status, 404);
  const yt = await ann.script({ platformId: 'youtube_shorts', topic: 'Why cats knock things over', duration: 30 });
  r = await ann.call('POST', '/api/post/generate', { historyId: yt });
  assert.deepEqual([r.status, r.body.error], [400, 'That platform has no image-post format']);

  // The activity log and the usage record know about it; demo mode made no model call.
  const acts = (await ann.call('GET', '/api/activity')).body;
  assert.equal((acts.items || acts).filter((a) => a.type === 'post.write').length, 2);
});
