#!/usr/bin/env node
// Save CritiX Admin credentials in agent-browser auth vault (optional session helper).

import { spawnSync } from "child_process";
import { loadEnv } from "../src/session.js";
import {
  loadAegisCredentials,
  resolveAegisRoot,
} from "../src/aegisCredentials.js";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH =
  process.env.AEGIS_DEMO_MANIFEST ||
  join(__dirname, "..", "..", "aegis-demo.json");

const PROFILE = process.env.CRITIX_ADMIN_AUTH_PROFILE || "critix-admin";
const AGENT_BROWSER_BIN = process.env.AGENT_BROWSER_BIN || "agent-browser";

loadEnv();

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) return {};
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
}

const manifest = loadManifest();
const creds = loadAegisCredentials({ manifest });

const result = spawnSync(
  AGENT_BROWSER_BIN,
  [
    "auth",
    "save",
    PROFILE,
    "--url",
    "http://localhost:5173/admin/login",
    "--username",
    creds.username,
    "--password-stdin",
    "--username-selector",
    "[data-testid='aegis-critix-admin-login-username']",
    "--password-selector",
    "[data-testid='aegis-critix-admin-login-password']",
    "--submit-selector",
    "[data-testid='aegis-critix-admin-login-submit']",
  ],
  {
    input: creds.password,
    encoding: "utf-8",
    stdio: ["pipe", "inherit", "inherit"],
  }
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      profile: PROFILE,
      url: "http://localhost:5173/admin/login",
      username: creds.username,
      aegisRoot: resolveAegisRoot(manifest),
    },
    null,
    2
  )
);
