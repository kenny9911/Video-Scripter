// A live check of the saved gateways: one short question to the model of each, through the app's own client,
// with the address it was asked at. Run it when a provider starts failing, before changing any setting:
//
//   npm run check:gateways                the gateway in use, its default model
//   npm run check:gateways -- --all       every saved gateway, every enabled model
//   npm run check:gateways -- --doors     also knock on every door of the gateway (see below)
//
// When a call fails, or with --doors, the same question is put to each wire format the gateway might speak
// for that model: OpenAI chat/completions, Gemini generateContent and Anthropic messages. That is how a key
// that is "rate limited" at one door and fine at another is told from a provider that is really down.
// It reads the gateways from the same place the server does (data/, or DATABASE_URL). Each check costs a
// few tokens. No key is ever printed. Exits 1 when a check fails.

import { loadStore, activeProfile, enabledModels, validateConfig } from '../src/gateway/config.mjs';
import { getProvider } from '../src/gateway/providers.mjs';
import { completeChat, endpointOf, apiBase, geminiRoot, errorDetail } from '../src/gateway/client.mjs';
import { db } from '../src/db.mjs';

const args = new Set(process.argv.slice(2));
const QUESTION = 'Reply with the single word OK.';
const SECONDS = 90;
const ms = (t0) => `${String(Date.now() - t0).padStart(6)} ms`;

/** One raw request to one door: its status and what it said, in a line. */
async function knock(name, url, headers, body) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(SECONDS * 1000) });
    const text = await res.text();
    const said = res.ok ? 'answered' : errorDetail(res.status, text) || res.statusText;
    console.log(`      ${res.ok ? 'ok  ' : 'FAIL'} ${res.status} ${ms(t0)}  ${name}  ${new URL(url).pathname}${res.ok ? '' : `  ${said.slice(0, 160)}`}`);
    return res.ok;
  } catch (err) {
    console.log(`      FAIL --- ${ms(t0)}  ${name}  ${new URL(url).pathname}  ${err.name === 'TimeoutError' ? `no answer in ${SECONDS} s` : err.cause?.message || err.message}`);
    return false;
  }
}

/** The same question at every door the gateway might have for this model. */
async function doors(config) {
  const key = config.apiKey;
  const model = config.model;
  const chat = apiBase(config.baseUrl.replace(/\/chat\/completions\/?$/, ''));
  const root = geminiRoot(config.baseUrl);
  console.log('      Every door of this gateway, for this model:');
  await knock('OpenAI chat/completions ', `${chat}/chat/completions`, { authorization: `Bearer ${key}` }, { model, messages: [{ role: 'user', content: QUESTION }] });
  await knock('Gemini generateContent  ', `${root}/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key }, { contents: [{ role: 'user', parts: [{ text: QUESTION }] }] });
  await knock('Anthropic messages      ', `${root}/v1/messages`, { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, { model, max_tokens: 64, messages: [{ role: 'user', content: QUESTION }] });
}

async function check(profile, model, active) {
  const config = { ...profile, model };
  console.log(`\n${profile.name}${active ? ' (in use)' : ''} · ${getProvider(profile.provider)?.label || profile.provider} · ${model || 'no model'}`);
  const invalid = validateConfig(config);
  if (invalid) return (console.log(`  FAIL  not set up: ${invalid}`), false);
  const t0 = Date.now();
  let ok = false;
  try {
    const door = await endpointOf(config, { signal: AbortSignal.timeout(20_000) });
    console.log(`  called at  ${door.url}  (${door.protocol} format)`);
    let tries = 0;
    const reply = (await completeChat(config, { system: 'You are a connectivity check.', user: QUESTION, signal: AbortSignal.timeout(SECONDS * 1000), onRetry: () => tries++ })).trim();
    ok = Boolean(reply);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${ms(t0)}  ${ok ? `replied “${reply.slice(0, 60)}”` : 'an empty reply'}${tries ? `  after ${tries} more ${tries === 1 ? 'try' : 'tries'}` : ''}`);
  } catch (err) {
    console.log(`  FAIL  ${ms(t0)}  ${err.name === 'TimeoutError' ? `no answer in ${SECONDS} s` : err.message}${err.attempts > 1 ? `  (tried ${err.attempts} times)` : ''}`);
  }
  if (!ok || args.has('--doors')) await doors(config);
  return ok;
}

const store = await loadStore();
const active = activeProfile(store);
const profiles = args.has('--all') ? store.profiles : [active];
let failed = 0;
for (const profile of profiles) {
  if (getProvider(profile.provider)?.protocol === 'mock') {
    console.log(`\n${profile.name}: demo mode, nothing to check. Connect a model in LLM settings first.`);
    continue;
  }
  for (const model of args.has('--all') ? enabledModels(profile) : [profile.model]) if (!(await check(profile, model, profile.id === active.id))) failed++;
}
console.log(failed ? `\n${failed} check${failed === 1 ? '' : 's'} failed.` : '\nEvery check passed.');
await db.close();
process.exit(failed ? 1 : 0);
