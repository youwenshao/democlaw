#!/usr/bin/env node
// Verify CritiX Admin login and sidebar navigation for Phase 2 demo scenes.

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { open, close, snapshot, evalJs } from "../src/browser.js";
import { runActions } from "../src/actions.js";
import { loadEnv, sleep } from "../src/session.js";
import {
  loadAegisCredentials,
  buildLoginEntryActions,
  clickNavAction,
} from "../src/aegisCredentials.js";

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

function currentPath() {
  try {
    return new URL(evalJs("window.location.href")).pathname;
  } catch {
    return evalJs("window.location.pathname");
  }
}

async function runStep(label, actions) {
  console.error(`\n[verify] ${label}`);
  await runActions(actions, { log: console.error });
  await sleep(800);
  const { refs } = snapshot();
  const path = currentPath();
  const refCount = Object.keys(refs).length;
  console.error(`[verify]   path=${path} refs=${refCount}`);
  if (refCount < 3) {
    throw new Error(`${label}: sparse snapshot (${refCount} refs) at ${path}`);
  }
  return { path, refCount };
}

async function main() {
  const manifest = loadManifest();
  const creds = loadAegisCredentials({ manifest });
  console.error(`[verify] credentials from ${creds.source}`);

  const steps = [
    {
      label: "login",
      actions: buildLoginEntryActions(creds),
    },
    {
      label: "nav users",
      actions: [clickNavAction("users"), { type: "wait", ms: 1500 }],
    },
    {
      label: "nav submissions",
      actions: [clickNavAction("submissions"), { type: "wait", ms: 1500 }],
    },
    {
      label: "nav security + email whitelist",
      actions: [
        clickNavAction("security"),
        { type: "wait", ms: 800 },
        { type: "clickName", name: "Email Whitelist" },
        { type: "wait", ms: 1200 },
      ],
    },
    {
      label: "nav rubrix",
      actions: [clickNavAction("rubrix"), { type: "wait", ms: 1500 }],
    },
  ];

  try {
    open("http://localhost:5173/admin/login", { headed: false });
    await sleep(2000);

    const results = [];
    for (const step of steps) {
      results.push(await runStep(step.label, step.actions));
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          steps: results,
        },
        null,
        2
      )
    );
  } finally {
    try {
      close();
    } catch {
      /* best effort */
    }
  }
}

main().catch((err) => {
  console.error(`[verify] FAILED: ${err.message}`);
  process.exit(1);
});
