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
    scenes: timeline.map((s, i) => ({
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
    publish: {
      titles: zh ? [`演示标题一`, `演示标题二`, `演示标题三`] : ['Demo title one', 'Demo title two', 'Demo title three'],
      coverText: zh ? '演示封面文案' : 'Demo cover text',
      description: zh ? '演示描述：接入真实模型后，这里会是可以直接粘贴的发布文案。' : 'Demo description: with a real model connected, this is the paste-ready caption.',
      hashtags: zh ? ['#演示', '#短视频脚本'] : ['#demo', '#shortvideo'],
      pinnedComment: zh ? '演示置顶评论' : 'Demo pinned comment',
    },
    productionNotes: [zh ? '当前使用的是离线演示提供方，内容为占位文本。' : 'The offline demo provider is active; all content is placeholder text.'],
  };
}

export async function* mockStream({ signal, meta }) {
  const text = meta?.plan ? JSON.stringify(demoScript(meta.plan), null, 2) : 'OK';
  for (let i = 0; i < text.length; i += 90) {
    await sleep(25, signal);
    yield text.slice(i, i + 90);
  }
}
