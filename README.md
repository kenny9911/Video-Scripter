# Video Scripter

**From one brief to a shoot-ready script for every platform you publish on.**

Video Scripter is a script studio for short social video. Describe the video once, pick your platforms, and get a separate script for each one, written for that platform's audience, pacing and publishing rules, with storyboard images and clips generated from the scene notes.

It works with the model provider you already use, runs on your own machine or on a host such as Vercel, and gives every user their own account, history and usage record.

[中文说明](README.zh-CN.md)

## Why Video Scripter

- **One brief, six platforms.** A 抖音 script and a YouTube Shorts script are different pieces of writing. Each platform gets its own script instead of one draft pasted everywhere.
- **Ready to shoot.** Every scene is timed and carries its voiceover, on-screen text, visual, camera and sound notes.
- **Ready to publish.** Titles, cover text, description, hashtags and a pinned comment come with every script.
- **A narration agent, not a one-shot prompt.** The spoken words are planned on a viewpoint card, written with the skills that fit the brief, then measured, reviewed and corrected before a script is built around them.
- **Your words, if you want.** Have the narration drafted first, paste your own, or rewrite any beat in the narration editor. The script is then built around it word for word.
- **Publish from the app.** Upload the video straight to your own YouTube channel after one Google sign-in, or send the image post or the video to Instagram, TikTok, LinkedIn and other channels through your own Postiz account: now, at a set time, or as a draft.
- **A finished video.** The script is voiced scene by scene and made into a captioned MP4 in your browser, cut to the voice.
- **Video or image post.** The same script becomes a set of picture cards with the text to post under them, for 小红书 图文, 抖音图文, TikTok Photo Mode and Instagram carousels, counted against each platform's limits.
- **Storyboards included.** Turn any scene into an image or clip in the video's aspect ratio (9:16, 16:9, 1:1, 3:4 or 4:3), in one of 74 visual styles.
- **The look picked for you.** Type a topic and the visual style is chosen from it, with the reason and a few alternatives. One click has the model choose instead.
- **A host who stays the same.** Put a digital presenter on screen, or two for a podcast conversation. Their look is written into the script once, a portrait is made from it, and every scene they are in is drawn from that portrait.
- **Your own material.** Upload notes, articles, product pictures and clips to your library once. Pick the ones a script is written from: documents are read as source material, and your pictures and clips go into the scenes that show them.
- **Any model.** Ten provider presets, from OpenAI and Anthropic to 通义千问, 豆包 and local Ollama, plus any OpenAI-compatible or Anthropic-compatible endpoint. Switch model per script.
- **Yours to keep.** Every script, image and clip is saved to your account and exports as one tidy `.zip`.
- **Built for a team.** Accounts with sign-up and log-in, an administrator who manages models and users, token and image usage per script and per user, and an activity log.

## Platforms

| Script language | Platform | Lengths (seconds) |
| --- | --- | --- |
| 中文 | 视频号 (WeChat Channels) | 30, 60, 90, 120 |
| 中文 | 抖音 (Douyin) | 15, 30, 45, 60, 90 |
| 中文 | 小红书 (Xiaohongshu) | 15, 30, 45, 60, 90, 120, 180 |
| English | TikTok | 15, 30, 45, 60, 90 |
| English | Instagram Reels | 15, 30, 45, 60, 90 |
| English | YouTube Shorts | 30, 45, 60, 90, 180 |

The script language follows the platform. The interface language is a separate choice (see [Interface](#interface)).

## Get started

Video Scripter needs Node.js 20 or newer.

```bash
npm install
```

```bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='choose-a-long-password' npm start
```

Open http://localhost:3789, click **Start writing**, and log in with that email and password. `ADMIN_EMAIL` and `ADMIN_PASSWORD` create the administrator the first time the server starts; after that they can be left out. Everyone else signs up from the log-in screen.

The app starts in demo mode, which returns placeholder text so you can explore the workflow without a model. As the administrator, click **LLM settings** to connect one. To put it online, see [Deploy on Vercel](#deploy-on-vercel).

## How it works

### 1. Write the brief

Only the topic is required. The rest sharpens the result.

| Field | What it does |
| --- | --- |
| Topic | What the video is about |
| Platforms | One script is written per platform you tick |
| Materials | Files from [your library](#your-library) that this script is written from: up to 8 documents, pictures and clips |
| Structure and Length | The story framework, or a narration style that also sets the voice and the pace, and the running time: Auto (the length the style is made for, otherwise the platform's usual one), one of the platform's lengths, or **Custom** for any length from 10 to 360 seconds |
| Visual style | One look, or two blended, for the scene notes and all generated media. Picked from the topic until you pick your own (see [Visual styles](#visual-styles)) |
| On-screen host | A digital presenter who is the same person in every scene, or two for a conversation (see [On-screen host](#on-screen-host)) |
| Key message, Audience, Tone | The one thing to remember, who it is for, and how it should sound |
| Brand or creator, Call to action | Who is speaking and what the viewer should do next |
| Your experience | What you have seen first-hand: a client situation, a mistake, a result. The narration tells it in your voice. Without it, the agent describes a common pattern with no numbers or client names and asks you to confirm or replace it |
| Reference material | Facts, quotes or an article. The model is told to use only figures and quotes found here or in the brief |
| Web | Reads the links in the brief and in its documents, and can search the web about the topic, before anything is written: see [The web: links and search](#the-web-links-and-search) |
| Voiceover is for text-to-speech | Spells out numbers and symbols so a TTS voice reads them correctly |
| Narration | **With script** writes the narration, then the script around it, without stopping. **Narration first** drafts the narration for you to edit. **My narration** opens the editor for your own text |
| Narration agent | On by default: the narration is planned, written and reviewed in steps (see [The narration agent](#the-narration-agent)). Untick it for a single quick pass |
| Written by | The gateway and model that writes this script |

### 2. Edit the narration (optional)

Choose **Narration first** or **My narration** under the brief to work on the spoken words before anything else is written. Each platform gets its own narration editor:

- **One beat per stage.** A drafted narration has one beat for each stage of the story line. Every beat shows what it has to do, its estimated time code, and its length against the room that stage has.
- **A length meter.** Characters (Chinese) or words (English) against the budget for the length you asked for, and how long the video will run. Keep a longer narration and the video gets longer; **Fit the length** brings it back.
- **Checks.** The narration is measured as you type: length against the budget, sentences too long to say in one breath, greetings and wrap-up phrases, words the platform throttles, names from the topic that are never spoken, stretches with no turn, and the balance of the three layers. Each finding sits under the beat it belongs to.
- **The viewpoint card.** What the agent decided the video says: who is speaking, the core insight and the belief it overturns, the insider points, the first-hand experience, the names that must be spoken, and what to confirm before you record.
- **Refine.** On one beat or on the whole narration: fit the length, more spoken, punchier, plainer words, ready for text-to-speech, reshape to the structure, or your own instruction. **Agent review** runs the agent's review step on the narration as it stands, your own text included. Each rewrite can be undone.
- **Your own text.** Paste it into an empty editor or with **Paste narration**. Blank lines separate beats; without blank lines, each line is a beat.
- **Beats.** Add, delete and reorder them. The story line stays visible as a reference.

**Generate the script** builds the scenes, visuals and publishing package around the narration exactly as it stands. The model may only add stress and pause marks; if it changes a word anyway, your text is put back and the script says so. **Edit narration** on a finished script opens the editor on its narration, to change it and build a new script. A narration that is not a script yet is kept in the browser, so a reload does not lose it.

### 3. Review the script

Each platform opens in its own tab, and the script streams in as it is written. A script contains:

- **Three hook options** to choose from for the opening
- **A timed scene list**, each scene with voiceover, on-screen text, visual, camera and sound
- **A voiceover-only view**, for recording or pasting into a TTS tool
- **A publishing package**: titles, cover text, description, a line for sharing, hashtags, a pinned comment and, from three minutes up, chapters with timestamps
- **The viewpoint card** the narration was written to, when the agent wrote it
- **A whiteboard blueprint**, when the style teaches a structure: the board or slide the video builds, as a plain-text diagram

**Regenerate** rewrites a script. **Copy Markdown** and **Copy voiceover** put it on the clipboard.

### 4. Generate the visuals

Once the gateway in use has an image or video model, every scene gets **Generate image** and **Generate video** buttons that turn its Visual and Camera notes into a frame or clip in the **Aspect ratio** chosen in the brief: 9:16 vertical (the default), 16:9 landscape, 1:1 square, 3:4 portrait or 4:3 standard. The Size in the image and video settings is entered for vertical video and is turned to match; its edges are not rescaled, so 3:4 and 4:3 use the model's nearest size. Tick **Also generate an image for every scene** in the brief to have the images made automatically when the script is finished.

With pictures or clips in [your library](#your-library), every scene also has **From library**: use one of your own files as the scene's picture or clip as it is, or have a new image drawn from one of your pictures together with what the scene says.

### 5. Export

**Download .zip** packs the script, the voiceover and every generated image and clip into one archive, named and numbered by scene (see [Your work](#your-work)).

## Image posts

Most of these platforms publish a second kind of post besides video: a set of swipeable picture cards with a short text under them (小红书 图文笔记, 抖音图文, 视频号图文, TikTok Photo Mode, an Instagram carousel). A finished script has an **Image post** tab next to **Video script** that turns it into one: the same idea and the same facts, rewritten to be read instead of heard.

**Write the image post** has the model in use write six to nine cards and the text of the post: a cover that carries the hook, one idea per card, at most one quote, and a summary card worth saving. Say what should be different ("for beginners", "a bolder cover") and write it again as often as you like. In demo mode the post is drafted from the script's own on-screen text, with no model.

| Platform | Format | Shapes (first is the default) | Title | Text | Hashtags | File |
| --- | --- | --- | --- | --- | --- | --- |
| 小红书 | 图文笔记 | 3:4 (1080×1440), 1:1 | 20 characters | 1,000 | 10 | PNG |
| 抖音 | 图文 | 3:4, 9:16 | 30 | 1,000 | 5 | PNG |
| 视频号 | 图文 | 3:4, 1:1 | 20 | 1,000 | 8 | PNG |
| TikTok | Photo Mode | 9:16 (1080×1920), 3:4 | 90 | 4,000 | 5 | PNG |
| Instagram | Carousel | 4:5 (1080×1350), 3:4, 1:1 | none | 2,200 | 5 | JPEG |

YouTube Shorts has no such format. The 小红书, TikTok and Instagram limits are the platforms' own; the 视频号 limits and the 抖音 title are what creators report, kept on the safe side.

- **The cards are drawn in your browser**, at the size the platform takes, so what you see is the picture you download. Every word can be changed and the card redraws as you type; wrap a phrase in `** **` to mark it. Type shrinks to fit and a card says so when it holds more text than it can show.
- **Six themes**: cream paper, clean white, dark, bold colour, soft gradient and notebook. A line at the foot of every card can carry your name, and the cover can sit on one of the script's generated images.
- **Counted against the platform.** The title, the text with its hashtags and the number of hashtags are counted as you type. Words the platform throttles are flagged.
- **Out of the app in one step.** **Download images (.zip)** gives the numbered pictures with the title and text in `post.txt`. On a phone, **Share to an app** hands the pictures to the platform's own app through the share sheet and copies the title and text, ready to paste.

The cards are set in the fonts of the device, so no font is downloaded; a card drawn on a Mac and on a Windows PC uses each one's own Chinese typeface. Nothing is posted for you: the app has no access to your accounts on these platforms.

## Chat

**Chat** in the top bar opens a page of its own (`chat.html`): a conversation with the model, like the chat apps you know, for everything around a script. Ideas, hooks, titles, a post from your notes, a translation, a piece of code.

- **Who answers.** A prompt goes to one of four places, picked under the box. **Assistant** is the model, with the skills you chose; ask it for a picture or a clip and it makes one in the middle of its reply. **Narration agent** is the agent described below, asked from the conversation: give it the topic (and the platform and the length if you like, "90 秒的视频号视频：…") and it plans the viewpoint card, writes the narration and reviews it, showing each step. **Image** and **Video** send the prompt straight to the image or the video model, in the shape and length you pick.
- **Pick the model.** The chip at the top lists every model that is enabled on every saved gateway. The choice is yours and is kept with the conversation, so one chat can run on a fast model and another on a strong one. It also says which models draw the pictures and make the clips.
- **Replies are rendered.** Headings, lists, tables, quotes, links, task lists and code blocks with colouring and a copy button. A picture opens large when clicked; a clip plays in place and takes a few minutes, during which you can keep working. A picture or a clip that failed can be made again on its own.
- **History.** Every conversation is saved as it is written and listed in the sidebar by day. Search looks through titles and messages. Rename one, download it as Markdown, or delete it with the pictures and clips made in it. A reply that was stopped, or that failed half-way, keeps what was written.
- **Edit and answer again.** Change a prompt you sent and everything after it is replaced; or have the last prompt answered again, by another model if you switch first.
- **Canvas.** **Canvas** under a reply opens it beside the conversation as a document: a page with its title, laid out to be read. Switch to **Markdown** to edit the text and save it back to the conversation, copy it, download it as a `.md` file, or print it (which is also how it becomes a PDF). The canvas follows a reply while it is being written, and can take the full width.
- **The web.** A link in a prompt is read before the model answers, and **Web** under the box has every prompt searched for too; the reply lists what it read under **From the web**. See [The web: links and search](#the-web-links-and-search).
- **Skills.** A skill is a set of instructions you write once: your house style, how a product page is laid out, what a weekly report has to cover. Create them under **Skills**, with a name, when to use it, and the instructions in Markdown (a whole `SKILL.md` file can be pasted). Pick up to eight for a conversation, from the **Skills** button or by typing `/` in the box; the assistant follows them, the narration agent reads them at every step, and each reply says which skills it was written with. The app's built-in playbooks can be picked the same way.

Conversations are private: nobody else can open one, an administrator included. Usage is recorded like every other model call.

The assistant makes pictures and clips by writing a small fenced block in its reply, which the app reads once the reply is whole. That needs nothing from the provider beyond text in and text out, so it works with every model the gateway reaches.

## Video

A finished script also has a **Video** tab. It turns the script into a finished MP4: the voiceover spoken by a text-to-speech voice, every scene on screen with its on-screen text, and the voiceover as captions in time with the voice.

1. **Voice.** Pick a voice and a speed, then **Voice the script**. Each scene is spoken on its own, so the video is cut to the voice: a scene lasts exactly as long as its sound, with a breath after it. In a two-host script every line is said in its speaker's voice. The recordings are kept with the script. Under **Listen scene by scene** you can play each scene and, where a name or a number comes out wrong, write the line the way it should be said and voice that one scene again; the captions keep the script's own words.
2. **Look and sound.** A scene with a clip (generated, or your own from the library) plays it as moving footage, from the start of the scene, holding its last frame if the voice runs longer. A scene with a picture shows it, drifting slowly closer; a scene with neither shows its on-screen text on the theme you pick. The slider under the preview scrubs through the whole video before anything is encoded. Captions and the "AI-generated" corner label can be switched off. **Music under the voice** adds a bed that steps back while the voice speaks: one of two built-in beds synthesised on your device, which nobody else owns, or an audio file of your own.
3. **Video.** **Make the video** draws every frame and encodes the file in your browser: H.264 with AAC sound, 30 frames a second, in the script's aspect ratio (1080×1920 for 9:16, 1920×1080 for 16:9, 1080×1080, 1080×1440 or 1440×1080). An 80-second video takes about 12 seconds on a recent laptop. **Download .mp4** saves it; on a phone, **Share to an app** hands it to a platform's app. **Cover (.png)** draws the cover text at the size of the video, and **Subtitles (.srt)** gives the captions with their times for a platform's own subtitles or an editor.

The file is made on your device and is not uploaded or kept on the server, so download it before you leave the page; the voice is kept, so making it again is quick. It needs a browser with WebCodecs: a current Chrome, Edge or Safari.

### Connect a voice

An administrator connects one voice provider for everyone under **Video → Voice settings**. **Hear it** plays a sentence with the settings in the form before they are saved.

| Provider | What to enter |
| --- | --- |
| 火山引擎 豆包语音 (Seed-TTS) | APP ID and Access Token from the 豆包语音 console, a resource id (`seed-tts-2.0`) and a speaker id as the voice |
| OpenAI-compatible | The base URL and key of any service with a `/audio/speech` endpoint that can answer with WAV, a model and a voice name |

The key stays on the server, and members only see which voices they can pick. With no provider connected, demo mode stands a placeholder tone in for the voice so the rest can be tried.

What it does not do yet: sound effects, lip-synced hosts, and word-exact caption timing (captions are spread across each scene by length).

## Publishing

The **Image post** and **Video** tabs end in a **Publish** section. There are two ways out, and they sit side by side.

### YouTube, directly

A video can go straight to your own YouTube channel. **Connect YouTube** opens Google's sign-in in a small window; you allow uploads to your channel, and from then on **Upload to YouTube** sends the video you just made, with a title you can change, the script's description and hashtags, who can see it (everyone, people with the link, or only you), and the declaration that it contains synthetic media. A vertical video of up to three minutes is a Short. The link to the video is shown when it is up.

- The app asks for one permission, uploading videos. It cannot read your channel, your videos or anything else in your account. **Disconnect YouTube** forgets the connection here and withdraws it at Google.
- The file goes from your browser through the server to YouTube in pieces; your Google token stays on the server.
- **For the administrator.** This needs one Google OAuth client for the site: in Google Cloud, switch on the YouTube Data API v3, create an OAuth client ID of type *Web application*, and add the redirect address the app shows under **Publish → Set up YouTube sign-in**. Enter the client ID and secret there, or set `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`. Until Google has verified the app, only the test users listed on its consent screen can connect, and their connection lapses after a week.

### Other channels, through Postiz

[Postiz](https://postiz.com) is a scheduler that posts to YouTube, Instagram, TikTok, LinkedIn, X and more from one account. Through it, Video Scripter needs no developer app at any of those platforms: Postiz has them. Each person uses their own Postiz account.

1. **Connect once.** In Postiz, connect the channels you post to and create an API key under Settings. Paste the key into **Publish**. It is checked against Postiz, kept on the server and never shown again; every person connects their own.
2. **Pick the channels.** The ones your Postiz account has are listed; the one that matches the script's platform is ticked for you. YouTube is offered for videos only.
3. **Choose when.** Publish now, at a time you choose, or keep it as a draft in Postiz to review there.

An image post goes out as JPEG pictures in card order with its title and text; a video as the MP4 you just made, with the script's description and hashtags. Each platform is told what it needs: a YouTube title, tags and who can see it, a TikTok privacy level and its "made with AI" flag, a LinkedIn carousel for pictures. The files pass from your browser through the server to your Postiz media library, a video in pieces.

Good to know:

- 小红书, 抖音 and 视频号 let no outside service post for a person, so they are not among Postiz's channels. For those, use **Download** and, on a phone, **Share to an app**.
- What is published counts against your Postiz plan, and each platform's own rules and review still apply. Postiz shows whether each channel took the post.
- A deployment that hosts its own Postiz points the app at it with `POSTIZ_API_URL`.

## The narration agent

A single prompt writes a narration that reads like any other. The agent writes one the way a writing team does, in steps, each with the playbooks that apply:

1. **Pick the skills.** From the platform, the language, the style, the length and what the brief mentions.
2. **Plan and write.** First the viewpoint card: who is speaking, the one idea the viewer leaves with and the belief it overturns, the insider points, the first-hand experience, the names that must be spoken. Then the narration, written to that card, one beat per stage.
3. **Measure, review and correct.** The draft is measured in code, because a model cannot count its own characters or notice the name it dropped. The findings go to an editor step with the same skills and the card; it says what is wrong and returns the corrected narration. An edit that measures worse than the draft is not taken.

The card follows the 3 + 3 + 4 rule for commentary: about 30% insider explanation, 30% first-hand experience and 40% core insight, so a technical topic never comes out as an encyclopedia entry or a news read. The editor shows the measured balance.

It needs nothing from the provider beyond text in and text out, so it runs on every model the gateway reaches, and in demo mode. Planning and writing share one model call and the review is a second request: a model that reasons for minutes per call never has one request carry two of them.

### Skills

A skill is a Markdown playbook in `skills/<name>/SKILL.md`. Its header says when it applies and which steps read it. To teach the agent something new, add a folder; no code changes are needed.

| Skill | Applies to | What it holds |
| --- | --- | --- |
| `spoken-delivery-zh` | Chinese narration | Writing for the ear: 14–20 characters a breath, names said out loud, no greeting, no wrap-up phrase |
| `spoken-delivery-en` | English narration | The same for English: short sentences, one idea each, a turn every few seconds |
| `retention-rhythm` | Chinese narration | The first 3 seconds, the reason to stay, a turn every 12–15 seconds, chapters for long lectures, the cold close |
| `viewpoint-card` | Chinese narration | The 3 + 3 + 4 rule and how to fill in and check the card |
| `wechat-channels-growth` | 视频号 | Completion and social sharing, words that get a video throttled, the two compliant ways to capture leads, the publishing package |
| `enterprise-ai-ontology` | Briefs that mention Palantir, Ontology, agents, enterprise AI… | The four-layer architecture, how an ontology is built (objects, links, state, events, logic, actions, write-back) and the "three brains" model |
| `consultant-whiteboard-lecture` | The whiteboard lecture style | One diagram built step by step, chapters, pointing language, the handout |
| `honest-sourcing` | Everything | Fact, judgment and experience kept apart; no invented numbers, clients or quotes |

```
---
name: my-domain
title-en: My domain knowledge
description: one sentence on what it is for
lang: zh                     # optional conditions: lang, platforms, frameworks, groups, keywords, min-duration
keywords: Kubernetes, 容器
steps: plan, write, review   # plan, write, review (the narration) and script (visuals and the publishing package)
---
The playbook, in Markdown.
```

## Script structures

Eighteen frameworks set the story arc and how the running time is divided between its stages. Six are general structures. Twelve are narration styles, which also set how the narration sounds, how fast it is spoken and the length it is made for.

| Structure | Arc | Best for |
| --- | --- | --- |
| Golden retention | Hook, suspense anchor, three value waves, structured wrap, cold close | Business, tech and insight content |
| Problem – Agitate – Solve | Name the pain, raise the stakes, deliver the fix | Services, courses and tools |
| Story with a turn | Start at the conflict, tell a short story with a turn | Personal brands, founders and case studies |
| Listicle | "3 things…", strongest item last | Tips, mistakes and round-ups |
| How-to tutorial | Show the result first, then teach the steps | Demos, software and skills |
| Product showcase | Scenario, reveal, proof, offer | Product, launch and review videos |

| General content style | Arc | Length and pace | Best for |
| --- | --- | --- | --- |
| Counter-intuitive hit, stop the loss | The loss, the real cause, three steps to stop it, who to send it to | 45–75 s, 4.5 chars/s | Correcting a costly move the viewer is making |
| Saying what they can't | A concrete clash, the unwritten rule, a way to see it, a line worth sharing | 45–60 s, 4.2 | Speaking for founders, executives and tech leads |
| Take-away toolkit | The result, a tease for step three, steps one to three, the template | 60–100 s, 4.0 | Procedures, checklists and worked cases |
| A quiet story | A real detail, how it went, the turn, a line left open | 45–75 s, 3.5 | Founder reflections and delivery retrospectives |

| Tech, business and consultant style | Arc | Length and pace | Best for |
| --- | --- | --- | --- |
| Hard tech, demystified (short) | A business pain asked, the plain-words analogy, what goes wrong in practice, three steps to deploy | 60–90 s, 4.3 | One technical idea, e.g. "What is an ontology?" |
| Consultant whiteboard lecture | A business myth broken, how we got here, the whole architecture, one part taken apart, the idea that ties it together, three steps and the handout | 3–6 min, 4.2 | A full teardown on one board: Palantir, Ontology, enterprise AI architecture |
| Tech news, the insider read | Cold water on the consensus, what happened, the detail outsiders miss, what it means in production, what to do next | 60–120 s, 4.2 | Model and agent launches, big-tech moves |
| Earnings teardown and business model | One odd set of numbers, what they are made of, what customers are paying for, what we see in real deals, what to copy | 90–180 s, 4.0 | How a company makes its money, read from its earnings |
| Tech explained from first principles (YouTube style) | A cold-open question, the promise, start from what you know, why the obvious way breaks, the key idea, one example run end to end, what it costs, zoom out | 2–6 min, 4.4 | Teaching how a technology works: transformers, chips, vector databases |
| Tech news rundown (YouTube weekly style) | The headline cold, the line-up, the lead story, story two, story three, quick hits, the thread that ties them | 90 s–4 min, 4.5 | Several stories in one briefing |

| Podcast and host format | Arc | Length and pace | Best for |
| --- | --- | --- | --- |
| Solo podcast | Cold open, what this episode is about, the story told straight, my take, what it means for you, a question to leave with | 90 s–6 min, 4.0 | Opinion, news analysis and shop talk in one voice |
| Two-host podcast | The best exchange as a cold open, the set-up, get it clear, push back, make it practical, one line to keep | 90 s–6 min, 4.3 | A host and a guest in conversation; every line is marked `A:` or `B:` |

Paces are Chinese characters per second; English is paced in proportion. A narration style adds its own writing rules to the prompt. The hard-tech style states the value before the mechanism, names each term once after saying it plainly, and carries one analogy through the whole video. The whiteboard lecture builds one diagram chapter by chapter and comes with a whiteboard blueprint and chapters. The news and earnings styles keep fact apart from judgment, give every figure its scope and source on screen, and make no share-price or investment calls. Both report facts, so paste the news or the figures under **Reference material**: where a fact is missing, the script leaves a marked gap (`[TO VERIFY: …]`, `[TO ADD: …]`) and lists it in the production notes instead of inventing it. The news rundown works the same way.

The first-principles style teaches the way the best YouTube explainers do: it starts from what the viewer already knows, pushes the obvious approach until it breaks, reaches the real idea one step at a time, carries one example through the whole video, and says what the technology costs. It comes with a whiteboard blueprint.

The two podcast formats are written for the ear: they work with your eyes closed. The solo format is one host talking to one listener. The two-host format is a conversation in which A asks, interrupts and restates for the listener and B answers with examples; each line starts with `A:` or `B:`, the labels stay in the narration editor, the script and `voiceover.txt`, and the narration checks flag a line nobody is named on. Choosing either format switches the [on-screen host](#on-screen-host) on.

## Visual styles

The **Visual style** picker offers 74 looks in eight groups.

| Group | Styles |
| --- | --- |
| Live action | Cinematic, documentary, phone-shot vlog, studio product, bright lifestyle, modern workplace, macro detail |
| Illustration | Flat vector, isometric, hand-drawn sketch, watercolour, Chinese ink, anime, comic pop, paper collage |
| 3D and stop motion | Stylised 3D, claymation, glossy 3D objects |
| Graphics and data | Motion infographic, minimal geometric, tech interface, screen recording, animated diagram, math animation, code on screen, explainer journalism |
| Presenting and launching | Consulting deck, boardroom briefing, whiteboard session, lightboard, professor's chalkboard, product walkthrough, launch keynote, launch film |
| Hosts and podcasts | Tech creator desk, podcast studio, two-host podcast, news desk, virtual studio |
| Bright and light | Bright and clean, bright tech, cream tones, Nordic light, pastel, dopamine brights, soft and airy, fresh green, summer sky, seaside holiday, golden hour, morning mist, soft glow |
| Era and mood | Ancient China, black-and-white classic, Art Deco, old Shanghai poster, mid-century modern, retro-futurism, retro film, 80s–90s nostalgia, Hong Kong 90s, VHS tape, pixel art, Y2K, vaporwave, neon night, cyberpunk, steampunk, wasteland, dark and moody, dark academia, cozy and warm, wabi-sabi, surreal dream |

Every group ends with **Custom…**: tick it and describe a look in your own words, up to 200 characters ("children's crayon drawing on warm paper"). A custom look is used like any listed style, alone or blended; one with nothing written is ignored.

Pick one, or two to blend. The first one picked leads, and a third pick replaces the oldest. The choice does two things:

1. The scriptwriter is told what the style can show, so each scene's Visual and Camera notes suit it.
2. Every image and video prompt for that script carries the style description.

A script written without a style uses whatever is selected when you generate its media.

### Picked from the topic

**Pick the look for me from the topic** is on until you choose a style yourself. While it is on, the styles follow the brief: what the topic is about, the structure, the platform, the tone and whether a host is on screen each vote, and the winner is ticked for you, with a second style when the brief asks for a mood. The line under the switch says why, and offers three other styles that would also fit; clicking one puts it in the lead. This is done by rule: it is instant, calls no model, and gives the same answer for the same brief.

**Ask the model** puts the same question to the model in use, with the whole catalogue: it picks, and says in one sentence what in your topic made it choose. Its pick stays until you change it. Ticking any style by hand also switches the automatic pick off, and your choice is kept.

## On-screen host

Tick **Put a host on screen** and the video gets a digital presenter who is the same person from the first scene to the last. A conversation (the two-host podcast) has two: A the host, B the guest.

Each host has a look. Leave it on **Designed to fit the topic** and the scriptwriter designs the host with the script; or pick one of nine ready-made hosts; or describe your own (up to 240 characters: age, hair, clothes, bearing). The script then carries:

- **The cast**: each person's name, role, look and a casting note for the voice, at the top of the script.
- **Who is in frame**, scene by scene. The host opens and closes the video and is on screen for at least half of it; the rest cuts away to graphics and b-roll.

To keep the same face in every picture:

1. **Generate portrait** makes the host's reference portrait, in the frame and the visual style of the video. With **Also generate an image for every scene** on, the portraits are made first.
2. Every scene image and clip with that host carries the same written look. Where the image model takes a reference picture (an OpenAI-compatible `images/edits` endpoint), the portrait is sent along too, and the image is marked **Drawn from the host portrait**. A provider that has no such endpoint is asked once, then the images are made from the description alone.
3. **Keep this host** fixes that look in the brief, so the next script has the same person.

The portrait is also the picture to give a talking-avatar tool, together with `voiceover.txt`. The app writes and draws the host; it does not animate lip-sync.

## Your library

The library (素材库) holds your own files, so they are uploaded once and used in any script. Every user has a library of their own. Open it with **Library** in the top bar, or from **Materials** in the brief.

| Kind | Files | What a script does with it |
| --- | --- | --- |
| Document | `.pdf` `.docx` `.txt` `.md` `.csv` `.tsv` `.json` `.srt` `.vtt`, or text you paste | Its text is read when it is added. A brief that uses it gives that text to the model as more reference material, under the same rule: only figures and quotes found there are used |
| Picture | `.png` `.jpg` `.webp` `.gif`; also `.heic` `.avif` `.bmp` `.tiff` `.svg`, which the page turns into a JPEG or a PNG first | Named to the scriptwriter, which builds a scene around it. The picture is then placed in that scene as it is |
| Clip | `.mp4` `.mov` `.webm` | The same, as the scene's clip |

**PDFs.** A PDF is read as it is added, page by page: Chinese and English, files exported from Word, WPS, Keynote, PowerPoint or a browser, and files that are protected against copying but open without a password. The page count and the text are kept, not the file. Two kinds cannot be read, and the library says which: a PDF that needs a password, and one whose fonts do not say which characters they draw. When only part of a PDF is like that, it is added with a note saying so: open it in the library to see what was read.

**Scans.** A scanned PDF has no text, only a picture of each page. The model in use reads those pictures, one request a page, up to 40 pages, and what it writes out becomes the document's text. It is marked *Read from a scan*: a model reads print well and can still get a name or a figure wrong, so check those before a script relies on them. This needs a model that takes pictures, which most current chat models do; with one that does not, the scan is refused with the provider's own answer. Pages a scanner stored as fax or JBIG2 images, or as JPEG 2000, cannot be handed to a model and are refused too.

**Pictures.** A phone photo is often larger than a file may be. The page draws it smaller in your browser (2560 pixels on its long side, then less) and uploads that, so nothing has to be resized by hand. Pictures in a format the library does not keep are redrawn the same way, as a JPEG, or as a PNG when part of the picture is see-through. An iPhone's `.heic` needs a browser that can open it (Safari); elsewhere, save it as a JPEG first.

The scriptwriter is not shown your pictures, so each picture and clip has a note: a few words on what it shows. The note and the name are all it knows about them. A picture's note is written for you when you add the picture: the model in use looks at a small copy of it (1024 pixels, made in your browser) and says what it shows, in the language you use the app in. Change it whenever it misses the point, or have it written again with the button on the picture. A clip's note is yours to write.

There are three ways to put visuals on a scene, and they can be mixed within one script:

1. **From your library, as it is.** The script names the picture or clip a scene shows and it is there when the script is done. On any other scene, **From library → Use this picture** does the same.
2. **Drawn from a library picture and the scene.** **From library → Generate from it** sends your picture to the image model as its reference, with the scene's notes: your product in the setting the script describes. Where the image model takes no reference picture, the note is used instead.
3. **From the script alone.** **Generate image** and **Generate video**, as before.

Going the other way, **To library** on a generated image keeps it for other scripts, and **To library** on a script saves its narration as a document to write the next script from.

A brief uses up to 8 files, and their documents share about 24,000 characters of the prompt: short ones are read whole, long ones are cut to fit. A document may be 25 MB, and a picture or a clip 25 MB too, or 4 MB on a serverless host, which caps what one request can carry (`ASSET_MAX_MB` changes both). A document larger than that cap is sent in parts, so a 20 MB PDF uploads there as well. A library holds 300 files. A script keeps its own copy of every file placed in it, so deleting from the library never breaks a script.

The library is private to its owner. Every file carries the id of the user who added it, and every request works on the signed-in user's files only: nobody else can list them, read them, use them in a script or open them by their address, an administrator included. Deleting an account deletes its library.

## The web: links and search

A script is only as good as its sources. With a web service set up, the app reads the web before it writes:

- **Links are read.** Put a link in the topic, the key message, your experience or the reference material, and the page behind it is read when the writing starts. Links inside the library documents a brief uses are read too. One brief reads up to 8 links, the ones you typed first.
- **A topic can be searched.** Tick **Search the web about the topic** under **Details → Web** and the topic is searched for; the five best results come back with their text.
- **In the chat.** A link in a prompt is read before the model answers. Turn on **Web** under the box and every prompt is searched for as well. What was read stays with the prompt, so a follow-up question still has it. The narration agent, asked from the chat, reads the links of its prompt the same way.

What was read reaches the model as more reference material, fenced and marked as information only, so an instruction hidden in a page is read as text and not obeyed. The honesty rule is unchanged: figures and quotes come from the brief and its sources, now including these pages. Pages share about 20,000 characters of the prompt and search results about 10,000; long ones are cut to fit.

Every script and every reply lists its sources under **From the web**: the pages that were read, the search and its results, and any link that could not be read, with the reason. A dead link never stops a script.

A page is read once and kept for a day (a search for six hours), so the plan, the narration, its review and the script, on every platform you picked, all read the same copy and the service is asked once.

### Set it up

An administrator opens **LLM settings → Web search** and adds one or more of:

| Setting | What it is |
| --- | --- |
| **Tavily API key** | From [tavily.com](https://tavily.com). Searches, and reads pages (`/search`, `/extract`) |
| **Tavily MCP link** | The address of Tavily's hosted MCP server with your key in it, `https://mcp.tavily.com/mcp/?tavilyApiKey=…`. Does the same two jobs through its `search` and `extract` tools |
| **Firecrawl API key** | From [firecrawl.dev](https://firecrawl.dev). Reads a page as clean Markdown, PDFs included, and can search too (`/v2/scrape`, `/v2/search`) |

One of them is enough. **Search with** and **Read links with** say which service is asked first for each job (Tavily searches and Firecrawl reads, unless you change it); the other, when it is set up, is asked when the first fails. With both a Tavily key and a Tavily MCP link, the key is used first. **Try it** runs a search or reads a link with the values in the form, saved or not, and shows what came back and from which service.

Keys are stored on the server and shown masked; the MCP link carries a key, so it is masked the same way. Members see only whether the web is available. Without any service the two switches in the brief are off, and a brief with links says they were not read.

## Images and video

**Images per scene** (1 to 3, default 1) sets how many images each **Generate image** click, or the automatic run, makes for a scene. Each image is a separate request to the image model.

With two or three images, the dropdown next to it decides how they relate:

| Mode | 2 images | 3 images | Use it for |
| --- | --- | --- | --- |
| Alternatives | take, take | take, take, take | Picking the best of several tries |
| Action beats | start, end | start, middle, end | A slideshow, or first and last frames for image-to-video |
| Camera coverage | wide, close-up | wide, medium, close-up | Cuts within one scene |
| Main shot + cutaways | main, detail | main, detail, context | B-roll to cut away to |
| Style comparison | style A, style B | style A, style B, blend | Choosing between your two visual styles |

Each image gets its own prompt: the scene's Visual note plus that shot's instruction. Coverage and cutaway shots replace the scene's Camera note; action beats keep it. Each image is captioned with its role, and the role is carried into the file name in the `.zip` (`scene-01_00m00s-00m04s_1-wide.png`).

> **Good to know.** Images are generated independently. The prompt asks for the same subject, setting and palette across a set, but an image model may still vary them.

Video clips run for the shortest of 4, 8 or 12 seconds that covers the scene, and 12 seconds for anything longer.

## Connect a model

Generation goes through a **gateway**: a provider, its base URL, an API key and a model.

| Setting | Field in LLM settings | Environment variable |
| --- | --- | --- |
| Provider | Provider | `LLM_PROVIDER` |
| Base URL | BASE_URL_API | `BASE_URL_API` (or `LLM_BASE_URL`) |
| API key | API_KEY | `API_KEY` (or `LLM_API_KEY`) |
| Model | Default model | `LLM_MODEL` |

### Supported providers

OpenAI, Anthropic (Claude), DeepSeek, 通义千问 Qwen, 豆包 Doubao, Moonshot Kimi, 智谱 GLM, Google Gemini, OpenRouter and Ollama (local), plus custom OpenAI-compatible and Anthropic-compatible endpoints and the offline demo.

Preset base URLs and model names are starting points; edit them to match your account.

### Saved gateways

Under **LLM settings** you can save any number of gateways, one per provider or account. Edit or delete them, and tick **Use this gateway to write scripts** on the one you want.

- Saved gateways are written to `data/gateway.json` and take precedence over environment variables, which only supply the starting gateway when nothing is saved.
- **Test connection** checks a gateway's settings before you save them.

### Models

**List available models** asks the provider which models your key can use. Tick the ones you want to offer and pick a default. The ticked models of every saved gateway appear in the **Written by** picker in the brief, so an administrator can switch gateway and model without opening settings. The choice applies to everyone.

If a provider has no model list endpoint, type the model name instead.

### Image and video models

Each gateway has an **Images and videos** section with a separate BASE_URL_API, model, size and optional API_KEY for images and for videos.

- A blank base URL or key falls back to the gateway's own.
- A blank model turns that kind of media off.
- Size is sent only if you fill it in.
- **List available image models** and **video models** ask that address for its models. Providers return every model they have, so names that look like image or video models are listed first.

### When the provider is unsteady

Providers, and the gateways in front of them, fail in passing: no capacity for a moment, a timeout, a reply that stops half-way. The app rides these out by itself.

| What happens | What the app does |
| --- | --- |
| `502`, `503`, `504`, `529`, a rate limit (`429`) or a dropped connection before the reply starts | Asks again, up to three more times, with a pause that grows each time (about 1, 2 and 6 seconds, or what the provider asks for, never more than 10) |
| The stream breaks in the middle of a reply, or ends before the reply is finished (some gateways stop every reply after about a minute) | Picks the reply up where it stopped: the model is shown what it had written and asked for the rest, and the pieces are joined into one reply. This goes on while each attempt adds to the reply, eight times at most |
| The reply runs out of room (`length`, `max_tokens`) | The same: it is continued |
| An image request times out at the gateway (`504`) | One more try. A video job is never asked for twice after a timeout, since it may have started |
| A wrong key, a model the provider does not offer, no credit, a wrong address | Nothing is tried again: the message says what to fix |

While this goes on the page says so ("gw.example is not answering (503). Trying again: attempt 2 of 3."), and what has been written stays on screen. If it still fails, the error says how often it was tried and whose end the failure is on. The tokens of every attempt are counted in the usage of that one call.

### When a script outlasts one request

A host such as Vercel stops a request after a fixed time (800 seconds as this repository is set up), and it does so without a word: the reply just ends. A long script from a slow or unsteady provider can take longer than that, so the server keeps its own clock and stops a little earlier, while it can still say what happened.

| What happens | What the app does |
| --- | --- |
| The time is nearly up and the script is not finished | The request ends with a `handover` event, and the page asks for the rest in a new request. The model is shown what it had written and carries on from there, so the script on screen keeps growing. Eight requests at most |
| The connection drops in the middle of a script | The page picks it up the same way, from what it has |
| The time is nearly up on anything else (a narration draft, a review) | The request ends with an error that names the limit |

With `npm start` there is no limit, so none of this happens unless you set `REQUEST_TIME_LIMIT_S`. Each request of a script that was carried over is one call in the usage record.

## Accounts, usage and activity

### Accounts

- **Sign up and log in** with an email and a password of at least 8 characters. Sessions last 30 days.
- **Two roles.** A *member* writes scripts, generates media, and sees their own history, usage and activity. An *administrator* also manages LLM gateways (members never see addresses or keys, only the name and model in use), and sees and manages every user.
- **The first administrator** comes from `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Nobody becomes an administrator by signing up; administrators manage everyone else on the [admin page](#admin-page).
- **One gateway and model for everyone.** The administrator chooses it, in LLM settings or with the **Written by** picker in the brief; members see what is in use but cannot change it.
- Set `ALLOW_SIGNUP=false` to close sign-up.

- **Your own profile.** Under **Account → Profile** anyone can change their display name and their password. Changing a password logs out their other devices.
- **Show password.** Every password and API key field has an eye button that shows what was typed.

Not included yet: email verification and self-service password reset by email. An administrator resets a forgotten password.

### Admin page

Administrators get a **Users** page (`/admin.html`, linked from the top bar and from Account). It lists every account with role, status, last log-in, scripts and usage, with search and filters. From there an administrator can:

- **Create a user** with a role and a password (typed or generated). The password is shown once so it can be passed on; nothing is emailed.
- **Edit** a user's name, email, role and status. A disabled user cannot log in and is logged out at once.
- **Reset a password**, which logs that user out everywhere.
- **Log a user out everywhere** without changing the password.
- **See one user in full:** sessions, all-time usage and their latest activity.
- **Delete a user**, either deleting their scripts and media or moving them to the administrator's own account. Usage and activity records are kept as the audit trail.

An administrator cannot demote, disable or delete their own account, so there is always at least one.

### Usage

Every call to a model is recorded: who made it, for which script, which gateway and model, tokens in and out, images made, video seconds, how long it took, and whether it failed. **Account → Usage** shows totals for a period, then the same numbers by script, by model and call by call. Administrators can switch to **All users** for a per-user breakdown.

Token counts come from the provider when it reports them (OpenAI-compatible `usage`, Anthropic `usage`). When a provider reports none, the count is estimated from the text and marked with ≈.

### Visitors and conversion

**Users → Visitors** on the admin page shows how visitors to the home page turn into users:

- **The funnel.** Visitors, then how many clicked a button to the app, opened the app, signed up, and wrote a first script, each as a share of all visitors.
- **Breakdowns** by source (the referring site, or `utm_source` on the link), first page seen, day, country and device, each with its sign-ups and conversion rate.
- **Latest visitors**, with how far each one got and, once they sign up, which user they became.

People are counted in the period of their first visit, and the first source they came from is the one kept. Someone who already had an account is counted apart, so the conversion rate is over prospects only. Crawlers and scripts are not counted.

How it works: the home pages and the app load `public/track.js`, which posts page views and clicks on the buttons that lead to the app to `/api/track`. The server gives each browser a random id in a first-party cookie (`vs_vid`, one year) and keeps one record per visitor. It stores no IP address and sends nothing to any third party. Because it sets a cookie that is not strictly necessary, visitors in some regions (the EU and UK, for example) may need to be told or asked first; add a notice if that applies to you.

To tag a link you share, add `?utm_source=newsletter` (and optionally `utm_medium`, `utm_campaign`) to the home page address.

### Activity log

**Account → Activity** lists what happened and when: sign-ups, log-ins and failed log-ins, scripts written, stopped or failed, images and videos generated, packages downloaded, and gateway and user changes. Members see their own; administrators can see everyone's. Passwords and API keys are never written to the log.

## Your work

Everything is stored on the server, per user. Where it lives depends on how the app is run:

| | Local (`npm start`) | Hosted (`DATABASE_URL` set) |
| --- | --- | --- |
| Scripts, users, sessions, usage, activity, visitors, gateways | `data/<name>.json` | Postgres table `vs_docs` |
| Generated images and videos | `data/media/` | Postgres table `vs_blobs` |
| Library documents (their text) | `data/assets.json` | Postgres table `vs_docs` |
| Library pictures and clips | `data/media/lib-*` | Postgres table `vs_blobs` |

Reopening a script from History shows its media again and puts the brief it was written from back into the form (topic, platform, structure, length, style and details), so you can adjust it and generate again. Generating always saves a new script with its own package; the one you opened is left as it was. Redoing an image or video keeps the earlier file and shows the newest. If a provider returns a link instead of a file, the file is downloaded and stored too. Media is private: only its owner and administrators can open it.

To back up a local install or move it to another machine, copy the `data/` folder.

### The download package

**Download .zip** produces one archive per script, named `<date>_<platform>_<title>.zip`, for example `2026-11-10_douyin_AI-落地的三个坑.zip`. Titles keep their letters in any language, with punctuation and spaces turned into hyphens, 40 characters at most. Inside is one folder of the same name:

```
script.md                              the full script, in the interface language
script.html                            the same as a styled page that shows the images and clips; opens offline
script.json                            brief, plan, script, and a list of the media files
voiceover.txt                          spoken text only, one scene per paragraph
post.md                                the image post, when one was written: the text to paste and what each card says
images/host-A.png                      the reference portrait of each on-screen host
images/scene-01_00m00s-00m04s.png      latest image per scene
videos/scene-01_00m00s-00m04s.mp4      latest clip per scene
audio/scene-01_00m00s-00m04s.wav       the voiceover of each scene, once the script was voiced
```

When a scene has several images, each file name gains a number, and its role where there is one: `…_1.png`, or `…_1-start.png` and `…_2-end.png`.

## Privacy and security

- **Sign-in required.** Every API route except sign-up and log-in needs a session, and cross-origin API calls are refused.
- **Passwords are never stored.** Only a salted scrypt hash is kept. Five wrong passwords lock an account for 15 minutes.
- **Sessions** are random tokens in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` on HTTPS); the server stores only their SHA-256.
- **Each user's work is their own.** Scripts, media, usage and activity are scoped to the signed-in user.
- **Keys stay on the server.** Each API key is stored with its own gateway. Administrators see a masked preview; members see nothing.
- **Keys cannot leak to another service.** Changing a gateway's provider or base URL clears its saved key.
- **Out of version control.** `data/` is git-ignored. Never put `ADMIN_PASSWORD` or API keys in the repository; set them as environment variables.

A brief, its reference material and the text of the library documents it uses are sent to the model provider the user picked, and to no one else. A library picture is sent to the image provider only when an image is drawn from it. When the web is set up, a link in a brief or a prompt is sent to the web service (Tavily or Firecrawl), which fetches the page; a search sends it the topic or the prompt as the query. Nothing else of the brief goes there, and this server never fetches a page itself.

## Deploy on Vercel

The repository deploys as is: `vercel.json` selects the "Other" framework preset, serves `public/` as static files, and sends `/api/*` and `/media/*` to one Node.js function (`api/index.mjs`). Its one build step, `scripts/stamp-site-url.mjs`, writes the site's address into the home page, sitemap and robots.txt.

1. **Add a Postgres database.** In the Vercel project, open **Storage** and create a Postgres database (Neon). It adds `DATABASE_URL` to the project. The tables are created on the first request.
2. **Add two environment variables** under **Settings → Environment Variables**: `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Mark the password as sensitive.
3. **Redeploy**, open the site, and log in as the administrator. Connect a model under **LLM settings**.

Without `DATABASE_URL` the site still runs, but on temporary storage: accounts, scripts and settings disappear when the function restarts. The Account dialog shows a warning to administrators while that is the case.

Limits worth knowing on Vercel: a request can run for up to 800 seconds (`maxDuration` in `vercel.json`, the most the Pro plan allows; on the Hobby plan lower it to `300` and set `REQUEST_TIME_LIMIT_S=300`). A script that needs longer is [written across several requests](#when-a-script-outlasts-one-request). Large downloads such as a `.zip` with many images or a long video may exceed the platform's response size limit. Images and clips are stored in Postgres, which suits a small team; for heavy use, move media to object storage.

## Home page and search

`/` is a public home page (`public/index.html`, with `public/zh.html` in Simplified Chinese); the app itself is at `/app.html` and is marked `noindex`. The home page is static HTML with no scripts to wait for, and carries what search engines and AI answer engines read:

- a title, description, canonical link and `hreflang` links between the two languages
- Open Graph and Twitter tags with a share image (`public/og.png`)
- structured data (`SoftwareApplication`, `HowTo`, `FAQPage`) that repeats the visible copy word for word; `npm test` checks they match
- `robots.txt`, `sitemap.xml`, and `llms.txt`, a plain-text summary for language models

These need the site's public address. Set `SITE_URL` (for example `https://example.com`). On Vercel it defaults to the project's production domain and is written into the files at build time; with `npm start` it defaults to the address each request came in on.

## Interface

- **Language.** The **中文 / English** button in the top bar switches the interface between English and Simplified Chinese. Until you choose, it follows the browser language. Messages that come from the server or the model provider stay in English.
- **Theme.** The sun / moon button in the top bar switches between light and dark. Until you choose, the page follows the system setting.
- **Brief in four steps.** Your video, structure, look and images, details. The last two are folded and show a one-line summary. The **Generate** bar is always in reach.
- **Desktop.** Brief on the left, script on the right. History and LLM settings open from the top bar.
- **Phone.** One view at a time with a bottom bar: Brief, Script, History, Settings. Generating switches to the Script view, and settings and history open as full-screen sheets. Controls are at least 44px tall and inputs use 16px text, so iOS does not zoom when you tap a field.
- **History.** A searchable list with thumbnails.
- **While writing.** A progress view shows which scene the model is on; the raw reply is behind "Show the raw reply".

Colours, spacing and type are tokens at the top of `public/styles.css` (neutral zinc with one pink accent, in light and dark). Icons are inline SVG from `public/icons.js`. The font stack prefers Inter if it is installed and otherwise uses the system font. No web font is downloaded, so the page works offline and where Google Fonts is unreachable.

## Configuration

Everything below is optional. Settings saved in the app take precedence over the gateway variables.

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | Port the server listens on | `3789` |
| `HOST` | Address the server binds to | `127.0.0.1` |
| `DATA_DIR` | Where everything is stored when no database is set | `data/` |
| `DATABASE_URL`, `POSTGRES_URL` | Postgres connection string. When set, everything is stored there instead of `DATA_DIR` | None |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Creates the administrator on first start | None |
| `SITE_URL` | Public address of the site, for canonical links, the sitemap and robots.txt | The Vercel production domain, or the request's address |
| `ALLOW_SIGNUP` | Set to `false` to close sign-up | Open |
| `GATEWAY_CONFIG_FILE` | Older gateway file, read once if no gateways are saved yet | `data/gateway.json` |
| `LLM_PROVIDER` | Provider preset for the starting gateway | Demo |
| `BASE_URL_API`, `LLM_BASE_URL` | Base URL for the starting gateway | The preset's |
| `API_KEY`, `LLM_API_KEY` | API key for the starting gateway | None |
| `LLM_MODEL` | Model for the starting gateway | The preset's |
| `IMAGE_BASE_URL_API`, `IMAGE_MODEL`, `IMAGE_API_KEY` | Image generation defaults | Off |
| `VIDEO_BASE_URL_API`, `VIDEO_MODEL`, `VIDEO_API_KEY` | Video generation defaults | Off |
| `GATEWAY_RETRY_BASE_MS` | The first pause, in milliseconds, before a failed provider request is tried again; later pauses grow from it | `900` |
| `REQUEST_TIME_LIMIT_S` | How many seconds the host lets one request run. The server winds a request up shortly before, and a script that is not finished is carried on in the next request | `800` on Vercel, otherwise no limit |
| `SPEECH_PROVIDER`, `SPEECH_API_KEY`, `SPEECH_APP_ID` | The voice provider until one is saved in the app: `volc` (豆包语音 Seed-TTS, which also needs the APP ID) or `openai` (an OpenAI-compatible `/audio/speech`) | None |
| `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | The Google OAuth client people connect their YouTube channel through, until one is saved in the app | None |
| `POSTIZ_API_URL` | Where Postiz is, for a deployment that hosts its own | `https://api.postiz.com` |
| `SPEECH_BASE_URL_API`, `SPEECH_MODEL`, `SPEECH_VOICE`, `SPEECH_VOICE_B` | Its address, model or resource id, and the voices scripts are read in | The provider's |
| `TAVILY_API_KEY`, `TAVILY_MCP_URL`, `FIRECRAWL_API_KEY` | The web services until some are saved in the app (LLM settings → Web search) | None |
| `WEB_SEARCH_WITH`, `WEB_READ_WITH` | Which service is asked first to search and to read: `tavily` or `firecrawl` | `tavily`, `firecrawl` |
| `TAVILY_API_URL`, `FIRECRAWL_API_URL` | Where the two APIs are, for a self-hosted Firecrawl or a proxy | `https://api.tavily.com`, `https://api.firecrawl.dev` |
| `ASSET_MAX_MB` | The largest file the library takes, in megabytes | `25`; for pictures and clips on Vercel `4` |
| `ASSET_BODY_MB` | The largest upload one request may carry, for a host or a proxy that caps it. A larger file is sent in parts | no cap; on Vercel `4` |

## For developers

Video Scripter is plain Node.js with no build step. Its one dependency is `pg`, loaded only when `DATABASE_URL` is set.

```bash
npm run dev
```

```bash
npm test
```

`npm run dev` restarts the server when a file changes. `npm run restart` stops the copy of the app already running on the port and starts a fresh one (add `-- --watch` for the `dev` behaviour); it leaves any other program on that port alone. `npm test` runs the suite with `node --test`.

### Project layout

```
server.mjs              HTTP server, API routes, static files
src/gateway/            providers, config store, streaming client (with retry and resume), demo provider
src/platforms.mjs       per-platform writing, publishing and compliance guidance
src/frameworks.mjs      script structures and narration styles: stage timing and, for a style, its voice
src/narration.mjs       narration as beats: counting, timing, and keeping a locked narration word for word
src/styles.mjs          visual styles for images and clips
src/suggest.mjs         the visual style picked for a brief: by rule, or by the model
src/cast.mjs            the people of a video: speakers, the on-screen host, and how every image describes them
src/shots.mjs           how several images of one scene relate (multi-image modes)
src/prompt.mjs          brief -> timeline + prompts; model reply -> script, narration or refinement
src/json.mjs            reads the JSON in a model reply and mends its small slips
src/limits.mjs          how long one request may run, and how many requests one script may take
src/agent/              the narration agent: narrator.mjs (the steps), review.mjs (the measured checks),
                        card.mjs (the viewpoint card), prompts.mjs (the editor step), skills.mjs (loads skills/)
skills/                 the agent's playbooks, one folder with a SKILL.md each
src/db.mjs              storage: JSON documents and blobs, on disk or in Postgres
src/auth.mjs            accounts, password hashing, sessions, the first administrator
src/audit.mjs           usage records (every model call) and the activity log
src/store.mjs           saved scripts and generated media
src/assets.mjs          the library (素材库): uploaded files, the text read from documents, who owns what
src/pdf.mjs             the text of a PDF, read without a PDF library, and the page pictures of a scan
src/vision.mjs          the model in use looks at pictures: a picture's note, the pages of a scan
src/materials.mjs       the library files one brief uses: what the prompts say about them, and the scene that shows one
api/index.mjs           serverless entry point (Vercel); vercel.json routes requests to it
src/package.mjs         the downloadable .zip for one script (src/zip.mjs writes the archive)
src/post.mjs            the image post of a script: what each platform takes, the prompt, reading the reply
src/youtube.mjs         YouTube connected directly: the site's OAuth client, each person's sign-in, the upload in pieces
src/publish.mjs         publishing through Postiz: each person's key, their channels, uploads and the post
src/speech.mjs          the voice of a video: the voice provider, the two protocols, a scene's voiceover as one WAV
src/chat/               the chat: store.mjs (conversations and their files), skills.mjs (skills people write),
                        prompt.mjs (what the model is told), routes.mjs (the API)
src/web/                the web: config.mjs (the Tavily and Firecrawl settings), tavily.mjs, firecrawl.mjs and
                        mcp.mjs (the services), links.mjs (the links in a text), sources.mjs (reading, searching,
                        what is kept), brief.mjs (what the model is told), routes.mjs (the API)
public/                 the web UI: index.html and zh.html are the home page (English, 中文), app.html the app,
                        chat.html the chat (markdown.js reads and draws its replies), admin.html the user
                        administration page
src/site.mjs            the site's public address, for canonical links, the sitemap and robots.txt
src/visitors.mjs        visitors and the sign-up funnel (the Visitors tab on the admin page)
scripts/                stamp-site-url.mjs, the build step that writes that address into public/ on a static host
test/                   node --test
```

### Make it yours

| To change | Edit |
| --- | --- |
| How a platform's scripts read | Its entry in `src/platforms.mjs`. The text goes straight into the system prompt. |
| Script structures, narration styles, their pace, length and stage timing | `src/frameworks.mjs` |
| What the narration agent knows and holds a narration to | The playbooks in `skills/`: edit one, or add a folder |
| What the narration checks measure, and the words a platform throttles | `src/agent/review.mjs`, and `banned` in `src/platforms.mjs` |
| The refinements the narration editor offers | `REFINE_PRESETS` in `src/prompt.mjs` |
| Visual styles | `src/styles.mjs` |
| Which styles are suggested for which topics, structures and platforms | The tables in `src/suggest.mjs` |
| The ready-made hosts | `HOST_PRESETS` in `src/cast.mjs` |
| Multi-image modes | `src/shots.mjs` |
| What a platform's image post takes and how one is written | `post` in its entry in `src/platforms.mjs` |
| The themes of the image-post cards | `THEMES` in `public/cards.js` |
| Provider presets | `src/gateway/providers.mjs` |
| Interface translations | `public/i18n.js` |

The Golden retention structure comes from the B2B 4K short-video skill (hook, suspense anchor, three value waves, structured wrap, cold close), as do the Chinese rules that keep English on screen and out of the voiceover. The three tech and business styles draw on the narration, story-spine and explainer skills: the hook speaks the viewer's language, the value comes before the evidence, detail goes on screen while the voice carries the backbone, and every claim is either sourced or marked as the creator's judgment. The general content styles, the whiteboard lecture, the 3 + 3 + 4 viewpoint card, the 视频号 growth and compliance rules and the enterprise-AI knowledge base come from the WeChat Channels consultant script specification, split into the skills above.

### Wire protocols

Two protocols are implemented in `src/gateway/client.mjs`, both streaming: OpenAI-compatible `chat/completions` and Anthropic `messages`.

| Purpose | Request |
| --- | --- |
| List models | `GET {base}/models`, or `/v1/models` for Anthropic |
| Generate an image | `POST {base}/images/generations` |
| Generate an image from a host portrait | `POST {base}/images/edits` (multipart), where the provider has it |
| Start a video | `POST {base}/videos` |
| Check a video | `GET {base}/videos/{id}` |
| Fetch a video | `GET {base}/videos/{id}/content` |

Image and video generation use the OpenAI-compatible media endpoints.

### HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/auth/me` | The signed-in user, or `null` |
| `POST` | `/api/auth/signup`, `/api/auth/login`, `/api/auth/logout` | `{ email, password, name? }` Start or end a session |
| `GET` | `/api/usage?scope=me\|all&days=30` | Usage totals, by script, by model, by user (administrators) and the latest calls |
| `GET` | `/api/activity?scope=me\|all` | The activity log |
| `GET` | `/api/admin/users` | Administrators: every user with their totals |
| `POST` | `/api/track` | Public: `{ e: "view" \| "cta", p: "home" \| "zh" \| "app", ref?, src?, med?, camp?, cta? }` Records a page view or button click for the visitor funnel |
| `GET` | `/api/admin/visitors?days=30` | Administrators: the sign-up funnel, its breakdowns and the latest visitors |
| `GET` | `/api/admin/users/detail?id=` | Administrators: one user with sessions, usage and latest activity |
| `POST` | `/api/admin/users/create` | Administrators: `{ email, password, name?, role? }` |
| `POST` | `/api/admin/users/update` | Administrators: `{ id, name?, email?, role?, disabled? }` |
| `POST` | `/api/admin/users/password` | Administrators: `{ id, password }` Sets a password and ends that user's sessions |
| `POST` | `/api/admin/users/logout` | Administrators: `{ id }` Ends that user's sessions |
| `POST` | `/api/admin/users/delete` | Administrators: `{ id, scripts?: "transfer" }` Deletes a user and their scripts, or moves the scripts |
| `POST` | `/api/auth/profile` | `{ name }` Change your own name |
| `POST` | `/api/auth/password` | `{ current, password }` Change your own password |
| `GET` | `/api/meta` | Platforms, frameworks and their groups, refinements, speaking pace and provider presets |
| `GET` | `/api/gateway/config` | Every saved gateway (keys masked) and the one in use |
| `PUT` | `/api/gateway/config` | Administrators: create a gateway, or update the one with the given `id`. `activate: true` makes it the default |
| `POST` | `/api/gateway/select` | `{ id, model? }` Choose the gateway and model the signed-in user writes with |
| `POST` | `/api/gateway/delete` | `{ id }` Delete a gateway |
| `POST` | `/api/gateway/test` | Test the settings in the body without saving |
| `POST` | `/api/gateway/models` | List the provider's models for the settings in the body without saving. `kind: "image" \| "video"` asks at that kind's address instead |
| `GET` | `/api/history` | The signed-in user's scripts, newest first |
| `POST` | `/api/history` | Import a script |
| `POST` | `/api/history/package` | `{ id, markdown }` Returns the script's `.zip` |
| `POST` | `/api/post/generate` | `{ historyId, instruction? }` Writes the image post of a script and keeps it on the script: `{ post }` with `title`, `titles`, `body`, `hashtags` and `cards` |
| `GET`, `PUT` | `/api/speech/config` | The voice provider in use: everyone learns whether there is one and its voices; an administrator sees its address and a masked key, and changes it with `{ provider, baseUrl, apiKey, appId, model, voice, voiceB }` |
| `POST` | `/api/speech/test` | Administrators: one sentence spoken with the settings in the body, as `{ seconds, audio }` (a WAV in a `data:` URI) |
| `POST` | `/api/voice/scene` | `{ historyId, sceneId, voice?, voiceB?, speed?, text?, done? }` Speaks one scene (`text` is said in place of its voiceover) of a script and keeps the sound with the script: `{ sceneId, url, seconds }` |
| `GET` | `/api/youtube/status` | Whether the site can sign people in to YouTube and whether the signed-in person has; an administrator also sees the OAuth client (secret masked) and the redirect address to register |
| `PUT` | `/api/youtube/config` | Administrators: `{ clientId, clientSecret }`, or an empty `clientId` to switch it off |
| `GET` | `/api/youtube/connect`, `/api/youtube/callback` | The sign-in: off to Google, and back with a code that is exchanged for the person's tokens |
| `POST` | `/api/youtube/disconnect` | Forgets the person's connection and revokes it at Google |
| `POST` | `/api/youtube/upload` | `{ historyId, size, title, description?, tags?, visibility?, ai?, publishAt? }` Opens an upload at YouTube: `{ uploadId, partBytes }` |
| `POST` | `/api/youtube/part` | The body is one piece of the video (`x-upload-id`, `x-offset`, `x-history-id`), sent in order; the last answers `{ done, id, url, channel }` |
| `GET` | `/api/publish/status` | Whether the signed-in person has connected Postiz, and the channels their key reaches |
| `POST` | `/api/publish/connect` | `{ apiKey }` connects (the key is kept once Postiz answers to it); `{ disconnect: true }` forgets it |
| `POST` | `/api/publish/media` | The body is a picture or a video (name in `x-file-name`), passed on to the person's Postiz library: `{ id, path }`. A large file is sent first in pieces to `/api/publish/part` (`x-upload-id`, `x-part`), then named here with `x-upload-id` and `x-parts` |
| `POST` | `/api/publish/post` | `{ historyId, kind: "images" \| "video", channelIds, when: "now" \| "draft" \| ISO date, text, title?, hashtags?, visibility?, ai?, media }` Makes the post at Postiz and notes it on the script |
| `GET` | `/api/voice/file?id=&name=` | The recording of one scene (WAV), for the script's owner |
| `POST` | `/api/post/save` | `{ historyId, post }` Keeps the creator's edits to a post: its text, its cards, and their theme, shape and footer |
| `GET` | `/api/chat/meta` | What a conversation can be sent to: the gateways and their enabled models (names only), and the models that draw and film |
| `GET` | `/api/chats?q=` | Your conversations, the latest first; `q` searches titles and messages. `GET /api/chats/get?id=` is one in full |
| `POST` | `/api/chats/rename`, `/api/chats/delete` | `{ id, title }`; `{ id }` deletes a conversation with its pictures and clips |
| `POST` | `/api/chat/send` | `{ chatId?, text, target?, model?, skillIds?, aspect?, seconds?, web? }` Sends a prompt to `assistant`, `narrator`, `image` or `video`. `regenerate: true` answers the last prompt again; `editId` replaces a prompt and what follows it. Links in the prompt are read first, and `web: true` searches the web for it. Server-sent events: `chat`, `web`, `delta`, `step`, `trace`, `retry`, `media`, `done` (`{ message, chat }`; the reply's `sources` say what was read) |
| `POST` | `/api/chat/message/update` | `{ chatId, messageId, content }` Keeps a reply as it was edited in the canvas |
| `POST` | `/api/chat/media/make`, `/api/chat/media/status` | `{ chatId, messageId, index }` Makes a picture or a clip of a reply again; asks how a clip is coming on and stores it when ready |
| `GET` | `/api/skills` | Your skills, then the built-in ones (name and purpose only) |
| `POST` | `/api/skills`, `/api/skills/delete` | `{ id?, name, description?, body }` Creates or changes a skill; `{ id }` deletes it |
| `GET`, `PUT` | `/api/web/config` | What the web can do here: `{ search, read }`. An administrator also sees which keys are saved, masked, and saves them with `{ tavilyKey?, tavilyMcp?, firecrawlKey?, search?, read?, clear? }`: a blank field keeps what is saved, `clear: ["tavilyKey"]` removes it |
| `POST` | `/api/web/test` | Administrators: tries the form's values without saving them. `{ try, with? }`: a link in `try` is read, anything else is searched for; `with` asks `tavily` or `firecrawl` alone |
| `POST` | `/api/media/image` | `{ visual, camera, historyId, sceneId }` Makes and stores an image, returns `{ url }`. `referenced: true` when a host portrait was used as the reference |
| `POST` | `/api/media/host` | `{ historyId, hostId, aspectRatio, styleIds }` Makes and stores the reference portrait of host `A` or `B` of a script, returns `{ url }` |
| `POST` | `/api/styles/suggest` | `{ ...brief, lang }` The visual style for a brief: `{ styleIds, alternatives, reason, by }`. By rule, with no model call; `by: "model"` has the model in use choose |
| `POST` | `/api/media/video` | `{ visual, camera, start, end }` Starts a video job |
| `POST` | `/api/media/video/status` | `{ id, historyId, sceneId }` Polls a job and stores the file when ready |
| `GET` | `/media/<file>` | A stored image or video |
| `GET` | `/api/assets` | The signed-in user's library, newest first |
| `POST` | `/api/assets` | Add a file: the body is the file, its name is in the `x-file-name` header (URI-encoded). A JSON body `{ name?, text }` adds pasted text as a document |
| `POST` | `/api/assets/part` | One part of a file too large for a single request: the body is the part, `x-upload-id` names the upload and `x-part` its place, from 0. `POST /api/assets` with `x-upload-id` and `x-parts` then adds the file |
| `GET` | `/api/assets/text?id=` | The whole text of a document |
| `POST` | `/api/assets/describe` | `{ id, lang?, preview? }` Has the model in use look at a picture and write its note. `preview` is a small copy of the picture as a `data:` URI; without one the stored picture is shown |
| `POST` | `/api/assets/update`, `/api/assets/delete` | `{ id, name?, note? }` Rename a file or change its note; `{ id }` delete it |
| `POST` | `/api/assets/keep` | `{ url, name? }` Copies one of your generated images or clips into the library |
| `POST` | `/api/media/asset` | `{ historyId, sceneId, assetId }` Places a library picture or clip in a scene as it is |
| `POST` | `/api/plan` | The plan for a brief without writing anything: story line with times, length and voiceover budget |
| `POST` | `/api/narration/draft` | Writes the narration alone, one beat per stage: the agent's plan-and-write step, or a plain draft with `agent: false`. Server-sent events: `plan`, `step`, `delta`, `done` (`{ narration, card, report }`) or `error`. Nothing is saved |
| `POST` | `/api/narration/review` | `{ ...brief, narration, card? }` The agent's review step. Server-sent events: `plan`, `step`, `delta`, `done` (`{ beats, report }`) or `error` |
| `POST` | `/api/narration/check` | `{ ...brief, narration, card? }` The measured checks alone: `{ findings, errors, warns, stats }`. No model call |
| `POST` | `/api/narration/refine` | `{ ...brief, narration, index?, preset?, instruction?, target? }` Rewrites one beat (`{ text }`) or the whole narration (`{ beats }`); `preset: "review"` runs the agent's review and answers `{ beats, report }` |
| `POST` | `/api/generate` | Writes a script, saves it and records the call. With `narration: [{ stage, text }]` the script is built around those words as they are, and a `card` sent with it is kept on the script. With `resume: { text, part }` it carries on a reply an earlier request began. Server-sent events: `plan`, `delta`, `retry`, then `done`, `error` or `handover` (out of time: ask again with `resume`) |
