// Stage 4: post-production + hosting.
// Reads timing.json + marks.json, extracts each page's video slice, concatenates
// them, mixes every audio clip onto the timeline at its absolute offset, then
// hands the finished file to the configured host provider. Writes result.json.
//
// When postProd.name === "openscreen", builds polish_plan.json and runs the
// headless compositor before muxing narration. Falls back to ffmpeg on failure.

import { join } from "path";
import { existsSync, statSync } from "fs";
import {
  ensureSession,
  readArtifact,
  writeArtifact,
  makeLogger,
} from "./session.js";
import { getHostProvider } from "./host/index.js";
import { resolveProviders } from "./config.js";
import { resolvePostProdOptions } from "./polish/presets.js";
import { buildPolishPlan } from "./polish/buildPlan.js";
import { runOpenscreenExport } from "./polish/runExport.js";
import {
  extractAndConcatSilent,
  buildAudioClipsFromTiming,
  buildAudioClipsFromPlan,
  muxAndCleanup,
} from "./polish/videoPrep.js";

async function runFfmpegPath({
  session,
  timing,
  marksData,
  log,
  outputPath,
}) {
  const { videoPath, marks } = marksData;
  const { segmentPaths, concatListPath, concatSilentPath } = extractAndConcatSilent({
    sessionDir: session.sessionDir,
    videoPath,
    marks,
    marksData,
    log,
  });

  const audioClips = buildAudioClipsFromTiming(timing, marks, segmentPaths);
  muxAndCleanup({
    videoPath: concatSilentPath,
    audioClips,
    outputPath,
    segmentPaths,
    concatPath: concatSilentPath,
    concatListPath,
  });

  return {
    postProdUsed: "ffmpeg",
    concatSilentPath,
    polishPlanPath: null,
    polishedSilentPath: null,
  };
}

async function runOpenscreenPath({
  session,
  timing,
  marksData,
  postProdOptions,
  log,
  outputPath,
}) {
  const { videoPath, marks } = marksData;
  const postProd = resolvePostProdOptions(postProdOptions);

  const { segmentPaths, concatListPath, concatSilentPath } = extractAndConcatSilent({
    sessionDir: session.sessionDir,
    videoPath,
    marks,
    marksData,
    log,
  });

  const polishPlan = buildPolishPlan({
    sessionDir: session.sessionDir,
    timing,
    marksData: { ...marksData, marks },
    postProdOptions: postProd,
  });
  polishPlan.workingVideo = concatSilentPath;

  const polishPlanPath = writeArtifact(session.sessionId, "polish_plan.json", polishPlan);
  log(`Wrote polish plan: ${polishPlanPath}`);

  let visualPath = concatSilentPath;
  let postProdUsed = "openscreen";

  try {
    await runOpenscreenExport(session.sessionDir, { log });
    visualPath = join(session.sessionDir, "polished_silent.mp4");
    log(`OpenScreen export complete: ${visualPath}`);
  } catch (e) {
    const partialWebm = join(session.sessionDir, "polished_silent.webm");
    const partialMp4 = join(session.sessionDir, "polished_silent.mp4");
    const partialNote = existsSync(partialWebm)
      ? `partial webm ${statSync(partialWebm).size} bytes at ${partialWebm}`
      : existsSync(partialMp4)
        ? `partial mp4 ${statSync(partialMp4).size} bytes at ${partialMp4}`
        : "no partial polished file written";
    log(
      `WARNING: OpenScreen export failed (${e.message}); ${partialNote}; falling back to ffmpeg concat. ` +
        `Re-run produce_video on session ${session.sessionId} with postProd=openscreen after fixing export.`
    );
    postProdUsed = "openscreen-fallback-ffmpeg";
    visualPath = concatSilentPath;
  }

  const audioClips = buildAudioClipsFromPlan(polishPlan);
  muxAndCleanup({
    videoPath: visualPath,
    audioClips,
    outputPath,
    segmentPaths,
    concatPath: concatSilentPath,
    concatListPath,
  });

  return {
    postProdUsed,
    concatSilentPath,
    polishPlanPath,
    polishedSilentPath:
      postProdUsed === "openscreen" ? join(session.sessionDir, "polished_silent.mp4") : null,
  };
}

export async function produceVideo({ sessionId, providers }) {
  const session = ensureSession(sessionId);
  const log = makeLogger(session.sessionId);
  const timing = readArtifact(session.sessionId, "timing.json");
  const marksData = readArtifact(session.sessionId, "marks.json");

  const resolved = resolveProviders({ ...(timing.providers || {}), ...(providers || {}) });
  const postProdName = resolved.postProd?.name || "ffmpeg";

  log(`=== POST-PRODUCTION === segments=${marksData.marks.length} postProd=${postProdName}`);

  const outputPath = join(session.sessionDir, "output.mp4");
  let prodMeta;

  if (postProdName === "openscreen") {
    prodMeta = await runOpenscreenPath({
      session,
      timing,
      marksData,
      postProdOptions: resolved.postProd,
      log,
      outputPath,
    });
  } else {
    prodMeta = await runFfmpegPath({
      session,
      timing,
      marksData,
      log,
      outputPath,
    });
  }

  log(`Output created: ${outputPath}`);

  const host = getHostProvider(resolved.host.name);
  log(`Hosting via "${resolved.host.name}"...`);
  const hosted = await host.upload(outputPath, resolved.host);
  log(`Hosted: ${hosted.url}`);

  const result = {
    success: true,
    url: hosted.url,
    playbackUrl: hosted.url,
    host: resolved.host.name,
    postProd: prodMeta.postProdUsed,
    outputPath,
    sessionDir: session.sessionDir,
    pagesRecorded: marksData.marks.length,
    polishPlanPath: prodMeta.polishPlanPath,
    intermediates: {
      concatSilent: prodMeta.concatSilentPath,
      ...(prodMeta.polishedSilentPath
        ? { polishedSilent: prodMeta.polishedSilentPath }
        : {}),
    },
    hosted,
  };
  writeArtifact(session.sessionId, "result.json", result);
  return { sessionId: session.sessionId, ...result };
}
