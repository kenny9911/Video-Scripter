// Script frameworks. `share` is each stage's portion of the total runtime; the prompt builder
// turns the shares into concrete second ranges for the chosen duration.
//
// A framework may also be a narration style: besides the story line (`stages`) it then carries
//   voice           how the narration is written, as rules for the scriptwriter, per language
//   topics          example topics, offered as ideas while the topic field is empty
//   needsReference  true when the style reports facts (news, earnings): without reference material
//                   the script leaves marked gaps rather than inventing figures

export const FRAMEWORK_GROUPS = [
  { id: 'general', name: { zh: '通用结构', en: 'General structures' } },
  { id: 'tech', name: { zh: '科技与商业解说风格', en: 'Tech and business commentary' } },
];

export const FRAMEWORKS = [
  {
    id: 'golden_retention',
    name: { zh: '黄金留存（硬核认知）', en: 'Golden retention (insight explainer)' },
    blurb: {
      zh: '钩子 → 悬念锚点 → 三层价值 → 结构化收束 → 无预警收尾。适合商业、科技、认知类内容。',
      en: 'Hook → suspense anchor → three value waves → structured wrap → cold close. Best for business, tech and insight content.',
    },
    stages: [
      { key: 'hook', share: 0.045, zh: '黄金钩子：反常识暴击或痛点止损预警', en: 'Hook: a counter-intuitive claim or a loss the viewer is taking right now' },
      { key: 'anchor', share: 0.085, zh: '悬念锚点：引出权威来源或案例，并预告“听完这三点，特别是最后一条”', en: 'Suspense anchor: name the source or case, and promise what the viewer gets ("three things, the last one matters most")' },
      { key: 'wave_what', share: 0.21, zh: '第一层（是什么）：给外行听的大白话比喻', en: 'Wave 1 (What): explain it with a plain everyday analogy' },
      { key: 'wave_why', share: 0.21, zh: '第二层（为什么）：背后的核心逻辑、分水岭或“阳谋”', en: 'Wave 2 (Why): the underlying logic or the dividing line most people miss' },
      { key: 'wave_scenario', share: 0.2, zh: '第三层（怎么用）：解决要命痛点的具体实战场景', en: 'Wave 3 (So what): a concrete scenario where this solves a painful problem' },
      { key: 'structured_close', share: 0.165, zh: '结构化收束：用 01→04 步骤拆解，再接一句秒懂的定性总结', en: 'Structured wrap: break it into steps 01→04, then one line that sums up the principle' },
      { key: 'cta', share: 0.085, zh: '无预警收尾：一句金句 + 具象转发指令 + 下期钩子（禁止“总结一下”）', en: 'Cold close: one quotable line + a specific share instruction + next-episode hook (never "to sum up")' },
    ],
  },
  {
    id: 'pas',
    name: { zh: '痛点-放大-解决', en: 'Problem – Agitate – Solve' },
    blurb: { zh: '先戳痛点，再放大代价，最后给解法。适合服务、课程、工具类。', en: 'Name the pain, raise the stakes, deliver the fix. Good for services, courses and tools.' },
    stages: [
      { key: 'hook', share: 0.1, zh: '钩子：用一个具体场景点出痛点', en: 'Hook: put the pain in one specific, recognisable moment' },
      { key: 'problem', share: 0.2, zh: '痛点：说清楚问题到底是什么，让观众对号入座', en: 'Problem: state exactly what is going wrong so the viewer recognises themselves' },
      { key: 'agitate', share: 0.2, zh: '放大：不解决的代价，常见的错误做法为什么没用', en: 'Agitate: the cost of leaving it, and why the usual fix fails' },
      { key: 'solve', share: 0.38, zh: '解决：给出解法，分2–3个可执行的要点', en: 'Solve: the fix, in 2–3 points the viewer can act on' },
      { key: 'cta', share: 0.12, zh: '行动号召', en: 'Call to action' },
    ],
  },
  {
    id: 'story',
    name: { zh: '故事反转', en: 'Story with a turn' },
    blurb: { zh: '从结果或冲突切入，讲一个有转折的小故事。适合个人IP、品牌故事、案例。', en: 'Start at the conflict, tell a short story with a turn. Good for personal brands, founders and case studies.' },
    stages: [
      { key: 'hook', share: 0.1, zh: '钩子：从结果或最紧张的一刻切入', en: 'Hook: open on the outcome or the most tense moment' },
      { key: 'setup', share: 0.2, zh: '铺垫：人物、处境、想要什么', en: 'Setup: who, where, and what they wanted' },
      { key: 'conflict', share: 0.28, zh: '冲突：遇到的阻碍和失败的尝试', en: 'Conflict: the obstacle and the attempt that failed' },
      { key: 'turn', share: 0.27, zh: '转折：关键的认知或做法改变了结果', en: 'Turn: the realisation or change that flipped the result' },
      { key: 'takeaway', share: 0.15, zh: '落点：一句话的启发 + 行动号召', en: 'Takeaway: the lesson in one line + call to action' },
    ],
  },
  {
    id: 'listicle',
    name: { zh: '清单盘点', en: 'Listicle' },
    blurb: { zh: '“3个……”式清单，把最有价值的一条放最后。适合技巧、避坑、盘点。', en: '"3 things…" with the strongest item last. Good for tips, mistakes and round-ups.' },
    stages: [
      { key: 'hook', share: 0.1, zh: '钩子：说出数量和收益，并预告最后一条最重要', en: 'Hook: state the number and the payoff, and tease that the last one matters most' },
      { key: 'item_1', share: 0.23, zh: '第1条', en: 'Item 1' },
      { key: 'item_2', share: 0.23, zh: '第2条', en: 'Item 2' },
      { key: 'item_3', share: 0.3, zh: '第3条（最有价值的一条）', en: 'Item 3 (the strongest one)' },
      { key: 'cta', share: 0.14, zh: '一句话回扣 + 行动号召', en: 'One-line callback + call to action' },
    ],
  },
  {
    id: 'howto',
    name: { zh: '教程步骤', en: 'How-to tutorial' },
    blurb: { zh: '先展示结果，再分步骤教。适合实操、软件、技能教学。', en: 'Show the result first, then teach the steps. Good for demos, software and skills.' },
    stages: [
      { key: 'hook', share: 0.1, zh: '钩子：先展示最终结果', en: 'Hook: show the finished result first' },
      { key: 'step_1', share: 0.22, zh: '步骤1', en: 'Step 1' },
      { key: 'step_2', share: 0.22, zh: '步骤2', en: 'Step 2' },
      { key: 'step_3', share: 0.22, zh: '步骤3', en: 'Step 3' },
      { key: 'pitfall', share: 0.12, zh: '避坑：最常见的一个错误', en: 'Pitfall: the one mistake most people make' },
      { key: 'cta', share: 0.12, zh: '行动号召', en: 'Call to action' },
    ],
  },
  {
    id: 'product',
    name: { zh: '产品种草', en: 'Product showcase' },
    blurb: { zh: '场景痛点 → 产品亮相 → 卖点证明 → 行动。适合带货、新品、探店。', en: 'Scenario → reveal → proof → offer. Good for product, launch and review videos.' },
    stages: [
      { key: 'hook', share: 0.1, zh: '钩子：使用场景中的痛点或惊艳效果', en: 'Hook: the pain in a real-life scenario, or a striking result' },
      { key: 'reveal', share: 0.15, zh: '产品亮相：它是什么，一句话定位', en: 'Reveal: what it is, in one line' },
      { key: 'proof', share: 0.35, zh: '证明：实拍演示和对比，眼见为实', en: 'Proof: demonstration and comparison on camera' },
      { key: 'benefits', share: 0.25, zh: '卖点：2–3个与用户利益直接相关的点', en: 'Benefits: 2–3 points tied directly to what the viewer gains' },
      { key: 'cta', share: 0.15, zh: '行动号召：怎么获得，为什么是现在', en: 'Call to action: how to get it and why now' },
    ],
  },
  // ---------- Tech and business commentary: a story line plus a narration voice ----------
  {
    id: 'tech_explainer',
    group: 'tech',
    name: { zh: '硬核技术破壁与落地风', en: 'Hard tech, demystified and deployed' },
    blurb: {
      zh: '破壁钩子 → 一句话讲清 → 一个类比 → 拆机制 → 破误解 → 落地三步 → 适用边界。把硬核概念讲给不写代码的决策者，并讲到怎么落地。',
      en: 'Hook → one-line answer → one analogy → mechanism → myth → three steps to deploy → where it fits. Explains a hard technical idea to decision-makers who do not code, down to how it gets deployed.',
    },
    topics: {
      zh: ['什么是 Ontology（本体）？', '企业级 Ontology 到底如何落地？'],
      en: ['What is an ontology, really?', 'How does an enterprise ontology actually get deployed?'],
    },
    stages: [
      { key: 'hook', share: 0.06, zh: '破壁钩子：从一个业务上的代价或反常识切入，用观众自己的话说，不出现定义和术语', en: 'Hook: open on a business cost or a counter-intuitive fact, in the viewer\'s own words; no definition, no jargon' },
      { key: 'answer', share: 0.08, zh: '一句话讲清：用大白话说出这项技术到底解决什么，并预告“是什么、怎么运转、怎么落地”', en: 'One-line answer: what this technology actually fixes, in plain words, then promise the three parts (what it is, how it works, how to deploy it)' },
      { key: 'analogy', share: 0.17, zh: '是什么：一个贯穿全片的生活化类比，把抽象概念变成看得见的东西', en: 'What it is: one everyday analogy, carried through the whole video, that turns the abstraction into something you can see' },
      { key: 'mechanism', share: 0.2, zh: '怎么运转：按顺序拆开两到三层机制，每层只引入一个新术语，先说人话再报术语名', en: 'How it works: two or three layers in order, one new term per layer, plain words first and the term second' },
      { key: 'myth', share: 0.13, zh: '破误解：点破一个最常见的误解（它不是什么），说清它和旧做法的分水岭', en: 'Myth to break: the most common misreading (what it is not) and the line that separates it from the old way' },
      { key: 'landing', share: 0.2, zh: '怎么落地：从哪个场景切入、谁来牵头、先做哪三步（01→03），以及最容易踩的一个坑', en: 'How to deploy: which use case to start with, who owns it, the first three steps (01→03) and the most common trap' },
      { key: 'verdict', share: 0.08, zh: '适用边界：什么情况值得做、什么情况先别做，给一句判断标准', en: 'Where it fits: when it is worth doing, when to wait, and a one-line test' },
      { key: 'cta', share: 0.08, zh: '无预警收尾：一句金句 + 具象转发指令 + 下期问题（禁止“总结一下”）', en: 'Cold close: one quotable line + a specific share instruction + the next episode\'s question (never "to sum up")' },
    ],
    voice: {
      zh: [
        '人设：懂技术也做过业务的实践者，在给不写代码的业务负责人讲。先讲它解决的业务后果，再讲它是什么；实现细节只是论据，不是主线。',
        '开场和“一句话讲清”里不许出现术语定义和英文缩写；这项技术的价值必须在第二个场景结束之前说完，后面的内容都是在证明这句话。',
        '每个术语第一次出现时，先用大白话说它是什么，再报出术语名；之后全片只用这一个叫法，不换同义词。',
        '全片只用一个类比并贯穿到底，机制的每一层都回到这个类比上，不要每段换一个比喻。',
        '讲机制用“先…再…最后…”的因果链，一句话只推进一步，不要罗列名词。',
        '落地部分要具体到“先从哪个场景做、谁负责、做到什么算第一步完成”。没有资料支撑的效果数字不要给；举例用明确的假设说法（如“假设一家制造企业…”），并在 onScreenText 标注“示例”。',
        '必须讲清一个边界：什么情况下不值得做，或者做了也不会有效果。',
        '“不是…而是…”句式全片最多用一次。不用“赋能、抓手、闭环、底层逻辑、颠覆”这类空话。',
      ],
      en: [
        'Persona: a practitioner who knows the technology and has run a business with it, talking to a business owner who does not code. Lead with the business consequence it fixes, then what it is; implementation detail is evidence, never the spine.',
        'No definition and no acronym in the hook or the one-line answer. The value of the technology must be stated before the second scene ends; everything after that is there to prove it.',
        'The first time a term appears, say what it is in plain words, then name the term. After that use that one name throughout; no synonyms.',
        'Use one analogy and carry it through the whole video: every layer of the mechanism comes back to it. Do not switch metaphors from scene to scene.',
        'Explain the mechanism as a causal chain ("first… then… which means…"), one step per sentence. Never a list of nouns.',
        'Make the deployment part concrete: which use case first, who owns it, and what counts as step one being done. Give no result figures that the material does not support; phrase examples as explicit hypotheticals ("say a manufacturer…") and mark them "Example" in onScreenText.',
        'State one boundary: when this is not worth doing, or will not work.',
        'At most one "it is not X, it is Y" sentence in the whole script. No filler such as "empower", "leverage", "synergy", "game-changer" or "revolutionary".',
      ],
    },
  },
  {
    id: 'tech_news',
    group: 'tech',
    needsReference: true,
    name: { zh: '科技新闻内行解说风', en: 'Tech news, the insider read' },
    blurb: {
      zh: '新闻钩子 → 发生了什么 → 看热闹与看门道 → 为什么是现在 → 谁受影响 → 接下来看什么。事实和判断分开说，适合重磅发布、收购和架构调整的解读。',
      en: 'News hook → what happened → headline vs. signal → why now → who it hits → what to watch. Facts and judgment kept apart; for launches, acquisitions and reorganisations.',
    },
    topics: {
      zh: ['大模型 / Agent 重磅发布解读', '某科技巨头突发收购 / 架构调整，内行怎么看'],
      en: ['A major model or agent launch, read by an insider', 'A tech giant\'s surprise acquisition or reorganisation: what it really means'],
    },
    stages: [
      { key: 'hook', share: 0.07, zh: '新闻钩子：这条新闻里最反常、且可以核实的一个事实，开口第一句就说', en: 'News hook: the single most surprising, verifiable fact in the story, said in the first sentence' },
      { key: 'facts', share: 0.15, zh: '发生了什么：谁、什么时候、做了什么、关键数字；只陈述事实，并交代消息来源', en: 'What happened: who, when, what, and the key figure. Facts only, with where they come from' },
      { key: 'signal', share: 0.1, zh: '看热闹与看门道：一句话带过大多数报道在说什么，再抛出内行真正盯着的那个细节', en: 'Headline vs. signal: one line on what most coverage says, then the detail insiders are actually watching' },
      { key: 'why_now', share: 0.22, zh: '为什么是现在：这个细节背后的动机和棋局，放进公司战略或行业竞争里解释（标明是判断）', en: 'Why now: the motive and the bigger game behind that detail, read against the company\'s strategy or its competition (flagged as a judgment)' },
      { key: 'impact', share: 0.2, zh: '谁受影响：对两到三类人的具体影响（如开发者、企业客户、竞争对手），每类一句', en: 'Who it hits: the concrete effect on two or three groups (developers, enterprise buyers, competitors), one line each' },
      { key: 'watch', share: 0.14, zh: '接下来看什么：一到两个可以验证的观察信号，外加一个明确标注的预测', en: 'What to watch: one or two signals that would confirm or kill this reading, plus one clearly labelled prediction' },
      { key: 'cta', share: 0.12, zh: '收尾：一句定性金句 + 一个容易回答的评论区问题 + 下期预告（禁止“总结一下”）', en: 'Close: one line that sums up the read + a question that is easy to answer in the comments + next-episode hook (never "to sum up")' },
    ],
    voice: {
      zh: [
        '人设：在这个行业里做过事的内行，语气克制、有判断，像在给同行朋友讲门道，不是念新闻稿。',
        '事实和判断分开说。事实要带时间和来源（“官方公告里写的是…”“财报电话会上说…”）；自己的解读用“我的判断是”“我倾向于认为”引出；关于未来的说法必须说成预测。',
        '只用需求和参考资料里出现的事实。资料没给的时间、金额、人名、内幕一律不补；确实需要却缺失的信息，在 onScreenText 写“【待核实：…】”，旁白用定性的说法带过，并在 productionNotes 里列出所有待核实项。',
        '不替当事人说话：个人观点不能说成公司立场，引用要说清是谁说的；未经证实的消息要明说是传闻。',
        '钩子不超过二十个字，必须有一个数字或一个冲突。不用“震惊、炸裂、王炸、史诗级、颠覆、变天”这类词：标题党会拉低可信度。',
        '内行细节要具体：定价和计费方式、接口和许可条款、谁向谁汇报、发布的时间点、公告里没说的那句话，选一个讲透。',
        '讲影响时对着人说（“如果你是做…的”），每类人只给一个最要紧的变化。',
        '时间用资料里的具体日期，不要写“昨天”“刚刚”“今天凌晨”这类看到视频时已经过期的说法。',
      ],
      en: [
        'Persona: an insider who has worked in this industry. Measured, opinionated, explaining to a peer how to read the story; never reading out a press release.',
        'Keep fact and judgment apart. A fact comes with its date and source ("the announcement says…", "on the earnings call…"); your reading starts with "my read is" or "I think"; anything about the future is stated as a prediction.',
        'Use only facts found in the brief and the reference material. Never fill in a date, amount, name or inside detail that the material does not give. Where a needed fact is missing, write "[TO VERIFY: …]" in onScreenText, keep the spoken line qualitative, and list every item to verify in productionNotes.',
        'Do not speak for the people involved: one person\'s view is not the company\'s position, and every quote says who said it. An unconfirmed report is called a report.',
        'The hook is at most twelve words and carries a number or a conflict. No "shocking", "insane", "game over", "changes everything" or "revolutionary": clickbait lowers credibility.',
        'Make the insider detail specific: pricing and billing, API and licence terms, who reports to whom, the timing of the release, the sentence the announcement left out. Pick one and explain it fully.',
        'Address the impact to people ("if you build on…"), with the one change that matters most for each group.',
        'Use the dates given in the material. Never "yesterday", "just now" or "this morning": they are wrong by the time the video is watched.',
      ],
    },
  },
  {
    id: 'earnings',
    group: 'tech',
    needsReference: true,
    name: { zh: '科技公司财报透视与商业拆解风', en: 'Earnings teardown and business model' },
    blurb: {
      zh: '数字钩子 → 一句话结论 → 三个关键数（钱从哪来、留下多少、还能赚多久）→ 赚钱逻辑 → 对你意味着什么。从财报拆出一门生意怎么赚钱，不谈股价。',
      en: 'Number hook → the answer up front → three numbers (where the money comes from, how much is kept, how long it lasts) → the logic → so what. Reads an earnings report for how the business makes money; no share-price talk.',
    },
    topics: {
      zh: ['从 Palantir / 英伟达 / 微软最新财报，看今年 B 端生意的真正赚钱逻辑'],
      en: ['What the latest Palantir, Nvidia and Microsoft earnings say about how B2B really makes money this year'],
    },
    stages: [
      { key: 'hook', share: 0.06, zh: '数字钩子：财报里最反直觉的一个数字或一组反差，第一句就报出来', en: 'Number hook: the most counter-intuitive figure or contrast in the report, in the first sentence' },
      { key: 'thesis', share: 0.09, zh: '一句话结论：这家公司（或这几家）的钱到底是怎么赚的，并预告“看懂三个数就够了”', en: 'The answer up front: how this company (or these companies) really makes money, then promise "three numbers explain it"' },
      { key: 'number_1', share: 0.17, zh: '第一个数（钱从哪来）：收入和增长来自哪块业务、哪类客户', en: 'Number 1 (where the money comes from): which business and which customers drive revenue and growth' },
      { key: 'number_2', share: 0.17, zh: '第二个数（钱留下多少）：一个利润率或效率指标，并解释它为什么留得住钱', en: 'Number 2 (how much it keeps): one margin or efficiency figure, and why the money stays' },
      { key: 'number_3', share: 0.17, zh: '第三个数（还能赚多久）：订单、已签未确认的合同、业绩指引或资本开支这类前瞻指标', en: 'Number 3 (how long it lasts): a forward indicator such as backlog, contracted revenue not yet recognised, guidance or capital spending' },
      { key: 'logic', share: 0.16, zh: '赚钱逻辑：把三个数连成一条因果链，用一句话说出它的商业模式和护城河（标明是判断）', en: 'The logic: join the three numbers into one causal chain and state the business model and its moat in a sentence (flagged as a judgment)' },
      { key: 'so_what', share: 0.1, zh: '对你意味着什么：做 B 端生意的人可以照着学、或者必须避开的一件事', en: 'So what: the one thing a B2B operator can copy, or must avoid' },
      { key: 'cta', share: 0.08, zh: '收尾：一句金句 + 具象转发指令 + 下期预告（不谈股价，不给买卖建议）', en: 'Close: one quotable line + a specific share instruction + next-episode hook (no share-price talk, no buy or sell advice)' },
    ],
    voice: {
      zh: [
        '人设：看得懂报表、也做过生意的分析者，冷静、讲逻辑，像在给做 B 端业务的同行拆一门生意，不是荐股。',
        '每个数字都要有口径：哪家公司、哪个财季或财年、同比还是环比、什么货币。只用需求和参考资料里出现的数字，不要凭记忆补财报数据；资料里没有的，在 onScreenText 写“【待补：某指标】”，旁白只讲定性结论，并在 productionNotes 里列出所有待补数字。',
        '旁白只念骨架：每个场景最多一个关键数字，用好念的约数（“接近四十亿美元”“涨了三成多”）；精确数字、口径和来源（如“来源：公司 2026 财年第二季度财报”）放在 onScreenText。',
        '数字要有参照才有意义：和去年同期比、和自己的另一块业务比、和同行比；参照数字同样必须来自资料。',
        '会计和行业术语第一次出现时用一句大白话解释，例如把“剩余履约义务”说成“已经签了合同、还没确认成收入的钱”。',
        '事实和判断分开：“财报显示…”是事实，“我的判断是…”是观点；关于商业模式和护城河的结论属于判断。',
        '几家公司放在一起讲时，用同一个指标横向比，不要每家各讲一套；每家只留一个最能说明问题的数。',
        '不预测股价，不说“值得买”“可以上车”，不给任何买卖建议；讲的是生意怎么赚钱。在 productionNotes 里加一条“本视频不构成投资建议”。',
      ],
      en: [
        'Persona: an analyst who can read the statements and has run a business. Calm and logical, taking a business apart for peers who sell to companies; never a stock tip.',
        'Every figure has its scope: which company, which quarter or fiscal year, year-on-year or quarter-on-quarter, which currency. Use only figures found in the brief and the reference material and never fill in earnings data from memory. Where a figure is missing, write "[TO ADD: metric]" in onScreenText, keep the spoken line qualitative, and list every missing figure in productionNotes.',
        'The voice carries the backbone only: at most one key figure per scene, rounded so it is easy to say ("nearly four billion dollars", "up by more than a third"). The exact figure, its scope and its source ("Source: company FY2026 Q2 results") go in onScreenText.',
        'A number means something only next to another: the same quarter last year, the company\'s other business, a peer. The comparison figure must come from the material too.',
        'Explain an accounting or industry term in one plain sentence the first time it appears, e.g. remaining performance obligations as "money already under contract that has not been counted as revenue yet".',
        'Keep fact and judgment apart: "the report shows…" is fact, "my read is…" is opinion. Conclusions about the business model and the moat are judgment.',
        'When several companies are covered, compare them on the same metric instead of telling a separate story for each; keep the one number per company that makes the point.',
        'No share-price prediction, no "worth buying" or "time to get in", no buy or sell advice of any kind; this is about how the business makes money. Add the line "This video is not investment advice" to productionNotes.',
      ],
    },
  },
];

export function getFramework(id) {
  return FRAMEWORKS.find((f) => f.id === id);
}
