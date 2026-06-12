// Load CritiX Admin credentials from the AEGIS quickstart state file.
// Never log or commit passwords.

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import { entryActionsToScript } from "./actionScript.js";

export const CRITIX_ADMIN_AUTH_PROFILE =
  process.env.CRITIX_ADMIN_AUTH_PROFILE || "critix-admin";

export const LOGIN_USERNAME_SELECTOR = "[data-testid='aegis-critix-admin-login-username']";
export const LOGIN_PASSWORD_SELECTOR = "[data-testid='aegis-critix-admin-login-password']";
export const LOGIN_SUBMIT_SELECTOR = "[data-testid='aegis-critix-admin-login-submit']";
export const MAIN_CONTENT_SELECTOR = "[data-testid='aegis-critix-admin-main-content']";
export const ADMIN_LOGIN_PATH = "/admin/login";

export const NAV_SELECTORS = {
  dashboard: "[data-testid='aegis-critix-admin-nav-dashboard']",
  users: "[data-testid='aegis-critix-admin-nav-users']",
  submissions: "[data-testid='aegis-critix-admin-nav-submissions']",
  security: "[data-testid='aegis-critix-admin-nav-security']",
  rubrix: "[data-testid='aegis-critix-admin-nav-rubrix']",
};

function parseStateEnv(content) {
  const out = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function resolveAegisRoot(manifest = {}) {
  return (
    process.env.AEGIS_ROOT ||
    manifest.aegisRoot ||
    "/Users/youwen/Projects/AEGIS/evalguide_client"
  );
}

export function loadAegisCredentials({ manifest = {}, aegisRoot } = {}) {
  const root = aegisRoot || resolveAegisRoot(manifest);

  if (process.env.CRITIX_ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
    return {
      username: process.env.CRITIX_ADMIN_USERNAME,
      password: process.env.ADMIN_PASSWORD,
      source: "env",
    };
  }

  const statePath = join(root, ".aegis", "state.env");
  if (!existsSync(statePath)) {
    throw new Error(
      `Missing AEGIS credentials at ${statePath}.\n` +
        `Run ./quickstart.sh in ${root} first, or set CRITIX_ADMIN_USERNAME and ADMIN_PASSWORD in the environment.`
    );
  }

  const state = parseStateEnv(readFileSync(statePath, "utf-8"));
  const username = state.CRITIX_ADMIN_USERNAME;
  const password = state.ADMIN_PASSWORD;

  if (!username || !password) {
    throw new Error(
      `Incomplete credentials in ${statePath} (need CRITIX_ADMIN_USERNAME and ADMIN_PASSWORD).\n` +
        `Re-run ./quickstart.sh in ${root}.`
    );
  }

  return { username, password, source: statePath };
}

const AGENT_BROWSER_BIN = process.env.AGENT_BROWSER_BIN || "agent-browser";

/** True when agent-browser auth vault has the CritiX Admin profile saved. */
export function hasCritixAdminAuthProfile(profile = CRITIX_ADMIN_AUTH_PROFILE) {
  const result = spawnSync(AGENT_BROWSER_BIN, ["auth", "list", "--json"], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0) return false;
  try {
    const jsonStart = result.stdout.indexOf("{");
    const data = JSON.parse(result.stdout.slice(jsonStart >= 0 ? jsonStart : 0));
    const profiles = data?.data?.profiles || data?.profiles || [];
    return profiles.some((p) => (typeof p === "string" ? p : p?.name) === profile);
  } catch {
    return result.stdout.includes(profile);
  }
}

export function buildAuthLoginEntryActions(profile = CRITIX_ADMIN_AUTH_PROFILE) {
  return [
    { type: "authLogin", profile },
    { type: "wait", ms: 1500 },
    {
      type: "waitFor",
      selector: MAIN_CONTENT_SELECTOR,
      timeoutMs: 45000,
    },
  ];
}

export function buildLoginEntryActions({ username, password, useAuthProfile } = {}) {
  if (useAuthProfile !== false && hasCritixAdminAuthProfile()) {
    return buildAuthLoginEntryActions();
  }
  if (!username || !password) {
    throw new Error("buildLoginEntryActions requires username and password when auth profile is unavailable");
  }
  return [
    { type: "fill", selector: LOGIN_USERNAME_SELECTOR, text: username },
    { type: "fill", selector: LOGIN_PASSWORD_SELECTOR, text: password },
    { type: "click", selector: LOGIN_SUBMIT_SELECTOR },
    { type: "wait", ms: 1500 },
    {
      type: "waitFor",
      selector: MAIN_CONTENT_SELECTOR,
      timeoutMs: 45000,
    },
  ];
}

export function clickNavAction(navKey) {
  const selector = NAV_SELECTORS[navKey];
  if (!selector) throw new Error(`Unknown admin nav key: ${navKey}`);
  return { type: "click", selector };
}

export function injectLoginActions(pages, creds) {
  // Manual fill/click for actionScript — auth vault authLogin hangs during record start.
  const loginActions = buildLoginEntryActions({ ...creds, useAuthProfile: false });
  const loginScript = entryActionsToScript(loginActions);
  return pages.map((page) => {
    if (!page.loginScene) return { ...page };
    return {
      ...page,
      loginScene: true,
      entryActions: [...loginActions, ...(page.entryActions || [])],
      actionScript: [
        ...loginScript,
        ...(page.actionScript || []),
      ],
    };
  });
}

export function preparePhase2Pages(manifest, creds, { prependTransition = false } = {}) {
  let pages = injectLoginActions(
    structuredClone(manifest.phase2.pages),
    creds
  );
  if (prependTransition && manifest.combined?.transition) {
    const first = pages[0];
    first.segments = [
      manifest.combined.transition,
      ...(first.segments || []),
    ];
  }
  return pages;
}
