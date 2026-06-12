// Deterministic pacing analysis for the auto-critique loop.
// Reads timing.json and flags rushing/dragging/short/long segments.

import { ensureSession, readArtifact } from "../session.js";

const DEFAULT_THRESHOLDS = {
  rushWpm: 175,
  dragWpm: 95,
  minDurationMs: 1500,
  maxDurationMs: 14000,
  sceneWpmVariance: 45,
  actionLeadMs: 3000,
};

function wordCount(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function computeWpm(text, durationMs) {
  if (!durationMs || durationMs <= 0) return 0;
  const words = wordCount(text);
  return Math.round((words / durationMs) * 60000);
}

function computeWpmFromWordCount(words, durationMs) {
  if (!durationMs || durationMs <= 0 || words <= 0) return 0;
  return Math.round((words / durationMs) * 60000);
}

function segmentDurationMs(seg) {
  if (seg.endTimeMs != null && seg.startTimeMs != null) {
    return seg.endTimeMs - seg.startTimeMs;
  }
  return seg.durationMs || 0;
}

function flagSegment(seg, idx, thresholds) {
  const durationMs = segmentDurationMs(seg);
  const wpm = computeWpm(seg.text, durationMs);
  const flags = [];

  if (wpm > thresholds.rushWpm) flags.push("rushing");
  if (wpm < thresholds.dragWpm && wordCount(seg.text) > 8) flags.push("dragging");
  if (durationMs > 0 && durationMs < thresholds.minDurationMs && wordCount(seg.text) > 6) {
    flags.push("too_short");
  }
  if (durationMs > thresholds.maxDurationMs) flags.push("too_long");

  return {
    idx,
    text: seg.text,
    words: wordCount(seg.text),
    durationMs,
    wpm,
    flags,
    ...(seg.action ? { hasAction: true, actionType: seg.action.type } : {}),
  };
}

function detectDesync(page, segments, thresholds) {
  const flags = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg.hasAction) continue;

    const nextWait = (page.entryActions || []).find(
      (a) => a.type === "wait" && (a.ms || 0) >= 5000
    );
    if (!nextWait && i === segments.length - 1) {
      const trailing = page.reuseTab ? null : null;
      if (trailing) flags.push("action_before_wait");
    }

    if (seg.actionType === "click" || seg.actionType === "clickName") {
      const remainingMs =
        (page.pageDurationMs || 0) - (seg.startTimeMs || 0) - seg.durationMs;
      if (remainingMs > thresholds.actionLeadMs && i === segments.length - 1) {
        flags.push("action_early_in_scene");
      }
    }
  }
  return flags;
}

export function assessTimingFromArtifacts(timing, options = {}) {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds || {}) };
  const scenes = [];
  let totalWords = 0;
  let totalDurationMs = 0;
  const sceneWpms = [];

  timing.pages.forEach((page, pageIdx) => {
    const clipNum = pageIdx + 1;
    const segTimings = page.segmentTimings || [];
    const segments = segTimings.map((seg, idx) => flagSegment(seg, idx, thresholds));

    let sceneWords = 0;
    let sceneDurationMs = page.pageDurationMs || 0;
    for (const s of segments) {
      sceneWords += s.words;
    }
    if (!sceneDurationMs && segments.length) {
      sceneDurationMs = segments.reduce((sum, s) => sum + s.durationMs, 0);
    }

    const sceneWpm = computeWpmFromWordCount(sceneWords, sceneDurationMs);
    sceneWpms.push(sceneWpm);
    totalWords += sceneWords;
    totalDurationMs += sceneDurationMs;

    const sceneFlags = [];
    const flaggedSegs = segments.filter((s) => s.flags.length > 0);
    if (flaggedSegs.length > 0) sceneFlags.push("segment_pacing");

    const desyncFlags = detectDesync(page, segments, thresholds);
    sceneFlags.push(...desyncFlags);

    scenes.push({
      clipNum,
      url: page.url,
      sceneWpm,
      pageDurationMs: sceneDurationMs,
      segments,
      flags: sceneFlags,
    });
  });

  const overallWpm = computeWpmFromWordCount(totalWords, totalDurationMs);
  const wpmSpread =
    sceneWpms.length > 1
      ? Math.max(...sceneWpms) - Math.min(...sceneWpms)
      : 0;

  const flagged = scenes
    .filter((s) => s.flags.length > 0 || s.segments.some((seg) => seg.flags.length > 0))
    .map((s) => s.clipNum);

  return {
    overallWpm,
    totalDurationMs,
    thresholds,
    scenes,
    summary: {
      flagged,
      wpmSpread,
      pacingVariance:
        wpmSpread > thresholds.sceneWpmVariance ? "high" : "normal",
    },
    createdAt: new Date().toISOString(),
  };
}

export async function assessTiming({ sessionId, thresholds } = {}) {
  const session = ensureSession(sessionId);
  const timing = readArtifact(session.sessionId, "timing.json");
  const report = assessTimingFromArtifacts(timing, { thresholds });
  return { sessionId: session.sessionId, ...report };
}
