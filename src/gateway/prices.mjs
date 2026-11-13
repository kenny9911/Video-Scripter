// What a call costs. The same model costs a different amount at every provider (and, at a reseller, in
// every key group), so each saved gateway carries its own price sheet:
//
//   pricing: { currency, source, models: { [model]: row } }
//     currency   'USD' or 'CNY': what this provider bills in
//     source     where the prices came from, for the record ("aigw.store · Gemini Ultra")
//     row        input, output    per million tokens
//                image            per picture made (when set, a picture is not billed by its tokens)
//                second           per second of video
//                longAbove        a prompt longer than this many tokens is billed at longInput / longOutput
//
// A call is costed once, when it is made, and the amount is stored with it: changing a price later does not
// rewrite what earlier calls cost. A model with no row is "not priced", which is not the same as free.
//
// cleanPricing(input) -> pricing                       what is stored, whatever the form sent
// costOf(pricing, call) -> number | null               null: this call has no price
// plazaGroups(json) -> [{ id, name, note, rate, models, unpriced }]
// fetchPriceList(baseUrl, { signal }) -> { url, host, groups }   a provider's published prices, when it has
//                                                      a list this app can read (Sub2API's "model plaza")

export const CURRENCIES = ['USD', 'CNY'];
export const PRICING_BLANK = { currency: 'USD', source: '', models: {} };
const FIELDS = ['input', 'output', 'image', 'second', 'longAbove', 'longInput', 'longOutput'];
const MAX_MODELS = 400;

const round = (n) => Math.round(n * 1e8) / 1e8;
const price = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : round(Number(v)));

function cleanRow(row) {
  const out = {};
  for (const f of FIELDS) {
    const v = price(row?.[f]);
    if (v !== null) out[f] = v;
  }
  if (!out.longAbove || (out.longInput === undefined && out.longOutput === undefined)) for (const f of ['longAbove', 'longInput', 'longOutput']) delete out[f];
  return ['input', 'output', 'image', 'second'].some((f) => out[f] !== undefined) ? out : null;
}

export function cleanPricing(input) {
  const models = {};
  for (const [name, row] of Object.entries(input?.models && typeof input.models === 'object' ? input.models : {}).slice(0, MAX_MODELS)) {
    const model = String(name).trim().slice(0, 120);
    const clean = cleanRow(row);
    if (model && clean) models[model] = clean;
  }
  return { currency: CURRENCIES.includes(input?.currency) ? input.currency : 'USD', source: String(input?.source || '').trim().slice(0, 120), models };
}

/**
 * The cost of one call in the sheet's currency, or null when the sheet has no price for it.
 * `call`: { model, inputTokens, outputTokens, images, videoSeconds }.
 */
export function costOf(pricing, { model, inputTokens = 0, outputTokens = 0, images = 0, videoSeconds = 0 } = {}) {
  const row = pricing?.models?.[model];
  if (!row) return null;
  if (videoSeconds > 0) return row.second === undefined ? null : round(videoSeconds * row.second);
  if (images > 0 && row.image !== undefined) return round(images * row.image);
  if (row.input === undefined && row.output === undefined) return null;
  const long = row.longAbove > 0 && inputTokens > row.longAbove;
  const input = (long ? row.longInput : undefined) ?? row.input ?? 0;
  const output = (long ? row.longOutput : undefined) ?? row.output ?? 0;
  return round((inputTokens * input + outputTokens * output) / 1e6);
}

// ---------- A provider's own price list ----------
// Sub2API gateways (aigw.store is one) publish theirs at /api/v1/model-plaza, without a key: every key
// group, its rate, and each model's base price per token. What a key pays is base price x the group's rate.

const perMillion = (perToken, rate) => (Number.isFinite(perToken) && perToken !== null ? round(perToken * 1e6 * rate) : undefined);

function plazaRow(model, rate, imageRate) {
  const p = model?.pricing;
  if (!p) return null;
  const tiers = Array.isArray(p.intervals) ? p.intervals : [];
  if (p.billing_mode === 'image') {
    const each = tiers.map((t) => t.per_request_price).filter((n) => Number.isFinite(n) && n !== null);
    const image = each.length ? Math.max(...each) : p.per_request_price;
    return cleanRow({ image: Number.isFinite(image) && image !== null ? image * imageRate : null });
  }
  const row = { input: perMillion(p.input_price, rate), output: perMillion(p.output_price ?? p.image_output_price, p.output_price == null ? imageRate : rate) };
  const long = tiers.find((t) => t.min_tokens > 0 && (t.input_price != null || t.output_price != null));
  if (long) Object.assign(row, { longAbove: long.min_tokens, longInput: perMillion(long.input_price, rate), longOutput: perMillion(long.output_price, rate) });
  return cleanRow(row);
}

/** The key groups of a Sub2API price list, each with what its keys pay per model. */
export function plazaGroups(json) {
  const groups = json?.data?.groups ?? json?.groups;
  if (!Array.isArray(groups)) throw new Error('That is not a price list this app can read');
  return groups
    .map((g) => {
      const rate = Number.isFinite(g.rate_multiplier) ? g.rate_multiplier : 1;
      const imageRate = g.image_rate_independent && Number.isFinite(g.image_rate_multiplier) ? g.image_rate_multiplier : rate;
      const models = {};
      const unpriced = [];
      for (const m of Array.isArray(g.models) ? g.models : []) {
        const row = plazaRow(m, rate, imageRate);
        if (row) models[m.name] = row;
        else if (m?.name) unpriced.push(m.name);
      }
      return { id: String(g.id ?? g.name), name: String(g.name || ''), note: String(g.description || '').replace(/\s+/g, ' ').trim(), rate, models, unpriced };
    })
    .filter((g) => g.name && (Object.keys(g.models).length || g.unpriced.length));
}

/** Where a gateway's price list would be: on its own host, and on the host without an `api.` in front. */
export function priceListUrls(baseUrl) {
  const u = new URL(String(baseUrl || '').trim());
  if (!/^https?:$/.test(u.protocol)) throw new Error('BASE_URL_API must be http(s)');
  const hosts = [u.host, u.host.replace(/^api\./, '')];
  return [...new Set(hosts)].map((host) => `${u.protocol}//${host}/api/v1/model-plaza`);
}

export async function fetchPriceList(baseUrl, { signal, fetchImpl = fetch } = {}) {
  let urls;
  try {
    urls = priceListUrls(baseUrl);
  } catch {
    throw new Error('Enter the BASE_URL_API first');
  }
  let last = '';
  for (const url of urls) {
    try {
      const res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal });
      if (!res.ok) {
        last = `${new URL(url).host} answered ${res.status}`;
        continue;
      }
      const groups = plazaGroups(JSON.parse((await res.text()).slice(0, 4_000_000)));
      if (groups.length) return { url, host: new URL(url).host, groups };
      last = `${new URL(url).host} lists no prices`;
    } catch (err) {
      if (err.name === 'AbortError' || err.name === 'TimeoutError') throw err;
      last = `${new URL(url).host}: ${err.message}`;
    }
  }
  throw new Error(`This provider has no price list this app can read (${last}). Enter the prices by hand.`);
}
