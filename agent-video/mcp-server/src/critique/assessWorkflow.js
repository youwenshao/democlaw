// Workflow assessment from session debug.log and marks focus quality.

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { isAdminUrl } from "../adminSession.js";

const FAILED_RE = /\[action\] FAILED (\w+):/g;
const LOGIN_FAIL_RE = /\[action\] FAILED (waitFor|authLogin|fill|click):/i;
const NAV_FAIL_RE =
  /\[action\] FAILED click.*aegis-critix-admin-nav|FAILED clickName.*Email Whitelist/i;
const STUCK_LOGIN_RE = /on \/admin\/login — opening http/i;
const SESSION_EXPIRED_RE = /session expired or not authenticated/i;

export function assessWorkflowFromSession({
  sessionDir,
  timing,
  marksData = {},
  logContent = null,
}) {
  const logPath = join(sessionDir, "debug.log");
  const log =
    logContent ??
    (existsSync(logPath) ? readFileSync(logPath, "utf-8") : "");

  const scenes = [];
  const global = [];

  const pages = timing?.pages || [];
  const focusEvents = marksData?.focusEvents || [];

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const clipNum = i + 1;
    const defects = [];

    if (page.loginScene && log.match(LOGIN_FAIL_RE)) {
      defects.push({
        type: "login_failed",
        severity: "high",
        evidence: "Login action failed in debug.log",
        fix: "Run npm run verify-phase2 or npm run setup-critix-admin-auth",
      });
    }

    if (isAdminUrl(page.url) && !page.loginScene && log.match(NAV_FAIL_RE)) {
      defects.push({
        type: "nav_failed",
        severity: "high",
        evidence: "Admin sidebar nav click failed in debug.log",
        fix: "Ensure authenticated session before nav; re-record admin clips",
      });
    }

    if (log.match(STUCK_LOGIN_RE)) {
      defects.push({
        type: "wrong_page",
        severity: "high",
        evidence: "Recording fell back to direct URL while still on login page",
        fix: "Fix login before recording; avoid URL fallback navigation",
      });
    }

    const clipFocus = focusEvents.filter((e) => e.clipNum === clipNum);
    const actionFocus = clipFocus.filter(
      (e) =>
        e.kind === "action" &&
        e.focus &&
        typeof e.focus.cx === "number" &&
        typeof e.focus.cy === "number"
    );
    const hasNavOrLogin =
      page.loginScene ||
      (page.actionScript || page.entryActions || []).some(
        (a) =>
          a?.action?.type === "click" ||
          a?.action?.type === "clickName" ||
          a?.type === "click" ||
          a?.type === "clickName"
      );

    if (hasNavOrLogin && actionFocus.length === 0 && isAdminUrl(page.url)) {
      defects.push({
        type: "focus_missing",
        severity: "medium",
        evidence: `clip ${clipNum}: no action focusEvents with valid cx/cy`,
        fix: "Re-record scene; verify getBox captures element bounds",
      });
    }

    scenes.push({ clipNum, defects });
  }

  if (log.match(SESSION_EXPIRED_RE)) {
    global.push({
      type: "login_failed",
      severity: "medium",
      evidence: "Admin session expired during recording",
      fix: "Use auth vault profile or shorten Phase 1 before admin handoff",
    });
  }

  const failedCount = [...log.matchAll(FAILED_RE)].length;
  const hasMaterial =
    failedCount > 0 ||
    scenes.some((s) => s.defects.some((d) => d.severity === "high")) ||
    global.length > 0;

  return {
    failedActionCount: failedCount,
    scenes,
    global,
    hasMaterialDefects: hasMaterial,
    verdict: hasMaterial ? "revise" : "pass",
  };
}
