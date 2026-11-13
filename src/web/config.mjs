// Web access: the services that search the web and read pages for a brief or a conversation.
//
//   Tavily      a search engine made for models. Reached with an API key (its REST API), or with an MCP
//               link (its hosted MCP server, https://mcp.tavily.com/mcp/?tavilyApiKey=…), or both.
//   Firecrawl   reads a page and hands back its text as Markdown; it can search too.
//
// The settings are one document, `web`, in the `config` collection:
//   { tavilyKey, tavilyMcp, firecrawlKey, search, read }
// `search` and `read` say which service is asked first for each job ('tavily' or 'firecrawl'); the other
// one, when it is set up, is asked when the first fails. Until something is saved the environment is read
// (TAVILY_API_KEY, TAVILY_MCP_URL, FIRECRAWL_API_KEY).
// Keys never leave the server: the page only ever receives a masked preview. An MCP link carries a key in
// its address, so it is treated as one.

import { db } from '../db.mjs';

export const WEB_SERVICES = ['tavily', 'firecrawl'];
const BLANK = { tavilyKey: '', tavilyMcp: '', firecrawlKey: '', search: 'tavily', read: 'firecrawl' };
const SECRETS = ['tavilyKey', 'tavilyMcp', 'firecrawlKey'];
const service = (v, fallback) => (WEB_SERVICES.includes(v) ? v : fallback);
const clean = (config) => ({ ...BLANK, ...Object.fromEntries(SECRETS.map((k) => [k, String(config?.[k] || '').trim()])), search: service(config?.search, BLANK.search), read: service(config?.read, BLANK.read) });

function envWeb(env = process.env) {
  return clean({ tavilyKey: env.TAVILY_API_KEY, tavilyMcp: env.TAVILY_MCP_URL, firecrawlKey: env.FIRECRAWL_API_KEY, search: env.WEB_SEARCH_WITH, read: env.WEB_READ_WITH });
}

/** The web settings in use: what was saved, otherwise what the environment names. */
export async function loadWeb() {
  const saved = await db.get('config', 'web');
  return saved ? clean(saved) : envWeb();
}

export async function saveWeb(config) {
  await db.put('config', { id: 'web', ts: Date.now(), ...clean(config) });
  return clean(config);
}

/**
 * Form values merged over the saved settings. A blank key or link keeps the stored one; `clear` names the
 * ones to remove (['tavilyKey', …]).
 */
export function mergeWeb(patch = {}, current) {
  const cur = clean(current);
  const gone = new Set(Array.isArray(patch.clear) ? patch.clear : []);
  const next = { ...cur, search: service(patch.search, cur.search), read: service(patch.read, cur.read) };
  for (const k of SECRETS) {
    const typed = typeof patch[k] === 'string' ? patch[k].trim().slice(0, 600) : '';
    next[k] = typed || (gone.has(k) ? '' : cur[k]);
  }
  return next;
}

export function validateWeb(config) {
  if (config.tavilyMcp) {
    try {
      if (!/^https?:$/.test(new URL(config.tavilyMcp).protocol)) throw new Error('not http');
    } catch {
      return 'The Tavily MCP link must be an http(s) address, such as https://mcp.tavily.com/mcp/?tavilyApiKey=…';
    }
  }
  for (const k of ['tavilyKey', 'firecrawlKey']) if (/\s/.test(config[k])) return 'An API key cannot contain spaces';
  return null;
}

/** What the settings make possible: which services are set up, and whether there is one to search and one to read with. */
export function webAbility(config) {
  const tavily = Boolean(config.tavilyKey || config.tavilyMcp);
  const firecrawl = Boolean(config.firecrawlKey);
  return { tavily, firecrawl, search: tavily || firecrawl, read: tavily || firecrawl };
}

const mask = (key) => (!key ? '' : key.length <= 8 ? '••••' : `${key.slice(0, 3)}••••${key.slice(-4)}`);

/** An MCP link with the key in its address hidden: https://mcp.tavily.com/mcp/?tavilyApiKey=tvl••••1234 */
export function maskLink(link) {
  if (!link) return '';
  try {
    const u = new URL(link);
    const query = [...u.searchParams].map(([k, v]) => `${k}=${mask(v)}`).join('&');
    return `${u.origin}${u.pathname}${query ? `?${query}` : ''}`;
  } catch {
    return mask(link);
  }
}

/** The settings as a person may see them: everyone learns what can be done, an administrator also what is saved (masked). */
export function publicWeb(config, { admin = false } = {}) {
  const can = webAbility(config);
  const everyone = { search: can.search, read: can.read };
  if (!admin) return everyone;
  return {
    ...everyone,
    tavily: { ready: can.tavily, hasKey: Boolean(config.tavilyKey), keyPreview: mask(config.tavilyKey), hasMcp: Boolean(config.tavilyMcp), mcpPreview: maskLink(config.tavilyMcp) },
    firecrawl: { ready: can.firecrawl, hasKey: Boolean(config.firecrawlKey), keyPreview: mask(config.firecrawlKey) },
    prefer: { search: config.search, read: config.read },
  };
}
