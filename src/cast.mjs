// The people of a video: who speaks, and who is seen.
//
// A brief may ask for an on-screen host: a digital presenter who is the same person from the first scene
// to the last. A two-speaker style (a framework with `speakers: 2`) has two of them, A and B.
//
//   brief.host    { on, looks: [a, b] }                    what the creator asked for. A look is a preset id,
//                                                          the creator's own words, or '' (the scriptwriter designs it)
//   script.cast   [{ id, name, role, look, voice }]        who they are, as the script fixed it
//   scene.host    'A' | 'B' | 'AB' | ''                    who is in frame in that scene
//
// The look is written once and added to the prompt of every image and clip the host is in, so the same
// person is described the same way each time. The portrait made from it (hostPrompt) is the reference
// frame: it is handed to the image model with each scene where the provider takes a reference image
// (gateway/media.mjs), and it is the picture to give a talking-avatar tool.

export const HOST_IDS = ['A', 'B'];
export const MAX_HOST_LOOK = 240; // characters of the creator's own description kept

const P = (id, en, zh, lookEn, lookZh) => ({ id, name: { en, zh }, look: { en: lookEn, zh: lookZh } });

/** Ready-made hosts. Each look is specific enough for an image model to draw the same person again. No real person is described. */
export const HOST_PRESETS = [
  P('analyst_f', 'Poised analyst', '知性女主播',
    'an East Asian woman in her early thirties with straight shoulder-length black hair and light make-up, in a cream blazer over a white top, upright posture, calm and warm',
    '三十岁出头的东亚女性，齐肩黑色直发，淡妆，米白色西装外套配白色内搭，坐姿端正，神情沉稳亲和'),
  P('founder_m', 'Tech founder', '科技创业者',
    'an East Asian man of about thirty-five with short black hair and light stubble, in a charcoal crew-neck sweater with the sleeves pushed up, relaxed and direct',
    '三十五岁左右的东亚男性，黑色短发，略有胡茬，深灰色圆领毛衣，袖口微微挽起，神情放松而直接'),
  P('consultant_f', 'Senior consultant', '资深女顾问',
    'an East Asian woman of about forty with black hair tied low and thin-rimmed glasses, in a tailored navy suit over a pale blue shirt, crisp and assured',
    '四十岁左右的东亚女性，黑发低扎，细框眼镜，藏青色修身西装配浅蓝色衬衫，气质干练笃定'),
  P('professor_m', 'Professor', '儒雅教授',
    'an East Asian man in his fifties with short greying hair and round black glasses, in a dark blue casual jacket over a light grey roll-neck, gentle and unhurried',
    '五十多岁的东亚男性，花白短发，黑色圆框眼镜，深蓝色休闲西装内搭浅灰色高领衫，神情温和从容'),
  P('creator_f', 'Upbeat creator', '元气女博主',
    'an East Asian woman of about twenty-five with a high ponytail, in a bright yellow hoodie, with a big smile and lively gestures',
    '二十五岁左右的东亚女性，高马尾，明黄色卫衣，笑容明亮，动作有活力'),
  P('creator_m', 'Gadget creator', '数码男博主',
    'an East Asian man of about twenty-eight with short wavy black hair and clear-framed glasses, in a denim shirt over a white T-shirt, curious and talkative',
    '二十八岁左右的东亚男性，微卷的黑色短发，透明框眼镜，白色 T 恤外搭牛仔衬衫，表情好奇而健谈'),
  P('presenter_f', 'Friendly presenter', '亲和女主持',
    'a woman in her early thirties with wavy chestnut hair to the shoulders and freckles, in a forest-green knit sweater, open and friendly',
    '三十岁出头的女性，栗色及肩卷发，脸上有淡淡的雀斑，墨绿色针织衫，神情开朗友好'),
  P('presenter_m', 'Easygoing presenter', '随和男主持',
    'a man in his late thirties with short brown hair and a trimmed beard, in a navy overshirt over a grey T-shirt, calm with a dry smile',
    '三十七八岁的男性，棕色短发，修剪整齐的络腮胡，藏青色衬衫外套内搭灰色 T 恤，神情平静，带一点笑意'),
  P('avatar3d', '3D avatar', '三维虚拟形象',
    'a stylised 3D character with a round friendly face, large expressive eyes and short teal hair, in an orange bomber jacket over a white T-shirt, rounded simplified forms and smooth matte materials',
    '风格化的三维虚拟角色，圆润友好的脸，大而有神的眼睛，青绿色短发，橙色飞行员夹克内搭白色 T 恤，造型圆润简洁，哑光材质'),
];

const oneLine = (v, max) => [...String(v ?? '').replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim()].slice(0, max).join('');
const trimEnd = (s) => s.replace(/[\s.。,，;；:：]+$/, '');

/** A look as the creator gave it: a preset's description in the script's language, their own words, or '' for "design one". */
export function lookOf(value, lang = 'en') {
  const preset = HOST_PRESETS.find((p) => p.id === value);
  if (preset) return preset.look[lang === 'zh' ? 'zh' : 'en'];
  return trimEnd(oneLine(value, MAX_HOST_LOOK));
}

/**
 * The hosts a brief asks for: [] when none is on screen, otherwise one per speaker of the structure.
 * `look` is '' when the scriptwriter is to design that host.
 */
export function normalizeHosts(input, speakers = 1, lang = 'en') {
  if (!input || typeof input !== 'object' || !input.on) return [];
  const looks = Array.isArray(input.looks) ? input.looks : [];
  return HOST_IDS.slice(0, speakers === 2 ? 2 : 1).map((id, i) => ({ id, look: lookOf(looks[i], lang) }));
}

/** The host setting as it is kept with a script: only what the form can put back. */
export function hostSetting(input) {
  if (!input || typeof input !== 'object' || !input.on) return null;
  return { on: true, looks: (Array.isArray(input.looks) ? input.looks : []).slice(0, 2).map((v) => (HOST_PRESETS.some((p) => p.id === v) ? v : trimEnd(oneLine(v, MAX_HOST_LOOK)))) };
}

/** A cast from a model reply or a request body: at most two people, A then B, with sane sizes. */
export function normalizeCast(input) {
  const list = Array.isArray(input) ? input : [];
  const cast = [];
  for (const c of list) {
    if (!c || typeof c !== 'object' || cast.length === HOST_IDS.length) continue;
    const given = String(c.id ?? '').trim().toUpperCase().slice(-1);
    const free = (x) => !cast.some((y) => y.id === x);
    const id = HOST_IDS.includes(given) && free(given) ? given : HOST_IDS.find(free);
    cast.push({ id, name: oneLine(c.name, 40), role: oneLine(c.role, 80), look: trimEnd(oneLine(c.look, 400)), voice: oneLine(c.voice, 200) });
  }
  return cast.sort((a, b) => a.id.localeCompare(b.id));
}

const FALLBACK_LOOK = ['analyst_f', 'founder_m'];

/**
 * The cast of a script as the brief allows it. A video with no host on screen and one voice has none.
 * A look the creator fixed is kept word for word, whatever the model wrote; a host the model forgot to
 * describe gets a ready-made look, so that every image of the video still shows one and the same person.
 * A conversation without a host on screen keeps its two voices and no looks.
 */
export function settleCast(cast, brief) {
  const hosts = brief.hosts || [];
  const voices = brief.framework?.speakers === 2 ? 2 : 1;
  if (!hosts.length && voices === 1) return [];
  const written = normalizeCast(cast);
  return HOST_IDS.slice(0, Math.max(hosts.length, voices)).map((id, i) => {
    const mine = written.find((c) => c.id === id) || { id, name: '', role: '', look: '', voice: '' };
    const host = hosts.find((h) => h.id === id);
    return { ...mine, look: !host ? '' : host.look || mine.look || lookOf(FALLBACK_LOOK[i], brief.lang) };
  });
}

/**
 * Who is in frame, from a scene's `host` value: the ids among `ids` it names, in order.
 * "AB", "A, B", "Host a" and "both" all read; with one host, any value that is not a "no" means that host.
 */
export function onFrame(value, ids = HOST_IDS) {
  const said = String(value ?? '').trim().toUpperCase();
  if (!said || /^(NONE|NO|FALSE|NULL|N\/A|无|否|-)$/.test(said)) return [];
  if (ids.length === 1) return [...ids];
  if (/^(AB|BA)$/.test(said) || /BOTH|两人|二人|双人/.test(said)) return [...ids];
  const named = new Set([...said.matchAll(/(?<![A-Z])([AB])(?![A-Z])/g)].map((m) => m[1]));
  return ids.filter((id) => named.has(id));
}

const MENTION = /(?:主播|主持人|嘉宾|讲者|host|presenter|guest|speaker)\s*([AB])(?![A-Za-z])/gi;
const SOLO = /主播|主持人|出镜|讲者|\b(?:the |our )?(?:host|presenter)\b/i;

/** Who a scene shows when the model did not say: the hosts its visual note names ("主播A", "Host B", or "the host" when there is one). */
export function inferHost(visual, ids) {
  const text = String(visual || '');
  const named = new Set([...text.matchAll(MENTION)].map((m) => m[1].toUpperCase()));
  const found = ids.filter((id) => named.has(id));
  if (found.length) return found.join('');
  return ids.length === 1 && SOLO.test(text) ? ids[0] : '';
}

/** A scene's `host` field, settled against the cast: only people who have a look can be in frame. */
export function settleSceneHost(scene, cast) {
  const ids = cast.filter((c) => c.look).map((c) => c.id);
  if (!ids.length) return '';
  const said = scene.host == null || scene.host === '' ? null : onFrame(scene.host, ids);
  return (said ?? onFrame(inferHost(scene.visual, ids), ids)).join('');
}

/**
 * What an image or clip prompt says about the hosts in frame: the fixed look of each, and that it never
 * changes. `referenced` lists the ids whose portrait is attached to the request, in the order attached;
 * `others` is how many more pictures are attached after them (a picture from the creator's library).
 * Empty when nobody with a look is in frame.
 */
export function castLine(cast, host, { referenced = [], others = 0 } = {}) {
  const all = normalizeCast(cast).filter((c) => c.look);
  const on = all.filter((c) => onFrame(host, all.map((x) => x.id)).includes(c.id));
  if (!on.length) return '';
  const many = all.length > 1;
  const refs = referenced.filter((id) => on.some((c) => c.id === id));
  const person = (c) => `${many ? `Host ${c.id}` : 'The host'}${c.name ? `, ${c.name}` : ''} (called ${many ? `"主播${c.id}" or "Host ${c.id}"` : '"主播" or "the host"'} in the description): ${c.look}.`;
  const attached = !refs.length
    ? ''
    : refs.length === 1 && on.length === 1 && !others
      ? ' The attached image is the reference portrait of this person: match the face, hair and clothes in it exactly.'
      : ` ${refs.map((id, i) => `${i ? 'attached' : 'Attached'} image ${i + 1} is the reference portrait of Host ${id}`).join('; ')}: match each face, hair and clothes exactly.`;
  return `Recurring ${on.length > 1 ? 'hosts of this video, the same people' : 'host of this video, the same person'} in every shot. ${on.map(person).join(' ')} Keep face, hair, build and clothes exactly as described; only pose, expression and framing change.${attached}`;
}

/** The first line of a host portrait prompt after the frame: who this is, and what the picture is for. */
export function hostBrief(host) {
  return [
    `${host.look}.`,
    'One person only, framed from the chest up and centred, facing the camera with a relaxed, attentive expression, eyes on the lens, mouth closed.',
    'They are where they present from: the setting is simple, uncluttered and softly out of focus, the light even and flattering on the face.',
    'This is the reference portrait every other shot of this person is matched to: sharp, natural, true-to-life proportions.',
  ].join('\n');
}

/** What the page needs to offer the presets. */
export const publicPresets = () => HOST_PRESETS.map(({ id, name, look }) => ({ id, name, look }));
