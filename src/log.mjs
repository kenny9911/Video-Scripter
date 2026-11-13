// Debug messages for the terminal the server runs in: every API request, every call to a model, an image,
// video, voice or web service, each retry, and each step of the narration agent.
//
//   LOG_LEVEL=debug   everything (the default)
//   LOG_LEVEL=info    requests and failures only
//   LOG_LEVEL=quiet   nothing from here (the default while the tests run)
//   LOG_PROMPTS=1     also print the prompts sent to the model and its replies, whole
//
// A line is `time [scope] message key=value …`. Keys and tokens are never passed to these functions, and an
// address is logged without its query string, which is where some providers carry a key.

const LEVELS = { quiet: 0, info: 1, debug: 2 };
const level = () => LEVELS[String(process.env.LOG_LEVEL || '').toLowerCase()] ?? (process.env.NODE_TEST_CONTEXT ? 0 : 2);
const colour = () => Boolean(process.stderr.isTTY) && !process.env.NO_COLOR;

const stamp = () => new Date().toISOString().slice(11, 23);
const paint = (code, text) => (colour() ? `\x1b[${code}m${text}\x1b[0m` : text);

/** One value of a line: short, on one line, quoted when it has spaces. */
function show(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number') return String(Math.round(value * 100) / 100);
  if (typeof value === 'boolean') return String(value);
  const text = (typeof value === 'string' ? value : JSON.stringify(value)).replace(/\s+/g, ' ').trim();
  const cut = text.length > 220 ? `${text.slice(0, 220)}…` : text;
  return /[\s=]/.test(cut) ? JSON.stringify(cut) : cut;
}

function write(at, scope, message, data) {
  if (level() < at) return;
  const pairs = Object.entries(data || {})
    .map(([k, v]) => [k, show(v)])
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${paint(2, `${k}=`)}${v}`)
    .join(' ');
  // stderr, like the warnings: a log never mixes with anything a script reads from stdout.
  console.error(`${paint(2, stamp())} ${paint(at === 1 ? 36 : 35, `[${scope}]`)} ${message}${pairs ? ` ${pairs}` : ''}`);
}

/** A step worth following while something is being worked out. */
export const debug = (scope, message, data) => write(2, scope, message, data);
/** Something that happened: a request answered, a call that failed. */
export const info = (scope, message, data) => write(1, scope, message, data);
export const debugging = () => level() >= 2;

/** An address as it may be logged: host and path, nothing after the "?". */
export function where(url) {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return String(url).split('?')[0];
  }
}

/** A prompt or a reply, printed whole when LOG_PROMPTS is set. */
export function dump(scope, title, text) {
  if (level() < 2 || !/^(1|true|yes|on)$/i.test(String(process.env.LOG_PROMPTS || ''))) return;
  console.error(`${paint(2, stamp())} ${paint(35, `[${scope}]`)} ${title} ${paint(2, `(${String(text ?? '').length} characters)`)}\n${String(text ?? '')}\n${paint(2, '— end —')}`);
}
