// Script frameworks. `share` is each stage's portion of the total runtime; the prompt builder
// turns the shares into concrete second ranges for the chosen duration.
//
// A framework may also be a narration style: besides the story line (`stages`) it then carries
//   voice           how the narration is written, as rules for the scriptwriter, per language
//   topics          example topics, offered as ideas while the topic field is empty
//   pace            how fast it is spoken: Chinese characters / English words per second (default: PACE in narration.mjs)
//   length          { min, max, default } seconds the style is made for; the form suggests it
//   board           true when the script should come with a whiteboard blueprint (the structure, as an ASCII diagram)
//   needsReference  true when the style reports facts (news, earnings): without reference material
//                   the script leaves marked gaps rather than inventing figures

export const FRAMEWORK_GROUPS = [
  { id: 'general', name: { zh: '通用结构', en: 'General structures' } },
  { id: 'voice', name: { zh: '通用内容风格', en: 'General content styles' } },
  { id: 'tech', name: { zh: '科技商业与顾问风格', en: 'Tech, business and consultant styles' } },
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
  // ---------- General content styles: a story line plus a narration voice, a pace and a length ----------
  {
    id: 'loss_stop',
    group: 'voice',
    pace: { zh: 4.5, en: 2.7 },
    length: { min: 45, max: 75, default: 60 },
    name: { zh: '反常识暴击／痛点止损风', en: 'Counter-intuitive hit, stop the loss' },
    blurb: {
      zh: '痛点暴击 → 揭秘亏钱真因 → 三步止损法 → 转发指令。泛商业认知破圈，纠正企业正在做的错误动作。',
      en: 'The loss, named → the real cause → three steps to stop it → who to send it to. Corrects a costly move the viewer is making right now.',
    },
    topics: {
      zh: ['企业上 AI 项目最烧钱的一个错误动作', '为什么你花钱买的系统没人用'],
      en: ['The one move that burns most of an AI budget', 'Why the software you paid for sits unused'],
    },
    stages: [
      { key: 'hook', share: 0.1, zh: '痛点暴击：一句话点破观众正在亏的钱、时间或机会，或者一个反常识的事实', en: 'The hit: one sentence naming the money, time or chance the viewer is losing right now, or a fact that contradicts what they assume' },
      { key: 'cause', share: 0.3, zh: '揭秘真因：先说大家以为的原因，再说真正的原因，把账算给观众看', en: 'The real cause: what people blame, then what is actually behind it, with the sum worked out for the viewer' },
      { key: 'fix', share: 0.45, zh: '三步止损法：今天就能做的三步（01→03），每步一个动作，最要紧的放最后', en: 'Three steps to stop the loss (01→03): each one an action for today, the most important last' },
      { key: 'cta', share: 0.15, zh: '转发指令：一句金句 + 转给谁、为什么（无预警收尾，禁止“总结一下”）', en: 'Send it on: one quotable line + who to send this to and why (cold close, never "to sum up")' },
    ],
    voice: {
      zh: [
        '人设：替观众算过这笔账的内行。语气直接、不绕弯，但始终站在观众这边。',
        '第一句必须是具体的损失或反常识，不超过二十个字，不用“你知道吗”“很多人不知道”这类铺垫。',
        '真因只讲一个，讲透：先说大家以为的原因，再说真正的原因，中间用“但问题是”转过去。',
        '损失要可感：换算成观众自己的单位（每个月、每个客户、每个人）。数字只用资料里有的；没有就用“假设…”把算法演示一遍，并在 onScreenText 标注“示例”。',
        '三步每步都是今天能做的动作，用动词开头，不讲原则和心态。',
        '语速快，句子短。每十到十二秒一个转折，不连着解释超过三句。',
        '指出问题的同时必须给出路，不贩卖焦虑。不用“震惊、血亏、割韭菜、智商税”这类词。',
        '收尾的转发指令具体到人和理由（“转给管预算的那位合伙人，让他先看第二步”）。',
      ],
      en: [
        'Persona: an insider who has done this sum for the viewer. Direct, no detours, and always on the viewer\'s side.',
        'The first sentence is a specific loss or a counter-intuitive fact, in twelve words or fewer. No wind-up such as "did you know" or "most people don\'t realise".',
        'Give one real cause and explain it fully: what people blame first, then what is actually behind it, turning on "but here\'s the problem".',
        'Make the loss felt: put it in the viewer\'s own units (per month, per customer, per person). Use only figures from the material; without one, walk through the sum as an explicit hypothetical ("say you…") and mark it "Example" in onScreenText.',
        'Each of the three steps is an action for today and starts with a verb. No principles, no mindset.',
        'Fast pace, short sentences. A turn every ten to twelve seconds; never more than three explaining sentences in a row.',
        'Name the problem and give the way out in the same breath; never sell fear. No "shocking", "scam", "bleeding money" or "idiot tax".',
        'The closing ask names a person and a reason ("send this to whoever owns the budget, and have them start at step two").',
      ],
    },
  },
  {
    id: 'mouthpiece',
    group: 'voice',
    pace: { zh: 4.2, en: 2.5 },
    length: { min: 45, max: 60, default: 60 },
    name: { zh: '情绪嘴替／社交货币风', en: 'Saying what they can\'t' },
    blurb: {
      zh: '具象冲突场景 → 戳破行业潜规则 → 给个说法 → 金句升华促转发。替创业者、高管、技术负责人说出大实话。',
      en: 'A concrete clash → the unwritten rule, said out loud → a way to see it → a line worth sharing. Says what founders, executives and tech leads cannot say themselves.',
    },
    topics: {
      zh: ['技术负责人最怕听到老板说的一句话', '为什么汇报做得越好，项目死得越快'],
      en: ['The sentence every tech lead dreads hearing from the CEO', 'Why the better the status report, the faster the project dies'],
    },
    stages: [
      { key: 'scene', share: 0.24, zh: '具象冲突场景：一个观众亲身经历过的具体时刻，有人物、有地点、有一句原话', en: 'The clash: one specific moment the viewer has lived through, with a person, a place and a line of dialogue' },
      { key: 'truth', share: 0.36, zh: '戳破潜规则：把大家心里明白、没人明说的行业真相说出来，具体到流程、话术或考核方式', en: 'The unwritten rule: say the thing everyone knows and nobody says, down to the process, the phrasing or the metric behind it' },
      { key: 'reframe', share: 0.22, zh: '给个说法：站在观众这边重新解释这件事，再给一个明天就能用的做法或话术', en: 'A way to see it: re-read the situation from the viewer\'s side, then give one move or one sentence they can use tomorrow' },
      { key: 'line', share: 0.18, zh: '金句升华：一句值得发朋友圈的话 + 转给那个懂的人（无预警收尾）', en: 'The line: one sentence worth posting + send it to the person who will get it (cold close)' },
    ],
    voice: {
      zh: [
        '人设：替创业者、高管、技术负责人说出大实话的同行。说“我们”，不说“你们”。',
        '开场是一个场景，不是观点：有人物、有地点、有一句原话，观众三秒内认出“这就是我”。',
        '情绪克制：只说事实和处境。不骂人，不点名具体的公司和个人，不制造对立。',
        '潜规则要说到“原来不止我一个”的程度：具体到流程、话术、考核方式，不停在“行业很卷”这种泛泛的说法。',
        '不灌鸡汤：“给个说法”里必须有一个明天就能用的做法或一句话术。',
        '金句不超过二十个字，用对仗或反差，脱离视频也能独立成立。',
        '全片不出现说教词：“你应该”“你必须”“请记住”。',
        '场景是典型情境，不冒充真实个案；只有需求里给了的经历，才能说成“我遇到过”。',
      ],
      en: [
        'Persona: a peer saying out loud what founders, executives and tech leads cannot. "We", never "you people".',
        'Open on a scene, not an opinion: a person, a place and a line of dialogue, so the viewer thinks "that\'s me" within three seconds.',
        'Keep the emotion in check: facts and situations only. No insults, no named companies or people, no us-against-them.',
        'Take the unwritten rule far enough that the viewer thinks "so it isn\'t just me": the process, the phrasing, the metric. Never stop at "the industry is tough".',
        'No comfort talk: the reframe must contain one move or one sentence the viewer can use tomorrow.',
        'The closing line is twelve words or fewer, built on a contrast, and stands on its own outside the video.',
        'No lecturing words anywhere: "you should", "you must", "remember".',
        'The scene is a typical situation, never passed off as a real case; only an experience given in the brief may be told as "I have seen".',
      ],
    },
  },
  {
    id: 'toolkit',
    group: 'voice',
    board: true,
    pace: { zh: 4.0, en: 2.4 },
    length: { min: 60, max: 100, default: 90 },
    name: { zh: '利他工具／实战拆解风', en: 'Take-away toolkit' },
    blurb: {
      zh: '结果反差钩子 → 前置第三步悬念 → 一二三步实操拆解 → 置顶领模板。流程 SOP、避坑清单、实操案例。',
      en: 'The result first → a tease for step three → steps one, two, three → the template in the pinned comment. For procedures, checklists and worked cases.',
    },
    topics: {
      zh: ['企业上线第一个 AI Agent 的三步清单', '一张表梳理清楚你的业务流程'],
      en: ['A three-step checklist for shipping your first AI agent', 'Map a business process on one page'],
    },
    stages: [
      { key: 'hook', share: 0.08, zh: '结果反差钩子：先亮出做完之后的结果，或一组前后对比', en: 'Result first: show what it looks like when it is done, or a before and after' },
      { key: 'tease', share: 0.08, zh: '前置悬念：预告一共三步，并点明第三步最容易被漏掉', en: 'The tease: there are three steps, and the third is the one people miss' },
      { key: 'step_1', share: 0.22, zh: '第一步：做什么、怎么做、做到什么算完成', en: 'Step 1: what to do, how, and what counts as done' },
      { key: 'step_2', share: 0.22, zh: '第二步：做什么、怎么做、做到什么算完成', en: 'Step 2: what to do, how, and what counts as done' },
      { key: 'step_3', share: 0.26, zh: '第三步（最关键的一步）：兑现开头的悬念，讲清为什么多数人漏掉它', en: 'Step 3 (the one that matters): pay off the tease and say why most people skip it' },
      { key: 'cta', share: 0.14, zh: '置顶领模板：一句话回扣结果 + 评论区置顶领取清单或模板（无预警收尾）', en: 'The template: one line back to the result + the checklist or template in the pinned comment (cold close)' },
    ],
    voice: {
      zh: [
        '人设：把这件事做过很多遍的实操者，像带徒弟：只讲做法，不讲大道理。',
        '每一步固定三句：动作（动词开头）→ 怎么做（一个具体细节）→ 验收标准（做到什么算完成）。',
        '步骤的名字要短（四到六个字），能直接当清单抄走。旁白念步骤名，细节放进 onScreenText。',
        '用同一个例子把三步走完，不要每一步换一个例子。',
        '背景和道理加起来不超过两句，其余全是做法。',
        '每一步配一个最常见的坑，用一句话带过（“这一步最容易…”）。',
        '第三步必须兑现开头的悬念，并说出“这就是开头说的那一步”。',
        '收尾给出清单或模板的具体名称（如“三步检查清单”），引导到评论区置顶领取；不承诺需求里没有的资料。',
      ],
      en: [
        'Persona: someone who has done this many times, teaching an apprentice: the how, never the philosophy.',
        'Every step is three sentences: the action (starting with a verb) → how (one concrete detail) → the test (what counts as done).',
        'Step names are short (two to four words) and can be copied as a checklist. The voice says the name; the detail goes in onScreenText.',
        'Run one example through all three steps. Do not switch examples between steps.',
        'Background and reasons take two sentences in total; everything else is method.',
        'Give each step its most common trap in one sentence ("this is where people…").',
        'Step three pays off the tease and says so ("this is the step I mentioned at the start").',
        'The close names the checklist or template ("the three-step checklist") and points to the pinned comment. Never promise material the brief does not mention.',
      ],
    },
  },
  {
    id: 'quiet_story',
    group: 'voice',
    pace: { zh: 3.5, en: 2.1 },
    length: { min: 45, max: 75, default: 60 },
    name: { zh: '具象故事／走心留白风', en: 'A quiet story' },
    blurb: {
      zh: '真实细节切入 → 事情的走向 → 认知转折 → 留白金句引发评论。创始人感悟、客户交付复盘、价值观共鸣。',
      en: 'A real detail → how it went → the turn → a line left open for the comments. For founder reflections, delivery retrospectives and what you stand for.',
    },
    topics: {
      zh: ['交付一个项目之后，客户说的一句话让我想了很久', '我们拒绝过的一个大单'],
      en: ['One thing a client said after delivery that stayed with me', 'The big deal we turned down'],
    },
    stages: [
      { key: 'detail', share: 0.26, zh: '真实细节切入：从一个具体的画面或一句原话开始，不交代背景', en: 'A real detail: start on one concrete image or one line someone said, with no background' },
      { key: 'tension', share: 0.28, zh: '事情的走向：当时怎么想、怎么做，卡在了哪里', en: 'How it went: what you thought, what you did, and where it got stuck' },
      { key: 'turn', share: 0.28, zh: '认知转折：一个瞬间或一句话，让看法变了', en: 'The turn: the moment or the sentence that changed how you saw it' },
      { key: 'line', share: 0.18, zh: '留白金句：一句没有说满的话，把问题留给观众；不总结，不号召', en: 'The open line: a sentence that stops short and leaves the question with the viewer; no summary, no ask' },
    ],
    voice: {
      zh: [
        '人设：创始人或顾问在复盘一件亲历的事。语气平静，不煽情。',
        '语速慢，句子比平时更短，留出停顿。宁可少说一句。',
        '细节具体到感官：时间、地点、一个数字、一句原话。素材来自需求里的经历或资料；没有素材时写成“有一次…”的典型情境，并在 productionNotes 提醒换成真实经历。',
        '不解释情绪，不说“我很感动”“我很震撼”，让细节自己说话。',
        '全片只有一个转折，转折之前不剧透。',
        '结尾留白：不讲道理，不号召。用一个问题或半句话收住，让观众想在评论区把它接完。',
        '不拔高：不出现“人生”“格局”“成长”“初心”这类大词。',
        '旁白里不出现关注、转发的话术；互动引导只放在 pinnedComment。',
      ],
      en: [
        'Persona: a founder or a consultant looking back on something they lived through. Even voice, no sentimentality.',
        'Slow pace, sentences shorter than usual, room for silence. When in doubt, say one sentence less.',
        'Details the senses can hold: a time, a place, one number, one line someone said. They come from the experience or the material in the brief; without any, tell it as a typical situation ("there was a time…") and add a production note to replace it with a real one.',
        'Never explain the feeling ("I was moved", "I was stunned"). Let the detail do it.',
        'One turn in the whole story, and nothing gives it away before it comes.',
        'Leave the ending open: no lesson, no ask. End on a question or half a sentence the viewer wants to finish in the comments.',
        'Do not inflate it: no "life", "journey", "growth" or "purpose".',
        'No follow or share talk in the narration; the prompt to engage goes in pinnedComment only.',
      ],
    },
  },
  // ---------- Tech, business and consultant commentary: a story line plus a narration voice ----------
  {
    id: 'tech_explainer',
    group: 'tech',
    pace: { zh: 4.3, en: 2.6 },
    length: { min: 60, max: 90, default: 90 },
    name: { zh: '硬核技术破壁风（短平快版）', en: 'Hard tech, demystified (short)' },
    blurb: {
      zh: '业务痛点提问 → 人话比喻解说 → 一线踩坑经验 → 三步落地法。60–90 秒讲清一个技术概念，讲给不写代码的决策者。',
      en: 'A business pain, asked → the plain-words analogy → what goes wrong in practice → three steps to deploy. One technical idea in 60–90 seconds, for decision-makers who do not code.',
    },
    topics: {
      zh: ['什么是 Ontology（本体）？', '企业级 Ontology 到底如何落地？'],
      en: ['What is an ontology, really?', 'How does an enterprise ontology actually get deployed?'],
    },
    stages: [
      { key: 'hook', share: 0.09, zh: '业务痛点提问：用观众自己的话问出一个业务上的代价或反常识，不出现定义', en: 'The pain, asked: a business cost or a counter-intuitive fact, put as a question in the viewer\'s own words; no definition' },
      { key: 'analogy', share: 0.31, zh: '人话比喻解说：一句话说清它解决什么，再用一个生活化类比讲它是什么、怎么运转；先说人话再报术语名', en: 'Plain words and one analogy: what it fixes in a sentence, then one everyday analogy for what it is and how it works; plain words first, the term second' },
      { key: 'pitfall', share: 0.25, zh: '一线踩坑经验：我们在企业里看到的最常见的做错方式，以及它和正确做法的分水岭', en: 'What goes wrong in practice: the mistake we see most often inside companies, and the line between it and doing it right' },
      { key: 'landing', share: 0.26, zh: '三步落地法：先从哪个场景切入、谁牵头、做到什么算第一步（01→03），再给一句“什么情况先别做”', en: 'Three steps to deploy (01→03): which use case first, who owns it, what counts as step one done; then one line on when not to start' },
      { key: 'cta', share: 0.09, zh: '无预警收尾：一句金句 + 具象转发指令 + 下期问题（禁止“总结一下”）', en: 'Cold close: one quotable line + a specific share instruction + the next episode\'s question (never "to sum up")' },
    ],
    voice: {
      zh: [
        '人设：懂技术也做过业务的实践者，在给不写代码的业务负责人讲。先讲它解决的业务后果，再讲它是什么；实现细节只是论据，不是主线。',
        '开场不许出现术语定义；这项技术的价值必须在第二段的前两句说完，后面的内容都是在证明这句话。',
        '选题点名的技术和公司要说出口，第一次出现时先用大白话说它是什么，再报出名字；之后全片只用这一个叫法，不换同义词。',
        '全片只用一个类比并贯穿到底，机制的每一层都回到这个类比上，不要每段换一个比喻。',
        '讲机制用“先…再…最后…”的因果链，一句话只推进一步，不要罗列名词。',
        '踩坑经验用第一人称讲出场景（谁、在做什么、卡在哪）。素材来自需求里的经验；没有素材时讲业内常见的现象，不带数字、不点名客户。',
        '落地部分要具体到“先从哪个场景做、谁负责、做到什么算第一步完成”，并讲清一个边界：什么情况下不值得做。没有资料支撑的效果数字不要给；举例用明确的假设说法（如“假设一家制造企业…”），并在 onScreenText 标注“示例”。',
        '“不是…而是…”句式全片最多用一次。不用“赋能、抓手、颠覆”这类空话。',
      ],
      en: [
        'Persona: a practitioner who knows the technology and has run a business with it, talking to a business owner who does not code. Lead with the business consequence it fixes, then what it is; implementation detail is evidence, never the spine.',
        'No definition in the opening. The value of the technology is stated in the first two sentences of the second beat; everything after that is there to prove it.',
        'Say the technology and the company the topic names. The first time, say what it is in plain words, then give the name; after that use that one name throughout, no synonyms.',
        'Use one analogy and carry it through the whole video: every layer of the mechanism comes back to it. Do not switch metaphors from beat to beat.',
        'Explain the mechanism as a causal chain ("first… then… which means…"), one step per sentence. Never a list of nouns.',
        'Tell the practice beat in the first person, as a scene (who, doing what, stuck where). It comes from the experience in the brief; without any, describe a pattern the industry knows, with no numbers and no client names.',
        'Make the deployment part concrete: which use case first, who owns it, what counts as step one being done, and one boundary: when this is not worth doing. Give no result figures that the material does not support; phrase examples as explicit hypotheticals ("say a manufacturer…") and mark them "Example" in onScreenText.',
        'At most one "it is not X, it is Y" sentence in the whole script. No filler such as "empower", "synergy", "game-changer" or "revolutionary".',
      ],
    },
  },
  {
    id: 'consultant_lecture',
    group: 'tech',
    board: true,
    pace: { zh: 4.2, en: 2.5 },
    length: { min: 180, max: 360, default: 240 },
    name: { zh: '顾问级深度白板授课风（3–6 分钟长课）', en: 'Consultant whiteboard lecture (3–6 min)' },
    blurb: {
      zh: '商业神话破题 → 背景与演进 → 全局架构 → 微观组件与工作流解剖 → 认知升华 → 三步搭建与讲义转化。系统拆解 Palantir、Ontology、企业 AI 新架构，立咨询顾问与内训导师人设。',
      en: 'A business myth, broken → how we got here → the whole architecture → one part taken apart → the idea that ties it together → three steps and the handout. A full teardown on one board, in the voice of a consultant and trainer.',
    },
    topics: {
      zh: ['企业 AI 到底怎么落地：拆解 Palantir 的 Ontology', '一张图讲清企业 AI 新四层架构', 'Ontology、LLM、Agent 三者到底是什么关系'],
      en: ['How enterprise AI actually lands: Palantir\'s Ontology, taken apart', 'The four-layer enterprise AI architecture on one board', 'Ontology, LLM and agent: how the three really relate'],
    },
    stages: [
      { key: 'myth', share: 0.08, zh: '商业神话破题：用一个反常识的商业事实开场，点出外行在看什么、内行在看什么', en: 'The myth, broken: open on a business fact that defies expectation, and say what outsiders look at versus what insiders look at' },
      { key: 'evolution', share: 0.13, zh: '背景与演进：旧做法卡在哪里，新做法是怎么一步步长出来的', en: 'How we got here: where the old way got stuck, and how the new way grew out of it step by step' },
      { key: 'architecture', share: 0.22, zh: '全局架构：搭出整张图的骨架，自下而上或从左到右，每一层一句话', en: 'The whole architecture: build the skeleton of the board, bottom up or left to right, one sentence per layer' },
      { key: 'anatomy', share: 0.24, zh: '微观解剖：放大最关键的一块，拆开它的组件，再用一个业务例子把工作流走一遍', en: 'One part taken apart: zoom into the block that matters most, open up its components, then run one business example through the workflow' },
      { key: 'insight', share: 0.15, zh: '认知升华：把整张图收成一句能转述的框架金句，并点破一个最常见的误区', en: 'The idea that ties it together: fold the whole board into one sentence people can repeat, and break the most common misreading' },
      { key: 'build', share: 0.18, zh: '三步搭建与讲义转化：从哪个场景起步、谁牵头、第一步做到什么；再引导领取高清讲义或预约内训咨询（无预警收尾）', en: 'Three steps and the handout: which use case to start with, who owns it, what step one looks like; then point to the handout or the workshop (cold close)' },
    ],
    voice: {
      zh: [
        '人设：企业咨询顾问、内训导师，在白板或大屏前给老板和技术负责人上一堂公开课。有判断，讲过很多遍，不卖弄。',
        '全片只推演一张图：讲到哪一块才画出哪一块，先全局后局部，最后回到全局。旁白用指向性的话带观众看图（“先看最底下这一层”“中间这一块是重点”）。',
        '每一章用一个问题开场，以一句结论收住，再抛出下一章要回答的问题。',
        '讲组件固定三句：它管什么（人话）→ 它叫什么（术语）→ 没有它会怎样。一段只引入一个新术语。',
        '至少一处讲一线经验：做架构诊断或内训时看到的现象，用第一人称、有场景。没有素材时不带数字、不点名客户。',
        '核心认知是一句框架金句，全片说三次：开场预告，认知升华处点破，结尾回扣。',
        '讲课也用短句，每十二到十五秒一次转折，每一分钟回扣一次主线问题；不念定义，不堆名词。',
        '结尾把板书称为“讲义”或“架构图”，引导到评论区置顶领高清版，或私信预约企业内训与架构咨询；不出现任何结束预告词。',
      ],
      en: [
        'Persona: a management consultant and in-house trainer giving an open class to owners and tech leads at a whiteboard or a big screen. Has a view, has taught this many times, never shows off.',
        'The whole video builds one diagram: a block is drawn only when it is talked about, whole first, then one part, then back to the whole. The voice points ("start with the bottom layer", "this block in the middle is the one that matters").',
        'Every chapter opens on a question, closes on one conclusion, and hands over the question the next chapter answers.',
        'A component is always three sentences: what it does (plain words) → what it is called (the term) → what breaks without it. One new term per beat.',
        'At least one moment of first-hand practice: something seen while diagnosing an architecture or running a workshop, in the first person, as a scene. Without material, no numbers and no client names.',
        'The core insight is one framing sentence, said three times: promised in the opening, landed in the insight chapter, echoed in the close.',
        'A lecture still uses short sentences, a turn every ten to twelve seconds, and a return to the main question once a minute. No read-out definitions, no piles of nouns.',
        'The close calls the board "the handout" or "the diagram" and points to the high-resolution copy in the pinned comment, or to booking a workshop by direct message. No wrap-up phrase of any kind.',
      ],
    },
  },
  {
    id: 'tech_news',
    group: 'tech',
    needsReference: true,
    pace: { zh: 4.2, en: 2.5 },
    length: { min: 60, max: 120, default: 90 },
    name: { zh: '科技新闻内行解说风', en: 'Tech news, the insider read' },
    blurb: {
      zh: '反共识泼冷水 → 发生了什么 → 外行忽略的一个细节 → 生产环境印证 → 行动预判。事实和判断分开说，适合大模型、Agent 重磅发布和科技巨头动态。',
      en: 'Cold water on the consensus → what happened → the one detail outsiders miss → what it means in production → what to do next. Facts and judgment kept apart; for model and agent launches and big-tech moves.',
    },
    topics: {
      zh: ['大模型 / Agent 重磅发布解读', '某科技巨头突发收购 / 架构调整，内行怎么看'],
      en: ['A major model or agent launch, read by an insider', 'A tech giant\'s surprise acquisition or reorganisation: what it really means'],
    },
    stages: [
      { key: 'hook', share: 0.08, zh: '反共识泼冷水：和多数报道相反、且可以核实的一个判断或事实，开口第一句就说', en: 'Cold water: one verifiable fact or judgment that runs against most coverage, said in the first sentence' },
      { key: 'facts', share: 0.15, zh: '发生了什么：谁、什么时候、做了什么、关键数字；只陈述事实，并交代消息来源', en: 'What happened: who, when, what, and the key figure. Facts only, with where they come from' },
      { key: 'detail', share: 0.25, zh: '外行忽略的细节：抓住一个参数、条款或细节讲透，说清它为什么比标题重要（标明是判断）', en: 'The detail outsiders miss: one parameter, clause or detail explained fully, and why it matters more than the headline (flagged as a judgment)' },
      { key: 'field', share: 0.2, zh: '生产环境印证：这个细节放进真实业务意味着什么，用一线实测或体感来印证', en: 'What it means in production: what that detail does inside a real business, backed by a hands-on test or what practitioners see' },
      { key: 'watch', share: 0.22, zh: '行动预判：两到三类人现在该做什么，外加一个可验证的观察信号和一个明确标注的预测', en: 'What to do next: the move for two or three groups of people, plus one signal to watch and one clearly labelled prediction' },
      { key: 'cta', share: 0.1, zh: '收尾：一句定性金句 + 一个容易回答的评论区问题 + 下期预告（禁止“总结一下”）', en: 'Close: one line that sums up the read + a question that is easy to answer in the comments + next-episode hook (never "to sum up")' },
    ],
    voice: {
      zh: [
        '人设：在这个行业里做过事的内行，语气克制、有判断，像在给同行朋友讲门道，不是念新闻稿。',
        '事实和判断分开说。事实要带时间和来源（“官方公告里写的是…”“财报电话会上说…”）；自己的解读用“我的判断是”“我倾向于认为”引出；关于未来的说法必须说成预测。',
        '只用需求和参考资料里出现的事实。资料没给的时间、金额、人名、内幕一律不补；确实需要却缺失的信息，在 onScreenText 写“【待核实：…】”，旁白用定性的说法带过，并在 productionNotes 里列出所有待核实项。',
        '不替当事人说话：个人观点不能说成公司立场，引用要说清是谁说的；未经证实的消息要明说是传闻。',
        '钩子不超过二十个字，必须有一个数字或一个冲突。不用“震惊、炸裂、王炸、史诗级、颠覆、变天”这类词：标题党会拉低可信度。',
        '内行细节只选一个讲透：定价和计费方式、接口和许可条款、谁向谁汇报、发布的时间点、公告里没说的那句话。',
        '生产环境印证只讲需求里给出的实测和经历；没有实测时说成“按公开的参数推算”，并明说这是推断。讲影响时对着人说（“如果你是做…的”），每类人只给一个最要紧的动作。',
        '时间用资料里的具体日期，不要写“昨天”“刚刚”“今天凌晨”这类看到视频时已经过期的说法。',
      ],
      en: [
        'Persona: an insider who has worked in this industry. Measured, opinionated, explaining to a peer how to read the story; never reading out a press release.',
        'Keep fact and judgment apart. A fact comes with its date and source ("the announcement says…", "on the earnings call…"); your reading starts with "my read is" or "I think"; anything about the future is stated as a prediction.',
        'Use only facts found in the brief and the reference material. Never fill in a date, amount, name or inside detail that the material does not give. Where a needed fact is missing, write "[TO VERIFY: …]" in onScreenText, keep the spoken line qualitative, and list every item to verify in productionNotes.',
        'Do not speak for the people involved: one person\'s view is not the company\'s position, and every quote says who said it. An unconfirmed report is called a report.',
        'The hook is at most twelve words and carries a number or a conflict. No "shocking", "insane", "game over", "changes everything" or "revolutionary": clickbait lowers credibility.',
        'Pick one insider detail and explain it fully: pricing and billing, API and licence terms, who reports to whom, the timing of the release, the sentence the announcement left out.',
        'The production beat uses only tests and experience given in the brief; without a test, say "going by the published figures" and call it an inference. Address the impact to people ("if you build on…"), with the one move that matters most for each group.',
        'Use the dates given in the material. Never "yesterday", "just now" or "this morning": they are wrong by the time the video is watched.',
      ],
    },
  },
  {
    id: 'earnings',
    group: 'tech',
    needsReference: true,
    pace: { zh: 4.0, en: 2.4 },
    length: { min: 90, max: 180, default: 120 },
    name: { zh: '科技公司财报透视与商业拆解风', en: 'Earnings teardown and business model' },
    blurb: {
      zh: '揪出一组反常指标 → 拆这组指标 → 翻译成“客户在为什么买单” → 一线谈单体感共振 → 抄作业指南。从财报拆出一门生意怎么赚钱，不谈股价。',
      en: 'One odd set of numbers → what they are made of → what customers are really paying for → what we see in real deals → what to copy. Reads an earnings report for how the business makes money; no share-price talk.',
    },
    topics: {
      zh: ['从 Palantir / 英伟达 / 微软最新财报，看今年 B 端生意的真正赚钱逻辑'],
      en: ['What the latest Palantir, Nvidia and Microsoft earnings say about how B2B really makes money this year'],
    },
    stages: [
      { key: 'hook', share: 0.08, zh: '反常指标：财报里最反直觉的一组数字或反差，第一句就报出来', en: 'The odd numbers: the most counter-intuitive figure or contrast in the report, in the first sentence' },
      { key: 'numbers', share: 0.27, zh: '拆这组指标：钱从哪来、留下多少、还能赚多久，各用一个数说清，每个数都带口径', en: 'What they are made of: where the money comes from, how much is kept, how long it lasts; one number each, every number with its scope' },
      { key: 'buyers', share: 0.22, zh: '客户在为什么买单：把数字翻译成客户的购买理由，说出这门生意真正卖的是什么（标明是判断）', en: 'What customers are paying for: turn the numbers into the buyer\'s reason, and say what this business really sells (flagged as a judgment)' },
      { key: 'field', share: 0.17, zh: '一线体感共振：我们在谈单或交付中看到的、能印证这个判断的现象', en: 'What we see in real deals: something from selling or delivering that backs this reading' },
      { key: 'playbook', share: 0.18, zh: '抄作业指南：做 B 端生意的人可以照着学的一到两件事，和必须避开的一件事', en: 'What to copy: one or two things a B2B operator can take from this, and one thing to avoid' },
      { key: 'cta', share: 0.08, zh: '收尾：一句金句 + 具象转发指令 + 下期预告（不谈股价，不给买卖建议）', en: 'Close: one quotable line + a specific share instruction + next-episode hook (no share-price talk, no buy or sell advice)' },
    ],
    voice: {
      zh: [
        '人设：看得懂报表、也做过生意的分析者，冷静、讲逻辑，像在给做 B 端业务的同行拆一门生意，不是荐股。',
        '每个数字都要有口径：哪家公司、哪个财季或财年、同比还是环比、什么货币。只用需求和参考资料里出现的数字，不要凭记忆补财报数据；资料里没有的，在 onScreenText 写“【待补：某指标】”，旁白只讲定性结论，并在 productionNotes 里列出所有待补数字。',
        '旁白只念骨架：每一段最多一个关键数字，用好念的约数（“接近四十亿美元”“涨了三成多”）；精确数字、口径和来源（如“来源：公司 2026 财年第二季度财报”）放在 onScreenText。',
        '数字要有参照才有意义：和去年同期比、和自己的另一块业务比、和同行比；参照数字同样必须来自资料。',
        '会计和行业术语第一次出现时用一句大白话解释，例如把“剩余履约义务”说成“已经签了合同、还没确认成收入的钱”。',
        '事实和判断分开：“财报显示…”是事实，“我的判断是…”是观点；“客户在为什么买单”和护城河的结论属于判断。',
        '一线体感只讲需求里给出的谈单和交付经历；没有素材时讲业内常见的采购现象，不带数字、不点名客户。',
        '不预测股价，不说“值得买”“可以上车”，不给任何买卖建议；讲的是生意怎么赚钱。在 productionNotes 里加一条“本视频不构成投资建议”。',
      ],
      en: [
        'Persona: an analyst who can read the statements and has run a business. Calm and logical, taking a business apart for peers who sell to companies; never a stock tip.',
        'Every figure has its scope: which company, which quarter or fiscal year, year-on-year or quarter-on-quarter, which currency. Use only figures found in the brief and the reference material and never fill in earnings data from memory. Where a figure is missing, write "[TO ADD: metric]" in onScreenText, keep the spoken line qualitative, and list every missing figure in productionNotes.',
        'The voice carries the backbone only: at most one key figure per beat, rounded so it is easy to say ("nearly four billion dollars", "up by more than a third"). The exact figure, its scope and its source ("Source: company FY2026 Q2 results") go in onScreenText.',
        'A number means something only next to another: the same quarter last year, the company\'s other business, a peer. The comparison figure must come from the material too.',
        'Explain an accounting or industry term in one plain sentence the first time it appears, e.g. remaining performance obligations as "money already under contract that has not been counted as revenue yet".',
        'Keep fact and judgment apart: "the report shows…" is fact, "my read is…" is opinion. What customers are paying for, and the moat, are judgment.',
        'The deal-floor beat uses only selling and delivery experience given in the brief; without any, describe a buying pattern the industry knows, with no numbers and no client names.',
        'No share-price prediction, no "worth buying" or "time to get in", no buy or sell advice of any kind; this is about how the business makes money. Add the line "This video is not investment advice" to productionNotes.',
      ],
    },
  },
];

export function getFramework(id) {
  return FRAMEWORKS.find((f) => f.id === id);
}
