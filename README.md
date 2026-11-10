# Video Scripter

**From one brief to a shoot-ready script for every platform you publish on.**

Video Scripter is a script studio for short social video. Describe the video once, pick your platforms, and get a separate script for each one, written for that platform's audience, pacing and publishing rules, with storyboard images and clips generated from the scene notes.

It runs on your own machine, works with the model provider you already use, and keeps every script, image and clip in a folder you own.

[中文说明](README.zh-CN.md)

## Why Video Scripter

- **One brief, five platforms.** A 抖音 script and a YouTube Shorts script are different pieces of writing. Each platform gets its own script instead of one draft pasted everywhere.
- **Ready to shoot.** Every scene is timed and carries its voiceover, on-screen text, visual, camera and sound notes.
- **Ready to publish.** Titles, cover text, description, hashtags and a pinned comment come with every script.
- **Storyboards included.** Turn any scene into a 9:16 image or clip, in one of 27 visual styles.
- **Any model.** Ten provider presets, from OpenAI and Anthropic to 通义千问, 豆包 and local Ollama, plus any OpenAI-compatible or Anthropic-compatible endpoint. Switch model per script.
- **Yours to keep.** No account, no cloud, no install step. Everything is saved to disk and exports as one tidy `.zip`.

## Platforms

| Script language | Platform | Lengths (seconds) |
| --- | --- | --- |
| 中文 | 视频号 (WeChat Channels) | 30, 60, 90, 120 |
| 中文 | 抖音 (Douyin) | 15, 30, 45, 60, 90 |
| English | TikTok | 15, 30, 45, 60, 90 |
| English | Instagram Reels | 15, 30, 45, 60, 90 |
| English | YouTube Shorts | 30, 45, 60, 90, 180 |

The script language follows the platform. The interface language is a separate choice (see [Interface](#interface)).

## Get started

Video Scripter needs Node.js 20 or newer. There is nothing to install.

```bash
npm start
```

Open http://localhost:3789. The app starts in demo mode, which returns placeholder text so you can explore the workflow without a model. Click **LLM settings** to connect one.

## How it works

### 1. Write the brief

Only the topic is required. The rest sharpens the result.

| Field | What it does |
| --- | --- |
| Topic | What the video is about |
| Platforms | One script is written per platform you tick |
| Structure and Length | The story framework and the running time |
| Visual style | One look, or two blended, for the scene notes and all generated media |
| Key message, Audience, Tone | The one thing to remember, who it is for, and how it should sound |
| Brand or creator, Call to action | Who is speaking and what the viewer should do next |
| Reference material | Facts, quotes or an article. The model is told to use only figures and quotes found here or in the brief |
| Voiceover is for text-to-speech | Spells out numbers and symbols so a TTS voice reads them correctly |
| Written by | The gateway and model that writes this script |

### 2. Review the script

Each platform opens in its own tab, and the script streams in as it is written. A script contains:

- **Three hook options** to choose from for the opening
- **A timed scene list**, each scene with voiceover, on-screen text, visual, camera and sound
- **A voiceover-only view**, for recording or pasting into a TTS tool
- **A publishing package**: titles, cover text, description, hashtags and a pinned comment

**Regenerate** rewrites a script. **Copy Markdown** and **Copy voiceover** put it on the clipboard.

### 3. Generate the visuals

Once the gateway in use has an image or video model, every scene gets **Generate image** and **Generate video** buttons that turn its Visual and Camera notes into a 9:16 frame or clip. Tick **Also generate an image for every scene** in the brief to have the images made automatically when the script is finished.

### 4. Export

**Download .zip** packs the script, the voiceover and every generated image and clip into one archive, named and numbered by scene (see [Your work](#your-work)).

## Script structures

Six frameworks set the story arc and how the running time is divided between its stages.

| Structure | Arc | Best for |
| --- | --- | --- |
| Golden retention | Hook, suspense anchor, three value waves, structured wrap, cold close | Business, tech and insight content |
| Problem – Agitate – Solve | Name the pain, raise the stakes, deliver the fix | Services, courses and tools |
| Story with a turn | Start at the conflict, tell a short story with a turn | Personal brands, founders and case studies |
| Listicle | "3 things…", strongest item last | Tips, mistakes and round-ups |
| How-to tutorial | Show the result first, then teach the steps | Demos, software and skills |
| Product showcase | Scenario, reveal, proof, offer | Product, launch and review videos |

## Visual styles

The **Visual style** picker offers 27 looks in five groups.

| Group | Styles |
| --- | --- |
| Live action | Cinematic, documentary, phone-shot vlog, studio product, bright lifestyle, modern workplace, macro detail |
| Illustration | Flat vector, isometric, hand-drawn sketch, watercolour, Chinese ink, anime, comic pop, paper collage |
| 3D and stop motion | Stylised 3D, claymation, glossy 3D objects |
| Graphics and data | Motion infographic, minimal geometric, tech interface, screen recording |
| Era and mood | Retro film, neon night, dark and moody, pixel art, surreal dream |

Pick one, or two to blend. The first one picked leads, and a third pick replaces the oldest. The choice does two things:

1. The scriptwriter is told what the style can show, so each scene's Visual and Camera notes suit it.
2. Every image and video prompt for that script carries the style description.

A script written without a style uses whatever is selected when you generate its media.

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

**List available models** asks the provider which models your key can use. Tick the ones you want to offer and pick a default. The ticked models of every saved gateway appear in the **Written by** picker in the brief, so you can switch gateway and model per script without opening settings.

If a provider has no model list endpoint, type the model name instead.

### Image and video models

Each gateway has an **Images and videos** section with a separate BASE_URL_API, model, size and optional API_KEY for images and for videos.

- A blank base URL or key falls back to the gateway's own.
- A blank model turns that kind of media off.
- Size is sent only if you fill it in.
- **List available image models** and **video models** ask that address for its models. Providers return every model they have, so names that look like image or video models are listed first.

## Your work

Nothing is kept only in the browser.

| Location | Contents |
| --- | --- |
| `data/history.json` | Every finished script (brief, plan and script), with no limit. Listed under **History**. |
| `data/media/` | Every generated image and video, linked from its script. |
| `data/gateway.json` | Your saved gateways and their keys. |

Reopening a script from History shows its media again. Redoing an image or video keeps the earlier file on disk and shows the newest. If a provider returns a link instead of a file, the file is downloaded and stored too.

To back up your work or move it to another machine, copy the `data/` folder.

### The download package

**Download .zip** produces one archive per script, named `<date>_<platform>_<title>.zip`, for example `2026-11-10_douyin_AI-落地的三个坑.zip`. Titles keep their letters in any language, with punctuation and spaces turned into hyphens, 40 characters at most. Inside is one folder of the same name:

```
script.md                              the full script, in the interface language
script.json                            brief, plan, script, and a list of the media files
voiceover.txt                          spoken text only, one scene per paragraph
images/scene-01_00m00s-00m04s.png      latest image per scene
videos/scene-01_00m00s-00m04s.mp4      latest clip per scene
```

When a scene has several images, each file name gains a number, and its role where there is one: `…_1.png`, or `…_1-start.png` and `…_2-end.png`.

## Privacy and security

- **Local only.** The server listens on `127.0.0.1` and refuses cross-origin API calls.
- **Keys stay on the server.** Each key is stored with its own gateway in `data/gateway.json` (file mode 600). The browser only ever receives a masked preview.
- **Keys cannot leak to another service.** Changing a gateway's provider or base URL clears its saved key.
- **Out of version control.** `data/` is git-ignored.

Your brief and reference material are sent to the model provider you choose, and to no one else.

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
| `DATA_DIR` | Where history and media are stored | `data/` |
| `GATEWAY_CONFIG_FILE` | Where saved gateways are stored | `data/gateway.json` |
| `LLM_PROVIDER` | Provider preset for the starting gateway | Demo |
| `BASE_URL_API`, `LLM_BASE_URL` | Base URL for the starting gateway | The preset's |
| `API_KEY`, `LLM_API_KEY` | API key for the starting gateway | None |
| `LLM_MODEL` | Model for the starting gateway | The preset's |
| `IMAGE_BASE_URL_API`, `IMAGE_MODEL`, `IMAGE_API_KEY` | Image generation defaults | Off |
| `VIDEO_BASE_URL_API`, `VIDEO_MODEL`, `VIDEO_API_KEY` | Video generation defaults | Off |

## For developers

Video Scripter is plain Node.js with no dependencies and no build step.

```bash
npm run dev
```

```bash
npm test
```

`npm run dev` restarts the server when a file changes. `npm test` runs the suite with `node --test`.

### Project layout

```
server.mjs              HTTP server, API routes, static files
src/gateway/            providers, config store, streaming client, demo provider
src/platforms.mjs       per-platform writing, publishing and compliance guidance
src/frameworks.mjs      script structures and their stage timing
src/styles.mjs          visual styles for images and clips
src/shots.mjs           how several images of one scene relate (multi-image modes)
src/prompt.mjs          brief -> timeline + prompts; model reply -> script
src/store.mjs           saved history and generated media (data/)
src/package.mjs         the downloadable .zip for one script (src/zip.mjs writes the archive)
public/                 the web UI
test/                   node --test
```

### Make it yours

| To change | Edit |
| --- | --- |
| How a platform's scripts read | Its entry in `src/platforms.mjs`. The text goes straight into the system prompt. |
| Script structures and stage timing | `src/frameworks.mjs` |
| Visual styles | `src/styles.mjs` |
| Multi-image modes | `src/shots.mjs` |
| Provider presets | `src/gateway/providers.mjs` |
| Interface translations | `public/i18n.js` |

The Golden retention structure comes from the B2B 4K short-video skill (hook, suspense anchor, three value waves, structured wrap, cold close), as do the Chinese rules that keep English on screen and out of the voiceover.

### Wire protocols

Two protocols are implemented in `src/gateway/client.mjs`, both streaming: OpenAI-compatible `chat/completions` and Anthropic `messages`.

| Purpose | Request |
| --- | --- |
| List models | `GET {base}/models`, or `/v1/models` for Anthropic |
| Generate an image | `POST {base}/images/generations` |
| Start a video | `POST {base}/videos` |
| Check a video | `GET {base}/videos/{id}` |
| Fetch a video | `GET {base}/videos/{id}/content` |

Image and video generation use the OpenAI-compatible media endpoints.

### HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/meta` | Platforms, frameworks and provider presets |
| `GET` | `/api/gateway/config` | Every saved gateway (keys masked) and the one in use |
| `PUT` | `/api/gateway/config` | Create a gateway, or update the one with the given `id`. `activate: true` puts it in use |
| `POST` | `/api/gateway/select` | `{ id, model? }` Choose the gateway, and one of its enabled models, that writes scripts |
| `POST` | `/api/gateway/delete` | `{ id }` Delete a gateway |
| `POST` | `/api/gateway/test` | Test the settings in the body without saving |
| `POST` | `/api/gateway/models` | List the provider's models for the settings in the body without saving. `kind: "image" \| "video"` asks at that kind's address instead |
| `GET` | `/api/history` | Every saved script, newest first |
| `POST` | `/api/history` | Save a script |
| `POST` | `/api/history/package` | `{ id, markdown }` Returns the script's `.zip` |
| `POST` | `/api/media/image` | `{ visual, camera, historyId, sceneId }` Makes and stores an image, returns `{ url }` |
| `POST` | `/api/media/video` | `{ visual, camera, start, end }` Starts a video job |
| `POST` | `/api/media/video/status` | `{ id, historyId, sceneId }` Polls a job and stores the file when ready |
| `GET` | `/media/<file>` | A stored image or video |
| `POST` | `/api/generate` | Server-sent events: `plan`, `delta`, `done` or `error` |
