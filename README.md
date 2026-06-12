# DemoClaw

Autonomous narrated demo video generation for web apps, built on a modular fork of
[`muxinc/agent-video`](agent-video/).

**Default target:** [AEGIS](https://github.com/) CritiX teacher app (`http://localhost:5333`).

## Why DemoClaw?

We built DemoClaw to produce credible, narrated demo videos for real web platforms
**without a human in the loop** — driven by a Cursor (or other) agent that explores
the app, scripts scenes, records browser performance, and iterates on quality until
the cut is ready to ship.

[`muxinc/agent-video`](https://github.com/muxinc/agent-video) proved the hard part:
the **two-pass timing engine** that keeps narration and browser actions in sync.
DemoClaw preserves that core. What it could not do was support our more ambitious
goal of **agentic, end-to-end demo production for platforms** like CritiX:

| Upstream limitation | What DemoClaw adds |
|---|---|
| One monolithic MCP call — black-box output | Four discrete stages with JSON artifacts an agent can inspect and retry |
| Scroll-only tours from a bare URL list | Interactive scenes: click, type, submit, wait for async results |
| Providers baked in (ElevenLabs, Mux) | Swappable narration, TTS, host, and post-prod per call or via env |
| No quality loop | Auto-critique (ralph-loop) with partial re-record and OpenScreen polish |
| Page model trapped in the pipeline | First-class primitives (`extract_page_model`, `run_demo_actions`) |

The AEGIS demo shows the difference: instead of a passive homepage scroll through an
empty Flutter accessibility tree, DemoClaw types a real student essay, clicks Submit,
waits for AI grading, and narrates the **actual** scores on screen.

Full unsupervised exploration remains the direction — today, AEGIS runs combine curated
scene manifests with agent orchestration via MCP. Planned work (pre-TTS review gates,
`performance.json` for cursor/zoom intent) is documented in
[`agent-video/docs/production-investigation.md`](agent-video/docs/production-investigation.md).

## Quick start

### 1. Prerequisites

```bash
npm i -g agent-browser && agent-browser install
brew install ffmpeg
cd agent-video/mcp-server && npm install
```

### 2. Configure

Copy [`agent-video/.env.example`](agent-video/.env.example) to [`agent-video/.env`](agent-video/.env)
and set `DEEPSEEK_API_KEY` (or other narration/TTS/host keys). The `.env` file lives at
**`agent-video/.env`** (not inside `mcp-server/`).

### 3. Start AEGIS

```bash
cd /Users/youwen/Projects/AEGIS/evalguide_client
./quickstart.sh
```

### 4. Record a demo

```bash
cd agent-video/mcp-server
npm run ensure-aegis    # check :5333 is up
npm run aegis-demo      # Phase 1 Playground → output.mp4
```

Output lands in `~/Movies/agent-recordings/session-*/output.mp4`.

## Cursor agent integration

- **MCP server:** [`.cursor/mcp.json`](.cursor/mcp.json) registers the `narrator` tools.
  Reload MCP in Cursor after changes.
- **Playbook:** [`AGENTS.md`](AGENTS.md)
- **Rule:** [`.cursor/rules/democlaw-aegis.mdc`](.cursor/rules/democlaw-aegis.mdc)

Ask: *"Record an AEGIS demo video"* — the agent should check readiness, then call
`create_narrated_recording` via MCP.

## Repository layout

| Path | Purpose |
|------|---------|
| [`agent-video/mcp-server/`](agent-video/mcp-server/) | Narrator MCP server + pipeline |
| [`agent-video/aegis-demo.json`](agent-video/aegis-demo.json) | Demo URLs, persona, health ports |
| [`agent-video/docs/aegis-demo-phase2.md`](agent-video/docs/aegis-demo-phase2.md) | CritiX Admin multi-page tour |

See [`agent-video/README.md`](agent-video/README.md) for architecture, providers, and tool reference.
