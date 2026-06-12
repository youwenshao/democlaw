// Synthetic cursor telemetry from focusEvents + segment/action anchors.

import { resolveActionScript, FOCUS_ACTIONS } from "../actionScript.js";
import {
  closestFocusEvent,
  focusFromRefSummary,
  isValidFocus,
  defaultFocusForScroll,
} from "./focusUtils.js";

function resolveSegmentFocus(seg, page, focusEvents, clipNum) {
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

function dedupePoints(points, gapMs = 50) {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.timeMs - b.timeMs);
  const out = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = out[out.length - 1];
    if (sorted[i].timeMs - prev.timeMs >= gapMs) {
      out.push(sorted[i]);
    }
  }
  return out;
}

/** Insert eased intermediate points between sparse anchors. */
function densifyPath(points, dwellMs = 200) {
  if (points.length <= 1) return points;
  const out = [points[0]];

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const span = cur.timeMs - prev.timeMs;
    if (span > 400 && (Math.abs(cur.cx - prev.cx) > 0.05 || Math.abs(cur.cy - prev.cy) > 0.05)) {
      const midMs = prev.timeMs + span * 0.55;
      out.push({
        timeMs: midMs,
        cx: prev.cx + (cur.cx - prev.cx) * 0.55,
        cy: prev.cy + (cur.cy - prev.cy) * 0.55,
      });
      if (cur.click) {
        out.push({
          timeMs: Math.max(prev.timeMs + dwellMs, cur.timeMs - dwellMs),
          cx: cur.cx,
          cy: cur.cy,
        });
      }
    }
    out.push(cur);
  }

  return dedupePoints(out, 40);
}

export function buildCursorTelemetry({ timeline, timing, focusEvents = [], postProd }) {
  if (!postProd?.cursor?.enabled) {
    return { cursorTelemetry: [], cursorClickTimestamps: [] };
  }

  const points = [];
  const clickTimestamps = [];
  const rest = { cx: 0.5, cy: 0.55 };

  for (const scene of timeline.scenes) {
    const page = timing.pages[scene.clipNum - 1];
    if (!page) continue;

    points.push({
      timeMs: scene.finalStartMs,
      cx: rest.cx,
      cy: rest.cy,
    });

    for (const evt of focusEvents) {
      if (evt.clipNum !== scene.clipNum || !isValidFocus(evt.focus)) continue;
      const timeMs = scene.finalStartMs + evt.timeMs;
      const isClick =
        evt.kind === "action" && evt.action && FOCUS_ACTIONS.has(evt.action.type);
      points.push({
        timeMs,
        cx: evt.focus.cx,
        cy: evt.focus.cy,
        click: isClick,
      });
      if (isClick) clickTimestamps.push(timeMs);
    }

    for (const beat of resolveActionScript(page)) {
      const timeMs = scene.finalStartMs + beat.atMs;
      const focus = closestFocusEvent(focusEvents, scene.clipNum, beat.atMs, 600);
      if (isValidFocus(focus)) {
        const isClick = FOCUS_ACTIONS.has(beat.action?.type);
        points.push({ timeMs, cx: focus.cx, cy: focus.cy, click: isClick });
        if (isClick) clickTimestamps.push(timeMs);
      }
    }

    for (const seg of page.segmentTimings || []) {
      const timeMs = scene.finalStartMs + (seg.startTimeMs ?? 0);
      const focus = resolveSegmentFocus(seg, page, focusEvents, scene.clipNum);
      if (isValidFocus(focus)) {
        points.push({ timeMs, cx: focus.cx, cy: focus.cy });
      }
    }
  }

  const deduped = dedupePoints(points);
  const cursorTelemetry = densifyPath(deduped);

  return {
    cursorTelemetry,
    cursorClickTimestamps: [...new Set(clickTimestamps)].sort((a, b) => a - b),
  };
}
