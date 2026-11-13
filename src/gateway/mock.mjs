// Offline demo provider. Produces a placeholder script shaped like a real reply so the UI and
// export paths can be tried without an API key. The content is filler, not a usable script.

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      // Out of time (src/limits.mjs) is not the same as a visitor who left: pass that on as it is.
      reject(signal.reason?.name === 'TimeoutError' ? signal.reason : Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });
  });

/** A placeholder line of narration for one stage: a labelled exchange when the structure has two voices. */
function demoLine(brief, label, marked = false) {
  const zh = brief.lang === 'zh';
  const topic = marked ? `[[${brief.topic}]]` : brief.topic;
  if (brief.framework.speakers === 2) return zh ? `A：（演示占位）这一段对应：${label}。B：主题是${topic}。` : `A: (Demo placeholder) This beat covers: ${label}. B: The topic is ${topic}.`;
  return zh ? `（演示占位）这一段对应：${label}。${marked ? '⏸ ' : ''}主题是${topic}。` : `(Demo placeholder) This beat covers: ${label}. ${marked ? '⏸ ' : ''}The topic is ${topic}.`;
}

/** A placeholder cast: one person per voice, with a look only when a host is on screen. */
function demoCast(brief) {
  const zh = brief.lang === 'zh';
  const voices = brief.framework.speakers === 2 ? 2 : brief.hosts.length ? 1 : 0;
  const people = zh
    ? [{ name: '林夏', role: '（演示）主持人', look: '（演示）三十岁出头的女性，齐肩黑发，米白色西装外套', voice: '（演示）女声，三十岁上下，清亮，语速适中' }, { name: '周原', role: '（演示）嘉宾', look: '（演示）四十岁左右的男性，短发，深灰色毛衣', voice: '（演示）男声，四十岁上下，沉稳，语速偏慢' }]
    : [{ name: 'Lin', role: '(Demo) host', look: '(Demo) a woman in her early thirties with shoulder-length black hair, in a cream blazer', voice: '(Demo) female, around thirty, bright, medium pace' }, { name: 'Marc', role: '(Demo) guest', look: '(Demo) a man of about forty with short hair, in a charcoal sweater', voice: '(Demo) male, around forty, steady, unhurried' }];
  return people.slice(0, voices).map((p, i) => ({ id: 'AB'[i], ...p, look: brief.hosts[i] ? brief.hosts[i].look || p.look : '' }));
}

/** Who a placeholder scene shows: the host in the first and last scenes and every other one between; both for a conversation's opening. */
const demoHost = (brief, i, n) => (!brief.hosts.length ? '' : i === 0 || i === n - 1 ? (brief.hosts.length > 1 ? 'AB' : 'A') : i % 2 ? '' : 'AB'[(i / 2) % brief.hosts.length]);

/** Scenes for a locked narration: one per beat, word for word, each given its share of the running time. */
function lockedScenes(plan) {
  const { brief } = plan;
  const zh = brief.lang === 'zh';
  const total = brief.narration.reduce((n, b) => n + b.text.length, 0) || 1;
  let said = 0;
  let prev = 0;
  return brief.narration.map((b, i) => {
    said += b.text.length;
    const end = i === brief.narration.length - 1 ? brief.duration : Math.max(prev + 1, Math.round((said / total) * brief.duration));
    const scene = { id: i + 1, start: prev, end, stage: b.stage, voiceover: b.text, onScreenText: `${String(i + 1).padStart(2, '0')}`, visual: zh ? '演示占位：此处为画面描述。' : 'Demo placeholder: the shot description goes here.', camera: zh ? '中景，硬切' : 'Medium shot, hard cut', host: demoHost(brief, i, brief.narration.length), sfx: '' };
    prev = end;
    return scene;
  });
}

/** A placeholder narration: one beat per stage of the story line, after its viewpoint card when the draft plans first. */
function demoNarration(plan, planFirst) {
  const { brief, timeline } = plan;
  const zh = brief.lang === 'zh';
  return {
    ...(planFirst && { card: demoCard(plan) }),
    title: zh ? `【演示】${brief.topic}` : `[Demo] ${brief.topic}`,
    beats: timeline.map((s) => ({ stage: s.key, text: demoLine(brief, s.label) })),
  };
}

/** A placeholder viewpoint card, so the agent's flow can be tried offline. */
function demoCard(plan) {
  const { brief, timeline } = plan;
  const zh = brief.lang === 'zh';
  const layers = ['insider', 'experience', 'insight'];
  return {
    persona: zh ? '（演示）懂行的实践者' : '(Demo) a practitioner who knows the field',
    viewer: zh ? '（演示）想弄懂这件事的决策者' : '(Demo) a decision-maker who wants to understand this',
    insight: { claim: zh ? `（演示占位）关于${brief.topic}的核心认知。` : `(Demo placeholder) The core insight about ${brief.topic}.`, against: zh ? '（演示）常见的看法' : '(Demo) the common belief' },
    insider: [zh ? '（演示）内行解说的一个点' : '(Demo) one insider point'],
    experience: [{ point: zh ? '（演示）一线经验的一个点' : '(Demo) one point of first-hand experience', source: 'draft' }],
    analogy: '',
    mustSay: [],
    openLoop: zh ? '（演示）开场留下的悬念' : '(Demo) what the opening leaves open',
    outline: timeline.map((s, i) => ({ stage: s.key, layer: i === 0 ? 'hook' : i === timeline.length - 1 ? 'cta' : layers[(i - 1) % 3], point: zh ? `（演示）${s.label.split(/[：:]/)[0]}` : `(Demo) ${s.label.split(':')[0]}` })),
    toVerify: [zh ? '当前是演示模式：接入真实模型后，这里列出需要你核实或替换的内容。' : 'Demo mode: with a real model connected, this lists what you should confirm or replace.'],
  };
}

/** A placeholder review: the narration comes back as it was, with one note, so the agent's last step can be tried offline. */
function demoEdit({ beats, plan }) {
  const zh = plan.brief.lang === 'zh';
  return { review: [{ beat: 1, problem: zh ? '演示模式：没有真实的审稿。' : 'Demo mode: no real review took place.', fix: zh ? '旁白保持原样。' : 'The narration is unchanged.' }], beats: beats.map((b) => ({ stage: b.stage, text: b.text })) };
}

/** A placeholder refinement: the same text, visibly marked, so the editor's flow can be tried offline. */
function demoRefined({ beats, index, plan }) {
  const mark = (text) => (plan.brief.lang === 'zh' ? `${text.replace(/（演示：已润色）$/, '')}（演示：已润色）` : `${text.replace(/ \(demo: refined\)$/, '')} (demo: refined)`);
  return Number.isInteger(index) ? { text: mark(beats[index].text) } : { beats: beats.map((b) => ({ stage: b.stage, text: mark(b.text) })) };
}

function demoScript(plan) {
  const { brief, timeline } = plan;
  const zh = brief.lang === 'zh';
  const t = brief.topic;
  // The creator's own pictures and clips (src/materials.mjs): the demo shows one in each scene after the hook.
  const { docs = [], media = [] } = brief.materials || {};
  const shown = (scenes) => scenes.map((sc, i) => (media[i - 1] ? { ...sc, asset: media[i - 1].tag } : sc));
  return {
    title: zh ? `【演示】${t}` : `[Demo] ${t}`,
    logline: zh ? `这是离线演示输出，用来预览界面。请在设置里接入真实模型后生成正式脚本。` : `Offline demo output for previewing the interface. Connect a real model in Settings to generate an actual script.`,
    hookOptions: zh
      ? [
          { type: '反常识', line: `关于${t}，你听过的说法可能[[正好相反]]。` },
          { type: '痛点预警', line: `如果你还没搞懂${t}，这一分钟先别划走。` },
          { type: '悬念提问', line: `${t}，到底难在哪一步？` },
        ]
      : [
          { type: 'Contrarian', line: `What you've heard about ${t} is probably [[backwards]].` },
          { type: 'Loss warning', line: `If ${t} still confuses you, give me one minute.` },
          { type: 'Open question', line: `${t}: which step actually trips people up?` },
        ],
    cast: demoCast(brief),
    scenes: shown(brief.narration?.length ? lockedScenes(plan) : timeline.map((s, i) => ({
      id: i + 1,
      start: s.start,
      end: s.end,
      stage: s.key,
      host: demoHost(brief, i, timeline.length),
      voiceover: demoLine(brief, s.label, true),
      onScreenText: zh ? `${String(i + 1).padStart(2, '0')} · ${s.key}` : `${String(i + 1).padStart(2, '0')} · ${s.key}`,
      visual: zh ? '演示占位：此处为画面描述。' : 'Demo placeholder: the shot description goes here.',
      camera: zh ? '中景，硬切' : 'Medium shot, hard cut',
      sfx: '',
    }))),
    whiteboard: brief.framework.board ? (zh ? '+--------+    +--------+    +--------+\n| 演示 A | -> | 演示 B | -> | 演示 C |\n+--------+    +--------+    +--------+' : '+--------+    +--------+    +--------+\n| Demo A | -> | Demo B | -> | Demo C |\n+--------+    +--------+    +--------+') : '',
    publish: {
      titles: zh ? [`演示标题一`, `演示标题二`, `演示标题三`] : ['Demo title one', 'Demo title two', 'Demo title three'],
      coverText: zh ? '演示封面文案' : 'Demo cover text',
      description: zh ? '演示描述：接入真实模型后，这里会是可以直接粘贴的发布文案。' : 'Demo description: with a real model connected, this is the paste-ready caption.',
      shareLine: zh ? '演示转发导语' : 'Demo line for sharing',
      hashtags: zh ? ['#演示', '#短视频脚本'] : ['#demo', '#shortvideo'],
      pinnedComment: zh ? '演示置顶评论' : 'Demo pinned comment',
      chapters: brief.duration >= 180 ? timeline.map((s) => ({ time: `${String(Math.floor(s.start / 60)).padStart(2, '0')}:${String(s.start % 60).padStart(2, '0')}`, title: s.label.split(/[：:]/)[0] })) : [],
    },
    productionNotes: [zh ? '当前使用的是离线演示提供方，内容为占位文本。' : 'The offline demo provider is active; all content is placeholder text.', ...(docs.length ? [`${zh ? '素材库资料（已作为参考资料交给模型）：' : 'Library documents given to the model as reference material: '}${docs.map((d) => d.name).join(zh ? '、' : ', ')}`] : [])],
  };
}

/**
 * A placeholder reply in a conversation: Markdown that shows what the page renders, and a picture when one is
 * asked for and the gateway can draw (the demo's own placeholder image), so the whole flow can be tried offline.
 */
function demoChat({ prompt = '', tools = {} }) {
  const zh = /[㐀-鿿]/.test(prompt);
  const said = prompt.replace(/\s+/g, ' ').trim().slice(0, 80);
  const draw = tools.image && /画|图片|配图|海报|image|picture|draw|photo|illustrat|poster/i.test(prompt);
  if (zh)
    return [`# 【演示】${said}`, '', '这是**离线演示**的回复，用来预览聊天界面。在「模型设置」里接入真实模型后，这里就是模型的回答。', '', '## 界面能渲染什么', '', '- **加粗**、*斜体*、`行内代码` 和[链接](https://example.com)', '- 有序、无序和任务列表', '- 表格、引用和代码块', '', '| 能力 | 状态 |', '| --- | --- |', '| 文本 | 演示占位 |', '| 图片 | 演示占位图 |', '', '```js', "const reply = await ask('你好');", '```', '', ...(draw ? ['```image', 'aspect: 16:9', `Demo picture for: ${said}`, '```', ''] : []), '> 接入模型后，可以在右侧画布里打开、编辑并下载这份回复。'].join('\n');
  return [`# [Demo] ${said}`, '', 'This is the **offline demo** reply, for trying the chat. Connect a real model in LLM settings and the model answers here.', '', '## What the page renders', '', '- **Bold**, *italic*, `inline code` and [links](https://example.com)', '- Numbered, bulleted and task lists', '- Tables, quotes and code blocks', '', '| Kind | Status |', '| --- | --- |', '| Text | demo placeholder |', '| Pictures | demo placeholder image |', '', '```js', "const reply = await ask('hello');", '```', '', ...(draw ? ['```image', 'aspect: 16:9', `Demo picture for: ${said}`, '```', ''] : []), '> With a model connected, open this reply in the canvas to edit and download it.'].join('\n');
}

export async function* mockStream({ signal, meta, partial = '' }) {
  const kinds = { narration: () => demoNarration(meta.plan, meta.planFirst), refine: () => demoRefined(meta), edit: () => demoEdit(meta) };
  // Looking at a picture (src/vision.mjs): the demo sees nothing, and says so in the place the answer goes.
  const looks = {
    note: () => ({ note: meta.lang === 'zh' ? `【演示】图片“${meta.name}”的说明：接入真实模型后，这里会写出画面里是什么。` : `[Demo] A note for “${meta.name}”: with a real model connected, this says what the picture shows.` }),
    page: () => ({ text: `[Demo] The text of page ${meta.page} of “${meta.name}”: with a real model connected, this is what the scan says.` }),
  };
  const reply = looks[meta?.kind] ? looks[meta.kind]() : !meta?.plan ? null : (kinds[meta.kind] || (() => demoScript(meta.plan)))();
  const text = meta?.kind === 'chat' ? demoChat(meta) : reply ? JSON.stringify(reply, null, 2) : 'OK';
  // The rest of a reply an earlier request began: the demo writes the same text every time.
  for (let i = partial && text.startsWith(partial) ? partial.length : 0; i < text.length; i += 90) {
    await sleep(25, signal);
    yield text.slice(i, i + 90);
  }
}
