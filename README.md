# DemoClaw

Autonomous narrated demo video generation for web apps, built on a modular fork of
[`muxinc/agent-video`](agent-video/).

**Default target:** [AEGIS](https://github.com/) CritiX teacher app (`http://localhost:5333`).

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
| [`agent-video/docs/aegis-demo-phase2.md`](agent-video/docs/aegis-demo-phase2.md) | Admin tour (future) |

See [`agent-video/README.md`](agent-video/README.md) for architecture, providers, and tool reference.
