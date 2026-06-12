// CritiX Admin session keepalive and re-authentication during long recordings.

import { evalJs, open, setViewport, close } from "./browser.js";
import { runActions, LoginFailedError } from "./actions.js";
import { sleep } from "./session.js";
import { resolveActionScript } from "./actionScript.js";
import {
  ADMIN_LOGIN_PATH,
  LOGIN_PASSWORD_SELECTOR,
  LOGIN_SUBMIT_SELECTOR,
  LOGIN_USERNAME_SELECTOR,
  MAIN_CONTENT_SELECTOR,
  buildLoginEntryActions,
  loadAegisCredentials,
} from "./aegisCredentials.js";

export function isAdminUrl(url) {
  try {
    return new URL(url).pathname.startsWith("/admin");
  } catch {
    return false;
  }
}

export function isAdminLoginUrl(url) {
  try {
    const path = new URL(url).pathname;
    return path === ADMIN_LOGIN_PATH || path.startsWith(`${ADMIN_LOGIN_PATH}/`);
  } catch {
    return false;
  }
}

export function readCurrentPath() {
  const raw = evalJs("window.location.pathname");
  return String(raw).replace(/^"|"$/g, "");
}

export function isOnAdminLoginPage() {
  const path = readCurrentPath();
  return path === ADMIN_LOGIN_PATH || path.startsWith(`${ADMIN_LOGIN_PATH}/`);
}

export function hasAdminMainContent() {
  try {
    const raw = evalJs(
      `!!document.querySelector(${JSON.stringify(MAIN_CONTENT_SELECTOR)})`
    );
    return raw === "true";
  } catch {
    return false;
  }
}

export function findFirstAdminPageIndex(pages = []) {
  return pages.findIndex((p) => isAdminUrl(p.url));
}

export function shouldUseAdminFastSetup(pages, targetClipNum) {
  const adminStart = findFirstAdminPageIndex(pages);
  return adminStart >= 0 && targetClipNum - 1 > adminStart;
}

const LOGIN_ACTION_SELECTORS = new Set([
  LOGIN_USERNAME_SELECTOR,
  LOGIN_PASSWORD_SELECTOR,
  LOGIN_SUBMIT_SELECTOR,
  MAIN_CONTENT_SELECTOR,
]);

function isLoginEntryAction(action) {
  if (!action) return false;
  if (action.type === "authLogin") return true;
  if (action.type === "fill" || action.type === "click" || action.type === "waitFor") {
    return LOGIN_ACTION_SELECTORS.has(action.selector);
  }
  return false;
}

/** Drop login entryActions when session is already authenticated. */
export function filterAdminEntryActions(page) {
  const actions = page.entryActions || [];
  if (page.loginScene && hasAdminMainContent()) {
    return actions.filter((a) => !isLoginEntryAction(a));
  }
  if (!page.loginScene && hasAdminMainContent()) {
    return actions.filter((a) => !isLoginEntryAction(a));
  }
  return actions;
}

function resolveAdminLoginUrl(pages) {
  const idx = findFirstAdminPageIndex(pages);
  if (idx >= 0) return pages[idx].url;
  return "http://localhost:5173/admin/login";
}

let cachedCreds = null;

export function resolveAdminCredentials() {
  if (!cachedCreds) {
    cachedCreds = loadAegisCredentials({});
  }
  return cachedCreds;
}

export async function runLoginActions(creds, { log = console.error } = {}) {
  await runActions(buildLoginEntryActions(creds), { log, failFast: true });
  if (!hasAdminMainContent()) {
    throw new LoginFailedError(
      "CritiX Admin login completed but main content did not appear. " +
        "Run npm run verify-phase2 or npm run setup-critix-admin-auth."
    );
  }
}

export async function ensureAdminSession(creds, { log = console.error } = {}) {
  if (!isOnAdminLoginPage() && hasAdminMainContent()) {
    return false;
  }

  log("[admin] session expired or not authenticated — re-logging in");
  const loginUrl = creds?.loginUrl || "http://localhost:5173/admin/login";
  open(loginUrl);
  await sleep(1200);
  await runLoginActions(creds, { log });
  return true;
}

export async function pingAdminSession({ log = console.error } = {}) {
  if (isOnAdminLoginPage()) return;
  try {
    evalJs(
      "fetch('/api/admin/api-logs?page=1&limit=1',{credentials:'include'}).catch(()=>{})"
    );
    log("[admin] keepalive ping");
  } catch (e) {
    log(`[admin] keepalive ping failed: ${e.message}`);
  }
}

async function retryNavClick(action, creds, { log }) {
  if (!action || action.type !== "click") return;
  await ensureAdminSession(creds, { log });
  await sleep(400);
  await runActions([action], { log, failFast: false });
}

export async function ensureAdminPageReady(page, sceneIndex, creds, { log } = {}) {
  if (!isAdminUrl(page.url) || isAdminLoginUrl(page.url)) return;

  const credsResolved = creds || resolveAdminCredentials();
  await ensureAdminSession(credsResolved, { log });

  if (isOnAdminLoginPage() || !hasAdminMainContent()) {
    throw new LoginFailedError(
      `Scene ${sceneIndex + 1}: admin session not authenticated after re-login`
    );
  }
}

/** Headed pre-flight before a long combined/phase2 recording. */
export async function preflightAdminAuth(pages, { log = console.error } = {}) {
  const adminStart = findFirstAdminPageIndex(pages);
  if (adminStart < 0) return;

  log("[admin] pre-flight auth check (headed)");
  setViewport(1280, 720);
  open(resolveAdminLoginUrl(pages), { headed: true });
  await sleep(1500);
  await ensureAdminSession(resolveAdminCredentials(), { log });
  try {
    close();
  } catch {
    /* best effort */
  }
}

export async function replayAdminFastSetup(timing, targetClipNum, { log, creds } = {}) {
  const pages = timing.pages || [];
  if (!shouldUseAdminFastSetup(pages, targetClipNum)) return false;

  const credsResolved = creds || resolveAdminCredentials();
  const adminStart = findFirstAdminPageIndex(pages);
  const targetIndex = targetClipNum - 1;

  log(`[admin] fast setup for clip ${targetClipNum} (skip phase-1 replay)`);
  setViewport(1280, 720);
  open(resolveAdminLoginUrl(pages), { headed: true });
  await sleep(1500);
  await ensureAdminSession(credsResolved, { log });

  for (let i = adminStart; i < targetIndex; i++) {
    const page = pages[i];
    if (page.loginScene) {
      await sleep(400);
    } else {
      const script = resolveActionScript(page);
      if (script.length > 0) {
        log(`[admin] fast setup scene ${i + 1}: ${script.length} actionScript beat(s)`);
        for (const beat of script) {
          await runActions([beat.action], { log });
        }
        await sleep(400);
      }
    }
    for (const seg of page.segmentTimings || []) {
      if (seg.action) {
        try {
          await runActions([seg.action], { log });
        } catch (e) {
          log(`[admin] fast setup segment action failed on scene ${i + 1}: ${e.message}`);
        }
      }
    }
    await ensureAdminPageReady(page, i, credsResolved, { log });
    await pingAdminSession({ log });
  }

  const target = pages[targetIndex];
  await ensureAdminPageReady(target, targetIndex, credsResolved, { log });
  const targetScript = resolveActionScript(target);
  if (targetScript.length > 0) {
    log(`[admin] fast setup target scene ${targetClipNum}: ${targetScript.length} actionScript beat(s)`);
    for (const beat of targetScript) {
      await runActions([beat.action], { log });
    }
    await sleep(400);
  }

  return true;
}
