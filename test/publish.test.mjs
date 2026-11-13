// Publishing through Postiz: what each platform is told, the post that is sent, and the routes end to end
// against a stand-in for Postiz (no real account is touched).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { settingsFor, contentOf, partBytes, MAX_MEDIA_BYTES } from '../src/publish.mjs';

test('each platform is told what it needs, and nothing it would throw away', () => {
  const post = { kind: 'video', title: 'A title '.repeat(20), hashtags: ['#AI', 'shorts', ''], visibility: 'unlisted', ai: true };
  const yt = settingsFor('youtube', post);
  assert.deepEqual([yt.type, yt.selfDeclaredMadeForKids, [...yt.title].length, yt.tags], ['unlisted', 'no', 100, [{ value: 'AI', label: 'AI' }, { value: 'shorts', label: 'shorts' }]]);
  assert.equal(settingsFor('youtube', { kind: 'video', visibility: 'nonsense' }).type, 'public');
  assert.deepEqual(settingsFor('instagram-standalone', post), { post_type: 'post' });
  const tt = settingsFor('tiktok', post);
  // A TikTok post is published, not left in the app's inbox; a video says it was made with AI.
  assert.deepEqual([tt.content_posting_method, tt.privacy_level, tt.video_made_with_ai, tt.duet, 'autoAddMusic' in tt, [...tt.title].length], ['DIRECT_POST', 'SELF_ONLY', true, true, false, 90]);
  const photos = settingsFor('tiktok', { kind: 'images', title: '', visibility: 'public' });
  assert.deepEqual([photos.privacy_level, photos.autoAddMusic, 'duet' in photos, 'video_made_with_ai' in photos, 'title' in photos], ['PUBLIC_TO_EVERYONE', 'no', false, false, false]);
  assert.deepEqual(settingsFor('linkedin-page', { kind: 'images', title: 'Three steps' }), { post_as_images_carousel: true, carousel_name: 'Three steps' });
  assert.equal(settingsFor('linkedin', { kind: 'video' }), undefined);
  assert.equal(settingsFor('threads', post), undefined);
  assert.equal(contentOf('First line\r\n\n<b>second</b> & third'), '<p>First line</p><p></p><p>&lt;b&gt;second&lt;/b&gt; &amp; third</p>');
  assert.ok(partBytes() <= 3.5 * 1024 * 1024 && MAX_MEDIA_BYTES >= 100 * 1024 * 1024);
});

test('publishing over HTTP: connect, send files whole and in pieces, post, and only with your own key', async (t) => {
  // A stand-in for Postiz: it knows one key, keeps what it is sent, and answers the way Postiz does.
  const seen = { uploads: [], posts: [] };
  const postiz = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const send = (status, data) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
    if (req.headers.authorization !== 'pz_live_key_12345') return send(401, { msg: 'Invalid API key' });
    if (req.method === 'GET' && req.url === '/public/v1/integrations')
      return send(200, [
        { id: 'yt1', name: 'Ann on YouTube', identifier: 'youtube', picture: 'https://img.example/a.png', disabled: false },
        { id: 'ig1', name: 'ann.ig', identifier: 'instagram', disabled: false },
        { id: 'tt1', name: 'ann.tt', identifier: 'tiktok', disabled: true },
      ]);
    if (req.method === 'POST' && req.url === '/public/v1/upload') {
      const name = /filename="([^"]+)"/.exec(body.toString('latin1'))?.[1];
      seen.uploads.push({ name, size: body.length, type: /Content-Type: ([\w/]+)/i.exec(body.toString('latin1'))?.[1] });
      return send(201, { id: `m${seen.uploads.length}`, path: `https://uploads.postiz.example/${name}` });
    }
    if (req.method === 'POST' && req.url === '/public/v1/posts') {
      const post = JSON.parse(body);
      seen.posts.push(post);
      return send(201, post.posts.map((p, i) => ({ postId: `p${seen.posts.length}-${i}`, integration: p.integration.id })));
    }
    send(404, {});
  });
  await new Promise((resolve) => postiz.listen(0, '127.0.0.1', resolve));
  t.after(() => postiz.close());

  const PORT = 4200 + Math.floor(Math.random() * 90);
  const base = `http://127.0.0.1:${PORT}`;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scripter-publish-'));
  const env = { ...process.env, PORT: String(PORT), DATA_DIR: dir, GATEWAY_CONFIG_FILE: path.join(dir, 'none.json'), DATABASE_URL: '', POSTGRES_URL: '', LLM_PROVIDER: '', API_KEY: '', LLM_API_KEY: '', ADMIN_EMAIL: 'boss@example.test', ADMIN_PASSWORD: 'correct-horse-battery', ALLOW_SIGNUP: '', POSTIZ_API_URL: `http://127.0.0.1:${postiz.address().port}`, ASSET_BODY_MB: '1', GATEWAY_RETRY_BASE_MS: '1' };
  const child = spawn(process.execPath, ['server.mjs'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(async () => {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise((resolve) => child.stdout.once('data', resolve));
  const client = () => {
    let cookie = '';
    const raw = async (method, url, body, headers = {}) => {
      const json = body && !Buffer.isBuffer(body);
      const res = await fetch(base + url, { method, headers: { ...(json && { 'content-type': 'application/json' }), ...(cookie && { cookie }), ...headers }, body: json ? JSON.stringify(body) : body });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return res;
    };
    const call = async (method, url, body, headers) => {
      const res = await raw(method, url, body, headers);
      return { status: res.status, body: await res.json() };
    };
    return { raw, call };
  };
  const ann = client();
  await ann.call('POST', '/api/auth/signup', { email: 'ann@example.test', password: 'ann-password-1' });
  assert.equal((await client().call('GET', '/api/publish/status')).status, 401);

  // Not connected; a key Postiz does not know is not kept.
  let r = await ann.call('GET', '/api/publish/status');
  assert.deepEqual([r.body.connected, r.body.keyPreview, r.body.partBytes], [false, '', 1024 * 1024]);
  r = await ann.call('POST', '/api/publish/connect', { apiKey: 'wrong-key-000000' });
  assert.deepEqual([r.status, /did not accept the API key/.test(r.body.error)], [400, true]);
  assert.equal((await ann.call('POST', '/api/publish/connect', { apiKey: 'short' })).status, 400);
  assert.equal((await ann.call('GET', '/api/publish/status')).body.connected, false);
  assert.equal((await ann.call('POST', '/api/publish/media', Buffer.from('x'), { 'x-file-name': 'a.jpg' })).status, 400); // nothing is passed on before connecting

  // Connected: the key is masked, the channels are the account's.
  r = await ann.call('POST', '/api/publish/connect', { apiKey: ' pz_live_key_12345 ' });
  assert.deepEqual([r.status, r.body.connected, r.body.keyPreview, r.body.channels.map((c) => [c.id, c.identifier, c.disabled])], [200, true, 'pz_••••2345', [['yt1', 'youtube', false], ['ig1', 'instagram', false], ['tt1', 'tiktok', true]]]);
  assert.ok(!JSON.stringify(r.body).includes('pz_live_key_12345'));
  assert.equal((await ann.call('GET', '/api/publish/status')).body.channels.length, 3);

  // A picture in one request; a video in pieces; only what this app makes is passed on.
  r = await ann.call('POST', '/api/publish/media', Buffer.alloc(2000, 7), { 'x-file-name': encodeURIComponent('01 封面.jpg') });
  assert.deepEqual([r.status, r.body], [200, { id: 'm1', path: 'https://uploads.postiz.example/01.jpg' }]); // the name is made plain ASCII
  const video = Buffer.alloc(2.5 * 1024 * 1024, 9);
  const size = 1024 * 1024;
  for (let n = 0; n < 3; n++) assert.equal((await ann.call('POST', '/api/publish/part', video.subarray(n * size, (n + 1) * size), { 'x-upload-id': 'upload-0001', 'x-part': String(n) })).status, 200);
  r = await ann.call('POST', '/api/publish/media', null, { 'x-upload-id': 'upload-0001', 'x-parts': '3', 'x-file-name': 'film.mp4' });
  assert.deepEqual([r.status, r.body.path], [200, 'https://uploads.postiz.example/film.mp4']);
  assert.deepEqual(seen.uploads.map((u) => [u.name, u.type]), [['01.jpg', 'image/jpeg'], ['film.mp4', 'video/mp4']]);
  assert.ok(seen.uploads[1].size > video.length && seen.uploads[1].size < video.length + 1000); // the whole file, in one multipart body
  assert.equal((await ann.call('POST', '/api/publish/media', null, { 'x-upload-id': 'upload-0001', 'x-parts': '3', 'x-file-name': 'film.mp4' })).status, 400); // the pieces are gone once used
  assert.equal((await ann.call('POST', '/api/publish/media', Buffer.from('MZ'), { 'x-file-name': 'tool.exe' })).status, 400);

  // The post: to the channels picked that are switched on, each told what it needs.
  const text = await (await ann.raw('POST', '/api/generate', { platformId: 'youtube_shorts', topic: 'Why cats knock things over', duration: 30 })).text();
  const id = JSON.parse(/^event: done\ndata: (.*)$/m.exec(text)[1]).historyId;
  const media = [{ id: 'm2', path: 'https://uploads.postiz.example/film.mp4' }];
  r = await ann.call('POST', '/api/publish/post', { historyId: id, kind: 'video', channelIds: ['yt1', 'ig1', 'tt1', 'nope'], when: 'now', title: 'Why cats knock things over', text: 'Line one\nLine two', hashtags: ['#cats'], visibility: 'unlisted', ai: true, media });
  assert.deepEqual([r.status, r.body.sent.kind, r.body.sent.when, r.body.sent.channels, r.body.sent.posts], [200, 'video', 'now', [{ name: 'Ann on YouTube', identifier: 'youtube' }, { name: 'ann.ig', identifier: 'instagram' }], ['p1-0', 'p1-1']]);
  const sent = seen.posts[0];
  assert.deepEqual([sent.type, sent.shortLink, sent.posts.length], ['now', false, 2]);
  assert.deepEqual(sent.posts[0], { integration: { id: 'yt1' }, value: [{ content: '<p>Line one</p><p>Line two</p>', image: media }], settings: { __type: 'youtube', title: 'Why cats knock things over', type: 'unlisted', selfDeclaredMadeForKids: 'no', tags: [{ value: 'cats', label: 'cats' }] } });
  assert.deepEqual(sent.posts[1].settings, { __type: 'instagram', post_type: 'post' });
  assert.equal((await ann.call('GET', '/api/history')).body.find((e) => e.id === id).published.length, 1);

  // A draft, a time in the future, and what is refused.
  r = await ann.call('POST', '/api/publish/post', { historyId: id, kind: 'images', channelIds: ['ig1'], when: 'draft', text: 'x', media });
  assert.deepEqual([r.status, seen.posts[1].type], [200, 'draft']);
  const later = new Date(Date.now() + 3600_000).toISOString();
  r = await ann.call('POST', '/api/publish/post', { historyId: id, kind: 'images', channelIds: ['ig1'], when: later, text: 'x', media });
  assert.deepEqual([r.status, seen.posts[2].type, seen.posts[2].date], [200, 'schedule', later]);
  for (const bad of [{ when: '2020-01-01T00:00:00Z' }, { when: 'tomorrow-ish' }, { channelIds: ['tt1'] }, { media: [] }, { media: [{ id: 'x', path: '/etc/passwd' }] }])
    assert.equal((await ann.call('POST', '/api/publish/post', { historyId: id, kind: 'images', channelIds: ['ig1'], when: 'now', text: 'x', media, ...bad })).status, 400, JSON.stringify(bad));
  assert.equal(seen.posts.length, 3);

  // Someone else has no connection and cannot post from Ann's script; disconnecting forgets the key.
  const bob = client();
  await bob.call('POST', '/api/auth/signup', { email: 'bob@example.test', password: 'bob-password-1' });
  assert.equal((await bob.call('GET', '/api/publish/status')).body.connected, false);
  assert.equal((await bob.call('POST', '/api/publish/post', { historyId: id, kind: 'video', channelIds: ['yt1'], when: 'now', media })).status, 404);
  r = await ann.call('POST', '/api/publish/connect', { disconnect: true });
  assert.deepEqual([r.body.connected, (await ann.call('GET', '/api/publish/status')).body.connected], [false, false]);
  assert.equal((await ann.call('POST', '/api/publish/post', { historyId: id, kind: 'video', channelIds: ['yt1'], when: 'now', media })).status, 400);
  const acts = (await ann.call('GET', '/api/activity')).body;
  assert.deepEqual((acts.items || acts).filter((a) => a.type.startsWith('publish.')).map((a) => a.type).sort(), ['publish.connect', 'publish.disconnect', 'publish.post', 'publish.post', 'publish.post']);
});
