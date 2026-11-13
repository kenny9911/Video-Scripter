// Tavily: web search and page reading, reached two ways.
//
//   REST API   POST https://api.tavily.com/search and /extract, with the API key as a Bearer token
//   MCP link   the hosted MCP server (https://mcp.tavily.com/mcp/?tavilyApiKey=…): its search and extract tools
//
// Either way a search answers [{ url, title, snippet, text }] and a reading answers
// { pages: [{ url, title, text }], failed: [{ url, error }] }. TAVILY_API_URL moves the REST API (the tests use it).

import { postJson } from './http.mjs';
import { mcpCall } from './mcp.mjs';

const API = () => String(process.env.TAVILY_API_URL || 'https://api.tavily.com').replace(/\/+$/, '');
const auth = (key) => ({ authorization: `Bearer ${key}` });
// Tavily says what went wrong in { detail: { error } }, or in a list of validation messages.
const said = (j) => j?.detail?.error || (Array.isArray(j?.detail) && j.detail[0]?.msg) || (typeof j?.detail === 'string' && j.detail) || '';
const known = (v) => (v == null || v === 'undefined' || v === 'null' ? '' : String(v));

const results = (j) => (Array.isArray(j?.results) ? j.results : []).map((r) => ({ url: known(r.url), title: known(r.title), snippet: known(r.content), text: known(r.raw_content) })).filter((r) => r.url || r.text || r.snippet);
const extracted = (j) => ({
  pages: (Array.isArray(j?.results) ? j.results : []).map((r) => ({ url: known(r.url), title: known(r.title), text: known(r.raw_content) })),
  failed: (Array.isArray(j?.failed_results) ? j.failed_results : []).map((f) => ({ url: known(f.url), error: known(f.error) || 'could not be read' })),
});

export async function tavilySearch(key, query, { max = 5, signal } = {}) {
  return results(await postJson(`${API()}/search`, { query, max_results: max, search_depth: 'basic', include_raw_content: 'markdown' }, { headers: auth(key), signal, said }));
}

/** Read up to 20 pages in one call. */
export async function tavilyExtract(key, urls, { signal } = {}) {
  return extracted(await postJson(`${API()}/extract`, { urls, extract_depth: 'basic', format: 'markdown' }, { headers: auth(key), signal, said }));
}

// ---------- Through the MCP link ----------

const LABEL = /^(Title|URL|Content|Raw Content|Published Date|Favicon|Score): ?/;

/**
 * What a Tavily MCP tool wrote, as results. The hosted server answers with JSON in the shape of the REST
 * API, or (its older versions) with labelled text: "Title: … / URL: … / Content: … / Raw Content: …", one
 * such group per result.
 */
export function mcpResults(text) {
  const body = String(text || '').trim();
  try {
    const j = JSON.parse(body);
    if (j && typeof j === 'object') return { results: results(j), failed: extracted(j).failed };
  } catch {}
  const out = [];
  let cur = null;
  let field = '';
  for (const line of body.split('\n')) {
    const label = LABEL.exec(line)?.[1];
    if (label) {
      // A new result starts at its title, or at an address when the one in hand already has one.
      if (label === 'Title' || (label === 'URL' && (!cur || cur.URL != null))) out.push((cur = {}));
      cur ||= (out.push({}), out.at(-1));
      field = label;
      cur[field] = line.replace(LABEL, '');
    } else if (cur && field) cur[field] += `\n${line}`;
  }
  return { results: out.map((r) => ({ url: known(r.URL).trim(), title: known(r.Title).trim(), snippet: known(r.Content).trim(), text: known(r['Raw Content']).trim() })).filter((r) => r.url || r.text || r.snippet), failed: [] };
}

export async function tavilyMcpSearch(link, query, { max = 5, signal } = {}) {
  const { text, structured } = await mcpCall(link, /(^|[_-])search$/i, { query, max_results: max, search_depth: 'basic', include_raw_content: true }, { signal });
  const found = structured?.results ? results(structured) : mcpResults(text).results;
  // An answer in a shape nobody has seen is still an answer: it is passed on whole rather than lost.
  return found.length || !text.trim() ? found : [{ url: '', title: query, snippet: '', text }];
}

export async function tavilyMcpExtract(link, urls, { signal } = {}) {
  const { text, structured } = await mcpCall(link, /(^|[_-])extract$/i, { urls, extract_depth: 'basic', format: 'markdown' }, { signal });
  if (structured?.results) return extracted(structured);
  const read = mcpResults(text);
  const pages = read.results.map((r) => ({ url: r.url, title: r.title, text: r.text || r.snippet }));
  if (!pages.length && text.trim() && urls.length === 1) return { pages: [{ url: urls[0], title: '', text }], failed: [] };
  return { pages, failed: read.failed };
}
