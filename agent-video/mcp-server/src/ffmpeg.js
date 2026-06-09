// Shared ffmpeg / ffprobe helpers used by the TTS fallback tier (audio concat)
// and the post-production stage (video extract/concat/mix).

import { execSync } from "child_process";
import { writeFileSync } from "fs";

const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";
const FFPROBE = process.env.FFPROBE_BIN || "ffprobe";

function run(cmd) {
  console.error(`[ffmpeg] $ ${cmd}`);
  return execSync(cmd, { encoding: "utf-8" });
}

// Duration of a media file in seconds (float).
export function probeDurationSec(path) {
  const out = execSync(
    `${FFPROBE} -v error -show_entries format=duration -of csv=p=0 "${path}" 2>/dev/null`
  )
    .toString()
    .trim();
  return parseFloat(out);
}

export function probeDurationMs(path) {
  return Math.round(probeDurationSec(path) * 1000);
}

// Concatenate a list of audio files into one output (re-encoded to a uniform
// mp3 so downstream timing/probe is reliable across heterogeneous inputs).
export function concatAudio(clipPaths, outputPath) {
  if (clipPaths.length === 1) {
    run(`${FFMPEG} -y -i "${clipPaths[0]}" -c:a libmp3lame -q:a 2 "${outputPath}" 2>/dev/null`);
    return outputPath;
  }
  const inputs = clipPaths.map((p) => `-i "${p}"`).join(" ");
  const filter = clipPaths.map((_, i) => `[${i}:a]`).join("") + `concat=n=${clipPaths.length}:v=0:a=1[out]`;
  run(
    `${FFMPEG} -y ${inputs} -filter_complex "${filter}" -map "[out]" -c:a libmp3lame -q:a 2 "${outputPath}" 2>/dev/null`
  );
  return outputPath;
}

// Extract a [startSec, startSec+durationSec] slice of a video, re-encoded.
export function extractSegment(videoPath, startSec, durationSec, outputPath) {
  run(
    `${FFMPEG} -y -i "${videoPath}" -ss ${startSec} -t ${durationSec} -c:v libx264 -preset fast -crf 23 "${outputPath}" 2>/dev/null`
  );
  return outputPath;
}

// Concatenate video segments (same codec/params) via the concat demuxer.
export function concatVideo(segmentPaths, concatListPath, outputPath) {
  const list = segmentPaths.map((p) => `file '${p}'`).join("\n");
  writeFileSync(concatListPath, list);
  run(`${FFMPEG} -y -f concat -safe 0 -i "${concatListPath}" -c copy "${outputPath}" 2>/dev/null`);
  return outputPath;
}

// Mix a set of audio clips onto a video at absolute offsets (ms).
// audioClips: [{ path, offsetMs }]
export function muxAudioOntoVideo(videoPath, audioClips, outputPath) {
  let inputs = "";
  let filter = "";
  let labels = "";

  audioClips.forEach((clip, i) => {
    const n = i + 1; // input 0 is the video
    inputs += ` -i "${clip.path}"`;
    filter += `[${n}]adelay=${clip.offsetMs}|${clip.offsetMs}[a${n}];`;
    labels += `[a${n}]`;
  });

  // normalize=0: clips are sequential (non-overlapping), so keep full volume
  // instead of amix's default 1/N attenuation (which gets worse as segment
  // count grows in the duration tier).
  filter += `${labels}amix=inputs=${audioClips.length}:duration=longest:normalize=0[aout]`;

  run(
    `${FFMPEG} -y -i "${videoPath}"${inputs} -filter_complex "${filter}" -map 0:v -map "[aout]" -c:v copy -c:a aac "${outputPath}" 2>/dev/null`
  );
  return outputPath;
}
