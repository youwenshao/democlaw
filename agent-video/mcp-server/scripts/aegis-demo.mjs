#!/usr/bin/env node
// AEGIS demo: Phase 1 Playground, Phase 2 Admin, or combined tour.
// Requires AEGIS running (see ensure-aegis.mjs).

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { createNarratedRecording } from "../src/orchestrator.js";
import { loadEnv } from "../src/session.js";
import { resolveProviders } from "../src/config.js";
import {
  loadAegisCredentials,
  preparePhase2Pages,
} from "../src/aegisCredentials.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH =
  process.env.AEGIS_DEMO_MANIFEST ||
  join(__dirname, "..", "..", "aegis-demo.json");

loadEnv();

function parseArgs(argv) {
  let phase = process.env.AEGIS_DEMO_PHASE || "1";
  let fast = false;
  let noCritique = false;
  let postProdName;
  let postProdPreset;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--phase" && argv[i + 1]) {
      phase = argv[++i];
    } else if (arg.startsWith("--phase=")) {
      phase = arg.slice("--phase=".length);
    } else if (arg === "--fast") {
      fast = true;
    } else if (arg === "--no-critique") {
      noCritique = true;
    } else if (arg.startsWith("--post-prod=")) {
      postProdName = arg.slice("--post-prod=".length);
    } else if (arg === "--post-prod" && argv[i + 1]) {
      postProdName = argv[++i];
    } else if (arg.startsWith("--post-prod-preset=")) {
      postProdPreset = arg.slice("--post-prod-preset=".length);
    } else if (arg === "--post-prod-preset" && argv[i + 1]) {
      postProdPreset = argv[++i];
    }
  }

  if (!["1", "2", "combined"].includes(phase)) {
    throw new Error(`Invalid phase "${phase}" (expected 1, 2, or combined)`);
  }
  if (postProdName && !["ffmpeg", "openscreen"].includes(postProdName)) {
    throw new Error(`Invalid --post-prod "${postProdName}" (expected ffmpeg or openscreen)`);
  }

  return { phase, fast, noCritique, postProdName, postProdPreset };
}

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(`Missing demo manifest: ${MANIFEST_PATH}`);
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
}

function ensureAegis(phase) {
  const result = spawnSync("node", [join(__dirname, "ensure-aegis.mjs")], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, AEGIS_DEMO_PHASE: phase },
  });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(1);
  }
}

function resolveDemoConfig(manifest, phase) {
  if (phase === "1") {
    return {
      persona: manifest.phase1.persona,
      pages: manifest.phase1.pages,
    };
  }

  const creds = loadAegisCredentials({ manifest });

  if (phase === "2") {
    return {
      persona: manifest.phase2.persona,
      pages: preparePhase2Pages(manifest, creds),
    };
  }

  return {
    persona: manifest.combined.persona,
    pages: [
      ...manifest.phase1.pages,
      ...preparePhase2Pages(manifest, creds, { prependTransition: true }),
    ],
  };
}

function resolveCliProviders(manifest, { fast, postProdName, postProdPreset }) {
  const base = manifest.providers ? { ...manifest.providers } : {};
  if (fast) {
    base.postProd = { name: "ffmpeg" };
  } else if (postProdName || postProdPreset) {
    base.postProd = {
      ...(base.postProd || {}),
      ...(postProdName ? { name: postProdName } : {}),
      ...(postProdPreset ? { preset: postProdPreset } : {}),
    };
  }
  return resolveProviders(base);
}

async function ensurePlaywrightChromium() {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    await browser.close();
  } catch (err) {
    console.error(
      "[aegis-demo] OpenScreen polish requires Playwright Chromium.\n" +
        "Install with:\n\n  cd agent-video/mcp-server && npx playwright install chromium\n"
    );
    if (err?.message) console.error(err.message);
    process.exit(1);
  }
}

const { phase, fast, noCritique, postProdName, postProdPreset } = parseArgs(process.argv);
const manifest = loadManifest();

ensureAegis(phase);

const { persona, pages } = resolveDemoConfig(manifest, phase);
const providers = resolveCliProviders(manifest, { fast, postProdName, postProdPreset });
const critique = noCritique
  ? { enabled: false }
  : { enabled: true, maxIterations: manifest.critique?.maxIterations ?? 3 };

if (providers.postProd.name === "openscreen") {
  await ensurePlaywrightChromium();
}

const postProdLog = providers.postProd.preset
  ? `postProd=${providers.postProd.name} preset=${providers.postProd.preset}`
  : `postProd=${providers.postProd.name}`;

console.error(
  `[aegis-demo] phase=${phase} scenes=${pages.length} critique=${critique.enabled ? `on(max=${critique.maxIterations})` : "off"} providers: narration=${providers.narration.name} tts=${providers.tts.name} host=${providers.host.name} ${postProdLog}`
);

const result = await createNarratedRecording({
  persona,
  pages,
  providers,
  critique,
});

console.log(JSON.stringify(result, null, 2));
