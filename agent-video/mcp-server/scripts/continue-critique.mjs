#!/usr/bin/env node
// Continue auto-critique on an existing session (partial re-record + assess + polish).
// Usage: node scripts/continue-critique.mjs <sessionId> [--clips=6,7,8,9] [--polish]

import { loadEnv } from "../src/session.js";
import { readArtifact, writeArtifact } from "../src/session.js";
import { resolveProviders } from "../src/config.js";
import { runCritiqueIteration } from "../src/critique/runLoop.js";
import { produceVideo } from "../src/produce.js";
import { writeGoalsFromNarration } from "../src/critique/goals.js";

loadEnv();

function parseArgs(argv) {
  const sessionId = argv[2];
  if (!sessionId) {
    throw new Error("Usage: node scripts/continue-critique.mjs <sessionId> [--clips=6,7,8,9] [--polish]");
  }
  let clipNums = null;
  let polishOnly = false;
  for (let i = 3; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--clips=")) {
      clipNums = arg
        .slice("--clips=".length)
        .split(",")
        .map((n) => parseInt(n, 10))
        .filter((n) => Number.isFinite(n));
    } else if (arg === "--polish") {
      polishOnly = true;
    }
  }
  return { sessionId, clipNums, polishOnly };
}

const { sessionId, clipNums, polishOnly } = parseArgs(process.argv);

try {
  readArtifact(sessionId, "goals.json");
} catch {
  const narration = readArtifact(sessionId, "narration.json");
  writeGoalsFromNarration(sessionId, narration);
}

let providers = resolveProviders({});
try {
  const timing = readArtifact(sessionId, "timing.json");
  providers = resolveProviders(timing.providers || {});
} catch {
  /* timing optional for polish-only */
}

if (polishOnly) {
  const result = await produceVideo({
    sessionId,
    providers: {
      ...providers,
      postProd: { name: "openscreen", preset: "demo-with-cursor" },
    },
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const priorCritique = (() => {
  try {
    return readArtifact(sessionId, "critique.json");
  } catch {
    return null;
  }
})();

const iteration = (priorCritique?.iteration || 0) + 1;

const result = await runCritiqueIteration({
  sessionId,
  providers,
  iteration,
  clipNums: clipNums || undefined,
  merge: true,
});

if (result.critique.verdict === "pass") {
  const polished = await produceVideo({
    sessionId,
    providers: {
      ...providers,
      postProd: { name: "openscreen", preset: "demo-with-cursor" },
    },
  });
  console.log(JSON.stringify({ ...result, final: polished }, null, 2));
} else {
  console.log(JSON.stringify(result, null, 2));
}
