// Script frameworks. `share` is each stage's portion of the total runtime; the prompt builder
// turns the shares into concrete second ranges for the chosen duration.

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
];

export function getFramework(id) {
  return FRAMEWORKS.find((f) => f.id === id);
}
