// The whole application through its real HTTP API: accounts, access rules, gateways, scripts,
// media, the zip package, usage and the activity log.
// Runs against a temporary folder by default; set TEST_DATABASE_URL to run the same checks on Postgres.
import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = 3900 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${PORT}`;
const PG = process.env.TEST_DATABASE_URL || '';
const ADMIN = { email: 'boss@example.test', password: 'correct-horse-battery' };

/** A browser-like client: remembers the session cookie between calls. */
function client() {
  let cookie = '';
  const raw = async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, { method, headers: { ...(body && { 'content-type': 'application/json' }), ...(cookie && { cookie }), ...headers }, body: body && JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return res;
  };
  const call = async (method, url, body) => {
    const res = await raw(method, url, body);
    return { status: res.status, body: await res.json() };
  };
  /** POST that answers with server-sent events; returns them as [{ event, data }]. */
  const events = async (url, body) => {
    const text = await (await raw('POST', url, body)).text();
    return text
      .split('\n\n')
      .filter(Boolean)
      .map((block) => ({ event: /^event: (.*)$/m.exec(block)?.[1], data: JSON.parse(/^data: (.*)$/m.exec(block)?.[1] || 'null') }));
  };
  return { raw, call, events, hasSession: () => cookie.length > 'vs_session='.length };
}

test('accounts, access rules, gateways, scripts, media, usage and activity', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scripter-'));
  const file = path.join(dir, 'gateway.json');
  // Start from an older single-gateway file to cover the upgrade path.
  await writeFile(file, JSON.stringify({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-legacy-0000001', model: 'deepseek-chat' }));
  const env = { ...process.env, PORT: String(PORT), GATEWAY_CONFIG_FILE: file, DATA_DIR: dir, DATABASE_URL: PG, POSTGRES_URL: '', LLM_PROVIDER: '', API_KEY: '', LLM_API_KEY: '', ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, ALLOW_SIGNUP: '' };
  const child = spawn(process.execPath, ['server.mjs'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(async () => {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise((resolve) => child.stdout.once('data', resolve));

  // ---------- Signed out ----------
  const anon = client();
  assert.deepEqual((await anon.call('GET', '/api/auth/me')).body, { user: null, signupOpen: true });
  for (const [method, url] of [['GET', '/api/meta'], ['GET', '/api/history'], ['GET', '/api/gateway/config'], ['POST', '/api/generate'], ['GET', '/api/usage']]) {
    assert.equal((await anon.call(method, url, method === 'POST' ? {} : undefined)).status, 401, url);
  }
  assert.equal((await anon.raw('GET', '/api/meta', undefined, { origin: 'https://evil.example' })).status, 403); // cross-site calls are refused

  // The visitor beacon is open to everyone; the funnel it feeds is for administrators.
  const beacon = await client().raw('POST', '/api/track', { e: 'view', p: 'home', ref: 'news.example' }, { 'user-agent': 'Mozilla/5.0 (test browser)' });
  assert.deepEqual([beacon.status, /^vs_vid=[a-f0-9]{24};/.test(beacon.headers.get('set-cookie'))], [200, true]);
  assert.equal((await anon.call('GET', '/api/admin/visitors')).status, 401);

  // ---------- The administrator from ADMIN_EMAIL / ADMIN_PASSWORD ----------
  const admin = client();
  assert.equal((await admin.call('POST', '/api/auth/login', { email: ADMIN.email, password: 'wrong-password' })).status, 401);
  let r = await admin.call('POST', '/api/auth/login', { email: ADMIN.email.toUpperCase(), password: ADMIN.password }); // email is case-insensitive
  assert.deepEqual([r.status, r.body.user.role, r.body.user.email], [200, 'admin', ADMIN.email]);
  assert.ok(!JSON.stringify(r.body).includes('scrypt') && admin.hasSession());
  assert.equal((await admin.call('GET', '/api/auth/me')).body.storage.kind, PG ? 'postgres' : 'file');
  r = await admin.call('GET', '/api/admin/visitors?days=0');
  assert.deepEqual([r.status, r.body.funnel.visitors, r.body.bySource[0].key], [200, 1, 'news.example']);

  // ---------- Gateways (administrator only) ----------
  r = await admin.call('GET', '/api/gateway/config');
  assert.equal(r.body.profiles.length, 1);
  assert.deepEqual([r.body.profiles[0].name, r.body.profiles[0].hasKey, r.body.activeId], ['DeepSeek', true, 'default']);

  // Save a second gateway without making it the default.
  r = await admin.call('PUT', '/api/gateway/config', { name: 'Local', provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen3', models: ['qwen3', 'llama3'] });
  assert.equal(r.status, 200);
  const id = r.body.savedId;
  assert.deepEqual([r.body.profiles.length, r.body.activeId], [2, 'default']);
  assert.deepEqual(r.body.profiles[1].models, ['qwen3', 'llama3']);

  // Edit it: rename, keep the rest.
  r = await admin.call('PUT', '/api/gateway/config', { id, name: 'Local box', provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen3' });
  assert.deepEqual([r.body.profiles[1].name, r.body.profiles[1].models], ['Local box', ['qwen3', 'llama3']]);

  // Invalid settings are not saved; keys never come back and stay with their own gateway.
  assert.equal((await admin.call('PUT', '/api/gateway/config', { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' })).status, 400);
  assert.ok(!JSON.stringify(r.body).includes('legacy'));
  if (!PG) {
    const [saved] = JSON.parse(await readFile(path.join(dir, 'config.json'), 'utf8'));
    assert.deepEqual(saved.profiles.map((p) => p.apiKey), ['sk-legacy-0000001', '']);
  }

  // ---------- A member signs up ----------
  const ann = client();
  assert.equal((await ann.call('POST', '/api/auth/signup', { email: 'not-an-email', password: 'long-enough-1' })).status, 400);
  assert.equal((await ann.call('POST', '/api/auth/signup', { email: 'ann@example.test', password: 'short' })).status, 400);
  r = await ann.call('POST', '/api/auth/signup', { email: 'Ann@Example.test', password: 'ann-password-1', name: 'Ann' });
  assert.deepEqual([r.status, r.body.user.role, r.body.user.email, r.body.user.name], [200, 'user', 'ann@example.test', 'Ann']);
  assert.equal((await client().call('POST', '/api/auth/signup', { email: 'ann@example.test', password: 'another-pass-1' })).status, 409);
  assert.equal((await client().call('POST', '/api/auth/signup', { email: ADMIN.email, password: 'another-pass-1' })).status, 409); // nobody can sign up as the admin

  // A member sees only the gateway in use, without addresses or keys, and cannot touch settings or other accounts.
  r = await ann.call('GET', '/api/gateway/config');
  assert.deepEqual([r.body.profiles.length, r.body.activeId, r.body.profiles[0].models], [1, 'default', ['deepseek-chat']]);
  assert.deepEqual(Object.keys(r.body.profiles[0]).sort(), ['hasKey', 'id', 'image', 'model', 'models', 'name', 'provider', 'video']);
  for (const [method, url] of [['PUT', '/api/gateway/config'], ['POST', '/api/gateway/select'], ['POST', '/api/gateway/delete'], ['POST', '/api/gateway/test'], ['POST', '/api/gateway/models'], ['GET', '/api/admin/users'], ['POST', '/api/admin/users/update']]) {
    assert.equal((await ann.call(method, url, method === 'GET' ? undefined : {})).status, 403, url);
  }

  // The administrator's pick of gateway and model is the one everybody writes with.
  r = await admin.call('POST', '/api/gateway/select', { id, model: 'llama3' });
  assert.deepEqual([r.body.activeId, r.body.profiles[1].model, r.body.profiles[1].models], [id, 'llama3', ['llama3', 'qwen3']]);
  assert.equal((await admin.call('POST', '/api/gateway/select', { id, model: 'nope' })).status, 400);
  r = await ann.call('GET', '/api/gateway/config');
  assert.deepEqual([r.body.activeId, r.body.profiles.map((p) => [p.name, p.model])], [id, [['Local box', 'llama3']]]);

  // Deleting the gateway in use falls back to the first one left; deleting the last one returns to demo mode.
  r = await admin.call('POST', '/api/gateway/delete', { id });
  assert.deepEqual([r.body.profiles.length, r.body.activeId], [1, 'default']);
  assert.equal((await ann.call('GET', '/api/gateway/config')).body.activeId, 'default');
  r = await admin.call('POST', '/api/gateway/delete', { id: 'default' });
  assert.deepEqual([r.body.profiles.length, r.body.profiles[0].provider], [1, 'mock']);

  // Image / video model listing needs an address of its own when the gateway has none.
  r = await admin.call('POST', '/api/gateway/models', { provider: 'mock', kind: 'image' });
  assert.deepEqual([r.body.ok, /Demo mode has no image models/.test(r.body.error)], [false, true]);
  r = await admin.call('POST', '/api/gateway/models', { provider: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'k', model: 'm', kind: 'video' });
  assert.match(r.body.error, /Set a video BASE_URL_API first/);

  // ---------- Ann writes a script: saved on the server, with its model call recorded ----------
  assert.equal((await ann.call('POST', '/api/generate', { platformId: 'tiktok' })).status, 400); // no topic
  const stream = await ann.events('/api/generate', { platformId: 'tiktok', topic: 'Why cats knock things over', duration: 30, styleIds: ['clay'] });
  assert.deepEqual([stream[0].event, stream.at(-1).event], ['plan', 'done']);
  const done = stream.at(-1).data;
  const taskId = done.historyId;
  assert.ok(done.script.scenes.length > 0 && stream[0].data.taskId === taskId && done.entry.userId);
  let list = (await ann.call('GET', '/api/history')).body;
  assert.deepEqual([list.length, list[0].id, list[0].brief.topic, list[0].brief.styleIds], [1, taskId, 'Why cats knock things over', ['clay']]);
  assert.deepEqual((await admin.call('GET', '/api/history')).body, []); // history is per user

  // Import still works and stays with the importing user.
  const script = { title: 'T', scenes: [{ id: 1, start: 0, end: 4, visual: 'A desk', camera: 'wide' }] };
  assert.equal((await ann.call('POST', '/api/history', { platformId: 'tiktok' })).status, 400);
  const first = (await ann.call('POST', '/api/history', { platformId: 'tiktok', brief: { topic: 'x' }, script, ts: 1000 })).body;

  // ---------- Media: stored, private to its owner, linked from the script ----------
  r = await ann.call('POST', '/api/media/image', { ...script.scenes[0], historyId: first.id, sceneId: 1 });
  assert.match(r.body.url, new RegExp(`^/media/${first.id}-s1-image-\\w+\\.svg$`));
  const img = await ann.raw('GET', r.body.url, undefined, { range: 'bytes=0-3' });
  assert.deepEqual([img.status, img.headers.get('content-type'), await img.text()], [206, 'image/svg+xml', '<svg']);
  assert.equal((await anon.raw('GET', r.body.url)).status, 401);
  assert.equal((await ann.raw('GET', '/media/..%2Fgateway.json')).status, 404);
  list = (await ann.call('GET', '/api/history')).body;
  assert.deepEqual(list.map((e) => e.id), [taskId, first.id]); // newest first
  assert.equal(list[1].media[1].image.url, r.body.url);

  // Another member cannot see Ann's script, its media or its package, nor add media to it.
  const bob = client();
  await bob.call('POST', '/api/auth/signup', { email: 'bob@example.test', password: 'bob-password-1' });
  assert.equal((await bob.raw('GET', r.body.url)).status, 404);
  assert.equal((await bob.call('POST', '/api/history/package', { id: first.id })).status, 404);
  assert.equal((await bob.call('POST', '/api/media/image', { ...script.scenes[0], historyId: first.id, sceneId: 1 })).status, 404);
  assert.equal((await admin.raw('GET', r.body.url)).status, 200); // an administrator can

  // Up to three images per scene; a mode gives each its own role, shown in the package's file names.
  r = await ann.call('POST', '/api/media/image', { ...script.scenes[0], historyId: taskId, sceneId: 1, count: 9 });
  assert.deepEqual([r.body.urls.length, new Set(r.body.urls).size, r.body.url], [3, 3, r.body.urls[0]]);
  assert.deepEqual((await ann.call('GET', '/api/history')).body[0].media[1].image.urls, r.body.urls);
  r = await ann.call('POST', '/api/media/image', { ...script.scenes[0], historyId: taskId, sceneId: 1, count: 2, mode: 'sequence' });
  assert.deepEqual([r.body.urls.length, r.body.shots], [2, ['start', 'end']]);
  const zipOf = async (body) => {
    const res = await ann.raw('POST', '/api/history/package', body);
    const target = path.join(dir, `${body.id}.zip`);
    await writeFile(target, Buffer.from(await res.arrayBuffer()));
    return { res, target, names: execFileSync('unzip', ['-Z1', target], { encoding: 'utf8' }).trim().split('\n') };
  };
  let zip = await zipOf({ id: taskId });
  const shots = zip.names.filter((f) => f.includes('/images/')).map((f) => f.split('/').pop());
  assert.ok(shots.length === 2 && /^scene-01_.*_1-start\.svg$/.test(shots[0]) && /^scene-01_.*_2-end\.svg$/.test(shots[1]), shots.join(', '));

  // The package: one zip, named by date, platform and title, with script files and the scene's image.
  const day = new Date(1000); // the imported entry's timestamp, in local time
  const root = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}_tiktok_T`;
  zip = await zipOf({ id: first.id, markdown: '# T' });
  assert.equal(zip.res.headers.get('content-type'), 'application/zip');
  assert.match(zip.res.headers.get('content-disposition'), new RegExp(`filename\\*=UTF-8''${root}\\.zip$`));
  assert.deepEqual(zip.names, ['script.md', 'script.html', 'script.json', 'voiceover.txt', 'images/scene-01_00m00s-00m04s.svg'].map((f) => `${root}/${f}`));
  // The HTML page stands alone: it shows the scene's image from the folder next to it, and escapes what the model wrote.
  const page = execFileSync('unzip', ['-p', zip.target, `${root}/script.html`], { encoding: 'utf8' });
  assert.ok(page.startsWith('<!doctype html>') && page.includes('<h1>T</h1>') && page.includes('src="images/scene-01_00m00s-00m04s.svg"') && page.includes('>Script</h2>'));
  assert.ok(!/<script|https?:\/\//.test(page)); // no code, nothing loaded from the network
  const { scriptHtml } = await import('../src/html.mjs');
  const risky = scriptHtml({ ts: 0, platformId: 'douyin', script: { title: '<img src=x onerror=alert(1)>', logline: '', hookOptions: [], scenes: [{ id: 1, start: 0, end: 3, voiceover: '[[重点]] ⏸ <b>x</b>', visual: '"quoted"' }], publish: {}, productionNotes: [] } }, { lang: 'zh' });
  assert.ok(risky.includes('&lt;img src=x onerror=alert(1)&gt;') && risky.includes('<mark>重点</mark>') && risky.includes('&lt;b&gt;x&lt;/b&gt;') && risky.includes('>脚本</h2>') && !risky.includes('<img src=x'));
  assert.equal(execFileSync('unzip', ['-p', zip.target, `${root}/script.md`], { encoding: 'utf8' }), '# T');
  execFileSync('unzip', ['-tq', zip.target]); // CRCs check out
  assert.equal((await ann.call('POST', '/api/history/package', { id: 'nope' })).status, 404);

  // ---------- Usage: every model call, by task and by user ----------
  r = await ann.call('GET', '/api/usage?days=7');
  assert.equal(r.body.scope, 'me');
  assert.deepEqual([r.body.total.calls, r.body.total.images, r.body.total.failed], [7, 6, 0]); // 1 script + 1 + 3 + 2 images
  assert.ok(r.body.total.inputTokens > 0 && r.body.total.outputTokens > 0 && r.body.total.estimated === 7); // the demo model reports no counts
  const task = r.body.byTask.find((x) => x.key === taskId);
  assert.deepEqual([task.calls, task.images, task.platformId, Boolean(task.title)], [6, 5, 'tiktok', true]);
  assert.deepEqual(r.body.byKind.map((k) => [k.key, k.calls]).sort(), [['image', 6], ['script', 1]]);
  assert.equal((await ann.call('GET', '/api/usage?scope=all')).body.scope, 'me'); // a member cannot widen the scope
  assert.equal((await bob.call('GET', '/api/usage')).body.total.calls, 0);
  r = await admin.call('GET', '/api/usage?scope=all&days=0');
  assert.deepEqual([r.body.scope, r.body.total.calls, r.body.byUser.find((u) => u.email === 'ann@example.test').calls], ['all', 7, 7]);

  // ---------- Activity log ----------
  r = await ann.call('GET', '/api/activity');
  const types = r.body.items.map((a) => a.type);
  for (const type of ['auth.signup', 'script.generate', 'image.generate', 'script.download']) assert.ok(types.includes(type), type);
  assert.ok(r.body.items.every((a) => a.email === 'ann@example.test'));
  r = await admin.call('GET', '/api/activity?scope=all');
  const all = r.body.items.map((a) => a.type);
  for (const type of ['auth.login', 'auth.login_failed', 'gateway.create', 'gateway.update', 'gateway.delete']) assert.ok(all.includes(type), type);
  assert.ok(!JSON.stringify(r.body).includes('wrong-password')); // attempted passwords are never logged

  // ---------- User management ----------
  r = await admin.call('GET', '/api/admin/users');
  const annRow = r.body.users.find((u) => u.email === 'ann@example.test');
  assert.deepEqual([r.body.users.length, annRow.scripts, annRow.usage.calls], [3, 2, 7]);
  assert.ok(!JSON.stringify(r.body).includes('passwordHash'));
  const me = r.body.users.find((u) => u.role === 'admin');
  assert.equal((await admin.call('POST', '/api/admin/users/update', { id: me.id, disabled: true })).status, 400); // not yourself
  r = await admin.call('POST', '/api/admin/users/update', { id: annRow.id, disabled: true });
  assert.equal(r.body.user.disabled, true);
  assert.equal((await ann.call('GET', '/api/history')).status, 401); // her session ended
  assert.equal((await client().call('POST', '/api/auth/login', { email: 'ann@example.test', password: 'ann-password-1' })).status, 403);

  // ---------- Complete user management ----------
  // Create: an administrator makes an account; the person can log in with the password they were given.
  r = await admin.call('POST', '/api/admin/users/create', { email: 'carl@example.test', password: 'carl-password-1', name: 'Carl', role: 'user' });
  const carlId = r.body.user.id;
  assert.deepEqual([r.status, r.body.user.role, r.body.user.name], [200, 'user', 'Carl']);
  assert.equal((await admin.call('POST', '/api/admin/users/create', { email: 'carl@example.test', password: 'carl-password-2' })).status, 409);
  assert.equal((await admin.call('POST', '/api/admin/users/create', { email: 'x@example.test', password: 'short' })).status, 400);
  const carl = client();
  assert.equal((await carl.call('POST', '/api/auth/login', { email: 'carl@example.test', password: 'carl-password-1' })).status, 200);
  r = await admin.call('GET', `/api/admin/users/detail?id=${carlId}`);
  assert.deepEqual([r.body.user.email, r.body.sessions, r.body.scripts, r.body.usage.total.calls, r.body.activity[0].type], ['carl@example.test', 1, 0, 0, 'auth.login']);
  for (const url of ['/api/admin/users/create', '/api/admin/users/password', '/api/admin/users/logout', '/api/admin/users/delete']) assert.equal((await carl.call('POST', url, { id: me.id })).status, 403, url);
  assert.equal((await carl.call('GET', `/api/admin/users/detail?id=${carlId}`)).status, 403);

  // Edit: name and email (unique, valid), then role.
  r = await admin.call('POST', '/api/admin/users/update', { id: carlId, name: 'Carl R.', email: 'Carl.R@example.test' });
  assert.deepEqual([r.body.user.name, r.body.user.email], ['Carl R.', 'carl.r@example.test']);
  assert.equal((await admin.call('POST', '/api/admin/users/update', { id: carlId, email: 'bob@example.test' })).status, 409);
  assert.equal((await admin.call('POST', '/api/admin/users/update', { id: carlId, email: 'nope' })).status, 400);
  assert.equal((await admin.call('POST', '/api/admin/users/update', { id: carlId, role: 'admin' })).body.user.role, 'admin');
  assert.equal((await carl.call('GET', '/api/admin/users')).status, 200); // promoted
  assert.equal((await admin.call('POST', '/api/admin/users/update', { id: me.id, role: 'user' })).status, 400); // never yourself
  assert.equal((await admin.call('POST', '/api/admin/users/update', { id: carlId, role: 'user' })).body.user.role, 'user');

  // Reset password: the old one stops working and every session of that user ends.
  assert.equal((await admin.call('POST', '/api/admin/users/password', { id: carlId, password: 'short' })).status, 400);
  assert.equal((await admin.call('POST', '/api/admin/users/password', { id: carlId, password: 'carl-reset-pass-9' })).status, 200);
  assert.equal((await carl.call('GET', '/api/history')).status, 401);
  assert.equal((await carl.call('POST', '/api/auth/login', { email: 'carl.r@example.test', password: 'carl-password-1' })).status, 401);
  assert.equal((await carl.call('POST', '/api/auth/login', { email: 'carl.r@example.test', password: 'carl-reset-pass-9' })).status, 200);

  // Log out everywhere.
  assert.equal((await admin.call('POST', '/api/admin/users/logout', { id: carlId })).status, 200);
  assert.equal((await carl.call('GET', '/api/history')).status, 401);

  // "Generate images with the script" is off until the user turns it on, and is remembered on their account.
  await carl.call('POST', '/api/auth/login', { email: 'carl.r@example.test', password: 'carl-reset-pass-9' });
  assert.equal((await carl.call('GET', '/api/auth/me')).body.user.prefs.autoImages, undefined);
  assert.equal((await carl.call('POST', '/api/auth/prefs', { autoImages: true, role: 'admin' })).body.prefs.autoImages, true);
  r = await carl.call('GET', '/api/auth/me');
  assert.deepEqual([r.body.user.prefs.autoImages, r.body.user.role], [true, 'user']); // only the known preference is stored
  assert.equal((await carl.call('POST', '/api/auth/prefs', { autoImages: false })).body.prefs.autoImages, false);
  assert.equal((await anon.call('POST', '/api/auth/prefs', { autoImages: true })).status, 401);

  // A user changes their own name and password; the session they are using carries on, others end.
  const carl2 = client();
  await carl.call('POST', '/api/auth/login', { email: 'carl.r@example.test', password: 'carl-reset-pass-9' });
  await carl2.call('POST', '/api/auth/login', { email: 'carl.r@example.test', password: 'carl-reset-pass-9' });
  assert.equal((await carl.call('POST', '/api/auth/profile', { name: 'Carlos' })).body.user.name, 'Carlos');
  assert.equal((await carl.call('POST', '/api/auth/password', { current: 'wrong-current-1', password: 'carl-own-pass-77' })).status, 400);
  assert.equal((await carl.call('POST', '/api/auth/password', { current: 'carl-reset-pass-9', password: 'carl-own-pass-77' })).status, 200);
  assert.equal((await carl.call('GET', '/api/auth/me')).body.user.name, 'Carlos');
  assert.equal((await carl2.call('GET', '/api/history')).status, 401);
  assert.ok(!JSON.stringify((await admin.call('GET', '/api/activity?scope=all&limit=500')).body).includes('carl-own-pass')); // passwords never reach the log

  // Delete with "transfer": Ann's scripts and media move to the administrator.
  assert.equal((await admin.call('POST', '/api/admin/users/delete', { id: me.id })).status, 400); // not yourself
  r = await admin.call('POST', '/api/admin/users/delete', { id: annRow.id, scripts: 'transfer' });
  assert.deepEqual([r.body.scripts, r.body.transferred], [2, true]);
  const mine = (await admin.call('GET', '/api/history')).body;
  assert.equal(mine.length, 2);
  assert.equal((await admin.raw('GET', mine[1].media[1].image.url)).status, 200);
  assert.equal((await client().call('POST', '/api/auth/login', { email: 'ann@example.test', password: 'ann-password-1' })).status, 401);

  // Delete outright: the account, its scripts and its media files are gone; the usage record stays.
  const dana = client();
  const danaId = (await dana.call('POST', '/api/auth/signup', { email: 'dana@example.test', password: 'dana-password-1' })).body.user.id;
  const hers = (await dana.call('POST', '/api/history', { platformId: 'tiktok', brief: { topic: 'd' }, script })).body;
  const herImage = (await dana.call('POST', '/api/media/image', { ...script.scenes[0], historyId: hers.id, sceneId: 1 })).body.url;
  assert.equal((await admin.raw('GET', herImage)).status, 200);
  r = await admin.call('POST', '/api/admin/users/delete', { id: danaId });
  assert.deepEqual([r.body.scripts, r.body.transferred], [1, false]);
  assert.equal((await admin.raw('GET', herImage)).status, 404);
  assert.equal((await dana.call('GET', '/api/history')).status, 401);
  r = await admin.call('GET', '/api/admin/users');
  assert.deepEqual(r.body.users.map((u) => u.email).sort(), ['bob@example.test', ADMIN.email, 'carl.r@example.test'].sort());
  assert.equal((await admin.call('GET', '/api/usage?scope=all&days=0')).body.total.calls, 8); // nothing erased from the audit trail
  const log = (await admin.call('GET', '/api/activity?scope=all&limit=500')).body.items.map((a) => a.type);
  for (const type of ['admin.user_create', 'admin.user_update', 'admin.user_password', 'admin.user_logout', 'admin.user_delete', 'auth.password_change', 'auth.profile_update']) assert.ok(log.includes(type), type);

  // Test API: a prompt goes to the model as the form stands, and the reply comes back with what it cost.
  r = await admin.call('POST', '/api/gateway/test', { provider: 'mock', prompt: 'Say hello in one sentence.' });
  assert.ok(r.body.ok && r.body.reply.length > 0, JSON.stringify(r.body));
  assert.ok(r.body.inputTokens > 0 && r.body.outputTokens > 0 && r.body.truncated === false);
  r = await admin.call('POST', '/api/gateway/test', { provider: 'mock' });
  assert.ok(r.body.ok && !('inputTokens' in r.body), 'no prompt: the plain connectivity check');
  r = await admin.call('POST', '/api/gateway/test', { provider: 'custom', baseUrl: 'http://127.0.0.1:9/v1', model: 'm', prompt: 'hi' });
  assert.deepEqual([r.body.ok, r.body.cause.side, r.body.cause.code], [false, 'network', 'unreachable'], JSON.stringify(r.body));
  // A provider that refuses: the test answers with what that endpoint said, word for word.
  const refusal = '{"error":{"message":"No available accounts","type":"api_error"},"request_id":"r-1"}';
  const down = http.createServer((q, s) => s.writeHead(403, { 'content-type': 'application/json' }).end(refusal));
  await new Promise((done) => down.listen(0, '127.0.0.1', done));
  r = await admin.call('POST', '/api/gateway/test', { provider: 'custom', baseUrl: `http://127.0.0.1:${down.address().port}/v1`, model: 'm', prompt: 'hi' });
  down.close();
  assert.deepEqual(r.body.endpoint, { url: `http://127.0.0.1:${down.address()?.port ?? r.body.endpoint.url.split(':')[2].split('/')[0]}/v1/chat/completions`, status: 403, statusText: 'Forbidden', body: refusal });
  assert.deepEqual([r.body.ok, r.body.cause.code, r.body.error.includes('No available accounts')], [false, 'key', true]);
  r = await admin.call('GET', '/api/usage?scope=all&days=0');
  assert.deepEqual(r.body.byKind.find((k) => k.key === 'test').calls, 4, 'each test is on the usage record, failed ones too');

  // Five wrong passwords lock an account for a while, even for the right password.
  for (let i = 0; i < 5; i++) await client().call('POST', '/api/auth/login', { email: 'bob@example.test', password: 'guess-number-' + i });
  assert.equal((await client().call('POST', '/api/auth/login', { email: 'bob@example.test', password: 'bob-password-1' })).status, 429);

  // Logging out ends the session.
  await admin.call('POST', '/api/auth/logout');
  assert.equal((await admin.call('GET', '/api/history')).status, 401);
});
