// The web for a brief and for a conversation, and the settings that make it possible. server.mjs adds these
// routes to its own and hands over the helpers they share with the rest.
//
//   GET  /api/web/config   what the web can do here; an administrator also sees what is saved (keys masked)
//   PUT  /api/web/config   save the Tavily API key, the Tavily MCP link and the Firecrawl API key (administrators)
//   POST /api/web/test     try the form as it stands, saved or not: `try` is a search, or a link to read
//
//   briefWeb(req, user, brief, …)    the web for a brief: its links are read, and its topic searched when it asks
//   promptWeb(req, user, text, …)    the same for a prompt in a conversation
//
// A request that streams its reply says what is going on with a `web` event:
//   { status: 'reading', links, search }   before the services are asked
//   { status: 'done', …summary }           what was read and found (webSummary, src/web/brief.mjs)

import { loadWeb, saveWeb, mergeWeb, validateWeb, publicWeb, webAbility } from './config.mjs';
import { pickLinks, findLinks, searchQuery, MAX_LINKS, SEARCH_RESULTS, SERVICE_NAMES } from './links.mjs';
import { gather, readPages, searchWeb } from './sources.mjs';
import { normalizeWeb, webLines, webSummary, hasWeb } from './brief.mjs';
import { logActivity } from '../audit.mjs';

const GATHER_MS = 75_000; // what reading the web may take of one request, at most
const within = (signal) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(GATHER_MS)]) : AbortSignal.timeout(GATHER_MS));

/**
 * Gather for `want` ({ links, query }) and note it in the activity log when a service was asked. A reading
 * that runs out of its own time is not a failed request: what could not be read is simply not there.
 */
async function collect(req, user, config, want, { signal, send, cachedOnly, about }) {
  if (!cachedOnly) send?.('web', { status: 'reading', links: want.links.length, search: Boolean(want.query) });
  let found;
  try {
    found = await gather(config, want, { signal: within(signal), cachedOnly });
  } catch (err) {
    if (signal?.aborted) throw signal.reason;
    found = { pages: [], failed: want.links.map((url) => ({ url, error: 'the web did not answer in time' })), pending: [], search: want.query ? { query: want.query, results: [], error: 'the web did not answer in time' } : null, asked: 0 };
  }
  if (found.asked) {
    await logActivity(req, user, 'web.read', { ...about, pages: found.pages.length, ...(found.failed.length && { failed: found.failed.length }), ...(found.search && { search: found.search.results.length }), gateway: [...new Set([...found.pages.map((p) => p.via), found.search?.via].filter(Boolean))].map((v) => SERVICE_NAMES[v] || v).join(' + ') });
  }
  return found;
}

/**
 * The web for a brief, as `brief.web` takes it (normalizeWeb reads it), or null when the brief asks for none.
 * `brief` is the request's brief with its library files looked up (`materials`). Links come from what the
 * person typed (topic, key message, experience, reference material) and then from their documents;
 * `webLinks: false` turns that off, `webSearch: true` adds a search for the topic.
 * `cachedOnly` answers from what was read before and asks no service: a plan or a check must not wait for the web.
 */
export async function briefWeb(req, user, brief, { signal, send, cachedOnly = false } = {}) {
  const typed = [brief.topic, brief.keyMessage, brief.experience, brief.reference].filter(Boolean).join('\n');
  const docs = (Array.isArray(brief.materials) ? brief.materials : []).filter((a) => a?.kind === 'document').map((a) => a.text);
  const picked = brief.webLinks === false ? { links: [], skipped: 0 } : pickLinks(typed, docs);
  const query = brief.webSearch === true ? searchQuery(brief.topic) : '';
  if (!picked.links.length && !query) return null;
  const config = await loadWeb();
  const can = webAbility(config);
  const want = { links: can.read ? picked.links : [], query: can.search ? query : '' };
  const none = { pages: [], failed: [], pending: [], search: null };
  const found = want.links.length || want.query ? await collect(req, user, config, want, { signal, send, cachedOnly, about: { topic: String(brief.topic || '').slice(0, 120) } }) : none;
  const web = normalizeWeb({ ...found, skipped: picked.skipped, unread: can.read ? 0 : picked.links.length, searchOff: Boolean(query) && !can.search });
  if (web && !cachedOnly) send?.('web', { status: 'done', ...webSummary(web) });
  return web;
}

/**
 * The web for a prompt in a conversation: { context, …summary } or null. `context` is what the model reads
 * after the prompt; the rest is what the page shows. The links in the prompt are read, and with `search` the
 * prompt is searched for.
 */
export async function promptWeb(req, user, text, { search = false, signal, send, title = '' } = {}) {
  const links = findLinks(text, MAX_LINKS);
  const query = search ? searchQuery(text) : '';
  if (!links.length && !query) return null;
  const config = await loadWeb();
  const can = webAbility(config);
  const want = { links: can.read ? links : [], query: can.search ? query : '' };
  if (!want.links.length && !want.query) {
    // Nothing is set up: the reply says so once, where its sources would be.
    const off = webSummary(normalizeWeb({ unread: links.length, searchOff: Boolean(query) }));
    send?.('web', { status: 'done', ...off });
    return { context: '', ...off };
  }
  const found = await collect(req, user, config, want, { signal, send, about: { title } });
  const web = normalizeWeb({ ...found, unread: can.read ? 0 : links.length, searchOff: Boolean(query) && !can.search });
  if (!web) return null;
  const out = { context: hasWeb(web) ? webLines(web, { chat: true }).join('\n').trim() : '', ...webSummary(web) };
  send?.('web', { status: 'done', ...webSummary(web) });
  return out;
}

/** What a stored message's web is to the page: its sources, never the text the model was given. */
export const publicSources = (web) => {
  if (!web) return null;
  const { context: _, ...sources } = web;
  return sources;
};

export function webRoutes({ route, json, readJson, failure }) {
  return {
    'GET /api/web/config': route('user', async (req, res, user) => {
      json(res, 200, publicWeb(await loadWeb(), { admin: user.role === 'admin' }));
    }),

    'PUT /api/web/config': route('admin', async (req, res, user) => {
      const merged = mergeWeb(await readJson(req), await loadWeb());
      const invalid = validateWeb(merged);
      if (invalid) return json(res, 400, { error: invalid });
      const saved = await saveWeb(merged);
      const can = webAbility(saved);
      await logActivity(req, user, 'web.settings', { gateway: [can.tavily && 'Tavily', can.firecrawl && 'Firecrawl'].filter(Boolean).join(' + ') || 'off' });
      json(res, 200, publicWeb(saved, { admin: true }));
    }),

    // Tries the values in the form without saving them; a blank key falls back on the saved one. `try` is a
    // link (it is read) or anything else (it is searched for). `with` asks one service only: 'tavily' or 'firecrawl'.
    'POST /api/web/test': route('admin', async (req, res) => {
      const body = await readJson(req);
      const merged = mergeWeb(body, await loadWeb());
      const invalid = validateWeb(merged);
      if (invalid) return json(res, 200, { ok: false, error: invalid });
      const only = body.with === 'tavily' ? { ...merged, firecrawlKey: '' } : body.with === 'firecrawl' ? { ...merged, tavilyKey: '', tavilyMcp: '' } : merged;
      const can = webAbility(only);
      if (!can.search) return json(res, 200, { ok: false, error: body.with ? `${SERVICE_NAMES[body.with]} is not set up: add its key first.` : 'Add a Tavily or a Firecrawl key first.' });
      const asked = String(body.try || '').trim().slice(0, 500);
      const [link] = findLinks(asked, 1);
      const started = Date.now();
      const signal = AbortSignal.timeout(60_000);
      try {
        if (link) {
          const { pages, failed } = await readPages(only, [link], { signal, fresh: true });
          if (!pages.length) return json(res, 200, { ok: false, kind: 'read', ms: Date.now() - started, error: failed[0]?.error || 'The page could not be read' });
          const [page] = pages;
          return json(res, 200, { ok: true, kind: 'read', ms: Date.now() - started, via: SERVICE_NAMES[page.via], url: page.url, title: page.title, chars: page.text.length, excerpt: page.text.slice(0, 600) });
        }
        const found = await searchWeb(only, asked || 'What is new in short video this week?', { signal, fresh: true, max: SEARCH_RESULTS });
        if (!found.results.length) return json(res, 200, { ok: false, kind: 'search', ms: Date.now() - started, error: found.error || 'The search found nothing' });
        json(res, 200, { ok: true, kind: 'search', ms: Date.now() - started, via: SERVICE_NAMES[found.via], query: found.query, results: found.results.map((r) => ({ url: r.url, title: r.title, snippet: (r.snippet || r.text).slice(0, 200) })) });
      } catch (err) {
        json(res, 200, { ok: false, ms: Date.now() - started, ...failure(req, err, err.name === 'TimeoutError' ? 'Timed out after 60s' : err.message) });
      }
    }),
  };
}
