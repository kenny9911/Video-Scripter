// Firecrawl: reads a page into Markdown (POST /v2/scrape) and searches the web (POST /v2/search), with the
// API key as a Bearer token. FIRECRAWL_API_URL moves the API: a self-hosted Firecrawl, or the tests.

import { postJson } from './http.mjs';
import { GatewayError } from '../gateway/client.mjs';

const API = () => String(process.env.FIRECRAWL_API_URL || 'https://api.firecrawl.dev').replace(/\/+$/, '');
const auth = (key) => ({ authorization: `Bearer ${key}` });
const said = (j) => (typeof j?.error === 'string' ? j.error : j?.error?.message) || j?.message || '';
const refused = (j, url) => Object.assign(new GatewayError(`${new URL(url).host}: ${String(said(j) || 'the request was refused').slice(0, 300)}`, 502), { host: new URL(url).host });

/** Read one page: { url, title, text }. Throws when the page could not be read (the site answered 404, or with nothing). */
export async function firecrawlScrape(key, url, { signal } = {}) {
  const at = `${API()}/v2/scrape`;
  const j = await postJson(at, { url, formats: ['markdown'], onlyMainContent: true, timeout: 40_000 }, { headers: auth(key), signal, said });
  if (j.success === false) throw refused(j, at);
  const d = j.data || {};
  const status = Number(d.metadata?.statusCode) || 200;
  if (status >= 400) throw new Error(`the page answered ${status}`);
  return { url, title: String(d.metadata?.title || d.metadata?.ogTitle || ''), text: String(d.markdown || '') };
}

/** Search the web, with each result read as Markdown: [{ url, title, snippet, text }]. */
export async function firecrawlSearch(key, query, { max = 5, signal } = {}) {
  const at = `${API()}/v2/search`;
  const j = await postJson(at, { query, limit: max, scrapeOptions: { formats: ['markdown'], onlyMainContent: true } }, { headers: auth(key), signal, said });
  if (j.success === false) throw refused(j, at);
  const rows = Array.isArray(j.data) ? j.data : Array.isArray(j.data?.web) ? j.data.web : []; // v2 groups the results by kind; v1 answered with the list itself
  return rows.map((r) => ({ url: String(r.url || r.metadata?.sourceURL || ''), title: String(r.title || r.metadata?.title || ''), snippet: String(r.description || r.snippet || ''), text: String(r.markdown || '') })).filter((r) => r.url);
}
