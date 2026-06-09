#!/usr/bin/env node
// Phase 1 AEGIS demo: DeepSeek narration + Edge TTS + local mp4 output.
// Requires AEGIS running (see ensure-aegis.mjs).

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { createNarratedRecording } from "../src/orchestrator.js";
import { loadEnv } from "../src/session.js";
import { resolveProviders } from "../src/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH =
  process.env.AEGIS_DEMO_MANIFEST ||
  join(__dirname, "..", "..", "aegis-demo.json");

loadEnv();

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`Missing demo manifest: ${MANIFEST_PATH}`);
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
}

function ensureAegis() {
  const result = spawnSync("node", [join(__dirname, "ensure-aegis.mjs")], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(1);
  }
}

const manifest = loadManifest();
const phase = manifest.phase1;

ensureAegis();

const providers = resolveProviders();
console.error(
  `[aegis-demo] providers: narration=${providers.narration.name} tts=${providers.tts.name} host=${providers.host.name}`
);

const result = await createNarratedRecording({
  persona: phase.persona,
  pages: phase.pages,
  providers,
});

console.log(JSON.stringify(result, null, 2));
