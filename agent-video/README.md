# DemoClaw (agent-video)

Give an AI agent the ability to autonomously navigate a web app and produce a
narrated demo video — research, narration, voiceover, recording, post-production,
and hosting — all over MCP.

Our ambition is **agent-driven demo production for real platforms**: an agent explores
a web app, decides what to show, writes grounded narration, records interactive
performance, and ships a polished video — not a scroll-only homepage tour. The modular
pipeline below exists to serve that goal, not merely for code hygiene.

This is a provider-agnostic fork of the monolithic
[`muxinc/agent-video`](https://github.com/muxinc/agent-video). The two-pass timing
engine (the actual innovation) is preserved; everything around it is now
swappable and individually callable.

## Why we forked muxinc/agent-video

### What the monolith could do

One MCP call turns a URL list into a narrated screencast. That works for static or
marketing pages with a rich DOM and predictable layout. Output targets Mux hosting with
ElevenLabs narration — a good proof of concept, not a production pipeline for complex apps.

### What we needed for platform demos

Real products (Flutter/canvas UIs, multi-page admin consoles, async workflows) need more
than scroll-and-narrate:

- **Interactive scenes, not scroll-only** — click, fill, submit, wait for results
  ([`src/actions.js`](mcp-server/src/actions.js), [`src/sceneReplay.js`](mcp-server/src/sceneReplay.js))
- **Mixed scripted + snapshot-grounded narration** — verbatim segments where the story
  is fixed; auto LLM narration grounded in post-action snapshots where content is dynamic
  ([`src/research.js`](mcp-server/src/research.js))
- **Partial stage retry** — re-run TTS, recording, or assembly without starting over
  ([`index.js`](mcp-server/index.js) tool surface)
- **Auto-critique loop** — assess pacing and workflow, iterate on ffmpeg, polish once
  ([`src/critique/runLoop.js`](mcp-server/src/critique/runLoop.js))
- **Post-production polish** — synthetic cursor, zoom, wallpaper for platform-ready output
  ([`src/polish/`](mcp-server/src/polish/))

A bare `{ url }` page still works — it is just a single scroll-only scene, which is
insufficient for apps like AEGIS CritiX where the accessibility tree is sparse until
you enable semantics and drive real UI interactions.

### What DemoClaw changed

- **Discrete, inspectable stages.** The single `create_narrated_recording` tool is
  split into four tools that exchange JSON artifacts, so an agent can review the
  narration before burning TTS credits, re-run only the performance pass if the
  page changed, or swap a provider mid-flight.
- **Providers configurable at call time.** Narration (Claude / any OpenAI-compatible
  endpoint incl. DeepSeek), TTS (ElevenLabs / Edge TTS / local MisoTTS), and host
  (Mux / local file / S3-compatible) are chosen per call, not at compile time.
- **`extract_page_model` is a first-class primitive.** The accessibility tree +
  element refs are reusable for any web-agent task, not trapped in the video pipeline.
- **Timing survives any TTS.** A tiered timing contract keeps ElevenLabs'
  character-level precision when available and falls back to per-segment synthesis
  + `ffprobe` duration for engines that emit audio only (Edge, MisoTTS).

Agent review gates and planned `performance.json` (cursor/zoom intent) are documented in
[`docs/production-investigation.md`](docs/production-investigation.md).

## Architecture

```
index.js                 thin MCP registry + dispatch
src/
  config.js              resolve providers (call arg > env > smart default)
  session.js             session dirs + JSON artifacts
  browser.js             agent-browser CLI wrapper
  ffmpeg.js              ffmpeg/ffprobe helpers
  pageModel.js           accessibility snapshot primitive
  timing.js              two timing tiers -> uniform segment timings
  research.js            stage 1: snapshots -> narration.json
  synthesize.js          stage 2: TTS -> timing.json (+ audio clips)
  record.js              stage 3: performance pass -> marks.json (+ recording.webm)
  produce.js             stage 4: ffmpeg assemble + host -> result.json (+ output.mp4)
  orchestrator.js        runs all four stages in one call
  narration/  {index, claude, openai}
  tts/        {index, elevenlabs (char), edge (duration), miso (deferred)}
  host/       {index, mux, local, s3}
```

Pipeline: `extract_page_model` -> `generate_narration` -> `synthesize_speech` ->
`record_performance` -> `produce_video` (or `create_narrated_recording` for all-in-one).

## Setup

### 1. Prerequisites

```bash
# browser automation (Rust CLI; Chrome via CDP)
npm i -g agent-browser && agent-browser install

# post-production
brew install ffmpeg            # provides ffmpeg + ffprobe

# free local TTS path uses uvx (https://docs.astral.sh/uv/)
```

> Note: the performance pass uses `agent-browser record start/stop`. Confirm your
> installed `agent-browser` build supports video recording.

### 2. Install dependencies

```bash
cd mcp-server
npm install
```

### 3. Configure (optional)

Copy `.env.example` to **`.env` in this directory** (`agent-video/.env`, parent of
`mcp-server/`). Fill in only what you need. With **no** credentials, the server
defaults to free/local providers (Edge TTS + local file output).

For AEGIS demos with DeepSeek narration, set `DEEPSEEK_API_KEY` and:

```
DEMOCLAW_NARRATION_PROVIDER=openai
DEMOCLAW_TTS_PROVIDER=edge
DEMOCLAW_HOST_PROVIDER=local
```

Credential sniffing also auto-selects DeepSeek when `DEEPSEEK_API_KEY` is present.

### 4. Register the MCP server

Add to your agent's MCP config (e.g. `~/.claude/settings.json` or `.mcp.json`):

```json
{
  "mcpServers": {
    "narrator": {
      "command": "node",
      "args": ["/absolute/path/to/agent-video/mcp-server/index.js"]
    }
  }
}
```

## Providers

Pass a `providers` object to any stage (or the orchestrator):

```json
{
  "providers": {
    "narration": { "name": "openai", "baseUrl": "https://api.deepseek.com", "model": "deepseek-chat", "apiKeyEnv": "DEEPSEEK_API_KEY" },
    "tts":       { "name": "edge", "voice": "en-US-AriaNeural" },
    "host":      { "name": "local" }
  }
}
```

| Layer | Providers | Notes |
|---|---|---|
| narration | `claude`, `openai` | `openai` covers DeepSeek/vLLM/Ollama via `baseUrl` + `apiKeyEnv` |
| tts | `elevenlabs`, `edge`, `miso` | `elevenlabs` = char-timing tier; `edge`/`miso` = duration tier |
| host | `mux`, `local`, `s3` | `local` = file output (default on-device); `s3` works with R2/MinIO |
| postProd | `ffmpeg`, `openscreen` | `ffmpeg` = default concat/mux; `openscreen` = wallpaper/padding/shadow/zoom polish |

Partial re-record (after a full run): `record_performance({ sessionId, clipNums: [2], merge: true })`.  
Partial TTS: `synthesize_speech({ sessionId, clipNums: [2] })`. Preset `demo-with-cursor` enables synthetic cursor overlay and uses the macOS desktop wallpaper as background (override with `DEMOCLAW_WALLPAPER=#0f172a` or an image path).

**Smart defaults:** TTS defaults to `elevenlabs` if `ELEVENLABS_API_KEY` is set, else
`edge`. Host defaults to `mux` if Mux tokens are set, else `local`. Post-production
defaults to `ffmpeg` for generic MCP calls; AEGIS demo manifest sets `openscreen` +
`demo-with-cursor`. Override with `DEMOCLAW_POSTPROD_PROVIDER` / `DEMOCLAW_POSTPROD_PRESET`,
manifest `providers.postProd`, or `aegis-demo.mjs` flags `--fast`, `--post-prod=…`,
`--post-prod-preset=…`.

### Local MisoTTS (deferred — Mac Studio)

[`MisoLabs/MisoTTS`](https://huggingface.co/MisoLabs/MisoTTS) is an 8B (~32.8 GB)
local model. It is intentionally **not bundled** — it realistically needs a machine
like an M2 Ultra (64 GB unified memory). The `miso` provider is wired and ready;
enable it by pointing `MISO_TTS_CMD` at a local inference command that accepts
`--file <text> --out <audio> [--voice <ref-clip>]`:

```bash
MISO_TTS_CMD="uv run python run_misotts.py"   # in the MisoLabsAI/MisoTTS repo
```

## Tools

- `extract_page_model({ url, sessionId? })` — accessibility tree + refs.
- `generate_narration({ persona, pages, providers?, sessionId? })` — writes `narration.json`.
- `synthesize_speech({ sessionId, providers? })` — writes `timing.json` + audio.
- `record_performance({ sessionId })` — writes `marks.json` + `recording.webm`.
- `produce_video({ sessionId, providers? })` — writes `output.mp4` + `result.json`, returns the playback URL. Supports `providers.postProd` (`ffmpeg` | `openscreen`).
- `assess_timing({ sessionId, thresholds? })` — read-only WPM/pacing report for the auto-critique loop.
- `create_narrated_recording({ persona, pages, providers? })` — all four stages in one call.
- `get_element_bounds({ url, selector })` — bounding box of an element.
- `run_demo_actions({ url, actions, headed? })` — open a URL, run declarative actions, return the resulting snapshot. A reusable web-agent primitive for scripting/verifying a scene's actions outside the video pipeline.

### Scenes & actions (Phase 1.5)

`pages` are **scenes**: a URL plus an optional UI state reached by running actions before
narration/recording. This lets a demo click, type, submit, and wait — not just scroll.

`pages` item shape:

```jsonc
{
  "url": "http://localhost:5333",
  "reuseTab": true,                 // continue in the current tab (don't reload) — keeps typed text/results
  "entryActions": [                 // run in the trimmed inter-scene gap (navigation, fill, submit, waits)
    { "type": "enableAccessibility" },
    { "type": "find", "by": "placeholder", "value": "Input text here...", "do": "fill", "text": "..." },
    { "type": "find", "by": "text", "value": "Submit", "do": "click" },
    { "type": "wait", "ms": 18000 }
  ],
  "segments": [                     // scripted narration; each may fire an action on the timeline
    { "text": "...", "scrollTo": "top", "action": { "type": "click", "selector": "@e3" } }
  ],
  "narration": "...",               // OR a single scripted segment
  "hint": "Describe the grading results now visible"  // steers auto-generated narration when no segments/narration
}
```

A bare `{ url }` (or `{ url, narration }`) still works — it's just a single scroll-only scene.

**Action types:** `click`, `type`, `fill`, `keyboardType`, `press`, `find` (`by` = role/text/label/placeholder/…, `do` = click/fill/…), `scrollIntoView`, `wait` (`ms`), `waitFor` (`selector`, `timeoutMs?`), `enableAccessibility` (Flutter semantics unlock), `authLogin` (`profile` — agent-browser auth vault).

**Latency & sync:** `entryActions` (and same-URL `reuseTab` transitions) run in the gap between
scene marks, which post-production trims — so a multi-second `waitFor`/`wait` for async results
never desyncs the narration audio. Mixed narration is supported per scene: scripted segments
(verbatim), auto-generated narration grounded in the post-action snapshot, and a DOM-text
fallback when the accessibility tree is sparse (e.g. Flutter/canvas apps).

## AEGIS demo

With AEGIS running (`./quickstart.sh` in `evalguide_client`):

```bash
cd mcp-server
npm run ensure-aegis              # Phase 1 (default): probes :5333
AEGIS_DEMO_PHASE=2 npm run ensure-aegis   # Phase 2: probes :5173
npm run aegis-demo                # Phase 1.5 Playground (interactive grading)
npm run aegis-demo:phase2         # CritiX Admin tour (login + 5 routes)
npm run aegis-demo:combined       # Playground + Admin in one video
npm run verify-phase2             # smoke-test admin login + nav
```

**Phase 1.5** is an interactive Playground walkthrough: enables Flutter accessibility, types a
sample student essay, clicks **Submit**, waits for real AI grading, then narrates the results.
No login required (Turnstile must be off locally).

**Phase 2** loads admin credentials from `{aegisRoot}/.aegis/state.env`, logs into
`http://localhost:5173/admin/login`, and tours dashboard, users, submissions, security
(Email Whitelist tab), and RubriX integration via sidebar navigation.

Config: [`aegis-demo.json`](aegis-demo.json). Details: [`docs/aegis-demo-phase2.md`](docs/aegis-demo-phase2.md).

## Free, on-device smoke run

Once `agent-browser` + `ffmpeg` are installed, you can run end-to-end against any
local URL with zero paid APIs (free Edge TTS + local file output). See
[`scripts/smoke.md`](mcp-server/scripts/smoke.md).

## Artifacts (per session)

Sessions live in `~/Movies/agent-recordings/session-<id>/`:
`page_model.json`, `narration.json`, `timing.json`, `marks.json`, `result.json`,
plus `recording.webm`, audio clips, and `output.mp4`. Inspect or hand-edit any
artifact, then re-run a single stage.

## Further reading

- [`docs/production-investigation.md`](docs/production-investigation.md) — narration
  LLMs vs Cursor agent review, auto-critique gaps, OpenScreen cursor/zoom pipeline,
  and planned `performance.json` work.
- [`docs/aegis-demo-phase2.md`](docs/aegis-demo-phase2.md) — CritiX Admin tour.
- [`docs/aegis-a11y-hooks.md`](docs/aegis-a11y-hooks.md) — Flutter accessibility.
