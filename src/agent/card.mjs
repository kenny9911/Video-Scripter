// The viewpoint card: what a video says, decided before any narration is written. It is the plan step of
// the narration agent, and it travels with the narration into the script built around it.
//
//   persona      who is speaking
//   viewer       who it is for, and what they worry about
//   insight      { claim, against }: the one idea the viewer leaves with, and the common belief it overturns
//   insider      the insider explanation: concepts and details, in business words
//   experience   first-hand practice: [{ point, source }], source 'brief' (the creator gave it) or 'draft' (to confirm)
//   analogy      the one analogy carried through, or ''
//   mustSay      names from the topic that have to be spoken
//   openLoop     what the opening promises and where it is paid off
//   outline      [{ stage, layer, point }]: what each beat of the story line does
//   toVerify     what the creator should confirm or replace before recording

export const LAYERS = ['insider', 'experience', 'insight'];
const OUTLINE_LAYERS = new Set(['hook', ...LAYERS, 'cta']);

export const CARD_SCHEMA = `{
  "persona": "who is speaking, in one line",
  "viewer": "who this is for and what they are worried about, in one line",
  "insight": {
    "claim": "the one idea the viewer leaves with, as a sentence they could repeat to a colleague",
    "against": "the common belief it overturns"
  },
  "insider": ["a concept, component, detail or figure a practitioner would explain, in business words"],
  "experience": [
    { "point": "something seen first-hand in practice, with its scene", "source": "brief or draft" }
  ],
  "analogy": "the one everyday analogy carried through the video, or an empty string",
  "mustSay": ["a name from the topic that must be spoken"],
  "openLoop": "what the opening promises, and which stage pays it off",
  "outline": [
    { "stage": "stage key from the story line", "layer": "hook, insider, experience, insight or cta", "point": "what this beat says" }
  ],
  "toVerify": ["a fact or an experience the creator must confirm or replace before recording"]
}`;

/** How a card is filled in. Written for the model; the same in every language (values are written in the narration's language). */
export const PLAN_RULES = [
  'Start from the creator\'s own words. A topic often already carries a storyline, a claim or an opening line: keep its order and its strongest phrases, and build the plan around them. Do not replace the creator\'s angle with a generic explainer of the subject.',
  'Scope the plan to the room. A beat can make one point; a short video carries one idea, one analogy and one scene from practice. Leave out what does not fit instead of planning to compress it. Every entry of the card is one short sentence.',
  '`insight.claim` is one sentence a viewer could repeat to a colleague word for word. `insight.against` is the common belief it overturns. If the brief gives a key message, the claim is that message, sharpened.',
  '`insider`: two to four points an outsider would not know to make, each a specific claim in business words (never a topic label such as "what it is").',
  '`experience`: one to three things seen first-hand, each with its scene (who, doing what, stuck where). Take them from the creator\'s experience notes or the reference material when there are any, and mark them "brief". Otherwise describe a pattern a practitioner in this persona would recognise, with no numbers, no client names and no quotes, mark it "draft", and add a line to `toVerify` asking the creator to confirm it or swap in a real case.',
  '`mustSay`: every company, product, technology and person the topic names, as it should be spoken. Keep the original name and add the local-language name when there is one, e.g. "Ontology（本体）".',
  '`analogy`: one concrete analogy from the viewer\'s own world that can carry the whole explanation, or an empty string when the video does not need one.',
  '`outline`: one entry per stage of the story line, in order, with that stage\'s key. `layer` is what the beat mainly carries: "hook" for the opening, "cta" for the close, otherwise "insider", "experience" or "insight". `point` is what the beat says, as one claim.',
  '`openLoop`: the question or promise the opening leaves open, and the stage that pays it off.',
  '`toVerify`: every fact the plan leans on that the brief and the material do not give, and every drafted experience. Leave it empty when there is nothing.',
];

const str = (v, max) => (v == null ? '' : String(v)).trim().slice(0, max);
const strings = (v, max, cap) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => str(typeof x === 'object' ? x?.point ?? x?.text : x, max)).filter(Boolean).slice(0, cap);

/**
 * A card from a model reply or a request body, with only the fields the app knows and sane sizes.
 * Returns null when there is nothing in it. `stages` (the story line's keys) drops outline entries for other stages.
 */
export function normalizeCard(input, stages = null) {
  if (!input || typeof input !== 'object') return null;
  const insight = typeof input.insight === 'string' ? { claim: input.insight } : input.insight || {};
  const card = {
    persona: str(input.persona, 200),
    viewer: str(input.viewer, 240),
    insight: { claim: str(insight.claim, 240), against: str(insight.against, 240) },
    insider: strings(input.insider, 240, 5),
    experience: (Array.isArray(input.experience) ? input.experience : input.experience ? [input.experience] : [])
      .map((e) => ({ point: str(typeof e === 'object' ? e?.point : e, 300), source: e?.source === 'brief' ? 'brief' : 'draft' }))
      .filter((e) => e.point)
      .slice(0, 4),
    analogy: str(input.analogy, 200),
    mustSay: strings(input.mustSay, 60, 8),
    openLoop: str(input.openLoop, 240),
    outline: (Array.isArray(input.outline) ? input.outline : [])
      .map((o) => ({ stage: str(o?.stage, 40), layer: OUTLINE_LAYERS.has(o?.layer) ? o.layer : '', point: str(o?.point, 200) }))
      .filter((o) => o.stage && (!stages || stages.includes(o.stage)))
      .slice(0, 20),
    toVerify: strings(input.toVerify, 240, 8),
  };
  const empty = !card.insight.claim && !card.insider.length && !card.experience.length && !card.outline.length;
  return empty ? null : card;
}

/** The card as a prompt carries it. */
export const cardBlock = (card) => JSON.stringify(card, null, 2);
