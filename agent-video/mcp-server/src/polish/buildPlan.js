// Build polish_plan.json from timing.json + marks.json (+ optional focusEvents).

import { join } from "path";
import { resolvePostProdOptions } from "./presets.js";
import { buildCursorTelemetry } from "./cursorTelemetry.js";
import { resolveWallpaper } from "./resolveWallpaper.js";
import { resolveActionScript } from "../actionScript.js";
import {
  FOCUS_ACTIONS,
  closestFocusEvent,
  focusFromRefSummary,
  isValidFocus,
  defaultFocusForScroll,
} from "./focusUtils.js";

function buildTimeline(marks) {
  const scenes = [];
  let finalCursor = 0;

  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    const rawStartMs = mark.offsetMs;
    const rawEndMs = mark.offsetMs + mark.durationMs;
    const finalStartMs = finalCursor;
    const finalEndMs = finalStartMs + mark.durationMs;

    scenes.push({
      clipNum: mark.clipNum,
      rawStartMs,
      rawEndMs,
      finalStartMs,
      finalEndMs,
      durationMs: mark.durationMs,
    });

    finalCursor = finalEndMs;
  }

  return {
    totalDurationMs: finalCursor,
    scenes,
  };
}

function buildAudioPlan(timing, timeline) {
  const clips = [];
  for (let i = 0; i < timeline.scenes.length; i++) {
    const scene = timeline.scenes[i];
    const page = timing.pages[i];
    if (!page?.audioClips) continue;
    for (const clip of page.audioClips) {
      clips.push({
        path: clip.path,
        offsetMs: scene.finalStartMs + clip.offsetWithinPageMs,
      });
    }
  }
  return { clips };
}

function resolveSegmentFocus({ seg, clipNum, page, focusEvents }) {
  const timeMs = seg.startTimeMs ?? 0;
  const fromEvent = closestFocusEvent(focusEvents, clipNum, timeMs);
  if (isValidFocus(fromEvent)) return fromEvent;

  if (seg.action && FOCUS_ACTIONS.has(seg.action.type)) {
    const actionFocus = closestFocusEvent(focusEvents, clipNum, timeMs, 1200);
    if (isValidFocus(actionFocus)) return actionFocus;
    return defaultFocusForScroll("top");
  }

  return focusFromRefSummary(page.grounding?.refSummary, seg.scrollTo);
}

function resolveActionBeatFocus({ beat, clipNum, page, focusEvents }) {
  const fromEvent = closestFocusEvent(focusEvents, clipNum, beat.atMs, 600);
  if (isValidFocus(fromEvent)) return fromEvent;
  if (beat.action && FOCUS_ACTIONS.has(beat.action.type)) {
    return defaultFocusForScroll("top");
  }
  return null;
}

function segmentDepth(seg, segIndex, postProd, hasRealFocus) {
  const zoom = postProd.zoom || {};
  if (!hasRealFocus) return 1;
  if (seg.action && FOCUS_ACTIONS.has(seg.action.type)) {
    return zoom.clickDepth ?? 3;
  }
  if (segIndex === 0) return 1;
  return zoom.defaultDepth ?? 1;
}

export function buildZoomRegions({ timing, timeline, focusEvents, postProd }) {
  if (!postProd.zoom?.enabled) return [];

  const holdMs = postProd.zoom.holdMs ?? 2000;
  const regions = [];

  for (let i = 0; i < timeline.scenes.length; i++) {
    const scene = timeline.scenes[i];
    const page = timing.pages[i];
    const segments = page?.segmentTimings || [];

    for (const beat of resolveActionScript(page)) {
      if (!FOCUS_ACTIONS.has(beat.action?.type)) continue;
      const focus = resolveActionBeatFocus({
        beat,
        clipNum: scene.clipNum,
        page,
        focusEvents,
      });
      if (!isValidFocus(focus)) continue;
      const startMs = scene.finalStartMs + beat.atMs;
      const endMs = Math.min(startMs + holdMs, scene.finalEndMs);
      if (endMs <= startMs) continue;
      regions.push({
        id: `clip${scene.clipNum}-action-${startMs}`,
        startMs,
        endMs,
        depth: postProd.zoom?.clickDepth ?? 3,
        focus,
        focusMode: "manual",
        source: "actionScript",
      });
    }

    segments.forEach((seg, segIndex) => {
      const startMs = scene.finalStartMs + (seg.startTimeMs ?? 0);
      const focus = resolveSegmentFocus({
        seg,
        clipNum: scene.clipNum,
        page,
        focusEvents,
      });
      const hasRealFocus =
        isValidFocus(focus) &&
        (focus.cx !== 0.5 || focus.cy !== 0.2 || seg.action || segIndex === 0);

      if (!hasRealFocus && segIndex > 0 && !seg.action) return;

      const segEnd = seg.endTimeMs ?? seg.startTimeMs + 3000;
      const endMs = Math.min(startMs + holdMs, scene.finalEndMs, scene.finalStartMs + segEnd);
      if (endMs <= startMs) return;

      regions.push({
        id: `clip${scene.clipNum}-seg${segIndex}`,
        startMs,
        endMs,
        depth: segmentDepth(seg, segIndex, postProd, hasRealFocus),
        focus,
        focusMode: "manual",
        source: "auto",
        meta: seg.action
          ? {
              segmentIndex: segIndex,
              action: `${seg.action.type}:${seg.action.name || seg.action.selector || ""}`,
            }
          : { segmentIndex: segIndex },
      });
    });
  }

  return mergeZoomRegions(regions, timeline.totalDurationMs, postProd.zoom?.mergeGapMs ?? 400);
}

export function mergeZoomRegions(regions, totalDurationMs, gapMs = 400) {
  if (regions.length === 0) return [];
  const sorted = [...regions].sort((a, b) => a.startMs - b.startMs);
  const merged = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = sorted[i];
    if (cur.startMs - prev.endMs < gapMs && prev.depth === cur.depth) {
      prev.endMs = Math.max(prev.endMs, cur.endMs);
      prev.id = `${prev.id}+${cur.id}`;
    } else {
      merged.push({ ...cur });
    }
  }

  return merged.map((r) => ({
    ...r,
    startMs: Math.max(0, r.startMs),
    endMs: Math.min(totalDurationMs, r.endMs),
  }));
}

export function buildPolishPlan({
  sessionDir,
  timing,
  marksData,
  postProdOptions,
  viewport = { width: 1280, height: 720 },
}) {
  const postProd = resolvePostProdOptions(postProdOptions);
  const { videoPath, marks, focusEvents } = marksData;
  const timeline = buildTimeline(marks);
  const audioPlan = buildAudioPlan(timing, timeline);
  const zoomRegions = buildZoomRegions({
    timing,
    timeline,
    focusEvents,
    postProd,
  });

  const { cursorTelemetry, cursorClickTimestamps } = buildCursorTelemetry({
    timeline,
    timing,
    focusEvents,
    postProd,
  });

  const wallpaperSpec = resolveWallpaper(postProd.wallpaper, sessionDir);

  return {
    version: 1,
    sourceVideo: videoPath,
    workingVideo: join(sessionDir, "concat_silent.mp4"),
    polishedSilent: join(sessionDir, "polished_silent.mp4"),
    viewport,
    output: {
      width: postProd.width,
      height: postProd.height,
      frameRate: postProd.frameRate,
      bitrate: postProd.bitrate,
      wallpaper:
        wallpaperSpec.type === "color" ? wallpaperSpec.value : "#0f172a",
      wallpaperUrl: wallpaperSpec.type === "image" ? wallpaperSpec.url : null,
      padding: postProd.padding,
      borderRadius: postProd.borderRadius,
      showShadow: postProd.showShadow,
      motionBlurAmount: postProd.motionBlurAmount,
    },
    postProd: {
      name: postProd.name,
      preset: postProd.preset,
      zoom: postProd.zoom,
      cursor: postProd.cursor,
    },
    timeline,
    zoomRegions,
    trimRegions: [],
    cursorRecordingData: null,
    cursorTelemetry,
    cursorClickTimestamps,
    audioPlan,
    export: {
      playbackRate: postProd.export?.playbackRate ?? 1,
      timeoutMarginMs: postProd.export?.timeoutMarginMs ?? 120_000,
    },
    createdAt: new Date().toISOString(),
  };
}
