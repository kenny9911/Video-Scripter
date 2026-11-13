// Platform profiles. Each profile is injected into the system prompt, so the notes are
// written as direct guidance to the script writer. Edit freely: no code depends on the wording.
// `banned` lists words the narration check (src/agent/review.mjs) flags as an error on that platform.
// `post` is the platform's image post (图文): the picture sizes it takes (ids from POST_SIZES in src/post.mjs, the
// first is the default), its limits, and how one is written. A platform without `post` has no such format.
// The limits are the platforms' own where they publish them (小红书 title and body, TikTok and Instagram from
// their API references); 视频号 and the 抖音 title are what creators report, so they are kept on the safe side.

export const PLATFORMS = [
  {
    id: 'wechat_channels',
    name: '视频号',
    nameEn: 'WeChat Channels',
    lang: 'zh',
    defaultDuration: 90,
    durations: [30, 60, 90, 120, 180, 240, 360],
    notes: [
      '分发靠双引擎：完播率和熟人社交裂变。朋友点赞、转发到高管群、研发群和朋友圈是主要流量来源，所以内容要“值得转给某个具体的人”：要么是老板会转给团队对齐认知的学习教材，要么是可以抄作业的图、清单和步骤。',
      '受众偏成熟（老板、高管、技术负责人），语气要稳、有信息密度，像懂行的顾问在讲，不要网感过重的梗和夸张语气。',
      '前3秒必须给出反常识观点或明确的损失/痛点；紧接着用一句话预告“看完能得到什么”，锁住完播。之后每12–15秒安排一次听觉或视觉上的转折。',
      '3分钟以上的深度课靠一张架构图的渐进推演和章节来留人：每章30–60秒，只讲图上的一块。',
      '结尾不要说“总结一下”“今天就到这里”。用一句金句收住，再给一个具象的转发指令（转给谁）和下期预告。',
    ],
    publish: [
      'titles：3组高反差的封面标题备选，单行不超过12个汉字，直击痛点或反常识认知。',
      'description：左下角的发布文案。痛点提问 + 3点干货 + 一句点睛总结 + 定向转发引导 + 下期预告。',
      'shareLine：朋友圈和高管群的转发导语，站在转发者的立场写一两句，说清为什么值得同事看。',
      'hashtags：话题标签6–8个，垂直精准，格式 #标签。',
      'pinnedComment：评论区置顶的获客钩子，引导回复【关键词】领取高清讲义 PDF，或私信预约企业内训、架构咨询。',
      'chapters：3分钟以上的视频给出带时间戳的章节进度条，每章标题不超过10个汉字；更短的视频留空数组。',
    ],
    post: {
      name: '图文',
      nameEn: 'Image post',
      sizes: ['3:4', '1:1'],
      maxImages: 18,
      titleMax: 20,
      bodyMax: 1000,
      hashtagMax: 8,
      notes: [
        '视频号图文靠熟人转发：这组图要像一份可以转给同事的学习材料，一张图一个结论，最后一张是可以抄作业的清单。',
        '受众偏成熟：语气稳，信息密度高，像懂行的顾问写的要点页，不用网感过重的梗和夸张语气。',
        '正文说清这组图值得谁看，补充图上放不下的背景和判断，结尾给一个具象的转发指令（转给谁）。',
      ],
    },
    compliance: [
      '避免广告法极限词（最、第一、唯一、100%、国家级等）和无法证实的功效/收益承诺。',
      '口播和字幕里不出现“加微信”“微信号”“转账”；引流统一导向“评论区置顶”或“私信”。',
      '不要引导用户去其他平台，不要出现外部链接。',
    ],
    // Words the narration check refuses outright: the platform throttles videos that say them.
    banned: ['加微信', '加我微信', '微信号', '转账', 'V信', '加V'],
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
    post: {
      name: '图文',
      nameEn: 'Image post',
      sizes: ['3:4', '9:16'],
      maxImages: 30,
      titleMax: 30,
      bodyMax: 1000,
      hashtagMax: 5,
      notes: [
        '抖音图文是滑着看的，第一张决定用户滑不滑下一张：封面大字要有冲突、反差或直接的利益点。',
        '节奏比小红书更快：每张图一句话讲一个点，字要大，字要少，看一眼就懂。',
        '正文就是一句口语化的标题文案，结尾抛一个容易回答的问题带评论。',
      ],
    },
    compliance: [
      '避免广告法极限词和医疗、金融类的绝对化承诺。',
      '不要提及微信、其他平台名称或任何站外导流信息。',
    ],
    banned: ['加微信', '加我微信', '微信号', 'V信', '加V'],
  },
  {
    id: 'xiaohongshu',
    name: '小红书',
    nameEn: 'Xiaohongshu / RedNote',
    lang: 'zh',
    defaultDuration: 60,
    durations: [15, 30, 45, 60, 90, 120, 180],
    notes: [
      '小红书是“搜索 + 推荐”双入口的种草社区：一半流量来自用户主动搜索，所以选题要对准一个具体的搜索词（人群 + 场景 + 问题），并在前5秒把这个关键词说出口、打在画面上。',
      '封面和标题决定点击，收藏和评论决定后续分发。内容要“值得收藏”：清单、步骤、对比、避坑、可以照着做的模板，观众看完会想存下来以后用。',
      '人设是真实的过来人，不是品牌官号：第一人称，讲自己的真实经历、踩过的坑和具体细节，语气像在跟朋友分享。硬广口吻、夸张话术和说教感都会掉点击。',
      '开头3秒直接给结果或反差（“我用这个方法三个月……”“千万别再这样……”），不要寒暄和自我介绍。之后按“一个要点一个画面”推进，每个要点配一条大字花字，方便静音观看和截图。',
      '结尾给一句可以照着做的总结，再抛一个容易回答的问题带评论（“你们是怎么做的？”），不要生硬地索要点赞收藏关注。',
    ],
    publish: [
      'titles：3个笔记标题备选，每个不超过20个字（平台上限），带核心搜索关键词，用具体数字、人群或反差制造点击，可以带1个表情符号，不做标题党。',
      'coverText：封面大字，不超过12个字，分两行也能读清；封面按3:4竖版构图，主体居中，字不贴边。',
      'description：笔记正文，300–600字，不超过1000字（平台上限）。第一行是钩子并带关键词；中间分点展开，每点一行，用表情符号或序号做项目符号；结尾一句互动提问。口语化，像本人写的笔记，不是视频逐字稿。',
      'hashtags：话题标签5–8个（平台上限10个），格式 #标签：1–2个大类目词 + 2–3个精准长尾词 + 1–2个人群或场景词，放在正文末尾。',
      'pinnedComment：置顶评论，补充一个正片没讲的细节或资源获取方式，引导在评论区提问。',
    ],
    post: {
      name: '图文笔记',
      nameEn: 'Image note',
      sizes: ['3:4', '1:1'],
      maxImages: 18,
      titleMax: 20,
      bodyMax: 1000,
      hashtagMax: 10,
      notes: [
        '图文笔记靠封面和标题拿点击，靠收藏拿后续分发：封面一句话说清“谁、在什么场景、能得到什么”，并带上核心搜索关键词。',
        '每张图只讲一个要点，像一页可以单独截图保存的清单；最后一张是可以照着做的总结。',
        '正文不是图上文字的重复：第一行是钩子并带关键词，中间补充图上放不下的细节和亲身经历，分点成行，结尾一句互动提问。',
        '第一人称，真实过来人的口吻，像在跟朋友分享；正文可以用表情符号做项目符号，不要硬广口吻和说教感。',
      ],
    },
    compliance: [
      '避免广告法极限词（最、第一、唯一、100%、全网最低等）和无法证实的功效承诺；护肤、保健、医疗、金融类内容不做疗效和收益保证，不用“治愈”“根治”“稳赚”这类词。',
      '不做站外导流：口播、字幕和正文里不出现微信号、手机号、二维码、外部链接和其他平台名称；引导统一放在评论区或站内私信。',
      '有品牌合作或利益关系的内容要如实说明（平台要求通过官方渠道报备），不要把广告伪装成素人体验。',
      '不诱导互动：不用“点赞收藏才能看到”“不关注就亏了”这类话术，不承诺点赞抽奖之外的利益交换。',
    ],
    banned: ['加微信', '加我微信', '微信号', 'V信', '加V', '薇信'],
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
    post: {
      name: 'Photo Mode',
      nameEn: 'Photo Mode',
      sizes: ['9:16', '3:4'],
      maxImages: 35,
      titleMax: 90,
      bodyMax: 4000,
      hashtagMax: 5,
      notes: [
        'Photo Mode is swiped fast. Slide 1 is the hook and has to make sense on its own: a bold claim, a visible result or an open loop.',
        'One idea per slide, large text, few words. The last slide pays off the hook and asks a specific question.',
        'The caption opens with the hook and holds the keywords people would search for. Keep it short.',
      ],
    },
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
    post: {
      name: 'Carousel',
      nameEn: 'Carousel',
      sizes: ['4:5', '3:4', '1:1'],
      maxImages: 20,
      titleMax: 0, // a carousel has a caption and no title
      bodyMax: 2200,
      hashtagMax: 5,
      fileType: 'jpg', // the publishing API takes JPEG only
      notes: [
        'The first slide is the only one seen in the feed: it carries the hook as a headline of under eight words.',
        'Make slide 2 strong enough to open on as well, and give every slide one idea that reads with no caption.',
        'End on a summary slide worth saving, with a share prompt that names who to send it to.',
        'Caption: a first line that works as a hook on its own, two to four short value lines, then one call to action.',
      ],
    },
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
