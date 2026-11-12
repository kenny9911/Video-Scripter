// How long one request may run.
//
// A serverless host stops a request when its time is up, and it does so without a word: the reply simply
// ends, and the page cannot tell a script that was cut off from a connection that dropped. So the server
// keeps its own clock and winds a request up a little before the host would (server.mjs, eventStream):
//
//   a script that is not finished   is handed over: the page asks for the rest in a new request, and the
//                                   model carries on from what it had written (POST /api/generate, `resume`)
//   anything else                   ends with an error that names the limit
//
// The limit is the host's, so it is set where the host is configured:
//
//   Vercel       `maxDuration` in vercel.json, which VERCEL_MAX_DURATION repeats (a test keeps the two the same)
//   elsewhere    REQUEST_TIME_LIMIT_S in the environment, in seconds; unset means no limit (npm start)
//
// REQUEST_TIME_LIMIT_S also wins on Vercel: set it when the plan allows less than vercel.json asks for.

/** Seconds one request may run on Vercel: `functions["api/index.mjs"].maxDuration` in vercel.json. */
export const VERCEL_MAX_DURATION = 800;

/** How many requests one script may take, the first included. */
export const MAX_PARTS = 8;

// What is kept back at the end of a request for recording the call, telling the page and closing the reply.
const MARGIN = { share: 0.1, mostMs: 20_000 };

/** The host's limit for one request, in milliseconds; 0 when there is none. */
export function timeLimitMs(env = process.env) {
  const set = Number(env.REQUEST_TIME_LIMIT_S);
  if (Number.isFinite(set) && set > 0) return Math.round(set * 1000);
  return env.VERCEL ? VERCEL_MAX_DURATION * 1000 : 0;
}

/** How long the work of one request may take before it is wound up, in milliseconds; 0 for as long as it takes. */
export function workBudgetMs(env = process.env) {
  const limit = timeLimitMs(env);
  return limit ? Math.round(limit - Math.min(MARGIN.mostMs, limit * MARGIN.share)) : 0;
}

/** The error a request is stopped with when its time is up. Its name is what tells it from a visitor who left. */
export function outOfTime(env = process.env) {
  const seconds = Math.round(timeLimitMs(env) / 1000);
  return new DOMException(`It was not finished within the ${seconds} seconds one request may run`, 'TimeoutError');
}
