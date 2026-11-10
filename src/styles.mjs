// Visual styles for a video's images and clips. The user picks one, or two to blend.
// `look` is written for image / video models; `brief` tells the scriptwriter what the style can and cannot show.
// No living artists, studios or brands are named: each look is described by its own traits.

export const STYLE_GROUPS = [
  { id: 'live', name: { en: 'Live action', zh: '实拍' } },
  { id: 'illustration', name: { en: 'Illustration', zh: '插画' } },
  { id: '3d', name: { en: '3D and stop motion', zh: '三维与定格' } },
  { id: 'graphic', name: { en: 'Graphics and data', zh: '图形与数据' } },
  { id: 'mood', name: { en: 'Era and mood', zh: '年代与氛围' } },
];

const S = (id, group, en, zh, blurb, look, brief) => ({ id, group, name: { en, zh }, blurb, look, brief });

export const STYLES = [
  // Live action
  S('cinematic', 'live', 'Cinematic', '电影感', 'Film look for stories, brand films and emotional hooks.',
    'cinematic live-action photography, shallow depth of field, motivated directional lighting, rich film colour grade, subtle grain, anamorphic lens character',
    'real people and places, shot like a film: deliberate framing, light and depth'),
  S('documentary', 'live', 'Documentary', '纪实', 'Honest, observed footage for founder stories and field reports.',
    'documentary photography, natural available light, handheld framing, candid unposed moments, true-to-life colour',
    'observed real moments, real workplaces and unposed people'),
  S('ugc', 'live', 'Phone-shot vlog', '手机实拍', 'Looks like a creator filmed it; native to every feed.',
    'authentic phone-camera footage, front-camera or handheld perspective, everyday indoor light, slightly imperfect framing, no studio polish',
    'what one person can film on a phone: talking to camera, desk, street, screen in hand'),
  S('studio', 'live', 'Studio product', '棚拍产品', 'Clean commercial shots for products and demos.',
    'studio product photography, seamless backdrop, large soft key light with crisp rim light, controlled reflections, immaculate surfaces',
    'the product or object as hero on a clean set, with hands or props only when needed'),
  S('lifestyle', 'live', 'Bright lifestyle', '明亮生活方式', 'Warm and aspirational; consumer, wellness, travel.',
    'bright airy lifestyle photography, soft daylight, warm natural tones, relaxed real-home or outdoor settings',
    'people using or enjoying things in bright everyday settings'),
  S('office', 'live', 'Modern workplace', '现代职场', 'Credible business settings for B2B and careers.',
    'contemporary workplace photography, glass and daylight, clean desks and screens, cool neutral palette, professional but unstaged',
    'teams, meetings, screens and workspaces that look like a real modern company'),
  S('macro', 'live', 'Macro detail', '微距特写', 'Extreme close-ups of texture, food, craft and tech.',
    'macro close-up photography, razor-thin focus plane, visible material texture, glistening highlights, dark or softly blurred background',
    'tiny details filling the frame: textures, ingredients, components, hands at work'),

  // Illustration
  S('flat', 'illustration', 'Flat vector', '扁平矢量', 'The classic explainer look; clear and friendly.',
    'flat vector illustration, simple geometric shapes, limited harmonious palette, no gradients or outlines, generous negative space',
    'simplified characters, icons and objects that stand for ideas'),
  S('isometric', 'illustration', 'Isometric', '等距视角', 'Systems, workflows and products as tidy miniature worlds.',
    'isometric illustration, 30-degree projection, clean modular blocks and tiny figures, soft even shading, crisp edges',
    'processes, systems and spaces shown as miniature isometric scenes'),
  S('sketch', 'illustration', 'Hand-drawn sketch', '手绘草图', 'Whiteboard and notebook drawings for teaching.',
    'hand-drawn marker sketch on white, confident uneven line work, sparse spot colour, visible pen texture, diagram-like simplicity',
    'ideas drawn as simple doodles, arrows and diagrams, as if sketched live'),
  S('watercolor', 'illustration', 'Watercolour', '水彩', 'Soft and human; health, education, storytelling.',
    'watercolour painting, soft bleeding washes, visible paper texture, gentle muted palette, loose edges',
    'gentle painted scenes with few details and a lot of breathing room'),
  S('ink', 'illustration', 'Chinese ink', '国风水墨', 'Ink-wash atmosphere for culture, heritage and tea-table wisdom.',
    'Chinese ink wash painting, expressive brush strokes, graded black ink on rice paper, large empty space, a single restrained accent colour',
    'mountains, water, plants and figures suggested with a few strokes and a lot of empty space'),
  S('anime', 'illustration', 'Anime', '动漫', 'Cel-shaded drama and energy for younger audiences.',
    'anime cel-shaded illustration, clean line art, flat colour with crisp shadow shapes, expressive faces, luminous painted backgrounds',
    'drawn characters with clear emotions in dramatic, readable poses'),
  S('comic', 'illustration', 'Comic pop', '美漫波普', 'Punchy panels and halftone for bold claims and humour.',
    'comic-book pop art, bold black outlines, halftone dot shading, saturated primary colours, dynamic angles',
    'exaggerated, high-contrast moments that read in a split second'),
  S('collage', 'illustration', 'Paper collage', '拼贴', 'Cut-paper and mixed media; editorial and opinion pieces.',
    'cut-paper collage, torn edges and layered textures, mixed photo fragments and flat colour shapes, visible paper grain, slight drop shadows',
    'metaphors built from cut-out photos, shapes and textures'),

  // 3D and stop motion
  S('toon3d', '3d', 'Stylised 3D', '风格化三维', 'Rounded 3D characters and objects; friendly product stories.',
    'stylised 3D render, rounded simplified forms, soft global illumination, smooth matte materials, gentle colour palette',
    'rounded 3D characters and objects acting out the idea on simple sets'),
  S('clay', '3d', 'Claymation', '黏土定格', 'Handmade stop-motion charm; stands out in any feed.',
    'clay stop-motion look, hand-sculpted plasticine with fingerprints, miniature handmade sets, soft tabletop lighting',
    'handmade clay figures and props on a small tabletop set'),
  S('glass3d', '3d', 'Glossy 3D objects', '质感三维', 'Glass, chrome and soft plastic shapes for tech and finance.',
    'abstract 3D render, glass, chrome and soft-touch plastic shapes, studio HDRI reflections, smooth gradients, floating composition',
    'abstract objects and symbols standing in for concepts, floating in clean space'),

  // Graphics and data
  S('infographic', 'graphic', 'Motion infographic', '动态信息图', 'Charts, icons and numbers; data-led explainers.',
    'motion-graphics infographic, bold flat shapes, clean charts and icon systems, strong grid, two or three brand-like colours',
    'numbers, comparisons and steps turned into charts, icons and diagrams'),
  S('minimal', 'graphic', 'Minimal geometric', '极简几何', 'A few shapes and lots of space; premium and calm.',
    'minimalist geometric composition, a few precise shapes, large negative space, restrained two-colour palette, perfect alignment',
    'one simple shape or object per shot that carries a single idea'),
  S('hud', 'graphic', 'Tech interface', '科技界面', 'Screens, data streams and glowing UI for AI and software.',
    'futuristic interface visualisation, dark background, thin glowing lines, data grids and node networks, cyan and violet light',
    'interfaces, data flows and networks visualised as glowing diagrams'),
  S('screen', 'graphic', 'Screen recording', '屏幕演示', 'Product UI and step-by-step tutorials.',
    'clean screen-capture look, crisp app interface on a device or full frame, tidy cursor highlights, soft backdrop behind the window',
    'the actual screen: apps, dashboards, chats and the steps being taken'),

  // Era and mood
  S('retro', 'mood', 'Retro film', '复古胶片', '35mm warmth and grain; nostalgia and origin stories.',
    'vintage 35mm film look, warm faded colours, heavy grain, soft halation around highlights, slight light leaks',
    'scenes that feel remembered: older objects, warm light, period details'),
  S('neon', 'mood', 'Neon night', '霓虹夜色', 'Rain, signs and glow; nightlife, gaming, bold tech.',
    'neon-lit night scene, wet reflective streets, magenta and teal signage glow, deep shadows, light haze',
    'night-time city settings lit by signs and screens'),
  S('noir', 'mood', 'Dark and moody', '暗调质感', 'Low-key contrast for serious, high-stakes topics.',
    'low-key lighting, deep blacks with a single hard light source, strong silhouettes, desaturated palette',
    'sparse, shadowy setups where one lit subject carries the shot'),
  S('pixel', 'mood', 'Pixel art', '像素风', '8-bit game nostalgia; playful tech and finance.',
    'pixel art, visible square pixels, limited 16-colour palette, retro video-game scenes and sprites',
    'ideas shown as retro game scenes, sprites and level maps'),
  S('dream', 'mood', 'Surreal dream', '超现实梦境', 'Impossible scenes for big ideas and metaphors.',
    'surreal dreamlike scene, impossible scale and floating objects, soft pastel sky, long shadows, calm uncanny stillness',
    'visual metaphors that could not be filmed: impossible scale, floating objects, dream logic'),
];

export const MAX_STYLES = 2;

/** Valid, de-duplicated style ids in the order chosen, at most two. */
export function pickStyles(ids) {
  const list = Array.isArray(ids) ? ids : ids ? [ids] : [];
  return [...new Set(list.map(String))].map((id) => STYLES.find((s) => s.id === id)).filter(Boolean).slice(0, MAX_STYLES);
}

/** One line for an image / video prompt. Two styles are blended, the first one leading. */
export function styleLook(styles) {
  if (!styles.length) return '';
  if (styles.length === 1) return `Visual style: ${styles[0].look}.`;
  const [a, b] = styles;
  return `Visual style: a consistent blend of two styles. Lead with ${a.name.en.toLowerCase()} (${a.look}); mix in ${b.name.en.toLowerCase()} (${b.look}). Fuse them into one coherent look, not a split frame.`;
}
