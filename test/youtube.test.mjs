// YouTube, connected directly: the video resource, and the whole path over HTTP against stand-ins for
// Google's sign-in and YouTube's upload endpoint (no real account is touched).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { videoResource, partBytes, SCOPE } from '../src/youtube.mjs';

test('the video YouTube is given: a title within its limit, tags within theirs, and what it declares', () => {
  const v = videoResource({ title: `  ${'长标题'.repeat(60)}  `, description: 'Line one\nLine <two>', tags: ['#AI', ' shorts ', '', 'a,b', 'x'.repeat(600)], visibility: 'unlisted', ai: true });
  assert.deepEqual([[...v.snippet.title].length, v.snippet.description, v.snippet.tags, v.snippet.categoryId], [100, 'Line one\nLine two', ['AI', 'shorts', 'ab'], '22']);
  assert.deepEqual(v.status, { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false, containsSyntheticMedia: true });
  assert.equal(videoResource({ title: 'x', visibility: 'everyone' }).status.privacyStatus, 'public');
  // Set to go out later, a video waits as private.
  const later = new Date(Date.now() + 3600_000).toISOString();
  assert.deepEqual(videoResource({ title: 'x', visibility: 'public', publishAt: later }).status, { privacyStatus: 'private', selfDeclaredMadeForKids: false, containsSyntheticMedia: false, publishAt: later });
  assert.throws(() => videoResource({ title: 'x', publishAt: '2020-01-01T00:00:00Z' }), /future/);
  assert.throws(() => videoResource({ title: '  ' }), /title/);
  assert.equal(partBytes({}) % (256 * 1024), 0);
  assert.equal(partBytes({ ASSET_BODY_MB: '1' }), 1024 * 1024);
  assert.equal(partBytes({ ASSET_BODY_MB: '0.3' }), 256 * 1024);
});

test('YouTube over HTTP: set up, sign in, upload in pieces, and only your own connection', async (t) => {
  // Stand-ins: Google's token endpoint and YouTube's resumable upload.
  const seen = { tokens: [], starts: [], puts: [], revoked: [] };
  const video = { bytes: 0 };
  const google = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://x');
    const send = (status, data, headers = {}) => res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(data));
    if (url.pathname === '/token') {
      const form = Object.fromEntries(new URLSearchParams(body.toString()));
      seen.tokens.push(form);
      if (form.client_secret !== 'secret-0001') return send(401, { error: 'invalid_client', error_description: 'The OAuth client was not found.' });
      if (form.grant_type === 'authorization_code') return form.code === 'good-code' ? send(200, { access_token: 'at-1', expires_in: 1, refresh_token: 'rt-1', scope: SCOPE }) : send(400, { error: 'invalid_grant', error_description: 'Bad code' });
      return form.refresh_token === 'rt-1' ? send(200, { access_token: `at-${seen.tokens.length}`, expires_in: 3600 }) : send(400, { error: 'invalid_grant' });
    }
    if (url.pathname === '/revoke') return seen.revoked.push(url.searchParams.get('token')), send(200, {});
    if (url.pathname === '/upload' && req.method === 'POST') {
      seen.starts.push({ auth: req.headers.authorization, length: req.headers['x-upload-content-length'], type: req.headers['x-upload-content-type'], query: url.search, body: JSON.parse(body) });
      if (JSON.parse(body).snippet.title === 'no channel') return send(401, { error: { message: 'Unauthorized', errors: [{ reason: 'youtubeSignupRequired' }] } });
      video.bytes = 0;
      return send(200, {}, { location: `http://127.0.0.1:${google.address().port}/session/abc` });
    }
    if (url.pathname === '/session/abc' && req.method === 'PUT') {
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(req.headers['content-range']);
      seen.puts.push({ range: req.headers['content-range'], size: body.length });
      if (!range || Number(range[1]) !== video.bytes || Number(range[2]) - Number(range[1]) + 1 !== body.length) return send(400, { error: { message: 'bad range' } });
      video.bytes += body.length;
      if (video.bytes < Number(range[3])) return res.writeHead(308, { range: `bytes=0-${video.bytes - 1}` }).end();
      return send(201, { id: 'vid_123', snippet: { channelTitle: 'Ann’s channel' }, status: { privacyStatus: 'unlisted' } });
    }
    send(404, {});
  });
  await new Promise((resolve) => google.listen(0, '127.0.0.1', resolve));
  t.after(() => google.close());
  const G = `http://127.0.0.1:${google.address().port}`;

  const PORT = 4300 + Math.floor(Math.random() * 90);
  const base = `http://127.0.0.1:${PORT}`;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scripter-youtube-'));
  const env = { ...process.env, PORT: String(PORT), DATA_DIR: dir, GATEWAY_CONFIG_FILE: path.join(dir, 'none.json'), DATABASE_URL: '', POSTGRES_URL: '', LLM_PROVIDER: '', API_KEY: '', LLM_API_KEY: '', ADMIN_EMAIL: 'boss@example.test', ADMIN_PASSWORD: 'correct-horse-battery', ALLOW_SIGNUP: '', YOUTUBE_CLIENT_ID: '', YOUTUBE_CLIENT_SECRET: '', GOOGLE_AUTH_URL: `${G}/auth`, GOOGLE_TOKEN_URL: `${G}/token`, GOOGLE_REVOKE_URL: `${G}/revoke`, YOUTUBE_UPLOAD_URL: `${G}/upload`, ASSET_BODY_MB: '1' };
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
      const res = await fetch(base + url, { method, redirect: 'manual', headers: { ...(json && { 'content-type': 'application/json' }), ...(cookie && { cookie }), ...headers }, body: json ? JSON.stringify(body) : body });
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
  const admin = client();
  await admin.call('POST', '/api/auth/login', { email: 'boss@example.test', password: 'correct-horse-battery' });

  // Not set up: a member learns only that; setting it up is the administrator's.
  let r = await ann.call('GET', '/api/youtube/status');
  assert.deepEqual([r.body.configured, r.body.connected, 'redirectUri' in r.body, 'clientId' in r.body], [false, false, false, false]);
  assert.equal((await ann.raw('GET', '/api/youtube/connect')).status, 400);
  assert.equal((await ann.call('PUT', '/api/youtube/config', { clientId: 'x' })).status, 403);
  assert.equal((await admin.call('PUT', '/api/youtube/config', { clientId: 'client-0001.apps.example' })).status, 400); // no secret
  r = await admin.call('PUT', '/api/youtube/config', { clientId: 'client-0001.apps.example', clientSecret: 'secret-0001' });
  assert.deepEqual([r.status, r.body.configured, r.body.secretPreview], [200, true, 'sec••••0001']);
  r = await admin.call('GET', '/api/youtube/status');
  assert.deepEqual([r.body.redirectUri, r.body.clientId], [`${base}/api/youtube/callback`, 'client-0001.apps.example']);
  assert.ok(!JSON.stringify(r.body).includes('secret-0001'));

  // Signing in: off to Google with only the upload permission, and back with a code that is exchanged once.
  r = await ann.raw('GET', '/api/youtube/connect');
  const to = new URL(r.headers.get('location'));
  assert.deepEqual([r.status, to.origin + to.pathname, to.searchParams.get('scope'), to.searchParams.get('access_type'), to.searchParams.get('redirect_uri'), to.searchParams.get('client_id')], [302, `${G}/auth`, SCOPE, 'offline', `${base}/api/youtube/callback`, 'client-0001.apps.example']);
  const state = to.searchParams.get('state');
  const bob = client();
  await bob.call('POST', '/api/auth/signup', { email: 'bob@example.test', password: 'bob-password-1' });
  assert.equal((await bob.raw('GET', `/api/youtube/callback?code=good-code&state=${state}`)).status, 400); // someone else's sign-in is not theirs to finish
  r = await ann.raw('GET', '/api/youtube/connect');
  const state2 = new URL(r.headers.get('location')).searchParams.get('state');
  assert.equal((await ann.raw('GET', `/api/youtube/callback?error=access_denied&state=${state2}`)).status, 400);
  assert.equal((await ann.raw('GET', `/api/youtube/callback?code=bad-code&state=${state2}`)).status, 400);
  r = await ann.raw('GET', '/api/youtube/connect');
  const state3 = new URL(r.headers.get('location')).searchParams.get('state');
  r = await ann.raw('GET', `/api/youtube/callback?code=good-code&state=${state3}`);
  assert.deepEqual([r.status, /YouTube is connected/.test(await r.text())], [200, true]);
  assert.equal((await ann.raw('GET', `/api/youtube/callback?code=good-code&state=${state3}`)).status, 400); // a state works once
  assert.deepEqual([(await ann.call('GET', '/api/youtube/status')).body.connected, (await bob.call('GET', '/api/youtube/status')).body.connected], [true, false]);
  assert.deepEqual([seen.tokens.at(-1).grant_type, seen.tokens.at(-1).redirect_uri], ['authorization_code', `${base}/api/youtube/callback`]);

  // Uploading: the session is opened with the title and the rest, then the file follows in pieces, in order.
  const text = await (await ann.raw('POST', '/api/generate', { platformId: 'youtube_shorts', topic: 'Why cats knock things over', duration: 30 })).text();
  const id = JSON.parse(/^event: done\ndata: (.*)$/m.exec(text)[1]).historyId;
  const file = Buffer.alloc(2.5 * 1024 * 1024, 5);
  await new Promise((resolve) => setTimeout(resolve, 1100)); // the first token has run out: a fresh one is fetched
  r = await ann.call('POST', '/api/youtube/upload', { historyId: id, size: file.length, title: 'Why cats knock things over', description: 'Because.', tags: ['#cats'], visibility: 'unlisted', ai: true });
  assert.deepEqual([r.status, r.body.partBytes], [200, 1024 * 1024]);
  const start = seen.starts.at(-1);
  assert.deepEqual([start.auth, start.length, start.type, start.query, start.body.status.privacyStatus, start.body.status.containsSyntheticMedia, start.body.snippet.tags], [`Bearer at-${seen.tokens.length}`, String(file.length), 'video/mp4', '?uploadType=resumable&part=snippet,status', 'unlisted', true, ['cats']]);
  assert.equal(seen.tokens.at(-1).grant_type, 'refresh_token');
  const { uploadId } = r.body;
  const part = (offset, owner = ann, history = id) => owner.call('POST', '/api/youtube/part', file.subarray(offset, offset + 1024 * 1024), { 'x-upload-id': uploadId, 'x-offset': String(offset), 'x-history-id': history });
  assert.equal((await part(1024 * 1024)).status, 400); // out of order
  assert.equal((await part(0, bob)).status, 404); // not Bob's script, nor his upload
  r = await part(0);
  assert.deepEqual([r.status, r.body], [200, { done: false, sent: 1024 * 1024 }]);
  assert.equal((await part(0)).status, 400); // the same piece twice
  r = await part(1024 * 1024);
  assert.equal(r.body.sent, 2 * 1024 * 1024);
  r = await part(2 * 1024 * 1024);
  assert.deepEqual([r.status, r.body], [200, { done: true, id: 'vid_123', url: 'https://youtu.be/vid_123', channel: 'Ann’s channel', visibility: 'unlisted' }]);
  assert.deepEqual(seen.puts.filter((p) => /^bytes/.test(p.range)).map((p) => p.range), ['bytes 0-1048575/2621440', 'bytes 1048576-2097151/2621440', 'bytes 2097152-2621439/2621440']);
  assert.equal((await part(0)).status, 404); // the upload is over
  const kept = (await ann.call('GET', '/api/history')).body.find((e) => e.id === id).published;
  assert.deepEqual([kept.length, kept[0].url, kept[0].direct, kept[0].channels], [1, 'https://youtu.be/vid_123', true, [{ name: 'Ann’s channel', identifier: 'youtube' }]]);
  assert.equal((await ann.call('GET', '/api/youtube/status')).body.channel, 'Ann’s channel');

  // What YouTube refuses is said in words a person can act on; someone not connected is told to connect.
  r = await ann.call('POST', '/api/youtube/upload', { historyId: id, size: 10, title: 'no channel' });
  assert.deepEqual([r.status, /no YouTube channel yet/.test(r.body.error)], [400, true]);
  assert.equal((await ann.call('POST', '/api/youtube/upload', { historyId: id, size: 0, title: 'x' })).status, 400);
  const bobs = JSON.parse(/^event: done\ndata: (.*)$/m.exec(await (await bob.raw('POST', '/api/generate', { platformId: 'youtube_shorts', topic: 'Dogs', duration: 30 })).text())[1]).historyId;
  r = await bob.call('POST', '/api/youtube/upload', { historyId: bobs, size: 10, title: 'x' });
  assert.deepEqual([r.status, r.body.error], [400, 'Connect YouTube first']);

  // Disconnecting forgets the token here and tells Google.
  r = await ann.call('POST', '/api/youtube/disconnect', {});
  assert.deepEqual([r.body.connected, seen.revoked], [false, ['rt-1']]);
  const acts = (await ann.call('GET', '/api/activity')).body;
  assert.deepEqual((acts.items || acts).filter((a) => a.type.startsWith('youtube.')).map((a) => a.type).sort(), ['youtube.connect', 'youtube.disconnect', 'youtube.upload']);
});
