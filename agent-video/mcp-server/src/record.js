// Stage 3: performance pass (recording).
// Reads timing.json, re-opens the pages, records the screen, and drives smooth
// content-aware scrolling timed to each segment's start time. Writes marks.json
// (per-page offsets into the raw recording) for the post-production stage.

import {
  setViewport,
  open,
  close,
  recordStart,
  recordStop,
} from "./browser.js";
import {
  ensureSession,
  readArtifact,
  writeArtifact,
  makeLogger,
  sleep,
} from "./session.js";
import { join } from "path";
import {
  performSceneTimeline,
  recordSingleScene,
  sliceSceneClipsFromMaster,
  mergeSceneClips,
  mergeFocusEvents,
  syncMarksDurations,
  navigateToScene,
} from "./sceneReplay.js";
import {
  isAdminUrl,
  pingAdminSession,
  resolveAdminCredentials,
  preflightAdminAuth,
  findFirstAdminPageIndex,
} from "./adminSession.js";

async function runFullRecording({ session, timing, viewport, log }) {
  const videoPath = join(session.sessionDir, "recording.webm");
  const marks = [];
  const focusEvents = [];
  const creds = timing.pages.some((p) => isAdminUrl(p.url))
    ? resolveAdminCredentials()
    : null;

  if (findFirstAdminPageIndex(timing.pages) >= 0) {
    await preflightAdminAuth(timing.pages, { log });
  }

  setViewport(viewport[0], viewport[1]);
  open(timing.pages[0].url, { headed: true });
  await sleep(2000);

  recordStart(videoPath);
  const recordingStartMs = Date.now();

  for (let i = 0; i < timing.pages.length; i++) {
    const page = timing.pages[i];
    const nextPage = timing.pages[i + 1];

    if (i > 0) {
      await navigateToScene(page, i, log, { creds });
    } else if (creds && isAdminUrl(page.url)) {
      await navigateToScene(page, i, log, { creds });
    }

    const offsetMs = Date.now() - recordingStartMs;
    marks.push({ clipNum: i + 1, offsetMs, durationMs: page.pageDurationMs });
    log(`Marked clip ${i + 1} at offset ${offsetMs}ms (duration ${page.pageDurationMs}ms)`);

    const sceneFocus = await performSceneTimeline(
      page,
      page.segmentTimings || [],
      viewport,
      i + 1,
      {
        log,
        onFocusEvent: (evt) => focusEvents.push(evt),
      }
    );
    void sceneFocus;

    if (creds && (isAdminUrl(page.url) || (nextPage && isAdminUrl(nextPage.url)))) {
      await pingAdminSession({ log });
    }
  }

  recordStop();
  close();
  await sleep(1000);

  const sceneClips = sliceSceneClipsFromMaster({
    sessionDir: session.sessionDir,
    videoPath,
    marks,
    log,
    source: "full",
  });

  return { videoPath, marks, focusEvents, sceneClips };
}

async function runPartialRecording({
  session,
  timing,
  viewport,
  clipNums,
  merge,
  log,
}) {
  const priorMarks = readArtifact(session.sessionId, "marks.json");
  if (!priorMarks.marks?.length) {
    throw new Error(
      "Partial record requires a prior full record_performance run (marks.json with sceneClips)."
    );
  }
  const existingClips = priorMarks.sceneClips || [];
  const existingFocus = priorMarks.focusEvents || [];

  const updates = [];
  const newFocus = [];

  for (const clipNum of clipNums) {
    log(`=== PARTIAL RECORD clip ${clipNum} ===`);
    const result = await recordSingleScene({
      sessionDir: session.sessionDir,
      timing,
      clipNum,
      viewport,
      log,
    });
    updates.push(result);
    newFocus.push(...result.focusEvents);
    try {
      close();
    } catch {
      /* best effort */
    }
    await sleep(500);
  }

  const sceneClips = mergeSceneClips(existingClips, updates, merge);
  const marks = syncMarksDurations(priorMarks.marks, sceneClips);
  const focusEvents = mergeFocusEvents(existingFocus, newFocus, clipNums);

  return {
    videoPath: priorMarks.videoPath,
    marks,
    focusEvents,
    sceneClips,
  };
}

export async function recordPerformance({
  sessionId,
  viewport = [1280, 720],
  clipNums = null,
  merge = true,
}) {
  const session = ensureSession(sessionId);
  const log = makeLogger(session.sessionId);
  const timing = readArtifact(session.sessionId, "timing.json");

  const partial = Array.isArray(clipNums) && clipNums.length > 0;
  log(
    `=== PERFORMANCE PASS === pages=${timing.pages.length}${partial ? ` partial=${clipNums.join(",")}` : ""}`
  );

  try {
    let result;
    if (partial) {
      result = await runPartialRecording({
        session,
        timing,
        viewport,
        clipNums,
        merge,
        log,
      });
    } else {
      result = await runFullRecording({ session, timing, viewport, log });
    }

    const marksData = {
      videoPath: result.videoPath,
      marks: result.marks,
      sceneClips: result.sceneClips,
      ...(result.focusEvents.length > 0 ? { focusEvents: result.focusEvents } : {}),
      createdAt: new Date().toISOString(),
    };
    writeArtifact(session.sessionId, "marks.json", marksData);
    return { sessionId: session.sessionId, ...marksData };
  } catch (e) {
    try {
      close();
    } catch {
      /* best effort */
    }
    throw e;
  }
}
