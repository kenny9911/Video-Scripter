// Two append-only records:
//   usage     one document per call to a model (script, image, video, connection test): who, for which
//             task (the script's id), which gateway and model, tokens in and out, images, video seconds,
//             and what it cost at that gateway's prices on the day (`priced` is false when it had none).
//   activity  one document per thing a person did (signed in, generated a script, changed a gateway ...).
// Recording must never break the request it describes, so failures here are logged and swallowed.

import { randomUUID } from 'node:crypto';
import { db } from './db.mjs';
import { costOf } from './gateway/prices.mjs';

const id = () => randomUUID().slice(0, 16);
const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);

/** Rough token count for providers that do not report usage: one per CJK character, one per four others. */
export function estimateTokens(text) {
  const s = String(text || '');
  const cjk = (s.match(/[㐀-鿿豈-﫿぀-ヿ가-힯]/g) || []).length;
  return cjk + Math.ceil((s.length - cjk) / 4);
}

export async function recordUsage({ user, taskId = '', kind, config, model, inputTokens, outputTokens, images, videoSeconds, estimated = false, ok = true, error = '', ms = 0 }) {
  const name = String(model || config?.model || '');
  // A call that failed is not billed; one that worked costs what this gateway's price sheet says, if it says.
  const cost = ok ? costOf(config?.pricing, { model: name, inputTokens: num(inputTokens), outputTokens: num(outputTokens), images: num(images), videoSeconds: num(videoSeconds) }) : null;
  const doc = {
    id: id(),
    ts: Date.now(),
    userId: user?.id || '',
    taskId: String(taskId || ''),
    kind,
    gatewayId: config?.id || '',
    gateway: config?.name || '',
    provider: config?.provider || '',
    model: name,
    inputTokens: num(inputTokens),
    outputTokens: num(outputTokens),
    images: num(images),
    videoSeconds: num(videoSeconds),
    estimated: Boolean(estimated),
    cost: cost ?? 0,
    currency: cost === null ? '' : config.pricing.currency || 'USD',
    priced: cost !== null,
    ok: Boolean(ok),
    error: String(error || '').slice(0, 300),
    ms: num(ms),
  };
  try {
    await db.put('usage', doc);
  } catch (err) {
    console.warn(`[usage] not recorded: ${err.message}`);
  }
  return doc;
}

export async function logActivity(req, user, type, detail = {}) {
  try {
    await db.put('activity', {
      id: id(),
      ts: Date.now(),
      userId: user?.id || '',
      email: user?.email || detail.email || '',
      type,
      detail,
      ip: String(req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || '').split(',')[0].trim(),
    });
  } catch (err) {
    console.warn(`[activity] not recorded: ${err.message}`);
  }
}

const blank = () => ({ calls: 0, failed: 0, inputTokens: 0, outputTokens: 0, images: 0, videos: 0, videoSeconds: 0, estimated: 0, cost: {}, unpriced: 0 });
function add(total, u) {
  total.calls += 1;
  if (!u.ok) total.failed += 1;
  total.inputTokens += u.inputTokens;
  total.outputTokens += u.outputTokens;
  total.images += u.images;
  total.videoSeconds += u.videoSeconds;
  if (u.kind === 'video' && u.ok) total.videos += 1;
  if (u.estimated) total.estimated += 1;
  if (u.priced) total.cost[u.currency] = Math.round(((total.cost[u.currency] || 0) + u.cost) * 1e8) / 1e8;
  else if (u.ok && u.provider !== 'mock') total.unpriced += 1; // it worked and nobody said what it costs
  return total;
}
const group = (rows, keyOf, extra) => {
  const map = new Map();
  for (const u of rows) {
    const key = keyOf(u);
    if (!map.has(key)) map.set(key, { key, ...extra?.(u), ...blank(), lastTs: 0 });
    const g = add(map.get(key), u);
    g.lastTs = Math.max(g.lastTs, u.ts);
  }
  return [...map.values()];
};

/**
 * Totals for one user (userId) or everyone (userId undefined), over the last `days` (0 = all time):
 * overall, by kind of call, by model, by task (script), by user, and the latest calls.
 * `costs: false` leaves out what the calls cost: that is the administrators' business.
 */
export async function summarizeUsage({ userId, days = 30, costs = true } = {}) {
  const since = days > 0 ? Date.now() - days * 86_400_000 : undefined;
  const rows = await db.list('usage', { userId, since, limit: 20_000 });
  const history = new Map((await db.list('history', { userId })).map((e) => [e.id, e]));
  const users = userId === undefined ? new Map((await db.list('users')).map((u) => [u.id, u])) : new Map();
  // A conversation is a task too. Its title is its owner's to see: in the totals for everyone it is only "a conversation".
  const chats = new Map((await db.list('chats', { userId })).map((c) => [c.id, userId === undefined ? 'Conversation' : c.title]));
  const tokens = (g) => g.inputTokens + g.outputTokens;
  const shown = (g) => {
    if (costs) return g;
    const { cost, unpriced, currency, priced, ...rest } = g;
    return rest;
  };
  const groups = (list) => list.map(shown);

  const summary = {
    days,
    total: rows.reduce(add, blank()),
    byKind: group(rows, (u) => u.kind),
    byModel: group(rows, (u) => `${u.gateway} · ${u.model}`, (u) => ({ gateway: u.gateway, model: u.model })).sort((a, b) => tokens(b) - tokens(a) || b.calls - a.calls),
    byTask: group(rows.filter((u) => u.taskId), (u) => u.taskId, (u) => {
      const e = history.get(u.taskId);
      return { title: e?.script?.title || e?.brief?.topic || chats.get(u.taskId) || '', platformId: e?.platformId || (chats.has(u.taskId) ? 'chat' : ''), userId: u.userId, email: users.get(u.userId)?.email || '' };
    })
      .sort((a, b) => b.lastTs - a.lastTs)
      .slice(0, 200),
    byUser: userId === undefined ? group(rows, (u) => u.userId, (u) => ({ email: users.get(u.userId)?.email || '', name: users.get(u.userId)?.name || '' })).sort((a, b) => tokens(b) - tokens(a) || b.calls - a.calls) : [],
    recent: rows.slice(0, 100).map((u) => ({ ...u, email: users.get(u.userId)?.email || '' })),
  };
  return { ...summary, total: shown(summary.total), byKind: groups(summary.byKind), byModel: groups(summary.byModel), byTask: groups(summary.byTask), byUser: groups(summary.byUser), recent: groups(summary.recent) };
}

export const listActivity = ({ userId, limit = 200 } = {}) => db.list('activity', { userId, limit: Math.min(1000, Math.max(1, Number(limit) || 200)) });
