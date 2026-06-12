// Scene replay primitives for full and partial performance recording.

import { join } from "path";
import { copyFileSync } from "fs";
import {
  setViewport,
  open,
  close,
  recordStart,
  recordStop,
  enableSmoothScroll,
  pageDimensions,
  scrollIntoView,
  scrollToTop,
  scrollToBottom,
  evalJs,
  getBox,
} from "./browser.js";
import { runActions, resolveRefByName } from "./actions.js";
import { sleep } from "./session.js";
import { extractSegment, probeDurationMs } from "./ffmpeg.js";
import {
  isAdminUrl,
  isAdminLoginUrl,
  ensureAdminPageReady,
  pingAdminSession,
  replayAdminFastSetup,
  resolveAdminCredentials,
  ensureAdminSession,
} from "./adminSession.js";

import {
  FOCUS_ACTIONS,
  resolveActionScript,
} from "./actionScript.js";

export { FOCUS_ACTIONS, entryActionsToScript, resolveActionScript } from "./actionScript.js";

function actionSelector(action) {
  if (!action) return null;
  if (action.selector) return action.selector;
  if (action.type === "clickName" || action.type === "fillName") {
    try {
      return resolveRefByName(action.name, { exact: action.exact });
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeFocus(bounds, viewport) {
  const [vw, vh] = viewport;
  const cx = (bounds.x + bounds.width / 2) / vw;
  const cy = (bounds.y + bounds.height / 2) / vh;
  return {
    cx: Math.min(1, Math.max(0, cx)),
    cy: Math.min(1, Math.max(0, cy)),
  };
}

function scrollFocusForTarget(scrollTo) {
  if (scrollTo === "bottom") return { cx: 0.5, cy: 0.8, kind: "scroll" };
  if (scrollTo === "top") return { cx: 0.5, cy: 0.2, kind: "scroll" };
  return { cx: 0.5, cy: 0.5, kind: "scroll" };
}

export function captureFocusEvent({ clipNum, timeMs, action, viewport, log }) {
  const selector = actionSelector(action);
  if (!selector) return null;
  try {
    const bounds = getBox(selector);
    if (!bounds || bounds.width <= 0) return null;
    return {
      clipNum,
      timeMs,
      kind: "action",
      action,
      focus: normalizeFocus(bounds, viewport),
      bounds,
    };
  } catch (e) {
    log(`Focus capture failed for ${action?.type}: ${e.message}`);
    return null;
  }
}

export function captureScrollFocusEvent({ clipNum, timeMs, scrollTo, viewport, page }) {
  const refId = String(scrollTo || "").replace(/^@/, "");
  const refEntry = page?.grounding?.refSummary?.find((r) => r.id === refId);
  if (refEntry?.focusBounds) {
    return {
      clipNum,
      timeMs,
      kind: "scroll",
      scrollTo,
      focus: refEntry.focusBounds,
    };
  }
  const focus = scrollFocusForTarget(scrollTo);
  return {
    clipNum,
    timeMs,
    kind: focus.kind,
    scrollTo,
    focus: { cx: focus.cx, cy: focus.cy },
  };
}

/** Pure: describe setup steps for partial re-record (used in tests). */
export function buildSetupActionPlan(timing, targetClipNum) {
  const steps = [];
  const targetIndex = targetClipNum - 1;
  if (targetIndex < 0 || targetIndex >= timing.pages.length) {
    throw new Error(`Invalid clipNum ${targetClipNum}`);
  }

  steps.push({ phase: "open", url: timing.pages[0].url });

  for (let i = 0; i < targetIndex; i++) {
    const page = timing.pages[i];
    if (i > 0 && !page.reuseTab) {
      steps.push({ phase: "navigate", clipNum: i + 1, url: page.url });
    }
    const script = resolveActionScript(page);
    if (script.length) {
      steps.push({ phase: "actionScript", clipNum: i + 1, count: script.length });
    }
    const segActions = (page.segmentTimings || [])
      .filter((s) => s.action)
      .map((s) => s.action);
    if (segActions.length) {
      steps.push({ phase: "segmentActions", clipNum: i + 1, count: segActions.length });
    }
  }

  const target = timing.pages[targetIndex];
  if (targetIndex > 0 && !target.reuseTab) {
    steps.push({ phase: "navigate", clipNum: targetClipNum, url: target.url });
  }
  const targetScript = resolveActionScript(target);
  if (targetScript.length) {
    steps.push({ phase: "actionScript", clipNum: targetClipNum, count: targetScript.length });
  }

  return steps;
}

export async function navigateToScene(page, sceneIndex, log, { creds } = {}) {
  const credsResolved = creds || (isAdminUrl(page.url) ? resolveAdminCredentials() : null);

  if (sceneIndex > 0) {
    if (page.reuseTab) {
      log(`Scene ${sceneIndex + 1}: reusing current tab (no reload)`);
    } else {
      open(page.url);
      await sleep(1000);
    }
  } else if (credsResolved && isAdminUrl(page.url) && isAdminLoginUrl(page.url)) {
    open(page.url);
    await sleep(1000);
  }

  if (credsResolved && isAdminUrl(page.url)) {
    if (isAdminLoginUrl(page.url)) {
      if (!page.loginScene) {
        await ensureAdminSession(credsResolved, { log });
      }
    } else {
      await ensureAdminPageReady(page, sceneIndex, credsResolved, { log });
    }
  }

  if (credsResolved && isAdminUrl(page.url) && !isAdminLoginUrl(page.url)) {
    await pingAdminSession({ log });
  }
}

async function replayPriorSceneState(page, sceneIndex, log, { creds } = {}) {
  await navigateToScene(page, sceneIndex, log, { creds });
  const script = resolveActionScript(page);
  for (const beat of script) {
    try {
      await runActions([beat.action], { log, failFast: page.loginScene });
    } catch (e) {
      log(`Setup: failed actionScript on scene ${sceneIndex + 1}: ${e.message}`);
    }
  }
  const segTimings = page.segmentTimings || [];
  for (const seg of segTimings) {
    if (seg.action) {
      try {
        await runActions([seg.action], { log });
      } catch (e) {
        log(`Setup: failed segment action ${seg.action?.type} on scene ${sceneIndex + 1}: ${e.message}`);
      }
    }
  }
}

export async function replaySceneSetup(timing, targetClipNum, { log, creds } = {}) {
  const targetIndex = targetClipNum - 1;
  if (targetIndex < 0 || targetIndex >= timing.pages.length) {
    throw new Error(`Invalid clipNum ${targetClipNum}`);
  }

  const credsResolved = creds || resolveAdminCredentials();
  const usedFastAdmin = await replayAdminFastSetup(timing, targetClipNum, {
    log,
    creds: credsResolved,
  });
  if (usedFastAdmin) return;

  setViewport(1280, 720);
  open(timing.pages[0].url, { headed: true });
  await sleep(2000);

  for (let i = 0; i < targetIndex; i++) {
    await replayPriorSceneState(timing.pages[i], i, log, { creds: credsResolved });
  }

  await navigateToScene(timing.pages[targetIndex], targetIndex, log, { creds: credsResolved });
}

function buildTimelineBeats(page, segTimings) {
  const beats = [];

  for (const beat of resolveActionScript(page)) {
    beats.push({
      atMs: beat.atMs,
      type: "action",
      action: beat.action,
      failFast: !!page.loginScene,
    });
  }

  for (const seg of segTimings) {
    beats.push({
      atMs: seg.startTimeMs ?? 0,
      type: "segment",
      seg,
    });
  }

  beats.sort((a, b) => a.atMs - b.atMs);
  return beats;
}

async function runSegmentScroll(seg, page, log) {
  if (seg.scrollTo === "top") {
    scrollToTop();
  } else if (seg.scrollTo === "bottom") {
    scrollToBottom();
  } else if (seg.scrollTo) {
    const ref = String(seg.scrollTo).replace(/^@/, "");
    if (/^e\d+$/i.test(ref)) {
      scrollToTop();
    } else {
      try {
        scrollIntoView(seg.scrollTo);
      } catch (e) {
        log(`Failed to scroll to ref @${seg.scrollTo}: ${e.message}`);
        scrollToTop();
      }
    }
  }
  await sleep(350);
}

export async function performSceneTimeline(
  page,
  segTimings,
  viewport,
  clipNum,
  { log, onFocusEvent }
) {
  enableSmoothScroll();
  log(`Page dimensions: ${pageDimensions()}`);

  const focusEvents = [];
  const beats = buildTimelineBeats(page, segTimings);

  if (segTimings.length === 0 && beats.length === 0) {
    log(`WARNING: no segment timings for clip ${clipNum}; using flat wait`);
    await sleep(page.pageDurationMs);
    return focusEvents;
  }

  const segStart = Date.now();
  let beatIndex = 0;

  while (beatIndex < beats.length) {
    const beat = beats[beatIndex];
    const waitMs = beat.atMs - (Date.now() - segStart);
    if (waitMs > 0) await sleep(waitMs);

    const sceneTimeMs = Date.now() - segStart;

    if (beat.type === "action") {
      if (FOCUS_ACTIONS.has(beat.action?.type)) {
        const focusEvt = captureFocusEvent({
          clipNum,
          timeMs: sceneTimeMs,
          action: beat.action,
          viewport,
          log,
        });
        if (focusEvt) {
          focusEvents.push(focusEvt);
          onFocusEvent?.(focusEvt);
        }
      }

      try {
        await runActions([beat.action], { log, failFast: beat.failFast });
      } catch (e) {
        log(`Failed actionScript ${beat.action?.type}: ${e.message}`);
        if (beat.failFast) throw e;
      }
    } else if (beat.type === "segment") {
      const seg = beat.seg;

      if (seg.action) {
        const focusEvt = captureFocusEvent({
          clipNum,
          timeMs: sceneTimeMs,
          action: seg.action,
          viewport,
          log,
        });
        if (focusEvt) {
          focusEvents.push(focusEvt);
          onFocusEvent?.(focusEvt);
        }

        try {
          await runActions([seg.action], { log });
        } catch (e) {
          log(`Failed segment action ${seg.action?.type}: ${e.message}`);
        }
      }

      await runSegmentScroll(seg, page, log);

      const scrollTimeMs = Date.now() - segStart;
      const scrollEvt = captureScrollFocusEvent({
        clipNum,
        timeMs: scrollTimeMs,
        scrollTo: seg.scrollTo || "top",
        viewport,
        page,
      });
      focusEvents.push(scrollEvt);
      onFocusEvent?.(scrollEvt);
    }

    beatIndex++;
  }

  const remainingMs = page.pageDurationMs - (Date.now() - segStart);
  if (remainingMs > 0) await sleep(remainingMs);

  return focusEvents;
}

export async function recordSingleScene({
  sessionDir,
  timing,
  clipNum,
  viewport = [1280, 720],
  log,
}) {
  const pageIndex = clipNum - 1;
  const page = timing.pages[pageIndex];
  const scenePath = join(sessionDir, `scene_${clipNum}.webm`);

  await replaySceneSetup(timing, clipNum, { log });

  recordStart(scenePath);
  const focusEvents = await performSceneTimeline(
    page,
    page.segmentTimings || [],
    viewport,
    clipNum,
    { log }
  );
  recordStop();
  try {
    close();
  } catch {
    /* best effort */
  }

  const durationMs = probeDurationMs(scenePath) || page.pageDurationMs;

  return {
    clipNum,
    path: scenePath,
    durationMs,
    source: "partial",
    recordedAt: new Date().toISOString(),
    focusEvents,
  };
}

export function sliceSceneClipsFromMaster({ sessionDir, videoPath, marks, log, source = "full" }) {
  const sceneClips = [];
  const recordedAt = new Date().toISOString();

  for (const mark of marks) {
    const startSec = (mark.offsetMs / 1000).toFixed(3);
    const durationSec = (mark.durationMs / 1000).toFixed(3);
    const mp4Path = join(sessionDir, `scene_${mark.clipNum}.mp4`);
    log(`Slice scene ${mark.clipNum} from master: ${startSec}s for ${durationSec}s`);
    extractSegment(videoPath, startSec, durationSec, mp4Path);
    sceneClips.push({
      clipNum: mark.clipNum,
      path: mp4Path,
      durationMs: mark.durationMs,
      source,
      recordedAt,
    });
  }

  return sceneClips;
}

export function mergeSceneClips(existing = [], updates = [], merge = true) {
  if (!merge || existing.length === 0) return updates;
  const byClip = new Map(existing.map((c) => [c.clipNum, c]));
  for (const u of updates) byClip.set(u.clipNum, u);
  return [...byClip.values()].sort((a, b) => a.clipNum - b.clipNum);
}

export function mergeFocusEvents(existing = [], updates = [], clipNums = null) {
  const clipSet = clipNums ? new Set(clipNums) : null;
  const kept = existing.filter((e) => !clipSet || !clipSet.has(e.clipNum));
  return [...kept, ...updates];
}

export function syncMarksDurations(marks, sceneClips) {
  const byClip = new Map(sceneClips.map((c) => [c.clipNum, c]));
  return marks.map((m) => {
    const clip = byClip.get(m.clipNum);
    if (clip?.durationMs) {
      return { ...m, durationMs: clip.durationMs };
    }
    return m;
  });
}

/** Copy scene clip to segment path for concat (webm/mp4 → segment mp4). */
export function materializeSegmentFromSceneClip(sceneClip, segmentPath, log) {
  if (sceneClip.path.endsWith(".mp4")) {
    copyFileSync(sceneClip.path, segmentPath);
    return segmentPath;
  }
  const startSec = "0";
  const durationSec = ((sceneClip.durationMs || 0) / 1000).toFixed(3);
  extractSegment(sceneClip.path, startSec, durationSec, segmentPath);
  log(`Materialized segment from ${sceneClip.path}`);
  return segmentPath;
}
