import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cleanPricing, costOf, plazaGroups, priceListUrls, fetchPriceList } from '../src/gateway/prices.mjs';
import { mergeConfig, publicConfig, memberConfig } from '../src/gateway/config.mjs';

const plaza = JSON.parse(await readFile(new URL('./fixtures/model-plaza.json', import.meta.url), 'utf8'));
const sheet = (models, currency = 'USD') => ({ currency, source: '', models });

test('a call costs its tokens at the model’s price per million', () => {
  const pricing = sheet({ m: { input: 0.7, output: 3.5 } });
  assert.equal(costOf(pricing, { model: 'm', inputTokens: 1_000_000, outputTokens: 1_000_000 }), 4.2);
  assert.equal(costOf(pricing, { model: 'm', inputTokens: 391, outputTokens: 13 }), 0.0003192);
  assert.equal(costOf(pricing, { model: 'm' }), 0);
});

test('a model with no price is not priced, which is not free', () => {
  assert.equal(costOf(sheet({ m: { input: 1 } }), { model: 'other', inputTokens: 100 }), null);
  assert.equal(costOf(undefined, { model: 'm', inputTokens: 100 }), null);
  assert.equal(costOf(sheet({ m: { image: 0.08 } }), { model: 'm', inputTokens: 100, outputTokens: 5 }), null);
});

test('a long prompt is billed at the long-context price for the whole call', () => {
  const pricing = sheet({ m: { input: 0.5, output: 2.5, longAbove: 272000, longInput: 1, longOutput: 3.75 } });
  assert.equal(costOf(pricing, { model: 'm', inputTokens: 272_000, outputTokens: 1000 }), 0.1385);
  assert.equal(costOf(pricing, { model: 'm', inputTokens: 300_000, outputTokens: 1000 }), 0.30375);
});

test('pictures cost per picture when the model has such a price, otherwise their tokens; video costs per second', () => {
  assert.equal(costOf(sheet({ img: { image: 0.08, input: 5 } }), { model: 'img', images: 2, inputTokens: 500 }), 0.16);
  assert.equal(costOf(sheet({ img: { input: 0.4, output: 2.4 } }), { model: 'img', images: 1, inputTokens: 1000, outputTokens: 5000 }), 0.0124);
  assert.equal(costOf(sheet({ vid: { second: 0.1 } }), { model: 'vid', videoSeconds: 8, inputTokens: 40 }), 0.8);
  assert.equal(costOf(sheet({ vid: { input: 1 } }), { model: 'vid', videoSeconds: 8, inputTokens: 40 }), null);
});

test('cleanPricing keeps real prices and drops the rest', () => {
  const clean = cleanPricing({ currency: 'EUR', source: ' aigw.store · Gemini Ultra ', models: { ' a ': { input: '0.7', output: 3.5, image: '', second: -1 }, b: { input: 'x' }, c: { longAbove: 5 }, d: { input: 0 } } });
  assert.deepEqual(clean, { currency: 'USD', source: 'aigw.store · Gemini Ultra', models: { a: { input: 0.7, output: 3.5 }, d: { input: 0 } } });
  assert.deepEqual(cleanPricing(undefined), { currency: 'USD', source: '', models: {} });
  assert.equal(cleanPricing({ currency: 'CNY' }).currency, 'CNY');
});

test('each gateway keeps its own price sheet; an administrator sees it and a member does not', () => {
  const a = mergeConfig({ provider: 'custom', baseUrl: 'https://one.example', model: 'm', pricing: sheet({ m: { input: 1, output: 2 } }) }, null);
  const b = mergeConfig({ provider: 'custom', baseUrl: 'https://two.example', model: 'm', pricing: sheet({ m: { input: 7, output: 9 } }, 'CNY') }, null);
  assert.equal(costOf(a.pricing, { model: 'm', inputTokens: 1e6 }), 1);
  assert.equal(costOf(b.pricing, { model: 'm', inputTokens: 1e6 }), 7);
  assert.equal(b.pricing.currency, 'CNY');
  assert.deepEqual(mergeConfig({ name: 'renamed' }, a).pricing, a.pricing); // a save that says nothing about prices keeps them
  assert.deepEqual(publicConfig(a).pricing.models, { m: { input: 1, output: 2 } });
  assert.equal(memberConfig(a).pricing, undefined);
});

test('a Sub2API price list gives each key group what its keys pay: the base price times the group rate', () => {
  const groups = plazaGroups(plaza);
  const by = (name) => groups.find((g) => g.name === name);
  const gemini = by('Gemini Ultra');
  assert.equal(gemini.rate, 0.35);
  assert.deepEqual(gemini.models['gemini-4-argon-high'], { input: 0.7, output: 3.5 });
  assert.deepEqual(gemini.models['gemini-3.8-flash'], { input: 0.2625, output: 1.3125 });
  assert.ok(gemini.unpriced.includes('gemini-4-carbon-high')); // listed without a price
  assert.equal(gemini.models['gemini-4-carbon-high'], undefined);
  assert.deepEqual(by('GPT 特惠').models['gpt-6-astra'], { input: 0.5, output: 2.5, longAbove: 272000, longInput: 1, longOutput: 3.75 });
  assert.deepEqual(by('GPT 【原生生图】').models['gpt-image-2.5'], { image: 0.08 });
  assert.deepEqual(by('DeepSeek【官Key】').models['deepseek-flash'], { input: 0.35, output: 1.4 });
  assert.throws(() => plazaGroups({ hello: 1 }), /not a price list/);
});

test('the price list is looked for on the gateway’s host, then without the api. in front, and no key is sent', async () => {
  assert.deepEqual(priceListUrls('https://api.aigw.store/v1'), ['https://api.aigw.store/api/v1/model-plaza', 'https://aigw.store/api/v1/model-plaza']);
  assert.deepEqual(priceListUrls('https://aigw.store'), ['https://aigw.store/api/v1/model-plaza']);
  const asked = [];
  const fetchImpl = async (url, init) => {
    asked.push([url, Object.keys(init.headers)]);
    return url.includes('//api.') ? { ok: false, status: 404 } : { ok: true, status: 200, text: async () => JSON.stringify(plaza) };
  };
  const list = await fetchPriceList('https://api.gw.example/v1', { fetchImpl });
  assert.equal(list.host, 'gw.example');
  assert.equal(list.groups.length, 4);
  assert.deepEqual(asked.map(([url]) => url), ['https://api.gw.example/api/v1/model-plaza', 'https://gw.example/api/v1/model-plaza']);
  assert.ok(asked.every(([, headers]) => headers.join() === 'accept'));
  await assert.rejects(fetchPriceList('https://api.openai.com/v1', { fetchImpl: async () => ({ ok: false, status: 404 }) }), /no price list this app can read \(openai\.com answered 404\)\. Enter the prices by hand/);
  await assert.rejects(fetchPriceList('', { fetchImpl }), /Enter the BASE_URL_API first/);
});
