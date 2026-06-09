// Stage 4: post-production + hosting.
// Reads timing.json + marks.json, extracts each page's video slice, concatenates
// them, mixes every audio clip onto the timeline at its absolute offset, then
// hands the finished file to the configured host provider. Writes result.json.

import { join } from "path";
import { unlinkSync } from "fs";
import {
  ensureSession,
  readArtifact,
  writeArtifact,
  makeLogger,
} from "./session.js";
import {
  extractSegment,
  concatVideo,
  muxAudioOntoVideo,
  probeDurationMs,
} from "./ffmpeg.js";
import { getHostProvider } from "./host/index.js";
import { resolveProviders } from "./config.js";

export async function produceVideo({ sessionId, providers }) {
  const session = ensureSession(sessionId);
  const log = makeLogger(session.sessionId);
  const timing = readArtifact(session.sessionId, "timing.json");
  const marksData = readArtifact(session.sessionId, "marks.json");
  const { videoPath, marks } = marksData;

  log(`=== POST-PRODUCTION === segments=${marks.length}`);

  // 1. Extract each page's slice of the raw recording.
  const segmentPaths = [];
  for (const mark of marks) {
    const startSec = (mark.offsetMs / 1000).toFixed(3);
    const durationSec = (mark.durationMs / 1000).toFixed(3);
    const segPath = join(session.sessionDir, `segment_${mark.clipNum}.mp4`);
    log(`Extract segment ${mark.clipNum}: ${startSec}s for ${durationSec}s`);
    extractSegment(videoPath, startSec, durationSec, segPath);
    segmentPaths.push(segPath);
  }

  // 2. Concatenate the slices.
  const concatListPath = join(session.sessionDir, "concat_list.txt");
  const concatPath = join(session.sessionDir, "concat.mp4");
  concatVideo(segmentPaths, concatListPath, concatPath);

  // 3. Place every audio clip at its absolute timeline offset.
  //    page start in final video = cumulative ACTUAL extracted slice durations.
  const audioClips = [];
  let cumulativeOffsetMs = 0;
  for (let i = 0; i < marks.length; i++) {
    const page = timing.pages[i];
    const actualSegMs = probeDurationMs(segmentPaths[i]);
    for (const clip of page.audioClips) {
      audioClips.push({
        path: clip.path,
        offsetMs: cumulativeOffsetMs + clip.offsetWithinPageMs,
      });
    }
    cumulativeOffsetMs += actualSegMs;
  }

  // 4. Mix audio onto the concatenated video.
  const outputPath = join(session.sessionDir, "output.mp4");
  muxAudioOntoVideo(concatPath, audioClips, outputPath);
  log(`Output created: ${outputPath}`);

  // 5. Host it.
  const resolved = resolveProviders({ ...(timing.providers || {}), ...(providers || {}) });
  const host = getHostProvider(resolved.host.name);
  log(`Hosting via "${resolved.host.name}"...`);
  const hosted = await host.upload(outputPath, resolved.host);
  log(`Hosted: ${hosted.url}`);

  // Cleanup intermediates.
  for (const p of segmentPaths) {
    try {
      unlinkSync(p);
    } catch (e) {
      /* best effort */
    }
  }
  try {
    unlinkSync(concatPath);
    unlinkSync(concatListPath);
  } catch (e) {
    /* best effort */
  }

  const result = {
    success: true,
    url: hosted.url,
    playbackUrl: hosted.url, // backward-compatible alias
    host: resolved.host.name,
    outputPath,
    sessionDir: session.sessionDir,
    pagesRecorded: marks.length,
    hosted,
  };
  writeArtifact(session.sessionId, "result.json", result);
  return { sessionId: session.sessionId, ...result };
}
