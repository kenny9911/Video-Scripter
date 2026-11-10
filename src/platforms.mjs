// Platform profiles. Each profile is injected into the system prompt, so the notes are
// written as direct guidance to the script writer. Edit freely: no code depends on the wording.

export const PLATFORMS = [
  {
    id: 'wechat_channels',
    name: '视频号',
    nameEn: 'WeChat Channels',
    lang: 'zh',
    defaultDuration: 90,
    durations: [30, 60, 90, 120],
    notes: [
      '分发靠社交关系链：朋友点赞、转发到群和朋友圈是主要流量来源，所以内容要“值得转给某个具体的人”。',
      '受众偏成熟（职场人、管理者、企业主），语气要稳、有信息密度，像懂行的朋友在讲，不要网感过重的梗和夸张语气。',
      '前3秒必须给出反常识观点或明确的损失/痛点；紧接着用一句话预告“看完能得到什么”，锁住完播。',
      '结尾不要说“总结一下”“今天就到这里”。用一句金句收住，再给一个具象的转发指令（转给谁）和下期预告。',
    ],
    publish: [
      '短标题3个备选，每个6–16个汉字，直击痛点或反常识认知。',
      '视频描述：痛点提问 + 3点干货 + 一句点睛总结 + 定向转发引导 + 下期预告。',
      '话题标签6–8个，垂直精准，格式 #标签。',
      '置顶评论：设计一个“评论区扣【关键词】领资料”式的留资钩子。',
    ],
    compliance: [
      '避免广告法极限词（最、第一、唯一、100%、国家级等）和无法证实的功效/收益承诺。',
      '不要引导用户去其他平台，不要出现外部链接。',
    ],
  },
  {
    id: 'douyin',
    name: '抖音',
    nameEn: 'Douyin',
    lang: 'zh',
    defaultDuration: 45,
    durations: [15, 30, 45, 60, 90],
    notes: [
      '算法分发，前3秒的停留和整体完播率决定流量。第一句话就要有冲突、反差或直接的利益点，不要铺垫和自我介绍。',
      '节奏快：每2–4秒要有一个新信息点或画面变化；句子短，口语化，一句话只说一件事。',
      '中段至少埋一个“钩子回收”或反转，避免中途划走；可以用“但是”“结果你猜怎么着”这类转折推进。',
      '结尾用互动提问或选择题引导评论，再提示关注看下一期；结尾要短，说完就停。',
    ],
    publish: [
      '标题文案3个备选，每个不超过30个汉字，口语化，带悬念或利益点。',
      '话题标签3–5个：1–2个大流量泛标签 + 2–3个垂直标签。',
      '视频描述就是标题文案后接话题标签，保持简短。',
      '置顶评论：抛一个容易回答的问题，或补充一个正片没讲的细节来带评论。',
    ],
    compliance: [
      '避免广告法极限词和医疗、金融类的绝对化承诺。',
      '不要提及微信、其他平台名称或任何站外导流信息。',
    ],
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    nameEn: 'TikTok',
    lang: 'en',
    defaultDuration: 30,
    durations: [15, 30, 45, 60, 90],
    notes: [
      'Hook lands in the first 1–2 seconds: a bold claim, a visible result, or an open loop. No greeting, no "hey guys", no intro.',
      'Sound native to the platform: first person, conversational, contractions, short sentences. It should feel like a person talking, not an ad read.',
      'Change something every 2–3 seconds (cut, angle, on-screen text, prop) and place a pattern interrupt around the midpoint.',
      'Pay off the hook, then end on a comment prompt or a line that loops back into the opening. Keep the outro to one sentence.',
    ],
    publish: [
      '3 caption options, each under 150 characters, opening with the hook and containing the keywords people would search for.',
      '3–5 hashtags mixing one broad tag with niche tags. No walls of hashtags.',
      'The description is the caption plus hashtags.',
      'Pinned comment: ask a specific, easy-to-answer question, or add one detail the video left out.',
    ],
    compliance: [
      'No medical, financial or income guarantees. No "link in bio" unless the brief asks for it.',
      'Do not reference a specific trending sound or copyrighted song by name; describe the music mood instead.',
    ],
  },
  {
    id: 'instagram',
    name: 'Instagram Reels',
    nameEn: 'Instagram Reels',
    lang: 'en',
    defaultDuration: 30,
    durations: [15, 30, 45, 60, 90],
    notes: [
      'Many viewers watch muted: every key line needs matching on-screen text, and the first frame must make sense with the sound off.',
      'Visuals carry more weight here than elsewhere. Specify clean, well-lit, aesthetically consistent shots and a clear cover frame.',
      'Shares and saves are the goal. Give the viewer something worth sending to a friend or saving for later (a checklist, a template, a reframing).',
      'Close with a save or share prompt that names who to send it to. Keep the tone warm and polished rather than loud.',
    ],
    publish: [
      '3 cover-headline options, each under 8 words.',
      'Caption: a first line that works as a hook on its own, 2–4 short value lines, then one call to action.',
      '3–5 targeted hashtags at the end of the caption.',
      'Pinned comment: a question that invites people to share their own version or situation.',
    ],
    compliance: [
      'No engagement bait that asks for likes or follows in exchange for nothing.',
      'No before/after health claims or guaranteed results.',
    ],
  },
  {
    id: 'youtube_shorts',
    name: 'YouTube Shorts',
    nameEn: 'YouTube Shorts',
    lang: 'en',
    defaultDuration: 45,
    durations: [30, 45, 60, 90, 180],
    notes: [
      'Viewers decide in the first second whether to swipe. Open on the most interesting moment or the result, then explain how you got there.',
      'Shorts are found through search and suggested feeds as well as the swipe feed, so say the topic keyword out loud early and put it on screen.',
      'Favor one clear idea delivered completely over several half-explained ones. Slightly more explanatory than TikTok is fine.',
      'Write the last line so it flows back into the first line (a loop), and point to a longer video or the channel instead of a hard sell.',
    ],
    publish: [
      '3 title options, each under 60 characters, with the main keyword near the front.',
      'Description: 1–2 sentences restating the value with keywords, then the call to action.',
      '3 hashtags, including #Shorts.',
      'Pinned comment: a question, or a pointer to the related long-form video.',
    ],
    compliance: [
      'No misleading titles: the title must be delivered on within the video.',
      'Describe music by mood only; do not name copyrighted tracks.',
    ],
  },
];

export function getPlatform(id) {
  return PLATFORMS.find((p) => p.id === id);
}
