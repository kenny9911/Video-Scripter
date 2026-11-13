// One POST to a web service (Tavily, Firecrawl), with its failures turned into the errors the rest of the
// app already knows how to explain (src/gateway/client.mjs, src/errors.mjs).

import { request, GatewayError } from '../gateway/client.mjs';

/**
 * POST `body` as JSON and read the JSON answer. `said(json)` reads the service's own words out of an error
 * reply, where they are not where the model providers put theirs.
 */
export async function postJson(url, body, { headers = {}, signal, said } = {}) {
  const host = new URL(url).host;
  let res;
  try {
    res = await request(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', ...headers }, body: JSON.stringify(body), signal }, { retries: 1 });
  } catch (err) {
    let own = '';
    try {
      own = said && err.endpoint ? String(said(JSON.parse(err.endpoint.body)) || '') : '';
    } catch {}
    if (own) err.message = `${host} responded ${err.status}: ${own.slice(0, 400)}`;
    throw err;
  }
  const data = await res.json().catch(() => null);
  if (!data || typeof data !== 'object') throw Object.assign(new GatewayError(`${host} did not answer with JSON`, 502), { host });
  return data;
}
