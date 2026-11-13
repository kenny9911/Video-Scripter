// The links in a piece of text: the ones a person typed into a brief or a prompt, and the ones a document
// from their library names. Only addresses worth handing to a reading service are kept.

/** How many links one brief or one prompt has read. */
export const MAX_LINKS = 8;
/** How many results one search brings back. */
export const SEARCH_RESULTS = 5;
/** The ways the web is reached, as a person reads them. */
export const SERVICE_NAMES = { tavily: 'Tavily', 'tavily-mcp': 'Tavily (MCP)', firecrawl: 'Firecrawl' };

// Files that are not pages: reading them returns nothing a script could use.
const NOT_PAGES = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|mp4|mov|webm|m4v|avi|mp3|wav|m4a|ogg|flac|zip|rar|7z|gz|tar|dmg|exe|apk|iso|css|js|woff2?|ttf)$/i;
// An address ends where the sentence around it goes on: at a space, a quote, or Chinese text and punctuation
// (which are written straight after a link, with no space; a real address has them percent-encoded).
const LINK = /https?:\/\/[^\s<>"'`\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]+/gi;
const PRIVATE = /^(localhost|.*\.local|.*\.internal|.*\.localhost|10\.\d+\.\d+\.\d+|127\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|0\.0\.0\.0|\[.*\])$/i;

/** Take the punctuation of the sentence off the end of an address, and a closing bracket that has no opening one in it. */
function trimEnd(link) {
  let s = link;
  for (;;) {
    const last = s.at(-1);
    if (/[.,;:!?'"*_~]/.test(last)) s = s.slice(0, -1);
    else if (last === ')' && (s.match(/\(/g) || []).length < (s.match(/\)/g) || []).length) s = s.slice(0, -1);
    else if (last === ']' || last === '}' || last === '>') s = s.slice(0, -1);
    else return s;
  }
}

/** The address as a reading service is given it, or '' when it is not a page on the public web. */
export function pageUrl(link) {
  let u;
  try {
    u = new URL(String(link || '').trim());
  } catch {
    return '';
  }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return '';
  if (!u.hostname.includes('.') || PRIVATE.test(u.hostname) || NOT_PAGES.test(u.pathname)) return '';
  u.hash = '';
  const out = u.toString();
  return out.length <= 2000 ? out : '';
}

/** One key for the addresses that are the same page: no fragment, no trailing slash, the host in lower case, http and https alike. */
export function linkKey(link) {
  const url = pageUrl(link);
  if (!url) return '';
  const u = new URL(url);
  return `${u.host.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`;
}

/** The readable links in `text`, in the order they appear, each once. */
export function findLinks(text, max = Infinity) {
  const seen = new Set();
  const out = [];
  for (const [raw] of String(text || '').matchAll(LINK)) {
    const url = pageUrl(trimEnd(raw));
    const key = linkKey(url);
    if (!url || seen.has(key)) continue;
    seen.add(key);
    out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The links one brief has read: the ones the person typed first, then the ones their documents name, up to
 * MAX_LINKS in all. Returns { links, typed, fromDocs, skipped }: `skipped` is how many more there were.
 */
export function pickLinks(typedText, docTexts = [], max = MAX_LINKS) {
  const typed = findLinks(typedText);
  const seen = new Set(typed.map(linkKey));
  const fromDocs = [];
  for (const text of docTexts) {
    for (const url of findLinks(text)) {
      if (seen.has(linkKey(url))) continue;
      seen.add(linkKey(url));
      fromDocs.push(url);
    }
  }
  const all = [...typed, ...fromDocs];
  const links = all.slice(0, max);
  return { links, typed: links.filter((u) => typed.includes(u)).length, fromDocs: links.filter((u) => fromDocs.includes(u)).length, skipped: all.length - links.length };
}

/** A prompt or a topic as a search engine is asked it: without its links, on one line, no longer than the engines take. */
export function searchQuery(text, max = 300) {
  return String(text || '').replace(LINK, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}
