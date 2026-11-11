// Visual styles for a video's images and clips. The user picks one, or two to blend.
// `look` is written for image / video models; `brief` tells the scriptwriter what the style can and cannot show.
// No living artists, studios or brands are named: each look is described by its own traits.
//
// Every group also takes a custom style, described by the creator in their own words. Its id carries those
// words, "custom:<group>:<description>", so it travels wherever a style id does (the brief, a scene, the
// history) with nothing else to pass along. `medium` is what a group's custom style is made in; the last two
// groups are a format or a tone rather than a medium, so their custom style is the description alone.

export const STYLE_GROUPS = [
  { id: 'live', name: { en: 'Live action', zh: '实拍' }, medium: 'live-action photography' },
  { id: 'illustration', name: { en: 'Illustration', zh: '插画' }, medium: 'illustration' },
  { id: '3d', name: { en: '3D and stop motion', zh: '三维与定格' }, medium: '3D render' },
  { id: 'graphic', name: { en: 'Graphics and data', zh: '图形与数据' }, medium: 'graphic design' },
  { id: 'present', name: { en: 'Presenting and launching', zh: '演示与发布' } },
  { id: 'bright', name: { en: 'Bright and light', zh: '明亮与浅色' } },
  { id: 'mood', name: { en: 'Era and mood', zh: '年代与氛围' } },
];

export const MAX_CUSTOM_STYLE = 200; // characters of description kept

/**
 * The custom style an id stands for, or null when the id is not one (unknown group, nothing described).
 * The description is put on one line, cut to MAX_CUSTOM_STYLE, and loses its closing punctuation, since it
 * is set inside a sentence of the prompt.
 */
export function customStyle(id) {
  const m = /^custom:([^:]+):([\s\S]+)$/.exec(String(id));
  const group = m && STYLE_GROUPS.find((g) => g.id === m[1]);
  if (!group) return null;
  const text = [...m[2].replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim()].slice(0, MAX_CUSTOM_STYLE).join('').replace(/[\s.。,，;；:：]+$/, '');
  if (!text) return null;
  const look = group.medium ? `${group.medium}, ${text}` : text;
  return { id: `custom:${group.id}:${text}`, group: group.id, custom: true, name: { en: 'Custom style', zh: '自定义风格' }, blurb: text, look, brief: look };
}

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

  // Presenting and launching: the consultant's slides and room, the expert at a board, then the product on show
  S('deck', 'present', 'Consulting deck', '咨询汇报', 'One message per slide: the clean frameworks and charts a partner would present.',
    'management-consulting slide look, white background with wide margins, one framework or chart per frame, 2x2 matrices, pyramids, waterfall and bar charts in thin precise lines, navy and grey with a single accent colour, flat and exact, no decoration',
    'one message per frame, shown as a framework or a chart: a 2x2 matrix, a pyramid, a waterfall, three pillars, a before-and-after pair'),
  S('boardroom', 'present', 'Boardroom briefing', '顾问现场汇报', 'A consultant presenting to decision-makers; credible and high-stakes.',
    'boardroom presentation scene, a presenter standing beside a large wall screen that shows a simple chart, executives around a long table seen from behind, glass walls and soft daylight, restrained navy and grey palette, composed documentary framing',
    'a consultant walking leaders through a recommendation: the presenter at the screen, a hand pointing at a chart, listeners taking notes, a printed deck on the table'),
  S('whiteboard', 'present', 'Whiteboard session', '白板讲解', 'An expert thinking aloud with a marker: boxes, arrows and the moment it clicks.',
    'whiteboard explanation scene, an expert drawing on a large whiteboard with black, blue and red markers, boxes, arrows and simple diagrams building up, seen over the shoulder or from the side, bright even office light, marker in hand',
    'an expert at a whiteboard building one diagram step by step: a box, an arrow, a circle around the key part, a hand tapping the point'),
  S('lightboard', 'present', 'Lightboard', '玻璃板书', 'Glowing marker lines on glass with the presenter facing you; modern tech explainers.',
    'lightboard explanation, a presenter behind a clear glass board facing the camera, diagrams drawn in glowing neon marker lines floating in front of them, black background, soft key light on the face, luminous blue, green and orange strokes',
    'a presenter facing the viewer while a glowing diagram grows between them: nodes, arrows and layers drawn one at a time'),
  S('chalkboard', 'present', "Professor's chalkboard", '教授板书', 'Chalk, a full blackboard and a lecture hall; depth, rigour and first principles.',
    'university lecture scene, a professor at a wide dark chalkboard covered in chalk diagrams and derivations, chalk dust in warm side light, wooden lecture hall, rolled sleeves, caught mid-gesture',
    'a professor working an idea out on a blackboard: a diagram half drawn, an underlined result, a pause to face the room'),
  S('productdemo', 'present', 'Product walkthrough', '产品介绍', 'The product, its parts and how it is used; clear, calm and practical.',
    'product introduction look, the product centred on a clean surface against a soft neutral gradient, bright even light, hands demonstrating one feature at a time, thin callout lines and exploded-view layouts, crisp true-to-life colour',
    'the product shown feature by feature: the whole thing, one part up close, a hand using it, its pieces laid out in order'),
  S('keynote', 'present', 'Launch keynote', '新品发布会', 'A dark stage, a giant screen and one spotlight; the big reveal.',
    'product launch keynote, a presenter in a spotlight on a wide dark stage, a giant LED wall behind showing the product at huge scale, audience silhouettes and phone glow in the foreground, deep blacks with one saturated accent colour, wide dramatic angles',
    'moments from a launch event: the walk on stage, the product appearing on the giant screen, the presenter holding it up, the crowd reacting'),
  S('launchfilm', 'present', 'Launch film', '产品发布片', 'The product emerging from the dark in sweeping light; premium teaser energy.',
    'cinematic product launch film look, the product emerging from darkness under a sweeping rim light, glossy reflections on a black surface, macro passes over materials and edges, slow-motion dust and droplets, high contrast with one saturated accent',
    'the product revealed piece by piece: an edge catching light, a texture in macro, a slow turn, then the whole thing at last'),

  // Bright and light: clean and pale first, then colour, then daylight outdoors
  S('highkey', 'bright', 'Bright and clean', '明亮通透', 'White on white in even light; fresh, honest and optimistic.',
    'bright high-key look, white and near-white surroundings, soft even light with barely any shadow, crisp clean detail, a single gentle accent colour, open uncluttered space',
    'people and objects in bright white surroundings, with nothing in the frame that is not needed'),
  S('brighttech', 'bright', 'Bright tech', '明亮科技', 'White space, glass and soft blue; technology that feels open, not dark.',
    'bright clean technology look, white and pale grey surfaces, frosted glass and brushed aluminium, soft daylight, subtle sky-blue accent light, precise uncluttered composition',
    'devices, screens, diagrams and people at work in a light, open, almost lab-clean space'),
  S('cream', 'bright', 'Cream tones', '奶油浅色', 'Warm off-white and beige with soft curves; gentle, modern, homely.',
    'cream-toned aesthetic, warm off-white, beige and oat palette, rounded soft furniture and matte surfaces, boucle and linen textures, diffused warm daylight, low contrast',
    'soft rounded interiors and objects in warm off-white: sofas, cups, lamps, shelves, hands at rest'),
  S('nordic', 'bright', 'Nordic light', '北欧浅木', 'Pale wood, white walls and big windows; calm, practical clarity.',
    'Scandinavian light interior look, white walls and pale birch wood, simple functional furniture, large windows with cool soft daylight, grey-blue and green plant accents, tidy composition',
    'calm practical rooms and work corners: wooden tables, shelves, plants, a person working by the window'),
  S('pastel', 'bright', 'Pastel', '马卡龙色', 'Soft pink, mint and lilac; sweet, light and friendly.',
    'pastel colour palette, soft pink, mint, lilac and baby blue, smooth matte surfaces, gentle shadowless light, rounded playful shapes, airy composition',
    'simple objects and scenes in sweet soft colours, a few shapes arranged with plenty of space'),
  S('dopamine', 'bright', 'Dopamine brights', '多巴胺', 'Bold happy colour blocks in full sun; energy and good mood.',
    'dopamine colour style, saturated colour blocking in orange, pink, yellow, green and cobalt, hard bright sunlight with crisp shadows, glossy cheerful props, bold simple composition',
    'upbeat scenes built from strong colour contrasts: outfits, walls, props and food in happy clashing colours'),
  S('airy', 'bright', 'Soft and airy', '日系清新', 'Pale, slightly overexposed daylight; quiet everyday poetry.',
    'soft airy film photography, slightly overexposed natural light, low contrast, pale blue and mint tones, clean white space, gentle grain, quiet still-life framing',
    'quiet everyday details in pale daylight: curtains, bicycles, train platforms, a hand, the sky'),
  S('forest', 'bright', 'Fresh green', '森系自然', 'Sunlight through leaves, linen and wild flowers; natural and unhurried.',
    'fresh natural greenery look, sunlight dappled through leaves, soft greens and white, linen and wicker, wild flowers and grass, gentle backlight, light haze',
    'people and objects among plants: gardens, forest paths, picnic tables, windows full of leaves'),
  S('summer', 'bright', 'Summer sky', '夏日晴空', 'Deep blue sky, big white clouds, sunlit green; youth and fresh starts.',
    'bright summer day, deep blue sky with towering white clouds, sunlit green fields and trees, clear vivid colour, a light breeze in hair and clothes, occasional lens flare',
    'open-air summer moments: bicycles, rooftops, school gates, fields, a figure small under a huge sky'),
  S('coastal', 'bright', 'Seaside holiday', '海岛度假', 'Whitewashed walls, turquoise water and hard sun; travel and escape.',
    'bright seaside holiday look, whitewashed walls and blue shutters, turquoise water, strong midday sun with crisp shadows, straw and linen, vivid blue-and-white palette',
    'sunlit holiday scenes: terraces, harbours, beaches, narrow white lanes, a table set by the sea'),
  S('goldenhour', 'bright', 'Golden hour', '落日余晖', 'Low warm sun, long shadows and glow; hope, endings and reflection.',
    'golden hour light, low warm sun from behind, glowing rim light and long soft shadows, amber and honey tones, gentle lens flare, light haze in the air',
    'people and places at sunset: silhouettes, windows catching the light, streets and fields in a warm glow'),
  S('misty', 'bright', 'Morning mist', '晨雾空灵', 'Pale fog and quiet light; stillness and room to think.',
    'misty early-morning atmosphere, pale fog softening the distance, muted grey-blue and white palette, diffused light with no hard shadows, simple quiet composition',
    'still scenes half hidden in mist: a lake, a bridge, trees, a lone figure, distant buildings'),
  S('softglow', 'bright', 'Soft glow', '柔光氛围', 'Soft-focus bloom and sparkle; beauty, romance and gentle wonder.',
    'soft-focus glow look, bloom around highlights, pastel bokeh and tiny sparkles, backlit translucent fabric and petals, low contrast, luminous skin tones',
    'gentle close moments wrapped in light: faces, flowers, fabric, hands, small shining objects'),

  // Era and mood: eras first, oldest to newest, then moods
  S('gufeng', 'mood', 'Ancient China', '古风', 'Costume-drama elegance: silk robes, lanterns and palace courtyards.',
    'ancient Chinese costume-drama look, flowing silk hanfu, carved wooden halls and lantern light, misty gardens and tiled roofs, soft diffused light, jade green and vermilion palette',
    'figures in period dress in the courtyards, studies, markets and gardens of imperial China'),
  S('bwfilm', 'mood', 'Black-and-white classic', '黑白老电影', 'Silver-screen monochrome for history, origins and timeless lines.',
    'classic black-and-white film look, rich silver tonal range, soft glamour key light with deep shadows, gentle grain and slight flicker, 1930s studio framing',
    'scenes staged like an old studio picture: period dress, simple sets, faces and gestures carrying the story'),
  S('artdeco', 'mood', 'Art Deco', '装饰艺术', 'Gold-and-black 1920s geometry; luxury, finance and grand openings.',
    'Art Deco poster style, symmetrical stepped geometry and sunburst rays, black and deep emerald with metallic gold line work, elegant elongated figures, polished marble and brass',
    'grand symmetrical compositions: towers, sunbursts, emblems and stylised figures that make an idea look monumental'),
  S('shanghai', 'mood', 'Old Shanghai poster', '老上海月份牌', '1930s calendar-poster charm for heritage brands and city stories.',
    '1930s Shanghai calendar-poster illustration, soft rubbed-charcoal and watercolour shading, warm cream paper, rosy skin tones, qipao and period interiors, delicate floral borders',
    'elegant period scenes from 1930s Shanghai: tea tables, shop counters, street corners and portraits'),
  S('midcentury', 'mood', 'Mid-century modern', '中古摩登', '1950s print-ad optimism; friendly explainers with a retro wink.',
    'mid-century modern illustration, 1950s print-advertising look, flat overlapping shapes with misregistered ink texture, muted teal, mustard and tomato red, atomic-age starbursts, cheerful stylised figures',
    'tidy everyday scenes and simple diagrams in the manner of a 1950s advert: homes, offices, appliances, smiling stylised people'),
  S('retrofuture', 'mood', 'Retro-futurism', '复古未来', "Yesterday's tomorrow: space-age optimism for tech and predictions.",
    'retro-futurist space-age art, a 1960s vision of the future, bubble-domed cities and finned rockets, chrome and pastel enamel, airbrushed gradients, optimistic wide vistas',
    'the future as the past imagined it: domed cities, friendly robots, flying cars, control rooms full of dials'),
  S('retro', 'mood', 'Retro film', '复古胶片', '35mm warmth and grain; nostalgia and origin stories.',
    'vintage 35mm film look, warm faded colours, heavy grain, soft halation around highlights, slight light leaks',
    'scenes that feel remembered: older objects, warm light, period details'),
  S('nostalgia', 'mood', '80s–90s nostalgia', '年代怀旧', 'China in the 1980s and 90s: enamel mugs, bicycles and faded walls.',
    '1980s–1990s China nostalgia, faded colour-negative photograph look, green-and-white painted walls, enamel mugs, wooden desks, bicycles and brick courtyards, soft window light, slightly yellowed tones',
    'everyday life in 1980s–90s China: classrooms, factory floors, courtyards, corner shops and family rooms with period objects'),
  S('hongkong', 'mood', 'Hong Kong 90s', '港风', 'Tungsten, fluorescent green and motion blur; city romance and hustle.',
    '1990s Hong Kong cinema look, warm tungsten against green fluorescent light, saturated reds, step-printed motion blur, glowing crowded signage, handheld close framing, humid night air',
    'restless city moments: narrow streets, diners, stairwells, taxis and faces half in coloured light'),
  S('vhs', 'mood', 'VHS tape', '录像带', 'Camcorder fuzz and tracking lines; home video and early-internet stories.',
    'VHS camcorder footage look, soft low-resolution image, colour bleed and scan lines, tracking-noise bands, blown-out highlights, casual home-video framing',
    'what a family camcorder would catch: living rooms, school halls, shop openings, early computers and televisions'),
  S('pixel', 'mood', 'Pixel art', '像素风', '8-bit game nostalgia; playful tech and finance.',
    'pixel art, visible square pixels, limited 16-colour palette, retro video-game scenes and sprites',
    'ideas shown as retro game scenes, sprites and level maps'),
  S('y2k', 'mood', 'Y2K', '千禧 Y2K', 'Glossy chrome and bubbly plastic from the turn of the millennium.',
    'Y2K millennium aesthetic, glossy chrome and translucent candy-coloured plastic, bubbly rounded forms, icy blue and silver with hot pink accents, lens flares, early-digital optimism',
    'shiny turn-of-the-millennium objects and settings: bubble gadgets, chrome shapes, flip phones, clear plastic, starry glints'),
  S('vaporwave', 'mood', 'Vaporwave', '蒸汽波', 'A pink-and-teal dream of malls and early computers; irony and nostalgia.',
    'vaporwave aesthetic, pink, violet and teal gradients, glowing grid floor running to a sunset horizon, classical marble busts, palm trees, early-computer window shapes, soft glow and slight glitch',
    'surreal collages of statues, palms, grids and old computer imagery that stand for memory, hype and nostalgia'),
  S('neon', 'mood', 'Neon night', '霓虹夜色', 'Rain, signs and glow; nightlife, gaming, bold tech.',
    'neon-lit night scene, wet reflective streets, magenta and teal signage glow, deep shadows, light haze',
    'night-time city settings lit by signs and screens'),
  S('cyberpunk', 'mood', 'Cyberpunk', '赛博朋克', 'High tech, low life: megacities, holograms and wired people.',
    'cyberpunk megacity, towering dense architecture, holographic displays and tangled cables, augmented people, acid green and magenta light through smog, wet metal surfaces, wide low-angle views',
    'a crowded high-tech future: megacity streets, holograms, drones, implants, alleys of servers'),
  S('steampunk', 'mood', 'Steampunk', '蒸汽朋克', 'Brass, gears and steam; invention and industrial-age metaphors.',
    'steampunk world, polished brass and copper machinery, exposed gears and pressure gauges, riveted iron, leather and goggles, warm gaslight through steam, Victorian industrial detail',
    'ideas shown as ingenious machines: engines, airships, clockwork, workshops full of gauges and pipes'),
  S('wasteland', 'mood', 'Wasteland', '废土', 'Rust, dust and ruins; disruption, warnings and survival stories.',
    'post-apocalyptic wasteland, abandoned rusted structures half buried in sand, dust haze and harsh bleached sunlight, scavenged patched materials, desaturated ochre palette',
    'what is left after a collapse: empty factories, broken machines, lone figures crossing ruins'),
  S('noir', 'mood', 'Dark and moody', '暗调质感', 'Low-key contrast for serious, high-stakes topics.',
    'low-key lighting, deep blacks with a single hard light source, strong silhouettes, desaturated palette',
    'sparse, shadowy setups where one lit subject carries the shot'),
  S('academia', 'mood', 'Dark academia', '暗黑学院', 'Old libraries, lamplight and ink; books, ideas and big questions.',
    'dark academia mood, old library shelves and worn leather books, candle and brass-lamp light, ink, parchment and tweed, deep brown and forest green palette, dusty window light',
    'scholarly settings and objects: reading rooms, desks piled with books, chalkboards, specimens, pages of notes'),
  S('cozy', 'mood', 'Cozy and warm', '治愈暖调', 'Lamplight, rain on the window, a warm drink; calm and comforting.',
    'cozy comforting atmosphere, warm lamp and candle glow, soft knitted textures, steam rising from a cup, rain on the window, shallow focus, amber and cream palette',
    'small comforting indoor moments: a desk by the window, a kitchen table, a reading corner, a pet asleep'),
  S('wabisabi', 'mood', 'Wabi-sabi', '侘寂', 'Raw clay, linen and shadow; quiet, premium restraint.',
    'wabi-sabi aesthetic, raw plaster and aged wood, handmade ceramics with imperfect glaze, linen and dried branches, soft side light with long shadows, muted earth tones, generous emptiness',
    'a few humble objects in an almost empty room, where texture and shadow carry the feeling'),
  S('dream', 'mood', 'Surreal dream', '超现实梦境', 'Impossible scenes for big ideas and metaphors.',
    'surreal dreamlike scene, impossible scale and floating objects, soft pastel sky, long shadows, calm uncanny stillness',
    'visual metaphors that could not be filmed: impossible scale, floating objects, dream logic'),
];

export const MAX_STYLES = 2;

/** The styles for the ids chosen, in that order, at most two: unknown ids are dropped, a custom id becomes its style. */
export function pickStyles(ids) {
  const list = Array.isArray(ids) ? ids : ids ? [ids] : [];
  const styles = list.map((id) => STYLES.find((s) => s.id === String(id)) || customStyle(id)).filter(Boolean);
  return styles.filter((s, i) => styles.findIndex((x) => x.id === s.id) === i).slice(0, MAX_STYLES);
}

/** One line for an image / video prompt. Two styles are blended, the first one leading. */
export function styleLook(styles) {
  if (!styles.length) return '';
  if (styles.length === 1) return `Visual style: ${styles[0].look}.`;
  const [a, b] = styles;
  return `Visual style: a consistent blend of two styles. Lead with ${a.name.en.toLowerCase()} (${a.look}); mix in ${b.name.en.toLowerCase()} (${b.look}). Fuse them into one coherent look, not a split frame.`;
}
