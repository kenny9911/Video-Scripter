import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SITE_TOKEN, STAMPED_FILES, configuredSiteUrl, requestSiteUrl, stamp } from '../src/site.mjs';

const page = (name) => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');
const req = (headers) => ({ headers });

/** Visible text of a page: no scripts, no tags, single spaces. */
const visibleText = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ');

const structuredData = (html) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])['@graph'];

test('configuredSiteUrl prefers SITE_URL, then the Vercel production domain', () => {
  assert.equal(configuredSiteUrl({ SITE_URL: 'https://example.com/', VERCEL_PROJECT_PRODUCTION_URL: 'x.vercel.app' }), 'https://example.com');
  assert.equal(configuredSiteUrl({ SITE_URL: 'example.com' }), 'https://example.com');
  assert.equal(configuredSiteUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'x.vercel.app' }), 'https://x.vercel.app');
  assert.equal(configuredSiteUrl({}), '');
});

test('requestSiteUrl uses the address the request came in on and refuses odd hosts', () => {
  assert.equal(requestSiteUrl(req({ host: 'localhost:3789' })), 'http://localhost:3789');
  assert.equal(requestSiteUrl(req({ host: 'internal:3000', 'x-forwarded-host': 'example.com', 'x-forwarded-proto': 'https' })), 'https://example.com');
  assert.equal(requestSiteUrl(req({ host: 'evil.test/"><script>' })), '');
  assert.equal(requestSiteUrl(req({})), '');
});

test('every file that needs the site address carries the token, and stamping removes it', async () => {
  for (const name of STAMPED_FILES) {
    const text = await page(name);
    assert.ok(text.includes(SITE_TOKEN), `${name} has no ${SITE_TOKEN}`);
    const out = stamp(text, 'https://example.com');
    assert.ok(!out.includes(SITE_TOKEN), `${name} still has the token after stamping`);
    assert.ok(out.includes('https://example.com/'), name);
  }
});

for (const [name, lang, self] of [
  ['index.html', 'en', '/'],
  ['zh.html', 'zh-CN', '/zh.html'],
]) {
  test(`${name}: head tags a search engine needs`, async () => {
    const html = await page(name);
    assert.match(html, new RegExp(`<html lang="${lang}"[ >]`));
    assert.equal(html.match(/<h1[\s>]/g).length, 1, 'exactly one h1');
    assert.match(html, /<title>[^<]{20,70}<\/title>/);
    assert.match(html, /<meta name="description" content="[^"]{60,170}">/);
    assert.ok(html.includes(`<link rel="canonical" href="${SITE_TOKEN}${self}">`));
    for (const [code, href] of [['en', '/'], ['zh-CN', '/zh.html'], ['x-default', '/']]) {
      assert.ok(html.includes(`<link rel="alternate" hreflang="${code}" href="${SITE_TOKEN}${href}">`), `hreflang ${code}`);
    }
    assert.ok(!/name="robots" content="[^"]*noindex/.test(html), 'the home page must be indexable');
  });

  test(`${name}: structured data is valid JSON and matches what the page shows`, async () => {
    const html = await page(name);
    const graph = structuredData(html);
    const text = visibleText(html);
    const byType = (type) => graph.find((node) => node['@type'] === type);
    for (const type of ['WebSite', 'WebPage', 'SoftwareApplication', 'HowTo', 'FAQPage']) assert.ok(byType(type), `missing ${type}`);

    const faq = byType('FAQPage').mainEntity;
    assert.equal(faq.length, 8);
    for (const q of faq) {
      assert.ok(text.includes(q.name), `question not on the page: ${q.name}`);
      assert.ok(text.includes(q.acceptedAnswer.text), `answer not on the page: ${q.name}`);
    }
    for (const step of byType('HowTo').step) {
      assert.ok(text.includes(step.name), `step not on the page: ${step.name}`);
      assert.ok(text.includes(step.text), `step text not on the page: ${step.name}`);
    }
  });
}

test('the app and the admin page stay out of search results', async () => {
  for (const name of ['app.html', 'admin.html']) assert.match(await page(name), /<meta name="robots" content="noindex">/, name);
});

// The page's script sends every form itself. Should a form ever be sent by the browser instead (a password
// manager that submits as the page loads, a script that fails to load), a form without a method is sent with
// GET, and what was typed lands in the address bar, the history and the server's logs.
test('a form with a password field is never one the browser would send in the address', async () => {
  for (const name of ['app.html', 'admin.html', 'chat.html']) {
    const html = await page(name);
    for (const [form] of html.matchAll(/<form\b[\s\S]*?<\/form>/g)) {
      if (!/type="password"/.test(form)) continue;
      const tag = /<form\b[^>]*>/.exec(form)[0];
      assert.match(tag, /\bmethod="(?:post|dialog)"/, `${name}: ${tag} holds a password and would be sent with GET`);
    }
  }
});
