// Interface language: English or 简体中文. English text is the key, so anything without a
// translation simply stays in English. Static HTML is translated in place by applyI18n();
// scripts call t('English text', { vars }).

const KEY = 'video-scripter.lang';

function initial() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {}
  return (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export const lang = initial();

/** Save the choice and reload: every label on the page is rebuilt in the new language. */
export function setLang(next) {
  try {
    localStorage.setItem(KEY, next);
  } catch {}
  location.reload();
}

const ZH = {
  // Top bar
  'Short-video scripts for 视频号 · 抖音 · TikTok · Instagram · YouTube': '短视频脚本创作：视频号 · 抖音 · TikTok · Instagram · YouTube',
  'LLM settings': '模型设置',
  'LLM gateway settings': '模型网关设置',
  'Loading…': '加载中…',
  '☀ Light': '☀ 浅色',
  '☾ Dark': '☾ 深色',
  'Switch to light mode': '切换到浅色模式',
  'Switch to dark mode': '切换到深色模式',
  'Demo mode: no model connected': '演示模式：未连接模型',
  'no model': '未设置模型',
  'key missing': '缺少密钥',

  // Brief
  Brief: '创作需求',
  Topic: '主题',
  required: '必填',
  'What is the video about? e.g. 为什么企业买了大模型却用不起来 / Why most people quit learning to code in week three': '这条视频讲什么？例如：为什么企业买了大模型却用不起来',
  Platforms: '发布平台',
  English: '英文',
  Structure: '脚本结构',
  Length: '时长',
  Auto: '自动',
  'Visual style': '画面风格',
  'pick one, or two to blend': '选一种，或选两种混合',
  'No style chosen: the script and image model decide the look.': '未选择风格：由脚本和图像模型自行决定画面。',
  'Blend: {a} leads, mixed with {b}.': '混合风格：以「{a}」为主，融入「{b}」。',
  'Key message': '核心信息',
  'The one thing the viewer should remember': '希望观众记住的那一句话',
  Audience: '目标受众',
  'e.g. 中小企业老板 / first-time founders': '例如：中小企业老板',
  Tone: '语气风格',
  'e.g. 冷静专业 / blunt and funny': '例如：冷静专业 / 直白幽默',
  'Brand or creator': '品牌或创作者',
  'Who is speaking, what is being offered': '谁在说话，提供什么产品或服务',
  'Call to action': '行动号召',
  'e.g. 转给负责数字化的合伙人 / follow for part 2': '例如：转给负责数字化的合伙人',
  'Reference material': '参考资料',
  'Paste facts, quotes, notes or an article. The script will only use figures and quotes that appear here or in the brief.': '粘贴事实、引语、笔记或文章。脚本只会使用这里或需求中出现的数据和引语。',
  'Voiceover is for text-to-speech (spell out numbers and symbols)': '旁白用于语音合成（数字和符号写成读法）',
  'Also generate an image for every scene (uses the image model in LLM settings)': '同时为每个场景生成图片（使用模型设置中的图像模型）',
  'Written by': '写作模型',
  'Gateway and model': '网关和模型',
  'Generate scripts': '生成脚本',
  'Generating…': '生成中…',
  Stop: '停止',
  'Pick at least one platform.': '请至少选择一个平台。',

  // Output
  History: '历史记录',
  'History ({n})': '历史记录（{n}）',
  'No script yet': '还没有脚本',
  "Fill in the brief, pick one or more platforms, and generate. Each platform gets its own script, written for how that platform's audience watches.": '填写需求，选择一个或多个平台，然后生成。每个平台都会得到一份按其观众观看习惯写的独立脚本。',
  'Contacting the model…': '正在连接模型…',
  'Writing for {platform} with {model} · target about {budget} {unit} of voiceover': '正在用 {model} 为{platform}写作 · 旁白目标约 {budget} {unit}',
  'Try again': '重试',
  'Stopped.': '已停止。',
  'The connection closed before the script was finished.': '脚本还没写完，连接就断开了。',
  "The model's reply could not be read as a script ({reason}). The raw reply is shown below.": '无法把模型的回复解析成脚本（{reason}）。原始回复见下方。',
  'Request failed ({status})': '请求失败（{status}）',
  'Could not start: {error}. Is the server running?': '无法启动：{error}。服务是否在运行？',
  'Could not save to history: {error}': '无法保存到历史记录：{error}',
  'Could not load history: {error}': '无法加载历史记录：{error}',
  '{n} scenes': '{n} 个场景',
  '{n} words': '{n} 词',
  'voiceover {count}': '旁白 {count}',
  Platform: '平台',
  'Copy Markdown': '复制 Markdown',
  'Script copied as Markdown': '已复制为 Markdown',
  Regenerate: '重新生成',
  'Download .zip': '下载 .zip',
  'Script files plus every generated image and video': '脚本文件，以及所有已生成的图片和视频',
  'Downloaded {name}': '已下载 {name}',
  'Hook options': '开场钩子备选',
  Script: '脚本',
  Voiceover: '旁白',
  'Copy voiceover': '复制旁白',
  'Voiceover copied': '旁白已复制',
  'Voiceover only': '只看旁白',
  'Show full script': '显示完整脚本',
  'On screen': '屏幕文字',
  Visual: '画面',
  Camera: '镜头',
  Sound: '声音',
  'Publishing package': '发布素材',
  Titles: '标题',
  'Cover text': '封面文字',
  Description: '描述文案',
  Hashtags: '话题标签',
  'Pinned comment': '置顶评论',
  'Production notes': '制作备注',
  Copy: '复制',
  Copied: '已复制',
  'Copy failed: select the text and copy manually': '复制失败：请选中文字后手动复制',

  // Scene media
  'Generate image': '生成图片',
  'Generate video': '生成视频',
  'Redo image': '重新生成图片',
  'Redo video': '重新生成视频',
  'Making image…': '正在生成图片…',
  'Making video…': '正在生成视频…',
  Save: '保存',
  'Images per scene': '每个场景的图片数',
  'Made {n} of {total} images: {error}': '已生成 {total} 张中的 {n} 张：{error}',
  'Generated image for scene {n}': '场景 {n} 的生成图片',
  'No image model is set: add one under LLM settings → Images and videos': '尚未设置图像模型：请在 模型设置 → 图片和视频 中添加',
  'Still rendering after 20 minutes. Check the provider and try again.': '20 分钟后仍在渲染。请检查服务商后重试。',
  'The provider could not make this video': '服务商未能生成这段视频',
  'The provider finished but returned no video file': '服务商已完成，但没有返回视频文件',

  // Gateway settings
  'LLM gateways': '模型网关',
  'Save a gateway for each provider or account, then choose which one writes your scripts. Keys are stored on this machine in': '为每个服务商或账号保存一个网关，再选择用哪一个来写脚本。密钥保存在本机的',
  'and are never sent back to the browser.': '中，绝不会回传到浏览器。',
  '+ New gateway': '+ 新建网关',
  'New gateway': '新建网关',
  'Edit “{name}”': '编辑「{name}」',
  'In use': '使用中',
  Name: '名称',
  'e.g. DeepSeek work account': '例如：DeepSeek 工作账号',
  Provider: '服务商',
  'Default model': '默认模型',
  'model name': '模型名称',
  'List available models': '列出可用模型',
  Filter: '筛选',
  'Filter models': '筛选模型',
  '{n} models · {on} in the picker': '{n} 个模型 · {on} 个已加入选择器',
  Default: '默认',
  'Make default': '设为默认',
  'no model set': '未设置模型',
  'Saved: {key}': '已保存：{key}',
  'Paste your key': '粘贴你的密钥',
  Optional: '可选',
  optional: '可选',
  'Demo mode returns placeholder text so you can try the interface. Pick a provider to write real scripts.': '演示模式只返回占位文字，方便试用界面。选择一个服务商才能写出真实脚本。',
  'Leave the key blank to keep the saved one.': '密钥留空则继续使用已保存的密钥。',
  'Changing the provider or base URL clears the saved key, so a key is never sent to a different service.': '更改服务商或接口地址会清除已保存的密钥，避免密钥被发送到其他服务。',
  'Use this gateway to write scripts': '用这个网关写脚本',
  'Test connection': '测试连接',
  Delete: '删除',
  Close: '关闭',
  'Testing…': '测试中…',
  'Connected in {ms} ms. {model} replied: “{reply}”': '连接成功，用时 {ms} 毫秒。{model} 回复：「{reply}」',
  'Asking the provider for its models…': '正在向服务商查询模型…',
  'Asking the provider…': '正在查询服务商…',
  'The provider returned an empty model list. Type the model name instead.': '服务商返回的模型列表为空，请手动输入模型名称。',
  'The provider returned an empty list. Type the model name instead.': '服务商返回的列表为空，请手动输入模型名称。',
  '{n} models available. Tick the ones you want in the “Written by” picker and choose a default, then save.': '共 {n} 个可用模型。勾选要出现在「写作模型」选择器里的模型，选定默认模型，然后保存。',
  'Delete the saved gateway “{name}”? Its API key is removed from this machine.': '删除已保存的网关「{name}」？它的 API 密钥也会从本机移除。',
  'Gateway deleted': '网关已删除',
  'Saved. This gateway is in use.': '已保存。当前正在使用这个网关。',
  'Saved.': '已保存。',

  // Images and videos settings
  'Images and videos': '图片和视频',
  'Scene images and clips are made by separate models, often at a different address. Give each its own BASE_URL_API and model; leave a model blank to turn that off. A blank base URL or key uses the gateway\'s.': '场景图片和视频片段由单独的模型生成，接口地址通常也不同。请分别填写各自的 BASE_URL_API 和模型；模型留空即关闭该功能。接口地址或密钥留空时使用网关的设置。',
  Images: '图片',
  Videos: '视频',
  image: '图片',
  video: '视频',
  Model: '模型',
  Size: '尺寸',
  'Same as the gateway above': '与上方网关相同',
  "Blank uses the gateway's key": '留空则使用网关的密钥',
  'e.g. gpt-image-1': '例如 gpt-image-1',
  'e.g. sora-2': '例如 sora-2',
  'e.g. 1024x1536': '例如 1024x1536',
  'e.g. 720x1280': '例如 720x1280',
  'not set': '未设置',
  'List available image models': '列出可用图像模型',
  'List available video models': '列出可用视频模型',
  Selected: '已选',
  Use: '使用',
  '{n} models, {likely} that look like image models listed first.': '共 {n} 个模型，其中 {likely} 个看起来是图像模型，已排在前面。',
  '{n} models, {likely} that look like video models listed first.': '共 {n} 个模型，其中 {likely} 个看起来是视频模型，已排在前面。',
  "{n} models; none is obviously an image model, so check the provider's docs.": '共 {n} 个模型；没有明显的图像模型，请查看服务商文档。',
  "{n} models; none is obviously a video model, so check the provider's docs.": '共 {n} 个模型；没有明显的视频模型，请查看服务商文档。',

  // Provider presets
  'Anthropic (Claude)': 'Anthropic（Claude）',
  'Google Gemini (OpenAI-compatible)': 'Google Gemini（OpenAI 兼容）',
  'Ollama (local)': 'Ollama（本地）',
  'Custom (OpenAI-compatible)': '自定义（OpenAI 兼容）',
  'Custom (Anthropic-compatible)': '自定义（Anthropic 兼容）',
  'Demo (offline, no key)': '演示（离线，无需密钥）',
  'Ark endpoint ID or model name': 'Ark 接入点 ID 或模型名称',
  'e.g. vendor/model-name': '例如 vendor/model-name',
  'a model you have pulled': '已拉取到本地的模型',

  // Visual style blurbs (names come translated from the server)
  'Film look for stories, brand films and emotional hooks.': '电影质感，适合故事、品牌片和情绪钩子。',
  'Honest, observed footage for founder stories and field reports.': '真实的观察式镜头，适合创始人故事和现场记录。',
  'Looks like a creator filmed it; native to every feed.': '像创作者自己拍的，在任何信息流里都自然。',
  'Clean commercial shots for products and demos.': '干净的商业棚拍，适合产品和演示。',
  'Warm and aspirational; consumer, wellness, travel.': '温暖向往感，适合消费、健康、旅行。',
  'Credible business settings for B2B and careers.': '可信的商务场景，适合 B2B 和职场内容。',
  'Extreme close-ups of texture, food, craft and tech.': '极致特写，适合质感、美食、手艺和科技细节。',
  'The classic explainer look; clear and friendly.': '经典讲解风格，清晰友好。',
  'Systems, workflows and products as tidy miniature worlds.': '把系统、流程和产品画成整洁的微缩世界。',
  'Whiteboard and notebook drawings for teaching.': '白板和笔记本手绘，适合教学。',
  'Soft and human; health, education, storytelling.': '柔和有人情味，适合健康、教育、叙事。',
  'Ink-wash atmosphere for culture, heritage and tea-table wisdom.': '水墨意境，适合文化、传承和茶桌智慧。',
  'Cel-shaded drama and energy for younger audiences.': '赛璐璐风的戏剧张力，适合年轻受众。',
  'Punchy panels and halftone for bold claims and humour.': '冲击力强的分镜和网点，适合大胆观点和幽默。',
  'Cut-paper and mixed media; editorial and opinion pieces.': '剪纸与综合材料，适合评论和观点类内容。',
  'Rounded 3D characters and objects; friendly product stories.': '圆润的三维角色和物件，适合亲切的产品故事。',
  'Handmade stop-motion charm; stands out in any feed.': '手工定格动画的趣味，在信息流里很抢眼。',
  'Glass, chrome and soft plastic shapes for tech and finance.': '玻璃、金属和柔光塑料质感，适合科技和金融。',
  'Charts, icons and numbers; data-led explainers.': '图表、图标和数字，适合数据讲解。',
  'A few shapes and lots of space; premium and calm.': '少量图形加大量留白，高级而冷静。',
  'Screens, data streams and glowing UI for AI and software.': '屏幕、数据流和发光界面，适合 AI 和软件。',
  'Product UI and step-by-step tutorials.': '产品界面和分步教程。',
  '35mm warmth and grain; nostalgia and origin stories.': '35 毫米胶片的暖调和颗粒，适合怀旧和起源故事。',
  'Rain, signs and glow; nightlife, gaming, bold tech.': '雨夜、招牌和霓虹光，适合夜生活、游戏、潮流科技。',
  'Low-key contrast for serious, high-stakes topics.': '低调高反差，适合严肃、重大的话题。',
  '8-bit game nostalgia; playful tech and finance.': '8 位游戏的怀旧感，适合轻松的科技和金融内容。',
  'Impossible scenes for big ideas and metaphors.': '不可能的场景，适合大概念和隐喻。',
};

export function t(text, vars) {
  let out = (lang === 'zh' && ZH[text]) || text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, v);
  return out;
}

/** Translate the static HTML in place: text nodes, placeholders, titles and aria-labels. */
export function applyI18n(root = document.body) {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  if (lang !== 'zh') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode()); ) {
    const text = node.nodeValue.trim();
    if (text && ZH[text] && !node.parentElement.closest('script, style')) node.nodeValue = node.nodeValue.replace(text, ZH[text]);
  }
  for (const el of root.querySelectorAll('[placeholder], [title], [aria-label]')) {
    for (const attr of ['placeholder', 'title', 'aria-label']) {
      const v = el.getAttribute(attr);
      if (v && ZH[v]) el.setAttribute(attr, ZH[v]);
    }
  }
}
