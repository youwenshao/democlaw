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
  enableSmoothScroll,
  pageDimensions,
  scrollIntoView,
  scrollToTop,
  scrollToBottom,
} from "./browser.js";
import { runActions } from "./actions.js";
import {
  ensureSession,
  readArtifact,
  writeArtifact,
  makeLogger,
  sleep,
} from "./session.js";
import { join } from "path";

export async function recordPerformance({ sessionId, viewport = [1280, 720] }) {
  const session = ensureSession(sessionId);
  const log = makeLogger(session.sessionId);
  const timing = readArtifact(session.sessionId, "timing.json");
  const videoPath = join(session.sessionDir, "recording.webm");

  log(`=== PERFORMANCE PASS === pages=${timing.pages.length}`);

  const marks = [];
  try {
    setViewport(viewport[0], viewport[1]);
    open(timing.pages[0].url, { headed: true });
    await sleep(2000);

    recordStart(videoPath);
    const recordingStartMs = Date.now();

    for (let i = 0; i < timing.pages.length; i++) {
      const page = timing.pages[i];

      // Scene transition. Everything here happens BEFORE we mark the clip offset,
      // so it lands in the inter-scene gap that post-production trims out -
      // navigation, form fill, submit, and waitFor readiness never desync audio.
      if (i > 0) {
        if (page.reuseTab) {
          log(`Scene ${i + 1}: reusing current tab (no reload)`);
        } else {
          open(page.url);
          await sleep(1000);
        }
      }
      if (Array.isArray(page.entryActions) && page.entryActions.length > 0) {
        log(`Scene ${i + 1}: running ${page.entryActions.length} entryActions (in trimmed gap)`);
        await runActions(page.entryActions, { log });
        await sleep(500);
      }

      const offsetMs = Date.now() - recordingStartMs;
      marks.push({ clipNum: i + 1, offsetMs, durationMs: page.pageDurationMs });
      log(`Marked clip ${i + 1} at offset ${offsetMs}ms (duration ${page.pageDurationMs}ms)`);

      enableSmoothScroll();
      log(`Page dimensions: ${pageDimensions()}`);

      const segTimings = page.segmentTimings || [];
      if (segTimings.length > 0) {
        const segStart = Date.now();
        for (const seg of segTimings) {
          const waitMs = seg.startTimeMs - (Date.now() - segStart);
          if (waitMs > 0) await sleep(waitMs);

          // Fire the segment's interaction on the timeline, then scroll.
          if (seg.action) {
            try {
              await runActions([seg.action], { log });
            } catch (e) {
              log(`Failed segment action ${seg.action?.type}: ${e.message}`);
            }
          }

          if (seg.scrollTo === "top") {
            scrollToTop();
          } else if (seg.scrollTo === "bottom") {
            scrollToBottom();
          } else if (seg.scrollTo) {
            try {
              scrollIntoView(seg.scrollTo);
            } catch (e) {
              log(`Failed to scroll to ref @${seg.scrollTo}: ${e.message}`);
            }
          }
        }
        const remainingMs = page.pageDurationMs - (Date.now() - segStart);
        if (remainingMs > 0) await sleep(remainingMs);
      } else {
        log(`WARNING: no segment timings for page ${i + 1}; using flat wait`);
        await sleep(page.pageDurationMs);
      }
    }

    recordStop();
    close();
    await sleep(1000);
  } catch (e) {
    try {
      close();
    } catch (_) {
      /* best effort */
    }
    throw e;
  }

  const marksData = {
    videoPath,
    marks,
    createdAt: new Date().toISOString(),
  };
  writeArtifact(session.sessionId, "marks.json", marksData);
  return { sessionId: session.sessionId, ...marksData };
}
