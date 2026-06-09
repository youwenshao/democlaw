#!/usr/bin/env node
// Zero-paid-API end-to-end smoke run.
//
// Uses caller-provided narration (skips the LLM entirely), free Edge TTS, and
// local file output — so it needs NO API keys. It exercises the full pipeline:
// research snapshot -> TTS (duration tier) -> performance recording -> ffmpeg
// assembly -> local file.
//
// Prerequisites: `agent-browser` (+ `agent-browser install`), `ffmpeg`, and `uvx`.
//
// Usage:
//   node scripts/smoke.mjs [url]
//   node scripts/smoke.mjs http://localhost:3000

import { createNarratedRecording } from "../src/orchestrator.js";
import { loadEnv } from "../src/session.js";

loadEnv();

const url = process.argv[2] || "http://localhost:3000";

const result = await createNarratedRecording({
  persona: "a friendly product guide",
  pages: [
    {
      url,
      narration:
        "Welcome to the demo. This is the landing page, and here is a quick tour of what the app can do.",
    },
  ],
  providers: {
    tts: { name: "edge", voice: process.env.EDGE_TTS_VOICE || "en-US-AriaNeural" },
    host: { name: "local" },
  },
});

console.log(JSON.stringify(result, null, 2));
