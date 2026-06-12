// Shared ffmpeg pre-cut + audio offset math for Stage 4.

import { join } from "path";
import { unlinkSync } from "fs";
import {
  extractSegment,
  concatVideo,
  muxAudioOntoVideo,
  probeDurationMs,
} from "../ffmpeg.js";
import { materializeSegmentFromSceneClip } from "../sceneReplay.js";

function sceneClipsReady(marksData) {
  const { marks, sceneClips } = marksData;
  if (!Array.isArray(sceneClips) || sceneClips.length !== marks?.length) return false;
  return sceneClips.every((c) => c.path && c.clipNum);
}

export function extractAndConcatSilent({ sessionDir, videoPath, marks, marksData, log }) {
  const segmentPaths = [];

  if (marksData && sceneClipsReady(marksData)) {
    log(`Using ${marksData.sceneClips.length} sceneClips (no master slice)`);
    for (const mark of marks) {
      const sceneClip = marksData.sceneClips.find((c) => c.clipNum === mark.clipNum);
      const segPath = join(sessionDir, `segment_${mark.clipNum}.mp4`);
      materializeSegmentFromSceneClip(sceneClip, segPath, log);
      segmentPaths.push(segPath);
    }
  } else {
    for (const mark of marks) {
      const startSec = (mark.offsetMs / 1000).toFixed(3);
      const durationSec = (mark.durationMs / 1000).toFixed(3);
      const segPath = join(sessionDir, `segment_${mark.clipNum}.mp4`);
      log(`Extract segment ${mark.clipNum}: ${startSec}s for ${durationSec}s`);
      extractSegment(videoPath, startSec, durationSec, segPath);
      segmentPaths.push(segPath);
    }
  }

  const concatListPath = join(sessionDir, "concat_list.txt");
  const concatSilentPath = join(sessionDir, "concat_silent.mp4");
  concatVideo(segmentPaths, concatListPath, concatSilentPath);

  return { segmentPaths, concatListPath, concatSilentPath };
}

export function buildAudioClipsFromTiming(timing, marks, segmentPaths) {
  const audioClips = [];
  let cumulativeOffsetMs = 0;

  for (let i = 0; i < marks.length; i++) {
    const page = timing.pages[i];
    const actualSegMs = probeDurationMs(segmentPaths[i]);
    for (const clip of page.audioClips || []) {
      audioClips.push({
        path: clip.path,
        offsetMs: cumulativeOffsetMs + clip.offsetWithinPageMs,
      });
    }
    cumulativeOffsetMs += actualSegMs;
  }

  return audioClips;
}

export function buildAudioClipsFromPlan(polishPlan) {
  return polishPlan.audioPlan.clips.map((c) => ({
    path: c.path,
    offsetMs: c.offsetMs,
  }));
}

export function muxAndCleanup({
  videoPath,
  audioClips,
  outputPath,
  segmentPaths,
  concatPath,
  concatListPath,
}) {
  muxAudioOntoVideo(videoPath, audioClips, outputPath);

  for (const p of segmentPaths || []) {
    try {
      unlinkSync(p);
    } catch (e) {
      /* best effort */
    }
  }
  try {
    if (concatPath) unlinkSync(concatPath);
    if (concatListPath) unlinkSync(concatListPath);
  } catch (e) {
    /* best effort */
  }
}
