// Offline demo provider. Produces a placeholder script shaped like a real reply so the UI and
// export paths can be tried without an API key. The content is filler, not a usable script.

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });
  });

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
    const scene = { id: i + 1, start: prev, end, stage: b.stage, voiceover: b.text, onScreenText: `${String(i + 1).padStart(2, '0')}`, visual: zh ? '演示占位：此处为画面描述。' : 'Demo placeholder: the shot description goes here.', camera: zh ? '中景，硬切' : 'Medium shot, hard cut', sfx: '' };
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
    beats: timeline.map((s) => ({ stage: s.key, text: zh ? `（演示占位）这一段对应：${s.label}。主题是${brief.topic}。` : `(Demo placeholder) This beat covers: ${s.label}. The topic is ${brief.topic}.` })),
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
    scenes: brief.narration?.length ? lockedScenes(plan) : timeline.map((s, i) => ({
      id: i + 1,
      start: s.start,
      end: s.end,
      stage: s.key,
      voiceover: zh ? `（演示占位）这一段对应：${s.label}。⏸ 主题是[[${t}]]。` : `(Demo placeholder) This beat covers: ${s.label}. ⏸ The topic is [[${t}]].`,
      onScreenText: zh ? `${String(i + 1).padStart(2, '0')} · ${s.key}` : `${String(i + 1).padStart(2, '0')} · ${s.key}`,
      visual: zh ? '演示占位：此处为画面描述。' : 'Demo placeholder: the shot description goes here.',
      camera: zh ? '中景，硬切' : 'Medium shot, hard cut',
      sfx: '',
    })),
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
    productionNotes: [zh ? '当前使用的是离线演示提供方，内容为占位文本。' : 'The offline demo provider is active; all content is placeholder text.'],
  };
}

export async function* mockStream({ signal, meta }) {
  const kinds = { narration: () => demoNarration(meta.plan, meta.planFirst), refine: () => demoRefined(meta), edit: () => demoEdit(meta) };
  const reply = !meta?.plan ? null : (kinds[meta.kind] || (() => demoScript(meta.plan)))();
  const text = reply ? JSON.stringify(reply, null, 2) : 'OK';
  for (let i = 0; i < text.length; i += 90) {
    await sleep(25, signal);
    yield text.slice(i, i + 90);
  }
}
