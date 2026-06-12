// Auto-generate goals.json for the critique loop from narration artifacts.

import { writeArtifact } from "../session.js";
import { isAdminUrl } from "../adminSession.js";

const DEFAULT_WPM_RANGE = [110, 170];

function sceneIntent(page, clipNum, persona) {
  if (page.hint) {
    const short = page.hint.split(".")[0];
    return short.length > 120 ? `${short.slice(0, 117)}...` : short;
  }
  const firstSeg = page.segments?.[0]?.text || "";
  if (firstSeg) {
    return firstSeg.length > 120 ? `${firstSeg.slice(0, 117)}...` : firstSeg;
  }
  try {
    const path = new URL(page.url).pathname;
    return `Scene ${clipNum}: ${path}`;
  } catch {
    return `Scene ${clipNum}`;
  }
}

function mustShowForPage(page) {
  const items = [];
  try {
    const path = new URL(page.url).pathname;
    if (path.includes("playground") || page.url.includes("5333")) items.push("Playground");
    if (path.includes("dashboard")) items.push("Admin dashboard");
    if (path.includes("users")) items.push("Users table");
    if (path.includes("submissions")) items.push("Submissions list");
    if (path.includes("security")) items.push("Security", "Email Whitelist");
    if (path.includes("rubrix")) items.push("RubriX connection");
    if (path.includes("login")) items.push("Admin login");
  } catch {
    /* ignore */
  }
  if (page.segments?.some((s) => s.action?.type === "fillName")) {
    items.push("essay input", "Submit");
  }
  if (page.hint?.toLowerCase().includes("score")) items.push("grading results");
  return [...new Set(items)];
}

function mustSayForPage(page, clipNum, pages) {
  const say = [];
  if (page.url?.includes("5333")) say.push("AI grading", "teachers", "CritiX");
  if (isAdminUrl(page.url)) say.push("admin", "CritiX Admin");
  if (page.hint?.toLowerCase().includes("score")) say.push("scores", "feedback");
  if (clipNum === 1) say.push("hook", "product");
  if (clipNum === pages.length) say.push("outcome", "next step");
  return [...new Set(say)];
}

function avoidForPage(page, clipNum, pages) {
  const avoid = ["invented scores", "invented numbers"];
  if (page.url?.includes("5333")) avoid.push("admin console details");
  if (isAdminUrl(page.url)) avoid.push("playground grading flow");
  if (clipNum > 1 && clipNum < pages.length) avoid.push("redundant recap");
  return [...new Set(avoid)];
}

export function buildGoalsFromNarration(narration) {
  const pages = narration.pages || [];
  return {
    persona: narration.persona,
    scenes: pages.map((page, i) => ({
      clipNum: i + 1,
      intent: sceneIntent(page, i + 1, narration.persona),
      mustShow: mustShowForPage(page),
      mustSay: mustSayForPage(page, i + 1, pages),
      avoid: avoidForPage(page, i + 1, pages),
      targetWpmRange: DEFAULT_WPM_RANGE,
    })),
    story: {
      open: "Problem → product hook",
      close: "Outcome / admin operations wrap-up",
      throughline: narration.persona?.includes("admin")
        ? "Admin operations end-to-end"
        : "Teacher workflow through admin operations",
    },
    createdAt: new Date().toISOString(),
    source: "auto",
  };
}

export function writeGoalsFromNarration(sessionId, narration) {
  const goals = buildGoalsFromNarration(narration);
  writeArtifact(sessionId, "goals.json", goals);
  return goals;
}
