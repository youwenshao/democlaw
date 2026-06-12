#!/usr/bin/env node
// Integration test for OpenScreen export worker (short synthetic clip).

import { mkdtempSync, writeFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { probeDurationMs } from "../src/ffmpeg.js";
import { computeExportTimeoutMs } from "../src/polish/exportTimeout.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER = join(__dirname, "..", "polish", "export-worker.mjs");
const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";

const DURATION_SEC = 4;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function runFfmpeg(args) {
  const result = spawnSync(FFMPEG, args, { encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${result.stderr || result.stdout}`);
  }
}

function basePlan(totalDurationMs, outputExtra = {}) {
  return {
    version: 1,
    output: {
      width: 1280,
      height: 720,
      frameRate: 24,
      bitrate: 2_000_000,
      wallpaper: "#0f172a",
      padding: 32,
      borderRadius: 8,
      showShadow: false,
      ...outputExtra,
    },
    postProd: {
      name: "openscreen",
      preset: "fast",
      zoom: { enabled: false },
      cursor: { enabled: false },
    },
    timeline: { totalDurationMs },
    zoomRegions: [],
    cursorTelemetry: [],
    cursorClickTimestamps: [],
    export: {
      playbackRate: 1.5,
      timeoutMarginMs: 60_000,
    },
  };
}

function runExportCase(label, sessionDir, plan) {
  writeFileSync(join(sessionDir, "polish_plan.json"), JSON.stringify(plan, null, 2));
  const timeoutMs = computeExportTimeoutMs(plan);
  console.error(`[test-polish-export] ${label} timeout ${timeoutMs}ms`);

  const child = spawnSync(process.execPath, [WORKER, sessionDir], {
    encoding: "utf-8",
    env: {
      ...process.env,
      DEMOCLAW_EXPORT_TIMEOUT_MS: String(timeoutMs),
    },
    timeout: timeoutMs + 60_000,
  });

  if (child.status !== 0) {
    console.error(child.stderr || child.stdout);
    throw new Error(`${label}: export-worker failed with code ${child.status}`);
  }

  const mp4Path = join(sessionDir, "polished_silent.mp4");
  const webmPath = join(sessionDir, "polished_silent.webm");
  assert(existsSync(webmPath), `${label}: polished_silent.webm missing`);
  assert(existsSync(mp4Path), `${label}: polished_silent.mp4 missing`);

  const outMs = probeDurationMs(mp4Path);
  const delta = Math.abs(outMs - plan.timeline.totalDurationMs);
  assert(delta < 2500, `${label}: duration drift too large: ${outMs}ms`);
  return { mp4Path, outputDurationMs: outMs };
}

const sessionDir = mkdtempSync(join(tmpdir(), "polish-export-test-"));
const concatPath = join(sessionDir, "concat_silent.mp4");

try {
  console.error(`[test-polish-export] session ${sessionDir}`);

  runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=0x1e293b:s=1280x720:d=${DURATION_SEC}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:duration=${DURATION_SEC}`,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    concatPath,
  ]);

  const totalDurationMs = DURATION_SEC * 1000;

  const colorResult = runExportCase(
    "color-wallpaper",
    sessionDir,
    {
      ...basePlan(totalDurationMs),
      workingVideo: concatPath,
    }
  );

  const wallpaperPath = join(sessionDir, "wallpaper.jpg");
  runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x336699:s=1920x1080:d=0.04",
    "-frames:v",
    "1",
    wallpaperPath,
  ]);

  const imageResult = runExportCase(
    "image-wallpaper",
    sessionDir,
    {
      ...basePlan(totalDurationMs, {
        wallpaper: "#0f172a",
        wallpaperUrl: "/wallpaper.jpg",
      }),
      workingVideo: concatPath,
    }
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        sessionDir,
        inputDurationMs: totalDurationMs,
        colorResult,
        imageResult,
      },
      null,
      2
    )
  );
} finally {
  try {
    rmSync(sessionDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}
