// Whose end a failure is on. Every error the page is shown carries a cause next to its message, so the
// creator can tell "the provider is down, wait" from "the key in LLM settings is wrong, fix it":
//
//   side      whose end it is on
//     provider   the model provider (or the gateway in front of it): nothing to fix in this app
//     settings   our end: something in LLM settings (key, model name, address, account credit)
//     network    between this server and the provider: the provider could not be reached
//     app        our end: a fault in Video Scripter itself
//   code      what happened, in one word: the page has a sentence for each (public/i18n.js)
//   host      the provider's host, when there is one
//   status    the HTTP status the provider answered with, when it answered
//
// causeOf(err) -> { side, code, host?, status? } | null     null: the message already says it all
//                                                           (a brief with no topic, a wrong password)
// errorBody(err, message?) -> { error, cause? }             what a route answers with

const OUT_OF_CREDIT = /quota|balance|insufficient|credit|billing|payment|exceeded your current|欠费|余额/i;
const BUGS = [TypeError, ReferenceError, RangeError];

/** True when a provider's message says the account has run out, which no amount of waiting fixes. */
export const outOfCredit = (message) => OUT_OF_CREDIT.test(String(message || ''));

/** The cause of an HTTP reply from a provider, from its status and what it said. */
function upstreamCode(status, message) {
  if (status === 401 || status === 403) return ['settings', 'key'];
  if (status === 402 || (status === 429 && OUT_OF_CREDIT.test(message))) return ['settings', 'credit'];
  if (status === 404) return ['settings', 'model'];
  if (status === 429) return ['provider', 'busy'];
  if (status === 408 || status >= 500) return ['provider', 'outage'];
  return ['settings', 'request']; // 400, 422...: the provider understood the address and the key, and refused what was sent
}

export function causeOf(err) {
  if (!err) return null;
  const at = (side, code) => ({ side, code, ...(err.host && { host: err.host }), ...(err.upstream && Number.isFinite(err.status) && { status: err.status }), ...(err.attempts > 1 && { attempts: err.attempts }) });
  if (err.name === 'TimeoutError') return at('provider', 'timeout');
  if (err.unreadable) return at('provider', 'reply');
  if (err.name === 'GatewayError') {
    if (err.unreachable) return at('network', 'unreachable');
    if (err.upstream) return at(...(Number.isFinite(err.status) ? upstreamCode(err.status, err.message) : ['provider', 'stream']));
    if (err.status >= 500) return at('provider', 'reply'); // it answered, but not with what was asked for
    return at('settings', 'setup'); // refused before any call: a setting is missing or wrong
  }
  if (BUGS.some((kind) => err instanceof kind)) return at('app', 'bug');
  return null;
}

/** What a route answers a failure with: the message, and whose end it is on when that is known. */
export function errorBody(err, message = err.message) {
  const cause = causeOf(err);
  return { error: message, ...(cause && { cause }) };
}

/** One line for the server log: `provider/outage aigw.store 503`. */
export const causeLine = (cause) => (cause ? [`${cause.side}/${cause.code}`, cause.host, cause.status].filter(Boolean).join(' ') : 'user');
