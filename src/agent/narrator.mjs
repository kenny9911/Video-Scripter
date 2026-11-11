// The narration agent. One model call writes a narration that reads like any other; this writes one the
// way a writing team does, in steps, each with the playbooks (skills) that apply to the brief:
//
//   skills   pick the playbooks for this platform, style, language and topic            (no model call)
//   write    decide what the video says (the viewpoint card), then write the narration
//            to it, one beat per stage, in one reply                                    buildNarrationPrompts
//   review   measure the draft, have an editor review it against the findings and
//            the playbooks, and take the corrected narration                            reviewNarration + buildEditPrompts
//            (a second, narrower pass runs only when measured errors are left)
//
// It runs through the same LLM gateway as everything else and needs nothing from the provider beyond text
// in and text out, so it works with every model the gateway reaches, and in demo mode. Planning and writing
// share one call on purpose: a model that reasons before it answers can take minutes per call.
//
// writeNarration({ config, plan, signal, emit, onCall }) -> { title, beats, card, report }      skills + write
// reviseNarration({ config, plan, beats, card, signal, emit, onCall, until }) -> { beats, report }   review
// runNarrationAgent(...) -> { title, beats, card, report }                                          all of it
//   emit(event, data)   progress for the page: 'step' { id, status, ... } and 'delta' { text }
//   onCall(call)        one record per model call: { step, prompts, raw, usage, ms, ok, error }
//   until               a time (ms) after which no second review pass is started
//
// The page runs the two halves as two requests (write, then review), so a slow model never has one request
// carry two long calls: a serverless host cuts a request off after a few minutes.

import { streamChat } from '../gateway/client.mjs';
import { buildNarrationPrompts, parseNarration, replyJson } from '../prompt.mjs';
import { publicSkill } from './skills.mjs';
import { normalizeCard } from './card.mjs';
import { buildEditPrompts, parseEdit } from './prompts.mjs';
import { reviewNarration } from './review.mjs';

export const AGENT_STEPS = ['skills', 'write', 'review'];
const MAX_REVIEW_ROUNDS = 2;
const WRITE_ATTEMPTS = 2;

const isAbort = (err) => err?.name === 'AbortError' || err?.name === 'TimeoutError';

/** One model call of a step: streams the reply to the page and hands the finished call to `onCall`. */
function caller({ config, signal, emit, onCall, chat }) {
  return async (step, prompts, meta) => {
    const started = Date.now();
    let raw = '';
    let usage = null;
    emit('delta', { text: `\n\n── ${step} ──\n` });
    try {
      for await (const text of chat(config, { ...prompts, signal, meta, onUsage: (u) => (usage = u) })) {
        raw += text;
        emit('delta', { text });
      }
      await onCall?.({ step, prompts, raw, usage, ms: Date.now() - started, ok: true });
      return raw;
    } catch (err) {
      await onCall?.({ step, prompts, raw, usage, ms: Date.now() - started, ok: false, error: isAbort(err) ? 'Stopped by the user' : err.message });
      throw err;
    }
  };
}

/** What the page and the history keep of a review: the measured findings, the editor's notes, and what was used. */
const reportOf = (plan, measured, { notes = [], rounds = 0, reviewed = true } = {}) => ({
  findings: measured.findings,
  errors: measured.errors,
  warns: measured.warns,
  stats: measured.stats,
  notes,
  rounds,
  reviewed,
  skills: plan.skills.map(publicSkill),
});

/**
 * The review step on a narration: measure, edit, measure again. An edit is kept when it leaves no more
 * measured errors than there were (the editor also fixes what cannot be measured); otherwise the narration
 * stays as it was. Returns { beats, report }.
 */
async function review({ call, plan, beats, card, emit, until = Infinity }) {
  let best = { beats, measured: reviewNarration(beats, plan, { card }) };
  const notes = [];
  let rounds = 0;
  emit('step', { id: 'review', status: 'start', findings: best.measured.findings.length });
  for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
    if (round > 1 && (!best.measured.errors || Date.now() > until)) break;
    let edit;
    try {
      edit = parseEdit(await call('review', buildEditPrompts(plan, best.beats, best.measured, { card, round }), { plan, kind: 'edit', beats: best.beats }));
    } catch (err) {
      if (isAbort(err)) throw err;
      emit('step', { id: 'review', status: 'note', note: `The review could not be read (${err.message}); the draft is kept.` });
      break;
    }
    rounds = round;
    const measured = reviewNarration(edit.beats, plan, { card });
    if (round === 1) notes.push(...edit.notes);
    if (measured.errors <= best.measured.errors) best = { beats: edit.beats, measured };
  }
  const report = reportOf(plan, best.measured, { notes, rounds, reviewed: rounds > 0 });
  emit('step', { id: 'review', status: 'done', errors: report.errors, warns: report.warns, rounds });
  return { beats: best.beats, report };
}

/**
 * Pick the skills, then plan and write: the viewpoint card and the narration written to it, in one reply.
 * The report is what the draft measures as; it has not been reviewed yet.
 * A reply with no narration is asked for once more; a second one throws (`unreadable`, with the `raw` reply).
 */
export async function writeNarration({ config, plan, signal, emit = () => {}, onCall, chat = streamChat }) {
  const call = caller({ config, signal, emit, onCall, chat });
  emit('step', { id: 'skills', status: 'done', skills: plan.skills.map(publicSkill) });
  emit('step', { id: 'write', status: 'start' });
  // A model now and then answers with a stray sentence instead of the narration: ask once more before giving up.
  let raw;
  let draft;
  for (let attempt = 1; !draft; attempt++) {
    raw = await call('write', buildNarrationPrompts(plan, { planFirst: true }), { plan, kind: 'narration', planFirst: true });
    try {
      draft = parseNarration(raw);
    } catch (err) {
      if (attempt === WRITE_ATTEMPTS) throw Object.assign(err, { raw, unreadable: true });
      emit('step', { id: 'write', status: 'note', note: `The reply could not be read (${err.message}); asking again.` });
    }
  }
  // A reply whose card cannot be read still gives a narration: it is then reviewed without one.
  const card = normalizeCard(replyJson(raw).card, plan.timeline.map((s) => s.key));
  emit('step', { id: 'write', status: 'done', beats: draft.beats.length, card });
  return { title: draft.title, beats: draft.beats, card, report: checkNarration(plan, draft.beats, card) };
}

/** The review step: on the agent's own draft, or on a narration the creator wrote or edited. */
export async function reviseNarration({ config, plan, beats, card = null, signal, emit = () => {}, onCall, chat = streamChat, until }) {
  return review({ call: caller({ config, signal, emit, onCall, chat }), plan, beats, card, emit, until });
}

/** Plan, write and review a narration for a plan (buildPlan), start to finish. */
export async function runNarrationAgent(options) {
  const written = await writeNarration(options);
  const revised = await reviseNarration({ ...options, beats: written.beats, card: written.card });
  return { title: written.title, beats: revised.beats, card: written.card, report: revised.report };
}

/** The measured checks alone, in the shape the page shows: nothing is rewritten and no model is called. */
export function checkNarration(plan, beats, card = null) {
  return reportOf(plan, reviewNarration(beats, plan, { card }), { reviewed: false });
}
