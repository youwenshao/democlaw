// Shared focus matching for polish cursor + zoom.

import { FOCUS_ACTIONS } from "../actionScript.js";

export { FOCUS_ACTIONS };

export function closestFocusEvent(focusEvents, clipNum, timeMs, windowMs = 800) {
  if (!Array.isArray(focusEvents)) return null;
  let best = null;
  let bestDelta = Infinity;
  for (const evt of focusEvents) {
    if (evt.clipNum !== clipNum || !evt.focus) continue;
    const delta = Math.abs(evt.timeMs - timeMs);
    if (delta <= windowMs && delta < bestDelta) {
      bestDelta = delta;
      best = evt;
    }
  }
  return best?.focus || null;
}

export function isValidFocus(focus) {
  return (
    focus &&
    typeof focus.cx === "number" &&
    typeof focus.cy === "number" &&
    !Number.isNaN(focus.cx) &&
    !Number.isNaN(focus.cy)
  );
}

export function defaultFocusForScroll(scrollTo) {
  if (scrollTo === "bottom") return { cx: 0.5, cy: 0.8 };
  if (scrollTo === "top") return { cx: 0.5, cy: 0.2 };
  return { cx: 0.5, cy: 0.5 };
}

export function focusFromRefSummary(refSummary, scrollTo, viewport = [1280, 720]) {
  const refId = String(scrollTo || "").replace(/^@/, "");
  const entry = refSummary?.find((r) => r.id === refId);
  if (entry?.focusBounds && isValidFocus(entry.focusBounds)) {
    return entry.focusBounds;
  }
  if (entry?.selector) {
    return defaultFocusForScroll(scrollTo);
  }
  return defaultFocusForScroll(scrollTo);
}
