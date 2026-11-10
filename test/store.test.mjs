// The whole application through its real HTTP API: accounts, access rules, gateways, scripts,
// media, the zip package, usage and the activity log.
// Runs against a temporary folder by default; set TEST_DATABASE_URL to run the same checks on Postgres.
import test from 'node:test';
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

  // ---------- The administrator from ADMIN_EMAIL / ADMIN_PASSWORD ----------
  const admin = client();
  assert.equal((await admin.call('POST', '/api/auth/login', { email: ADMIN.email, password: 'wrong-password' })).status, 401);
  let r = await admin.call('POST', '/api/auth/login', { email: ADMIN.email.toUpperCase(), password: ADMIN.password }); // email is case-insensitive
  assert.deepEqual([r.status, r.body.user.role, r.body.user.email], [200, 'admin', ADMIN.email]);
  assert.ok(!JSON.stringify(r.body).includes('scrypt') && admin.hasSession());
  assert.equal((await admin.call('GET', '/api/auth/me')).body.storage.kind, PG ? 'postgres' : 'file');

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

  // A member sees the model picker but no addresses or keys, and cannot touch settings or other accounts.
  r = await ann.call('GET', '/api/gateway/config');
  assert.deepEqual(Object.keys(r.body.profiles[0]).sort(), ['hasKey', 'id', 'image', 'model', 'models', 'name', 'provider', 'video']);
  for (const [method, url] of [['PUT', '/api/gateway/config'], ['POST', '/api/gateway/delete'], ['POST', '/api/gateway/test'], ['POST', '/api/gateway/models'], ['GET', '/api/admin/users'], ['POST', '/api/admin/users/update']]) {
    assert.equal((await ann.call(method, url, method === 'GET' ? undefined : {})).status, 403, url);
  }

  // Picking a gateway and model is per user: Ann's choice does not move the administrator's.
  r = await ann.call('POST', '/api/gateway/select', { id, model: 'llama3' });
  assert.deepEqual([r.body.activeId, r.body.profiles[1].model, r.body.profiles[1].models], [id, 'llama3', ['llama3', 'qwen3']]);
  assert.equal((await ann.call('POST', '/api/gateway/select', { id, model: 'nope' })).status, 400);
  assert.equal((await admin.call('GET', '/api/gateway/config')).body.activeId, 'default');

  // Deleting a gateway someone picked falls back to the default; deleting the last one returns to demo mode.
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
  assert.deepEqual(zip.names, ['script.md', 'script.json', 'voiceover.txt', 'images/scene-01_00m00s-00m04s.svg'].map((f) => `${root}/${f}`));
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

  // Five wrong passwords lock an account for a while, even for the right password.
  for (let i = 0; i < 5; i++) await client().call('POST', '/api/auth/login', { email: 'bob@example.test', password: 'guess-number-' + i });
  assert.equal((await client().call('POST', '/api/auth/login', { email: 'bob@example.test', password: 'bob-password-1' })).status, 429);

  // Logging out ends the session.
  await admin.call('POST', '/api/auth/logout');
  assert.equal((await admin.call('GET', '/api/history')).status, 401);
});
