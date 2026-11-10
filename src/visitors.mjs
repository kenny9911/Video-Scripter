// Visitors and the sign-up funnel: who came to the public pages, where from, and how far they got.
//
// One document per visitor in the `visitors` collection, keyed by a random id kept in a first-party
// cookie (vs_vid, one year). It records the first and latest visit, the source, and the time of
// each step: clicked a button to the app, opened the app, signed up, wrote a first script.
// No IP address is stored, and nothing is sent to anyone else.
//
// Like the audit records, tracking must never break the request it rides on: failures are logged
// and swallowed.

import { randomBytes } from 'node:crypto';
import { db } from './db.mjs';

const COL = 'visitors';
const COOKIE = 'vs_vid';
const YEAR = 365 * 86_400;
const DAY = 86_400_000;
const PAGES = ['home', 'zh', 'app'];
// Crawlers, link previews, uptime checks and scripts are not visitors.
const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|scrapy|httpclient|go-http|okhttp|java\/|axios|node-fetch|undici|facebookexternalhit|whatsapp|telegram/i;

const clip = (v, n = 80) => String(v ?? '').trim().slice(0, n);
const secure = (req) => req.headers['x-forwarded-proto'] === 'https' || Boolean(process.env.VERCEL);
const setCookie = (req, id) => `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${YEAR}${secure(req) ? '; Secure' : ''}`;

/** The visitor id in the request's cookie, or ''. */
export const visitorIdOf = (req) => /(?:^|;\s*)vs_vid=([a-f0-9]{24})(?:;|$)/.exec(req.headers.cookie || '')?.[1] || '';

/** A referrer or utm_source as a short, comparable name: "https://www.Google.com/search?q=x" -> "google.com". */
export function sourceName(value) {
  const s = clip(value, 200).toLowerCase();
  if (!s) return '';
  let host = s;
  try {
    host = new URL(/^[a-z]+:\/\//.test(s) ? s : `https://${s}`).hostname || s;
  } catch {}
  return host.replace(/^www\./, '').replace(/[^a-z0-9.\-_]/g, '').slice(0, 60);
}

function describe(req, body) {
  const ua = String(req.headers['user-agent'] || '');
  const own = sourceName(req.headers['x-forwarded-host'] || req.headers.host || '');
  const referrer = sourceName(body.ref);
  const utm = sourceName(body.src);
  return {
    source: utm || (referrer && referrer !== own ? referrer : '') || 'direct',
    medium: clip(body.med, 40).toLowerCase(),
    campaign: clip(body.camp, 60),
    lang: clip(String(req.headers['accept-language'] || '').split(/[,;]/)[0], 12).toLowerCase(),
    device: /mobi|android|iphone|ipad/i.test(ua) ? 'mobile' : 'desktop',
    country: clip(req.headers['x-vercel-ip-country'], 2).toUpperCase(),
  };
}

const fresh = (id, now, about = {}) => ({ id, ts: now, firstTs: now, userId: '', views: 0, landing: '', source: 'direct', medium: '', campaign: '', lang: '', device: '', country: '', ctaTs: 0, cta: '', appTs: 0, signupTs: 0, scriptTs: 0, ...about });

/**
 * Record a page view or a button click from the pages' beacon (public/track.js).
 * body: { e: 'view' | 'cta', p: 'home' | 'zh' | 'app', ref, src, med, camp, cta }
 * Returns the Set-Cookie value when a new visitor was created, otherwise ''.
 */
export async function trackVisit(req, body = {}, user = null) {
  try {
    const event = body.e === 'cta' ? 'cta' : body.e === 'view' ? 'view' : '';
    const page = PAGES.includes(body.p) ? body.p : '';
    const ua = String(req.headers['user-agent'] || '');
    if (!event || !page || !ua || BOT.test(ua)) return '';
    const now = Date.now();
    const apply = (doc) => {
      doc.ts = now;
      if (event === 'view') {
        doc.views += 1;
        if (page === 'app' && !doc.appTs) doc.appTs = now;
      } else if (!doc.ctaTs) {
        doc.ctaTs = now;
        doc.cta = clip(body.cta, 20);
      }
      // Someone already signed in is an existing user, not a prospect.
      if (user && !doc.userId) doc.userId = user.id;
      return doc;
    };

    const known = visitorIdOf(req);
    if (known && (await db.update(COL, known, apply))) return '';
    // A visitor starts with a page view; a stray click with no cookie is not one.
    if (event !== 'view') return '';
    const id = randomBytes(12).toString('hex');
    await db.put(COL, apply(fresh(id, now, { landing: page, ...describe(req, body) })));
    return setCookie(req, id);
  } catch (err) {
    console.warn(`[visitors] not recorded: ${err.message}`);
    return '';
  }
}

/**
 * A visitor signed up: mark them converted. A sign-up with no visitor record (the beacon was
 * blocked) still gets one, so every sign-up is counted. Returns a Set-Cookie value, or ''.
 */
export async function markSignup(req, user) {
  try {
    const now = Date.now();
    const convert = (doc) => Object.assign(doc, { ts: now, userId: user.id, signupTs: doc.signupTs || now });
    const known = visitorIdOf(req);
    if (known && (await db.update(COL, known, convert))) return '';
    const id = randomBytes(12).toString('hex');
    await db.put(COL, convert(fresh(id, now, { landing: 'app', ...describe(req, {}), source: 'unknown' })));
    return setCookie(req, id);
  } catch (err) {
    console.warn(`[visitors] sign-up not recorded: ${err.message}`);
    return '';
  }
}

/** A visitor logged in to an account they already had: they are a returning user, not a conversion. */
export async function markLogin(req, user) {
  try {
    const known = visitorIdOf(req);
    if (known) await db.update(COL, known, (doc) => (doc.userId ? doc : Object.assign(doc, { ts: Date.now(), userId: user.id })));
  } catch (err) {
    console.warn(`[visitors] log-in not recorded: ${err.message}`);
  }
}

/** The user wrote a script: the last step of the funnel, recorded once. */
export async function markFirstScript(user) {
  try {
    for (const doc of await db.list(COL, { userId: user.id, limit: 20 })) {
      if (!doc.scriptTs) await db.update(COL, doc.id, (d) => Object.assign(d, { scriptTs: d.scriptTs || Date.now() }));
    }
  } catch (err) {
    console.warn(`[visitors] first script not recorded: ${err.message}`);
  }
}

/** How far a visitor got. `returning` is someone who already had an account when they were first seen signed in. */
export function stageOf(doc) {
  if (doc.userId && !doc.signupTs) return 'returning';
  if (doc.signupTs) return doc.scriptTs ? 'activated' : 'signed_up';
  if (doc.appTs) return 'opened_app';
  if (doc.ctaTs) return 'clicked';
  return 'visited';
}

const rate = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

function breakdown(rows, keyOf) {
  const map = new Map();
  for (const v of rows) {
    const key = keyOf(v) || '';
    const g = map.get(key) || { key, visitors: 0, signups: 0 };
    g.visitors += 1;
    if (v.signupTs) g.signups += 1;
    map.set(key, g);
  }
  return [...map.values()].map((g) => ({ ...g, rate: rate(g.signups, g.visitors) })).sort((a, b) => b.visitors - a.visitors || b.signups - a.signups);
}

/**
 * The funnel for visitors first seen in the last `days` (0 = all time).
 * People who already had an account are counted apart, so the conversion rate is over prospects only.
 */
export async function summarizeVisitors({ days = 30 } = {}) {
  days = Math.min(3650, Math.max(0, Math.round(Number(days)) || 0));
  const since = days > 0 ? Date.now() - days * DAY : undefined;
  const seen = (await db.list(COL, { since, limit: 50_000 })).filter((v) => since === undefined || v.firstTs >= since);
  const prospects = seen.filter((v) => stageOf(v) !== 'returning');
  const count = (fn) => prospects.filter(fn).length;

  const visitors = prospects.length;
  const signups = count((v) => v.signupTs);
  const funnel = {
    visitors,
    clicked: count((v) => v.ctaTs || v.appTs || v.signupTs),
    openedApp: count((v) => v.appTs || v.signupTs),
    signups,
    activated: count((v) => v.signupTs && v.scriptTs),
  };

  const byDayMap = new Map();
  for (const v of prospects) {
    const day = new Date(v.firstTs).toISOString().slice(0, 10);
    const g = byDayMap.get(day) || { day, visitors: 0, signups: 0 };
    g.visitors += 1;
    if (v.signupTs) g.signups += 1;
    byDayMap.set(day, g);
  }

  const users = new Map((await db.list('users')).map((u) => [u.id, u]));
  return {
    days,
    funnel,
    rates: { clicked: rate(funnel.clicked, visitors), openedApp: rate(funnel.openedApp, visitors), signups: rate(signups, visitors), activated: rate(funnel.activated, visitors) },
    returning: seen.length - prospects.length,
    bySource: breakdown(prospects, (v) => v.source).slice(0, 30),
    byLanding: breakdown(prospects, (v) => v.landing),
    byCountry: breakdown(prospects, (v) => v.country).slice(0, 30),
    byDevice: breakdown(prospects, (v) => v.device),
    byDay: [...byDayMap.values()].map((g) => ({ ...g, rate: rate(g.signups, g.visitors) })).sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 90),
    recent: seen.slice(0, 200).map((v) => ({ ...v, stage: stageOf(v), email: users.get(v.userId)?.email || '' })),
  };
}
