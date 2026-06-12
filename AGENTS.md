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

Providers resolve from env (DeepSeek narration, Edge TTS, local file output) and
manifest `providers.postProd` (OpenScreen + synthetic cursor). Use `npm run aegis-demo:fast`
for ffmpeg-only output during iteration.
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

## Auto-critique loop (ralph-loop)

**Enabled by default** for `create_narrated_recording`, `npm run aegis-demo`, `:phase2`, and
`:combined`. Disable with `--no-critique` (CLI) or `critique: { enabled: false }` (MCP). The
orchestrator auto-writes `goals.json` and `critique.json`; pacing fixes iterate on ffmpeg, then
OpenScreen polish runs once on the accepted cut.

Manual / partial continuation (see
[`.cursor/rules/democlaw-critique.mdc`](.cursor/rules/democlaw-critique.mdc)):

```text
generate_narration → write goals.json
synthesize_speech → record_performance
assess_timing → agent writes critique.json
→ scene-fix or full-redo (max 3 iterations, postProd=ffmpeg)
→ produce_video with postProd=openscreen (final polish only; preset demo-with-cursor for cursor)
```

Partial re-record (after a full run):

```text
npm run continue-critique -- <sessionId> --clips=6,7,8,9   # re-record + assess + ffmpeg
npm run continue-critique -- <sessionId> --polish          # final OpenScreen polish
```

Or discrete MCP tools:

```text
synthesize_speech({ sessionId, clipNums: [2] })     // if narration changed
record_performance({ sessionId, clipNums: [2], merge: true })
produce_video({ sessionId, providers: { postProd: { name: "ffmpeg" } } })
```

| Artifact | Writer | Purpose |
|----------|--------|---------|
| `goals.json` | Cursor agent | Per-scene intent, mustShow/mustSay/avoid, target WPM |
| `critique.json` | Cursor agent | Defects vs goals, next action |
| `narration.json` → `grounding` | Stage 1 | Snapshot text for fact-checking |
| `assess_timing` output | MCP tool | Deterministic WPM / pacing flags |

**Iterate on ffmpeg** (`postProd: { name: "ffmpeg" }`) during revisions; run **OpenScreen polish once** on the accepted cut.

### postProd provider (Stage 4)

AEGIS CLI runs (`npm run aegis-demo`, `:phase2`, `:combined`) use OpenScreen polish with synthetic cursor via [`aegis-demo.json`](agent-video/aegis-demo.json). Use `npm run aegis-demo:fast` or `--fast` for ffmpeg-only output during iteration.

```json
{
  "providers": {
    "postProd": {
      "name": "openscreen",
      "preset": "demo-with-cursor"
    }
  }
}
```

Generic MCP/smoke paths default to `ffmpeg`. Override with `DEMOCLAW_POSTPROD_PROVIDER` / `DEMOCLAW_POSTPROD_PRESET` or CLI flags `--post-prod=…` / `--post-prod-preset=…`. OpenScreen adds wallpaper, padding, shadow, auto zoom, and optional synthetic cursor; falls back to ffmpeg on export failure.

Architecture notes (narration LLMs, agent review, cursor/zoom pipeline, planned
`performance.json`): [`agent-video/docs/production-investigation.md`](agent-video/docs/production-investigation.md).

```bash
cd agent-video/mcp-server
npm run assess-timing -- <sessionId>
```

## Phase 1 vs Phase 2

- **Phase 1.5:** Teacher Playground at `http://localhost:5333` — no login. Interactive: types a sample essay, clicks Submit, waits for grading, narrates the real results. Requires Turnstile off locally.
- **Phase 2:** CritiX Admin multi-page tour at `http://localhost:5173/admin/` — login + dashboard, users, submissions, security, rubrix. Credentials loaded from AEGIS `.aegis/state.env` at runtime.

### Phase 2 / combined CLI

```bash
cd agent-video/mcp-server
AEGIS_DEMO_PHASE=2 npm run ensure-aegis
npm run verify-phase2              # optional smoke test
npm run aegis-demo:phase2          # admin tour only
npm run aegis-demo:combined        # Playground + admin in one video
npm run aegis-demo:fast            # ffmpeg-only (skip OpenScreen polish)
```

Set `AEGIS_DEMO_PHASE=1|2|combined` or pass `--phase=…` to `aegis-demo.mjs`. See
[`agent-video/docs/aegis-demo-phase2.md`](agent-video/docs/aegis-demo-phase2.md).

## Manifest

Demo URLs and persona live in [`agent-video/aegis-demo.json`](agent-video/aegis-demo.json).

## MCP server

Registered in [`.cursor/mcp.json`](.cursor/mcp.json). Reload MCP in Cursor after config changes.
