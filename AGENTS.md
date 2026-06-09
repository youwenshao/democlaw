# DemoClaw — Agent Playbook

DemoClaw produces narrated demo videos of web apps via the **narrator** MCP server.
Default target app: **AEGIS** (CritiX teacher UI).

## Prerequisites

1. **Host tools:** `ffmpeg`, `ffprobe`, `agent-browser` (+ `agent-browser install`).
2. **AEGIS running** at `http://localhost:5333`:
   ```bash
   cd /Users/youwen/Projects/AEGIS/evalguide_client
   ./quickstart.sh
   ```
   Do **not** run `quickstart.sh` automatically — it is interactive (10–30 min).
   Only check readiness; tell the user to start AEGIS if it is down.
3. **Env:** [`agent-video/.env`](agent-video/.env) with `DEEPSEEK_API_KEY` and:
   - `DEMOCLAW_NARRATION_PROVIDER=openai`
   - `DEMOCLAW_TTS_PROVIDER=edge`
   - `DEMOCLAW_HOST_PROVIDER=local`

## When the user asks to demo / record AEGIS

### Happy path (one CLI call)

Prefer `npm run aegis-demo` — it loads the **interactive** Phase 1.5 scene script from
[`agent-video/aegis-demo.json`](agent-video/aegis-demo.json) (enable accessibility → type a
sample essay → Submit → wait for grading → narrate the real results) and runs the full
pipeline. Equivalent to calling the **narrator** MCP tool `create_narrated_recording` with
that manifest's `phase1.persona` + `phase1.pages`.

Do **not** pass a bare `{ "pages": [{ "url": "http://localhost:5333" }] }` for AEGIS — that
reverts to the old passive scroll-only tour of a near-empty Flutter accessibility tree.

Providers resolve from env (DeepSeek narration, Edge TTS, local file output).
Output: `file://.../output.mp4` under `~/Movies/agent-recordings/session-*/`.

Scene/action manifest shape (entryActions, reuseTab, per-segment actions, hint) is documented
in [`agent-video/README.md`](agent-video/README.md).

### CLI alternative

```bash
cd agent-video/mcp-server
node scripts/ensure-aegis.mjs   # exit 0 = ready
npm run aegis-demo
```

### Retry / inspect a single stage

| Stage | MCP tool | Artifact |
|-------|----------|----------|
| Page model | `extract_page_model` | `page_model.json` |
| Narration | `generate_narration` | `narration.json` — review before TTS |
| TTS | `synthesize_speech` | `timing.json` + audio clips |
| Recording | `record_performance` | `recording.webm`, `marks.json` |
| Assembly | `produce_video` | `output.mp4`, `result.json` |

Re-run only the failed stage using the same `sessionId`.

## Phase 1 vs Phase 2

- **Phase 1.5 (now):** Teacher Playground at `http://localhost:5333` — no login. Interactive: types a sample essay, clicks Submit, waits for grading, narrates the real results. Requires Turnstile off locally.
- **Phase 2 (later):** CritiX Admin multi-page tour — see [`agent-video/docs/aegis-demo-phase2.md`](agent-video/docs/aegis-demo-phase2.md). Requires admin credentials (login form fill via the same action primitives).

## Manifest

Demo URLs and persona live in [`agent-video/aegis-demo.json`](agent-video/aegis-demo.json).

## MCP server

Registered in [`.cursor/mcp.json`](.cursor/mcp.json). Reload MCP in Cursor after config changes.
