# Video Scripter

Script creator for short social video. One brief in, one platform-specific script out per platform:

| Language | Platforms |
| --- | --- |
| 中文 | 视频号 (WeChat Channels), 抖音 (Douyin) |
| English | TikTok, Instagram Reels, YouTube Shorts |

Each script contains three hook options, a timed scene list (voiceover, on-screen text, visual, camera, sound), a voiceover-only view, and a publishing package (titles, cover text, description, hashtags, pinned comment). Export as Markdown or JSON.

## Run

Needs Node 20 or newer. There are no dependencies to install.

```bash
npm start
```

Open http://localhost:3789. It starts in demo mode (placeholder text, no model). Click **LLM settings** to connect a model.

## LLM gateway

Generation goes through a gateway: a provider, its base URL, an API key and a model.

| Setting | UI field | Environment variable |
| --- | --- | --- |
| Provider | Provider | `LLM_PROVIDER` |
| Base URL | BASE_URL_API | `BASE_URL_API` (or `LLM_BASE_URL`) |
| API key | API_KEY | `API_KEY` (or `LLM_API_KEY`) |
| Model | Default model | `LLM_MODEL` |

**Saved gateways.** Under **LLM settings** you can save any number of gateways (one per provider or account), edit or delete them, and tick "Use this gateway to write scripts" on the one you want. They are written to `data/gateway.json` (git-ignored, mode 600) and take precedence over environment variables, which only supply the starting gateway when nothing is saved. Each key stays on the server with its own gateway; the browser only receives a masked preview. Changing a gateway's provider or base URL clears its saved key so it cannot be sent to a different service.

**Models.** "List available models" asks the provider which models your key can use (`GET {base}/models`, or `/v1/models` for Anthropic). Tick the ones you want to offer and pick a default. The ticked models of every saved gateway appear in the **Written by** picker in the brief, so you can switch gateway and model per script without opening settings. If a provider has no model list endpoint, type the model name instead.

**Images and videos.** Each gateway has an "Images and videos" section with a separate BASE_URL_API, model, size and optional API_KEY for images and for videos. A blank base URL or key falls back to the gateway's own; a blank model turns that kind off. "List available image models" / "video models" asks that address for its models; providers return every model they have, so names that look like image or video models are listed first. Once a model is set for the gateway in use, every scene of a script gets **Generate image** / **Generate video** buttons that turn its Visual and Camera notes into a 9:16 frame or clip. Both use the OpenAI-compatible media endpoints: `POST {base}/images/generations` for images, and `POST {base}/videos`, `GET {base}/videos/{id}`, `GET {base}/videos/{id}/content` for videos (clip length is the shortest of 4, 8 or 12 seconds that covers the scene). Size is sent only if you fill it in. Environment defaults: `IMAGE_BASE_URL_API`, `IMAGE_MODEL`, `IMAGE_API_KEY`, `VIDEO_BASE_URL_API`, `VIDEO_MODEL`, `VIDEO_API_KEY`. Tick "Also generate an image for every scene" in the brief to have the images made automatically as soon as a script is written. **Images per scene** (1 to 3, default 1) sets how many alternatives each Generate image click, or the automatic run, makes for a scene; each one is a separate request to the image model.

Provider presets: OpenAI, Anthropic, DeepSeek, 通义千问, 豆包, Moonshot, 智谱, Gemini, OpenRouter, Ollama, plus custom OpenAI-compatible and Anthropic-compatible endpoints. Preset base URLs and model names are starting points; edit them to match your account. Add a preset in `src/gateway/providers.mjs`.

Two wire protocols are implemented in `src/gateway/client.mjs`: OpenAI-compatible `chat/completions` and Anthropic `messages`, both streaming.

## Visual style

The brief has a **Visual style** picker with 27 looks in five groups: live action (cinematic, documentary, phone-shot vlog, studio product, bright lifestyle, modern workplace, macro detail), illustration (flat vector, isometric, hand-drawn sketch, watercolour, Chinese ink, anime, comic pop, paper collage), 3D and stop motion (stylised 3D, claymation, glossy 3D objects), graphics and data (motion infographic, minimal geometric, tech interface, screen recording) and era and mood (retro film, neon night, dark and moody, pixel art, surreal dream).

Pick one, or two to blend; the first one picked leads and a third pick replaces the oldest. The choice does two things: the scriptwriter is told what the style can show, so each scene's Visual and Camera notes suit it, and every image or video prompt for that script carries the style description. A script written without a style uses whatever is selected when you generate its media. Styles live in `src/styles.mjs`; add or edit entries there.

## Language

The **中文 / English** button in the top bar switches the interface between English and Simplified Chinese (it follows the browser language until you choose). This is separate from the script language, which follows the platform. Translations are in `public/i18n.js`; messages that come from the server or the model provider stay in English. 中文说明见 [README.zh-CN.md](README.zh-CN.md).

## Saved work

Nothing is kept only in the browser. Every finished script is appended to `data/history.json` (brief, plan, script) and is listed under **History**, with no limit. Every generated image and video is written to `data/media/` and linked from its script, so reopening a script from History shows its media again. Redoing an image or video keeps the earlier file on disk and shows the newest. If a provider returns a link instead of the file, the file is downloaded and stored too. `data/` is git-ignored; back it up or copy it to move your work. Set `DATA_DIR` to store it elsewhere.

**Download .zip** on a script packs everything for it into one archive, named `<date>_<platform>_<title>.zip` (for example `2026-11-10_douyin_AI-落地的三个坑.zip`; titles keep their letters in any language, with punctuation and spaces turned into hyphens, 40 characters at most). Inside is one folder of the same name:

```
script.md                              the full script, in the interface language
script.json                            brief, plan, script, and a list of the media files
voiceover.txt                          spoken text only, one scene per paragraph
images/scene-01_00m00s-00m04s.png      latest image per scene (…_1.png, …_2.png, …_3.png when there are several)
videos/scene-01_00m00s-00m04s.mp4      latest clip per scene
```

The **☾ Dark / ☀ Light** button in the top bar switches theme. Until you choose, the page follows the system setting.

## Layout

```
server.mjs              HTTP server, API routes, static files
src/gateway/            providers, config store, streaming client, demo provider
src/platforms.mjs       per-platform writing, publishing and compliance guidance
src/frameworks.mjs      script structures and their stage timing
src/styles.mjs          visual styles for images and clips
src/prompt.mjs          brief -> timeline + prompts; model reply -> script
src/store.mjs           saved history and generated media (data/)
src/package.mjs         the downloadable .zip for one script (src/zip.mjs writes the archive)
public/                 the web UI (no build step)
test/                   node --test
```

To change how a platform's scripts read, edit its entry in `src/platforms.mjs`; the text goes straight into the system prompt. The "Golden retention" structure comes from the B2B 4K short-video skill (hook, suspense anchor, three value waves, structured wrap, cold close), as do the Chinese rules that keep English on screen and out of the voiceover.

## API

- `GET /api/meta` platforms, frameworks, provider presets
- `GET /api/gateway/config` every saved gateway (keys masked) and the one in use
- `PUT /api/gateway/config` create a gateway, or update the one with the given `id`; `activate: true` puts it in use
- `POST /api/gateway/select` `{ id, model? }` choose the gateway, and one of its enabled models, that writes scripts
- `POST /api/gateway/delete` `{ id }`
- `POST /api/gateway/test` test the settings in the body without saving
- `POST /api/gateway/models` list the provider's models for the settings in the body without saving; `kind: "image" | "video"` asks at that kind's address instead
- `GET /api/history` every saved script, newest first; `POST /api/history` saves one
- `POST /api/history/package` `{ id, markdown }` returns the script's `.zip`
- `POST /api/media/image` `{ visual, camera, historyId, sceneId }` makes and stores an image, returns `{ url }`
- `POST /api/media/video` `{ visual, camera, start, end }` starts a job; `POST /api/media/video/status` `{ id, historyId, sceneId }` polls it and stores the file when ready
- `GET /media/<file>` a stored image or video
- `POST /api/generate` server-sent events: `plan`, `delta`, `done` or `error`

The server listens on 127.0.0.1 only and refuses cross-origin API calls.
# Video-Scripter
# Video-Scripter
