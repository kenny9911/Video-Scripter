// Visitor tracking and the sign-up funnel, against a temporary data folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dir = await mkdtemp(path.join(os.tmpdir(), 'scripter-visitors-'));
Object.assign(process.env, { DATA_DIR: dir, DATABASE_URL: '', POSTGRES_URL: '' });
const { db } = await import('../src/db.mjs');
const { trackVisit, markSignup, markLogin, markFirstScript, summarizeVisitors, sourceName, stageOf, visitorIdOf } = await import('../src/visitors.mjs');

test.after(() => rm(dir, { recursive: true, force: true }));

const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

/** A browser as the server sees it: keeps the visitor cookie between requests. */
function visitor(headers = {}) {
  let cookie = '';
  const req = () => ({ headers: { host: 'www.example.test', 'user-agent': BROWSER, 'accept-language': 'en-US,en;q=0.9', ...headers, ...(cookie && { cookie }) } });
  const keep = (set) => {
    if (set) cookie = set.split(';')[0];
    return set;
  };
  return {
    req,
    id: () => visitorIdOf(req()),
    track: async (body, user) => keep(await trackVisit(req(), body, user)),
    signup: async (user) => keep(await markSignup(req(), user)),
    login: (user) => markLogin(req(), user),
  };
}

test('sourceName turns a referrer or utm_source into a short comparable name', () => {
  assert.equal(sourceName('https://www.Google.com/search?q=video+script'), 'google.com');
  assert.equal(sourceName('news.ycombinator.com'), 'news.ycombinator.com');
  assert.equal(sourceName('Newsletter'), 'newsletter');
  assert.equal(sourceName(''), '');
  assert.equal(sourceName('<script>alert(1)</script>'.repeat(10)).length <= 60, true);
});

test('stageOf names how far a visitor got', () => {
  assert.equal(stageOf({}), 'visited');
  assert.equal(stageOf({ ctaTs: 1 }), 'clicked');
  assert.equal(stageOf({ ctaTs: 1, appTs: 2 }), 'opened_app');
  assert.equal(stageOf({ appTs: 2, signupTs: 3, userId: 'u' }), 'signed_up');
  assert.equal(stageOf({ signupTs: 3, scriptTs: 4, userId: 'u' }), 'activated');
  assert.equal(stageOf({ userId: 'u' }), 'returning');
});

test('visits, clicks, sign-ups and first scripts add up to a funnel', async () => {
  // A: arrives from a search, clicks through, signs up and writes a script.
  const a = visitor({ 'x-vercel-ip-country': 'us' });
  const first = await a.track({ e: 'view', p: 'home', ref: 'www.google.com' });
  assert.match(first, /^vs_vid=[a-f0-9]{24}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=31536000$/);
  assert.equal(await a.track({ e: 'view', p: 'home' }), '', 'a known visitor gets no new cookie');
  await a.track({ e: 'cta', p: 'home', cta: 'hero' });
  await a.track({ e: 'view', p: 'app' });
  assert.equal(await a.signup({ id: 'user-a' }), '');
  await markFirstScript({ id: 'user-a' });
  await markFirstScript({ id: 'user-a' });
  let doc = await db.get('visitors', a.id());
  assert.deepEqual([doc.source, doc.landing, doc.country, doc.device, doc.lang, doc.views, doc.cta, doc.userId], ['google.com', 'home', 'US', 'desktop', 'en-us', 3, 'hero', 'user-a']);
  assert.ok(doc.firstTs <= doc.ctaTs && doc.ctaTs <= doc.appTs && doc.appTs <= doc.signupTs && doc.signupTs <= doc.scriptTs);
  assert.equal(stageOf(doc), 'activated');
  assert.equal(doc.ip, undefined, 'no IP address is kept');

  // B: a campaign link on a phone to the Chinese page; clicks, never signs up.
  const b = visitor({ 'user-agent': PHONE, 'accept-language': 'zh-CN' });
  await b.track({ e: 'view', p: 'zh', ref: 'weixin.qq.com', src: 'Newsletter', med: 'Email', camp: 'launch' });
  await b.track({ e: 'cta', p: 'zh', cta: 'header' });
  await b.track({ e: 'cta', p: 'zh', cta: 'closing-signup' });
  doc = await db.get('visitors', b.id());
  assert.deepEqual([doc.source, doc.medium, doc.campaign, doc.landing, doc.device, doc.cta, stageOf(doc)], ['newsletter', 'email', 'launch', 'zh', 'mobile', 'header', 'clicked']);

  // C: looks at the home page and leaves. A link from the site itself is not a source.
  const c = visitor();
  await c.track({ e: 'view', p: 'home', ref: 'www.example.test' });
  assert.equal((await db.get('visitors', c.id())).source, 'direct');

  // D: an existing user. They are counted apart, not as a prospect who failed to convert.
  const d = visitor();
  await d.track({ e: 'view', p: 'app' });
  await d.login({ id: 'user-old' });
  assert.equal(stageOf(await db.get('visitors', d.id())), 'returning');
  // ... and so is someone whose first tracked view was already signed in.
  const e = visitor();
  await e.track({ e: 'view', p: 'app' }, { id: 'user-older' });
  assert.equal(stageOf(await db.get('visitors', e.id())), 'returning');

  // F: signs up with the beacon blocked. The sign-up is still counted.
  const f = visitor();
  assert.match(await f.signup({ id: 'user-f' }), /^vs_vid=/);
  assert.deepEqual([(await db.get('visitors', f.id())).source, stageOf(await db.get('visitors', f.id()))], ['unknown', 'signed_up']);

  // Not visitors: crawlers, requests with no user agent, junk events, and a click with no visit before it.
  for (const [headers, body] of [
    [{ 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }, { e: 'view', p: 'home' }],
    [{ 'user-agent': 'curl/8.7.1' }, { e: 'view', p: 'home' }],
    [{ 'user-agent': '' }, { e: 'view', p: 'home' }],
    [{}, { e: 'view', p: 'admin' }],
    [{}, { e: 'purchase', p: 'home' }],
    [{}, { e: 'cta', p: 'home', cta: 'hero' }],
    [{}, undefined],
  ]) {
    assert.equal(await visitor(headers).track(body), '', JSON.stringify([headers, body]));
  }

  const s = await summarizeVisitors({ days: 30 });
  assert.deepEqual(s.funnel, { visitors: 4, clicked: 3, openedApp: 2, signups: 2, activated: 1 });
  assert.deepEqual(s.rates, { clicked: 75, openedApp: 50, signups: 50, activated: 25 });
  assert.equal(s.returning, 2);
  assert.deepEqual(Object.fromEntries(s.bySource.map((g) => [g.key, [g.visitors, g.signups, g.rate]])), { 'google.com': [1, 1, 100], newsletter: [1, 0, 0], direct: [1, 0, 0], unknown: [1, 1, 100] });
  assert.deepEqual(Object.fromEntries(s.byLanding.map((g) => [g.key, g.visitors])), { home: 2, zh: 1, app: 1 });
  assert.deepEqual(Object.fromEntries(s.byDevice.map((g) => [g.key, g.visitors])), { desktop: 3, mobile: 1 });
  assert.deepEqual([s.byDay.length, s.byDay[0].visitors, s.byDay[0].signups, s.byDay[0].day], [1, 4, 2, new Date().toISOString().slice(0, 10)]);
  assert.equal(s.recent.length, 6);
  assert.deepEqual(new Set(s.recent.map((v) => v.stage)), new Set(['activated', 'clicked', 'visited', 'returning', 'signed_up']));
});

test('the period counts people by their first visit', async () => {
  const old = visitor();
  await old.track({ e: 'view', p: 'home' });
  // First seen 40 days ago, back today.
  await db.update('visitors', old.id(), (doc) => Object.assign(doc, { firstTs: Date.now() - 40 * 86_400_000 }));
  await old.track({ e: 'view', p: 'home' });
  assert.equal((await summarizeVisitors({ days: 30 })).funnel.visitors, 4);
  assert.equal((await summarizeVisitors({ days: 90 })).funnel.visitors, 5);
  assert.equal((await summarizeVisitors({ days: 0 })).funnel.visitors, 5);
});
