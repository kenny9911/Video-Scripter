// The web, as the pages show it: what was read for a script or a reply (its sources), the two switches in
// the brief, and the Web search tab of LLM settings, where an administrator keeps the Tavily API key, the
// Tavily MCP link and the Firecrawl API key. The server does the reading (src/web); nothing here leaves
// the browser except to this app's own API.

import './web.zh.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { el, call, fmt, statusLine } from './account.js';
import { enhancePasswords } from './shell.js';

// ---------- What the web can do here ----------

let ability = null; // { search, read } for everyone; an administrator also gets what is saved
const listeners = new Set();

/** What the web can do on this server: { search, read }. Asked once; `again` asks afresh. */
export async function webAbility(again = false) {
  if (!ability || again) ability = await call('/api/web/config').catch(() => ({ search: false, read: false }));
  return ability;
}
const changed = (next) => {
  ability = next;
  for (const fn of listeners) fn(next);
};

// ---------- Sources ----------

const hostOf = (url) => {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
};
const some = (n, one, many) => (n === 1 ? t(one) : t(many, { n: fmt(n) }));
const NOT_SET_UP = 'An administrator can add a Tavily or Firecrawl key under LLM settings, Web search.';

function linkItem({ url, title }, extra) {
  const safe = /^https?:\/\//i.test(url || '');
  const name = title || hostOf(url) || url || t('Search result');
  return el('li', {}, safe ? el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, name) : el('span', {}, name), safe && el('span', { class: 'hint' }, hostOf(url)), extra && el('span', { class: 'hint' }, extra));
}

/** What a 'web' event says while the services are being asked: one line for the progress note. */
export function readingNote({ links = 0, search = false } = {}) {
  if (links && search) return some(links, 'Reading 1 link and searching the web…', 'Reading {n} links and searching the web…');
  if (links) return some(links, 'Reading 1 link…', 'Reading {n} links…');
  return t('Searching the web…');
}

/**
 * The web a script or a reply was written from, folded: the pages that were read, the results of the search,
 * and what could not be read, with the reason. Null when there is nothing to say.
 */
export function sourcesNode(web, { open = false } = {}) {
  if (!web) return null;
  const pages = web.pages || [];
  const failed = web.failed || [];
  const results = web.search?.results || [];
  const notes = [
    web.unread && `${some(web.unread, 'A link in this brief was not read: no web service is set up.', '{n} links were not read: no web service is set up.')} ${t(NOT_SET_UP)}`,
    web.searchOff && `${t('The web was not searched: no web service is set up.')} ${t(NOT_SET_UP)}`,
    web.search?.error && !results.length && t('The search found nothing to use: {error}', { error: web.search.error }),
    web.pending && some(web.pending, '1 link is read when the writing starts.', '{n} links are read when the writing starts.'),
    web.skipped && some(web.skipped, '1 more link was left out: one brief reads up to 8.', '{n} more links were left out: one brief reads up to 8.'),
  ].filter(Boolean);
  if (!pages.length && !failed.length && !results.length && !notes.length) return null;
  const counts = [pages.length && some(pages.length, '1 page read', '{n} pages read'), results.length && some(results.length, '1 search result', '{n} search results'), failed.length && some(failed.length, '1 link not read', '{n} links not read')].filter(Boolean);
  return el(
    'details',
    { class: 'web-sources', open: open || (!pages.length && !results.length) },
    el('summary', {}, icon('globe', 15), el('b', {}, t('From the web')), el('span', { class: 'hint' }, counts.join(' · '))),
    pages.length > 0 && el('ul', {}, pages.map((p) => linkItem(p, [p.via, p.cut && t('first part only')].filter(Boolean).join(' · ')))),
    results.length > 0 && el('p', { class: 'hint' }, t('Search: “{query}”', { query: web.search.query }), web.search.via ? ` · ${web.search.via}` : ''),
    results.length > 0 && el('ul', {}, results.map((r) => linkItem(r))),
    failed.length > 0 && el('ul', { class: 'bad' }, failed.map((f) => el('li', {}, el('span', {}, String(f.url).replace(/^https?:\/\/(www\.)?/, '')), el('span', { class: 'hint' }, t(f.error))))),
    notes.map((n) => el('p', { class: 'hint' }, n)),
  );
}

// ---------- The brief: read the links, search the topic ----------

/** Keep the two switches of the brief in step with what the web can do here: off and explained until a service is set up. */
export async function wireBriefWeb({ links, search, hint }) {
  const sync = (can) => {
    links.disabled = !can.read;
    search.disabled = !can.search;
    hint.textContent = can.read || can.search ? t('Links are read when the writing starts, up to 8 for one brief. What was read is listed with the script.') : `${t('The web is not set up yet.')} ${t(NOT_SET_UP)}`;
  };
  listeners.add(sync);
  sync(await webAbility());
}

// ---------- LLM settings: the Web search tab ----------

const SERVICES = { tavily: 'Tavily', firecrawl: 'Firecrawl' };

/**
 * Give the settings dialog its two tabs (LLM gateways, Web search) and build the second one. `tabs` is the
 * tab strip and `panel` the empty element the tab is drawn in; what shows for each tab is in web.css.
 * Returns { show(tab) }.
 */
export function wireWebSettings({ dialog, tabs, panel }) {
  let saved = null; // the settings as the server last gave them
  const status = statusLine();
  const key = (placeholder) => el('input', { type: 'password', autocomplete: 'new-password', spellcheck: 'false', placeholder });
  const inputs = { tavilyKey: key('tvly-…'), tavilyMcp: key('https://mcp.tavily.com/mcp/?tavilyApiKey=…'), firecrawlKey: key('fc-…') };
  const pick = () => el('select', {}, Object.entries(SERVICES).map(([id, name]) => el('option', { value: id }, name)));
  const prefer = { search: pick(), read: pick() };
  const badges = { tavily: el('span', { class: 'badge' }), firecrawl: el('span', { class: 'badge' }) };
  const removers = {};
  const tryInput = el('input', { type: 'text', maxlength: 500, spellcheck: 'false', placeholder: t('A question to search for, or a link to read') });
  const tryWith = el('select', { class: 'compact', 'aria-label': t('Service') }, el('option', { value: '' }, t('As set above')), Object.entries(SERVICES).map(([id, name]) => el('option', { value: id }, t('{name} only', { name }))));
  const tryButton = el('button', { class: 'btn', type: 'button' }, t('Test'));
  const tryMeta = el('p', { class: 'hint', role: 'status' });
  const tryOut = el('div', { class: 'test-reply', hidden: true });
  const save = el('button', { class: 'btn primary', type: 'button' }, t('Save web settings'));

  const payload = () => ({ ...Object.fromEntries(Object.entries(inputs).map(([k, input]) => [k, input.value.trim()])), search: prefer.search.value, read: prefer.read.value });

  function fill(config) {
    saved = config;
    const has = { tavilyKey: config.tavily.hasKey, tavilyMcp: config.tavily.hasMcp, firecrawlKey: config.firecrawl.hasKey };
    const shown = { tavilyKey: config.tavily.keyPreview, tavilyMcp: config.tavily.mcpPreview, firecrawlKey: config.firecrawl.keyPreview };
    for (const [k, input] of Object.entries(inputs)) {
      input.value = '';
      if (has[k]) input.placeholder = t('Saved: {key}', { key: shown[k] });
      else input.placeholder = k === 'tavilyKey' ? 'tvly-…' : k === 'firecrawlKey' ? 'fc-…' : 'https://mcp.tavily.com/mcp/?tavilyApiKey=…';
      removers[k].hidden = !has[k];
    }
    for (const id of Object.keys(SERVICES)) {
      badges[id].textContent = t(config[id].ready ? 'Ready' : 'Not set up');
      badges[id].className = `badge ${config[id].ready ? 'accent' : ''}`;
    }
    prefer.search.value = config.prefer.search;
    prefer.read.value = config.prefer.read;
  }

  async function put(body, done) {
    save.disabled = true;
    try {
      const next = await call('/api/web/config', { method: 'PUT', body });
      fill(next);
      changed(next);
      status.ok(done);
    } catch (err) {
      status.bad(err.message);
    }
    save.disabled = false;
  }

  const remover = (k, what) =>
    (removers[k] = el('button', { class: 'btn', type: 'button', hidden: true, onclick: () => confirm(t('Remove the saved {what}?', { what: t(what) })) && put({ clear: [k] }, t('Removed.')) }, t('Remove')));
  const secret = (label, k, hint) => el('div', { class: 'field' }, el('span', {}, t(label)), el('div', { class: 'inline' }, inputs[k], remover(k, label)), hint && el('p', { class: 'hint' }, hint));

  async function runTest() {
    tryButton.disabled = true;
    tryMeta.textContent = t('Asking the web…');
    tryOut.hidden = true;
    try {
      const r = await call('/api/web/test', { method: 'POST', body: { ...payload(), try: tryInput.value.trim(), with: tryWith.value || undefined } });
      tryOut.hidden = false;
      tryOut.className = `test-reply ${r.ok ? 'ok' : 'bad'}`;
      if (!r.ok) {
        tryMeta.textContent = r.ms ? t('No answer after {ms} ms', { ms: fmt(r.ms) }) : '';
        tryOut.replaceChildren(t(r.error));
      } else if (r.kind === 'read') {
        tryMeta.textContent = t('{service} read the page in {ms} ms · {n} characters', { service: r.via, ms: fmt(r.ms), n: fmt(r.chars) });
        tryOut.replaceChildren(el('b', {}, r.title), `\n${r.excerpt}${r.chars > r.excerpt.length ? '…' : ''}`);
      } else {
        tryMeta.textContent = t('{service} answered in {ms} ms · {n} results', { service: r.via, ms: fmt(r.ms), n: fmt(r.results.length) });
        tryOut.replaceChildren(el('ol', { class: 'web-results' }, r.results.map((x) => el('li', {}, el('b', {}, x.title || hostOf(x.url)), x.url && el('span', { class: 'hint' }, ` ${hostOf(x.url)}`), x.snippet && el('div', { class: 'hint' }, x.snippet)))));
      }
    } catch (err) {
      tryMeta.textContent = '';
      tryOut.hidden = false;
      tryOut.className = 'test-reply bad';
      tryOut.replaceChildren(err.message);
    }
    tryButton.disabled = false;
  }

  panel.replaceChildren(
    el('p', { class: 'hint' }, t('With a web service set up, the links in a brief, in its documents and in a chat prompt are read before anything is written, and a topic or a question can be searched for. One service is enough. Keys are stored on the server and are never sent back to the browser.')),
    el(
      'fieldset',
      { class: 'media-group' },
      el('legend', {}, 'Tavily ', badges.tavily),
      secret('Tavily API key', 'tavilyKey'),
      secret('Tavily MCP link', 'tavilyMcp', t('The address of Tavily’s hosted MCP server, with your key in it. Either the key or the link is enough; with both, the key is used first and the link when it fails.')),
    ),
    el('fieldset', { class: 'media-group' }, el('legend', {}, 'Firecrawl ', badges.firecrawl), secret('Firecrawl API key', 'firecrawlKey')),
    el(
      'div',
      { class: 'row' },
      el('label', { class: 'field' }, el('span', {}, t('Search with')), prefer.search),
      el('label', { class: 'field' }, el('span', {}, t('Read links with')), prefer.read),
    ),
    el('p', { class: 'hint' }, t('The other service, when it is set up, is asked when the first one fails.')),
    el(
      'div',
      { class: 'field web-test' },
      el('span', {}, t('Try it')),
      el('div', { class: 'inline' }, tryInput, tryWith, tryButton),
      el('p', { class: 'hint' }, t('Uses the values above, saved or not. A link is read; anything else is searched for.')),
      tryMeta,
      tryOut,
    ),
    status.node,
    el('div', { class: 'actions' }, save),
  );
  enhancePasswords(panel);

  save.addEventListener('click', () => put(payload(), t('Saved.')));
  tryButton.addEventListener('click', runTest);
  // Enter in this tab saves the web settings or runs the test; it must not submit the gateway form the tab sits in.
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    if (e.target === tryInput) runTest();
    else save.click();
  });

  async function show(tab) {
    const web = tab === 'web';
    dialog.dataset.tab = web ? 'web' : 'gateways';
    for (const b of tabs.querySelectorAll('.seg-btn')) b.setAttribute('aria-selected', String((b.dataset.tab === 'web') === web));
    if (!web) return;
    status.clear();
    try {
      fill(await webAbility(true));
    } catch (err) {
      status.bad(err.message);
    }
  }
  for (const b of tabs.querySelectorAll('.seg-btn')) b.addEventListener('click', () => show(b.dataset.tab));
  dialog.addEventListener('close', () => show('gateways'));
  return { show };
}
