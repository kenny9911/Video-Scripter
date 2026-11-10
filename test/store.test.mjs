// The saved-gateway store, exercised through the real HTTP API against a temp file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const PORT = 3900 + Math.floor(Math.random() * 90);
const base = `http://127.0.0.1:${PORT}`;
const call = async (method, url, body) => {
  const res = await fetch(base + url, { method, headers: body && { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

test('gateways can be saved, edited, selected and deleted', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'scripter-'));
  const file = path.join(dir, 'gateway.json');
  // Start from an older single-gateway file to cover the upgrade path.
  await writeFile(file, JSON.stringify({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-legacy-0000001', model: 'deepseek-chat' }));
  const env = { ...process.env, PORT: String(PORT), GATEWAY_CONFIG_FILE: file, DATA_DIR: dir, LLM_PROVIDER: '', API_KEY: '', LLM_API_KEY: '' };
  const child = spawn(process.execPath, ['server.mjs'], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(async () => {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise((resolve) => child.stdout.once('data', resolve));

  let r = await call('GET', '/api/gateway/config');
  assert.equal(r.body.profiles.length, 1);
  assert.deepEqual([r.body.profiles[0].name, r.body.profiles[0].hasKey, r.body.activeId], ['DeepSeek', true, 'default']);

  // Save a second gateway without switching to it.
  r = await call('PUT', '/api/gateway/config', { name: 'Local', provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen3', models: ['qwen3', 'llama3'] });
  assert.equal(r.status, 200);
  const id = r.body.savedId;
  assert.deepEqual([r.body.profiles.length, r.body.activeId], [2, 'default']);
  assert.deepEqual(r.body.profiles[1].models, ['qwen3', 'llama3']);

  // Edit it: rename, keep the rest.
  r = await call('PUT', '/api/gateway/config', { id, name: 'Local box', provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen3' });
  assert.deepEqual([r.body.profiles[1].name, r.body.profiles[1].models], ['Local box', ['qwen3', 'llama3']]);

  // Select it with a different enabled model; a model that is not enabled is refused.
  r = await call('POST', '/api/gateway/select', { id, model: 'llama3' });
  assert.deepEqual([r.body.activeId, r.body.profiles[1].model, r.body.profiles[1].models], [id, 'llama3', ['llama3', 'qwen3']]);
  assert.equal((await call('POST', '/api/gateway/select', { id, model: 'nope' })).status, 400);

  // Invalid settings are not saved; keys never come back and stay with their own gateway.
  assert.equal((await call('PUT', '/api/gateway/config', { provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' })).status, 400);
  assert.ok(!JSON.stringify(r.body).includes('legacy'));
  const onDisk = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(onDisk.profiles.map((p) => p.apiKey), ['sk-legacy-0000001', '']);

  // Deleting the gateway in use falls back to the remaining one.
  r = await call('POST', '/api/gateway/delete', { id });
  assert.deepEqual([r.body.profiles.length, r.body.activeId], [1, 'default']);
  // Deleting the last one returns to the environment default (demo mode here).
  r = await call('POST', '/api/gateway/delete', { id: 'default' });
  assert.deepEqual([r.body.profiles.length, r.body.profiles[0].provider], [1, 'mock']);

  // Image / video model listing needs an address of its own when the gateway has none.
  r = await call('POST', '/api/gateway/models', { provider: 'mock', kind: 'image' });
  assert.deepEqual([r.body.ok, /Demo mode has no image models/.test(r.body.error)], [false, true]);
  r = await call('POST', '/api/gateway/models', { provider: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'k', model: 'm', kind: 'video' });
  assert.match(r.body.error, /Set a video BASE_URL_API first/);

  // History and generated media are saved on disk and come back after a reload.
  const script = { title: 'T', scenes: [{ id: 1, start: 0, end: 4, visual: 'A desk', camera: 'wide' }] };
  assert.equal((await call('POST', '/api/history', { platformId: 'tiktok' })).status, 400);
  const first = (await call('POST', '/api/history', { platformId: 'tiktok', brief: { topic: 'x' }, script, ts: 1000 })).body;
  const second = (await call('POST', '/api/history', { platformId: 'douyin', brief: { topic: 'y' }, script })).body;
  r = await call('POST', '/api/media/image', { ...script.scenes[0], historyId: first.id, sceneId: 1 });
  assert.match(r.body.url, new RegExp(`^/media/${first.id}-s1-image-\\w+\\.svg$`));
  const img = await fetch(base + r.body.url, { headers: { range: 'bytes=0-3' } });
  assert.deepEqual([img.status, img.headers.get('content-type'), await img.text()], [206, 'image/svg+xml', '<svg']);
  assert.equal((await fetch(`${base}/media/..%2Fgateway.json`)).status, 404);
  const list = (await call('GET', '/api/history')).body;
  assert.deepEqual(list.map((e) => e.id), [second.id, first.id]); // newest first
  assert.equal(list[1].media[1].image.url, r.body.url);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'history.json'), 'utf8')).length, 2);

  // Up to three images per scene; a package then numbers them.
  r = await call('POST', '/api/media/image', { ...script.scenes[0], historyId: second.id, sceneId: 1, count: 9 });
  assert.deepEqual([r.body.urls.length, new Set(r.body.urls).size, r.body.url], [3, 3, r.body.urls[0]]);
  assert.deepEqual((await call('GET', '/api/history')).body[0].media[1].image.urls, r.body.urls);
  const multi = path.join(dir, 'm.zip');
  await writeFile(multi, Buffer.from(await (await fetch(`${base}/api/history/package`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: second.id }) })).arrayBuffer()));
  assert.deepEqual(
    execFileSync('unzip', ['-Z1', multi], { encoding: 'utf8' }).trim().split('\n').filter((f) => f.includes('/images/')).map((f) => f.split('/').pop()),
    [1, 2, 3].map((n) => `scene-01_00m00s-00m04s_${n}.svg`),
  );

  // A mode gives each image of the set its own role, shown in the file name.
  r = await call('POST', '/api/media/image', { ...script.scenes[0], historyId: second.id, sceneId: 1, count: 2, mode: 'sequence' });
  assert.deepEqual([r.body.urls.length, r.body.shots], [2, ['start', 'end']]);
  await writeFile(multi, Buffer.from(await (await fetch(`${base}/api/history/package`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: second.id }) })).arrayBuffer()));
  assert.deepEqual(
    execFileSync('unzip', ['-Z1', multi], { encoding: 'utf8' }).trim().split('\n').filter((f) => f.includes('/images/')).map((f) => f.split('/').pop()),
    ['scene-01_00m00s-00m04s_1-start.svg', 'scene-01_00m00s-00m04s_2-end.svg'],
  );

  // The package: one zip, named by date, platform and title, with script files and the scene's image.
  const day = new Date(1000); // the entry's timestamp, in local time
  const root = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}_tiktok_T`;
  const zipRes = await fetch(`${base}/api/history/package`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: first.id, markdown: '# T' }) });
  assert.equal(zipRes.headers.get('content-type'), 'application/zip');
  assert.match(zipRes.headers.get('content-disposition'), new RegExp(`filename\\*=UTF-8''${root}\\.zip$`));
  const zipFile = path.join(dir, 'p.zip');
  await writeFile(zipFile, Buffer.from(await zipRes.arrayBuffer()));
  const listing = execFileSync('unzip', ['-Z1', zipFile], { encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(listing, ['script.md', 'script.json', 'voiceover.txt', 'images/scene-01_00m00s-00m04s.svg'].map((f) => `${root}/${f}`));
  assert.equal(execFileSync('unzip', ['-p', zipFile, `${root}/script.md`], { encoding: 'utf8' }), '# T');
  execFileSync('unzip', ['-tq', zipFile]); // CRCs check out
  assert.equal((await call('POST', '/api/history/package', { id: 'nope' })).status, 404);
});
