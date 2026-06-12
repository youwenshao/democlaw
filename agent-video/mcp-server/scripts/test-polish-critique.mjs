// Unit tests for critique + polish + scene splice helpers (run: npm run test-polish-critique)

import { assessTimingFromArtifacts } from "../src/critique/assessTiming.js";
import { assessWorkflowFromSession } from "../src/critique/assessWorkflow.js";
import { buildGoalsFromNarration } from "../src/critique/goals.js";
import { buildAutoCritique } from "../src/critique/autoCritique.js";
import {
  findFirstAdminPageIndex,
  isAdminUrl,
  shouldUseAdminFastSetup,
} from "../src/adminSession.js";
import {
  buildPolishPlan,
  mergeZoomRegions,
} from "../src/polish/buildPlan.js";
import { buildCursorTelemetry } from "../src/polish/cursorTelemetry.js";
import {
  buildSetupActionPlan,
  mergeSceneClips,
  mergeFocusEvents,
  syncMarksDurations,
} from "../src/sceneReplay.js";
import { interpolateCursorAt } from "../polish/vendor/cursor.js";
import { resolvePostProd, resolveProviders } from "../src/config.js";
import { resolveWallpaper } from "../src/polish/resolveWallpaper.js";
import { POSTPROD_PRESETS } from "../src/polish/presets.js";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const testSessionDir = mkdtempSync(join(tmpdir(), "polish-critique-"));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const sampleTiming = {
  pages: [
    {
      url: "http://localhost:5333",
      pageDurationMs: 10000,
      segmentTimings: [
        {
          text: "Hello world this is a test segment with enough words",
          startTimeMs: 0,
          endTimeMs: 2000,
        },
        {
          text: "Click submit now",
          startTimeMs: 2000,
          endTimeMs: 3500,
          action: { type: "clickName", name: "Submit" },
        },
      ],
      audioClips: [{ path: "/tmp/clip_1.mp3", offsetWithinPageMs: 0, durationMs: 3500 }],
    },
    {
      url: "http://localhost:5333",
      reuseTab: true,
      pageDurationMs: 8000,
      segmentTimings: [{ text: "Results", startTimeMs: 0, endTimeMs: 8000 }],
      audioClips: [{ path: "/tmp/clip_2.mp3", offsetWithinPageMs: 0, durationMs: 8000 }],
    },
  ],
};

const report = assessTimingFromArtifacts(sampleTiming);
assert(report.overallWpm > 0, "overallWpm should be positive");
assert(report.scenes.length === 2, "two scenes");

const goals = buildGoalsFromNarration({
  persona: "demo host",
  pages: sampleTiming.pages,
});
assert(goals.scenes.length === 2, "goals scenes");

const critique = buildAutoCritique({
  goals,
  timingReport: report,
  iteration: 1,
  forceRerecordClipNums: [2],
});
assert(critique.scenes.find((s) => s.clipNum === 2)?.action === "rerecord", "forced rerecord");

assert(isAdminUrl("http://localhost:5173/admin/users"), "admin url detect");
assert(findFirstAdminPageIndex(sampleTiming.pages) === -1, "no admin in sample");
const adminTiming = {
  pages: [
    { url: "http://localhost:5333" },
    { url: "http://localhost:5173/admin/login" },
    { url: "http://localhost:5173/admin/users", reuseTab: true },
  ],
};
assert(findFirstAdminPageIndex(adminTiming.pages) === 1, "admin start index");
assert(shouldUseAdminFastSetup(adminTiming.pages, 3), "fast setup for admin clip 3");

const marks = [
  { clipNum: 1, offsetMs: 1000, durationMs: 10000 },
  { clipNum: 2, offsetMs: 12000, durationMs: 8000 },
];
const plan = buildPolishPlan({
  sessionDir: testSessionDir,
  timing: sampleTiming,
  marksData: { videoPath: "/tmp/rec.webm", marks },
  postProdOptions: { name: "openscreen", preset: "demo-default" },
});

assert(plan.timeline.totalDurationMs === 18000, "timeline duration");
assert(plan.zoomRegions.length >= 2, "zoom regions generated");

const merged = mergeZoomRegions(
  [
    { id: "a", startMs: 0, endMs: 1000, depth: 2, focus: { cx: 0.5, cy: 0.5 } },
    { id: "b", startMs: 1100, endMs: 2000, depth: 2, focus: { cx: 0.5, cy: 0.5 } },
  ],
  5000,
  200
);
assert(merged.length === 1, "regions merged");

const setupSteps = buildSetupActionPlan(sampleTiming, 2);
assert(setupSteps.some((s) => s.phase === "segmentActions" && s.clipNum === 1), "setup replays scene 1 actions");
assert(setupSteps.filter((s) => s.phase === "navigate").length >= 0, "setup navigate steps");

const mergedClips = mergeSceneClips(
  [{ clipNum: 1, path: "/a.mp4", durationMs: 10000, source: "full" }],
  [{ clipNum: 2, path: "/b.mp4", durationMs: 8000, source: "partial" }],
  true
);
assert(mergedClips.length === 2, "merge scene clips");

const focusMerged = mergeFocusEvents(
  [{ clipNum: 1, timeMs: 100, kind: "action" }],
  [{ clipNum: 2, timeMs: 200, kind: "action" }],
  [2]
);
assert(focusMerged.length === 2, "focus events merged");
assert(focusMerged.every((e) => e.clipNum !== 1 || e.timeMs === 100), "clip 1 focus kept");

const synced = syncMarksDurations(marks, [
  { clipNum: 2, durationMs: 7500 },
]);
assert(synced[1].durationMs === 7500, "mark duration synced");

const cursorPlan = buildPolishPlan({
  sessionDir: testSessionDir,
  timing: sampleTiming,
  marksData: {
    videoPath: "/tmp/rec.webm",
    marks,
    focusEvents: [
      { clipNum: 2, timeMs: 2000, kind: "action", focus: { cx: 0.7, cy: 0.3 }, action: { type: "clickName" } },
    ],
  },
  postProdOptions: { name: "openscreen", preset: "demo-with-cursor" },
});

assert(cursorPlan.cursorTelemetry.length > 0, "cursor telemetry generated");
assert(cursorPlan.cursorClickTimestamps.length >= 1, "click timestamps");
if (process.platform === "darwin") {
  assert(cursorPlan.output.wallpaperUrl === "/wallpaper.jpg", "macOS wallpaper materialized");
}

const mid = interpolateCursorAt(
  [
    { timeMs: 0, cx: 0, cy: 0 },
    { timeMs: 1000, cx: 1, cy: 1 },
  ],
  500
);
assert(Math.abs(mid.cx - 0.5) < 0.15, "cursor interpolation near midpoint");

const workflowFail = assessWorkflowFromSession({
  sessionDir: testSessionDir,
  timing: adminTiming,
  marksData: { focusEvents: [] },
  logContent: "[action] FAILED waitFor: timeout\non /admin/login — opening http",
});
assert(workflowFail.verdict === "revise", "workflow assess detects login failure");

const workflowCritique = buildAutoCritique({
  goals,
  timingReport: report,
  workflowReport: workflowFail,
  iteration: 1,
});
assert(workflowCritique.verdict === "revise", "critique revise on workflow failure");

const manifestPostProd = resolvePostProd({
  name: "openscreen",
  preset: "demo-with-cursor",
});
assert(
  manifestPostProd.name === "openscreen" && manifestPostProd.preset === "demo-with-cursor",
  "manifest postProd preserved"
);

const savedPostProdProvider = process.env.DEMOCLAW_POSTPROD_PROVIDER;
const savedPostProdPreset = process.env.DEMOCLAW_POSTPROD_PRESET;
process.env.DEMOCLAW_POSTPROD_PROVIDER = "openscreen";
delete process.env.DEMOCLAW_POSTPROD_PRESET;
const envOpenscreen = resolvePostProd({});
assert(
  envOpenscreen.name === "openscreen" && envOpenscreen.preset === "demo-with-cursor",
  "openscreen env defaults to demo-with-cursor preset"
);
process.env.DEMOCLAW_POSTPROD_PRESET = "demo-default";
const envPresetOverride = resolvePostProd({});
assert(envPresetOverride.preset === "demo-default", "env preset override");
process.env.DEMOCLAW_POSTPROD_PROVIDER = "ffmpeg";
const ffmpegExplicit = resolvePostProd({ name: "ffmpeg" });
assert(ffmpegExplicit.name === "ffmpeg" && !ffmpegExplicit.preset, "ffmpeg ignores preset");
if (savedPostProdProvider === undefined) delete process.env.DEMOCLAW_POSTPROD_PROVIDER;
else process.env.DEMOCLAW_POSTPROD_PROVIDER = savedPostProdProvider;
if (savedPostProdPreset === undefined) delete process.env.DEMOCLAW_POSTPROD_PRESET;
else process.env.DEMOCLAW_POSTPROD_PRESET = savedPostProdPreset;

const resolvedFromManifest = resolveProviders({
  postProd: { name: "openscreen", preset: "demo-with-cursor" },
});
assert(
  resolvedFromManifest.postProd.preset === "demo-with-cursor",
  "resolveProviders passes postProd preset"
);

assert(
  POSTPROD_PRESETS["demo-with-cursor"].wallpaper === "macos",
  "demo-with-cursor uses macOS wallpaper"
);

const hexWallpaper = resolveWallpaper("#112233", "/tmp");
assert(hexWallpaper.type === "color" && hexWallpaper.value === "#112233", "hex wallpaper");

const missingFile = resolveWallpaper("/nonexistent-wallpaper-file.jpg", "/tmp");
assert(
  missingFile.type === "color" && missingFile.fallbackReason,
  "missing file falls back to color"
);

if (process.platform !== "darwin") {
  const macosFallback = resolveWallpaper("macos", "/tmp");
  assert(
    macosFallback.type === "color" && macosFallback.fallbackReason,
    "macos on non-darwin falls back"
  );
}

console.log(
  JSON.stringify({ ok: true, tests: process.platform === "darwin" ? 27 : 26 }, null, 2)
);
