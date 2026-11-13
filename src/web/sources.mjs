// Reading the web: pages by their address, and a search by its words, each through the services the
// administrator set up (src/web/config.mjs), the preferred one first and the other when that one fails.
//
//   readPages(config, urls)     { pages: [{ url, title, text, via }], failed: [{ url, error }], pending, asked }
//   searchWeb(config, query)    { query, results: [{ url, title, snippet, text }], via, error }
//   gather(config, { links, query })   both at once, for one brief or one prompt
//
// What was read is kept for a while in the `web` collection, by a hash of the address or of the query: a
// script is written in several requests (the plan, the narration, its review, the script) and several
// platforms at once, and they all read the same pages. A page that failed is remembered too, briefly, so a
// dead link is not asked for again and again. `cachedOnly` answers from what is kept and asks nobody.
// Neither function throws for a page or a service that fails: the failure is part of the answer. Only a
// request that was stopped, or ran out of time, throws.

import { createHash } from 'node:crypto';
import { db } from '../db.mjs';
import { linkKey, SEARCH_RESULTS, SERVICE_NAMES } from './links.mjs';
import { tavilySearch, tavilyExtract, tavilyMcpSearch, tavilyMcpExtract } from './tavily.mjs';
import { firecrawlScrape, firecrawlSearch } from './firecrawl.mjs';

/** How much of a page, and of a search result, is kept, in characters. A prompt takes less (src/web/brief.mjs). */
export const KEEP_PAGE = 30_000;
export const KEEP_RESULT = 8_000;

const MINUTE = 60_000;
const TTL = { page: 24 * 60 * MINUTE, search: 6 * 60 * MINUTE, failed: 10 * MINUTE };
const CACHE_MAX = 150; // documents kept; the oldest go first
const CALL_MS = 45_000; // what one call to a service may take
const MIN_TEXT = 40; // a page with less text than this was not read: a login wall, an empty shell

/** The ways to do a job ('search' or 'read') with these settings, in the order they are tried. */
export function waysTo(job, config) {
  const tavily = [config.tavilyKey && 'tavily', config.tavilyMcp && 'tavily-mcp'].filter(Boolean);
  const firecrawl = config.firecrawlKey ? ['firecrawl'] : [];
  return config[job] === 'firecrawl' ? [...firecrawl, ...tavily] : [...tavily, ...firecrawl];
}

/** A page's text as it is kept: no pictures (a model cannot see them, and an inlined one is enormous), no runs of blank lines. */
export function tidy(text, max = KEEP_PAGE) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

const hostOf = (url) => {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
};
/** What a page is called: what the service said, otherwise its first heading, otherwise where it is. */
const titleOf = (title, text, url) => String(title || /^#{1,2} +(.+)$/m.exec(text)?.[1] || hostOf(url)).replace(/\s+/g, ' ').trim().slice(0, 160);
const reason = (err) => (err.name === 'TimeoutError' ? `no answer after ${CALL_MS / 1000} s` : String(err.message || err)).slice(0, 240);
const within = (signal, ms = CALL_MS) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));
/** A stopped request stops everything; a service that was merely slow is a failure like any other. */
const stopIf = (signal) => {
  if (signal?.aborted) throw signal.reason;
};

// ---------- What is kept ----------

const idOf = (kind, key) => createHash('sha256').update(`${kind}\n${key}`).digest('hex').slice(0, 32);
const flying = new Map(); // what is being read right now, so two requests at once do not both ask for it

async function kept(kind, key) {
  const doc = await db.get('web', idOf(kind, key)).catch(() => null);
  if (!doc) return null;
  return Date.now() - doc.ts < (doc.error ? TTL.failed : TTL[kind]) ? doc : null;
}

async function keep(kind, key, data) {
  await db.put('web', { id: idOf(kind, key), ts: Date.now(), kind, ...data }).catch((err) => console.warn(`[web] not kept: ${err.message}`));
}

/** Drop what is too old to be used again, and the oldest when there is too much. */
async function prune() {
  try {
    const all = await db.list('web');
    const now = Date.now();
    for (const [i, doc] of all.entries()) if (i >= CACHE_MAX || now - doc.ts > TTL.page) await db.del('web', doc.id);
  } catch (err) {
    console.warn(`[web] could not tidy what is kept: ${err.message}`);
  }
}

/** Mark `ids` as being read: returns the function that says they are done. */
function claim(ids) {
  let done;
  const settled = new Promise((resolve) => (done = resolve));
  for (const id of ids) flying.set(id, settled);
  return () => {
    for (const id of ids) if (flying.get(id) === settled) flying.delete(id);
    done();
  };
}

// ---------- Pages ----------

/**
 * One service reads `todo` ([[key, url]]): what it read goes to `pages`, and why it could not read the rest to
 * `errors`. A page an earlier service already failed on keeps that first reason: it came from the service
 * the administrator prefers, and is the one worth acting on.
 */
async function readWith(way, config, todo, { signal, pages, errors }) {
  const missed = new Map(); // what this service could not read, and why
  const take = (key, url, page) => {
    const text = tidy(page?.text);
    if (text.length < MIN_TEXT) return void missed.set(key, 'the page had no text that could be read');
    pages.set(key, { url, title: titleOf(page.title, text, url), text, via: way });
    missed.delete(key);
    errors.delete(key);
  };
  const settle = () => {
    for (const [key] of todo) if (!pages.has(key) && !errors.has(key)) errors.set(key, missed.get(key) || 'the page was not read');
  };
  if (way === 'firecrawl') {
    await Promise.all(
      todo.map(async ([key, url]) => {
        try {
          take(key, url, await firecrawlScrape(config.firecrawlKey, url, { signal: within(signal) }));
        } catch (err) {
          missed.set(key, reason(err));
        }
      }),
    );
    return settle();
  }
  const urls = todo.map(([, url]) => url);
  const got = way === 'tavily' ? await tavilyExtract(config.tavilyKey, urls, { signal: within(signal) }) : await tavilyMcpExtract(config.tavilyMcp, urls, { signal: within(signal) });
  const byKey = new Map(todo);
  const unmatched = [];
  for (const page of got.pages) (byKey.has(linkKey(page.url)) ? take(linkKey(page.url), byKey.get(linkKey(page.url)), page) : unmatched.push(page));
  for (const f of got.failed) if (byKey.has(linkKey(f.url))) missed.set(linkKey(f.url), f.error);
  // A page that came back under another address (a redirect) is the one page that is still missing, when there is exactly one of each.
  const open = todo.filter(([key]) => !pages.has(key) && !missed.has(key));
  if (open.length === 1 && unmatched.length === 1) take(open[0][0], open[0][1], unmatched[0]);
  settle();
}

/**
 * Read pages by their addresses. `fresh` asks the services even for a page that is kept (the settings test).
 * `asked` is how many pages a service was asked for in this call: 0 when everything was already kept.
 */
export async function readPages(config, urls, { signal, cachedOnly = false, fresh = false } = {}) {
  const want = [...new Map(urls.map((url) => [linkKey(url), url]))].filter(([key]) => key);
  const pages = new Map();
  const errors = new Map();
  const recall = async (list) => {
    for (const [key, url] of list) {
      const doc = await kept('page', key);
      if (doc?.error) errors.set(key, doc.error);
      else if (doc) pages.set(key, { url, title: doc.title, text: doc.text, via: doc.via, cached: true });
    }
  };
  const open = () => want.filter(([key]) => !pages.has(key) && !errors.has(key));
  if (!fresh) await recall(want);

  let asked = 0;
  if (!cachedOnly && open().length) {
    // Pages another request is reading at this moment are waited for, not read twice.
    const others = open().filter(([key]) => flying.has(idOf('page', key)));
    if (others.length) {
      await Promise.all(others.map(([key]) => flying.get(idOf('page', key))));
      stopIf(signal);
      await recall(others);
    }
    const mine = open();
    if (mine.length) {
      asked = mine.length;
      const release = claim(mine.map(([key]) => idOf('page', key)));
      try {
        const ways = waysTo('read', config);
        if (!ways.length) for (const [key] of mine) errors.set(key, 'no web service is set up');
        for (const way of ways) {
          const todo = mine.filter(([key]) => !pages.has(key));
          if (!todo.length) break;
          try {
            await readWith(way, config, todo, { signal, pages, errors });
          } catch (err) {
            stopIf(signal);
            for (const [key] of todo) if (!errors.has(key)) errors.set(key, `${SERVICE_NAMES[way]}: ${reason(err)}`);
          }
          stopIf(signal);
        }
        for (const [key, url] of mine) {
          const page = pages.get(key);
          await keep('page', key, page ? { url, title: page.title, text: page.text, via: page.via } : { url, error: errors.get(key) || 'the page was not read' });
        }
        await prune();
      } finally {
        release();
      }
    }
  }
  return {
    pages: want.filter(([key]) => pages.has(key)).map(([key]) => pages.get(key)),
    failed: want.filter(([key]) => !pages.has(key) && errors.has(key)).map(([key, url]) => ({ url, error: errors.get(key) })),
    pending: open().map(([, url]) => url),
    asked,
  };
}

// ---------- Search ----------

const searchWith = (way, config, query, opts) => (way === 'firecrawl' ? firecrawlSearch(config.firecrawlKey, query, opts) : way === 'tavily' ? tavilySearch(config.tavilyKey, query, opts) : tavilyMcpSearch(config.tavilyMcp, query, opts));

/** Search the web for `query`. `results` is empty, with an `error`, when no service could answer. */
export async function searchWeb(config, query, { max = SEARCH_RESULTS, signal, cachedOnly = false, fresh = false } = {}) {
  const asked = String(query || '').trim();
  if (!asked) return { query: '', results: [], via: '', asked: 0 };
  const key = `${asked.toLowerCase()}\n${max}`;
  const id = idOf('search', key);
  const recall = async () => {
    const doc = fresh ? null : await kept('search', key);
    return doc && !doc.error ? { query: asked, results: doc.results, via: doc.via, cached: true, asked: 0 } : null;
  };
  let hit = await recall();
  if (hit || cachedOnly) return hit || { query: asked, results: [], via: '', pending: true, asked: 0 };
  if (flying.has(id)) {
    await flying.get(id);
    stopIf(signal);
    if ((hit = await recall())) return hit;
  }
  const release = claim([id]);
  try {
    let error = waysTo('search', config).length ? '' : 'no web service is set up';
    for (const way of waysTo('search', config)) {
      try {
        const found = (await searchWith(way, config, asked, { max, signal: within(signal) }))
          .map((r) => ({ url: r.url, title: titleOf(r.title, r.text, r.url), snippet: tidy(r.snippet, 1200), text: tidy(r.text, KEEP_RESULT) }))
          .filter((r) => r.text || r.snippet)
          .slice(0, max);
        if (found.length) {
          await keep('search', key, { results: found, via: way }); // the query itself is not kept: it may be someone's private prompt
          await prune();
          return { query: asked, results: found, via: way, asked: 1 };
        }
        error ||= 'the search found nothing';
      } catch (err) {
        stopIf(signal);
        error = `${SERVICE_NAMES[way]}: ${reason(err)}`;
      }
    }
    return { query: asked, results: [], via: '', error, asked: 1 };
  } finally {
    release();
  }
}

// ---------- Both, for one brief or one prompt ----------

/**
 * Read `links` and search for `query` (either may be empty). A search result that is one of the pages
 * already read is left out. `asked` counts what the services were asked for: 0 when it was all kept.
 */
export async function gather(config, { links = [], query = '' } = {}, opts = {}) {
  const [read, search] = await Promise.all([links.length ? readPages(config, links, opts) : { pages: [], failed: [], pending: [], asked: 0 }, query ? searchWeb(config, query, opts) : null]);
  const have = new Set(read.pages.map((p) => linkKey(p.url)));
  if (search) search.results = search.results.filter((r) => !r.url || !have.has(linkKey(r.url)));
  return { pages: read.pages, failed: read.failed, pending: read.pending, search, asked: read.asked + (search?.asked || 0) };
}
