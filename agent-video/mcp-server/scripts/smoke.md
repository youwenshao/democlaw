# Free, on-device smoke test

Runs the entire DemoClaw pipeline end-to-end with **no paid APIs**:

- **Narration:** caller-provided text (the LLM is skipped via `pages[].narration`).
- **TTS:** Edge TTS (free, via `uvx edge-tts`) — exercises the duration timing tier.
- **Host:** local file output (no upload).

This is the recommended way to verify the timing engine + post-production locally
before wiring in paid providers (Claude/ElevenLabs/Mux) or the deferred MisoTTS.

## Prerequisites

```bash
npm i -g agent-browser && agent-browser install   # browser automation + Chrome
brew install ffmpeg                                # ffmpeg + ffprobe
# uvx comes with uv: https://docs.astral.sh/uv/
```

Verify they are on PATH:

```bash
agent-browser --version && ffmpeg -version | head -1 && uvx --version
```

## Run

Point it at any locally running web app (e.g. AEGIS on its dev port):

```bash
cd mcp-server
node scripts/smoke.mjs http://localhost:3000
# or: npm run smoke -- http://localhost:3000
```

On success you'll get JSON like:

```json
{
  "success": true,
  "url": "file:///Users/you/Movies/agent-recordings/session-...//output.mp4",
  "host": "local",
  "pagesRecorded": 1,
  "sessionDir": "/Users/you/Movies/agent-recordings/session-..."
}
```

Open the `url` to watch the narrated recording. All intermediate artifacts
(`narration.json`, `timing.json`, `marks.json`, `result.json`, audio clips,
`recording.webm`) remain in `sessionDir` for inspection.

## Stage-by-stage (inspect/retry)

To review the auto-generated narration before TTS, or to swap a provider mid-flight,
call the discrete MCP tools instead of the orchestrator:

```
generate_narration  -> review narration.json
synthesize_speech   -> review timing.json (swap tts provider here if needed)
record_performance  -> recording.webm + marks.json
produce_video       -> output.mp4 + result.json
```

Each takes the `sessionId` returned by the previous stage.
