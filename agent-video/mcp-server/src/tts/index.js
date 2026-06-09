// TTS provider registry + the tiered timing contract.
//
// The core problem this solves: the two-pass timing engine originally relied on
// ElevenLabs character-level timestamps to sync scrolling to speech. Local/free
// TTS engines (Edge TTS, MisoTTS) emit audio only. To keep TTS swappable WITHOUT
// losing sync, providers declare a `tier`:
//
//   - "char":     synthesize the whole page text once; return per-character start
//                 times. Highest precision. (ElevenLabs)
//   - "duration": synthesize each segment separately; we measure each clip's
//                 duration with ffprobe and chain them. Works with ANY engine.
//
// Provider interface:
//   tier: "char" | "duration"
//   async synthesize(text, clipPath, options) -> { durationMs, charStartTimes? }
//     (writes the audio file to clipPath)
//
// synthesizePageAudio() normalizes both tiers into one uniform per-page shape:
//   {
//     tier,
//     pageDurationMs,
//     segmentTimings: [{ text, scrollTo, startTimeMs, endTimeMs, ... }],
//     audioClips:     [{ path, offsetWithinPageMs, durationMs }]
//   }

import { join } from "path";
import * as elevenlabs from "./elevenlabs.js";
import * as edge from "./edge.js";
import * as miso from "./miso.js";
import { probeDurationMs } from "../ffmpeg.js";
import { timingsFromCharTimes, timingsFromDurations } from "../timing.js";

const PROVIDERS = {
  elevenlabs,
  edge,
  miso,
};

export function getTtsProvider(name) {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(
      `Unknown TTS provider "${name}". Available: ${Object.keys(PROVIDERS).join(", ")}`
    );
  }
  return provider;
}

// Synthesize one page's worth of narration and produce unified timing.
export async function synthesizePageAudio({
  providerName,
  segments,
  sessionDir,
  pageIndex,
  options = {},
  log = console.error,
}) {
  const provider = getTtsProvider(providerName);
  const clipNum = pageIndex + 1;

  if (provider.tier === "char") {
    // One clip for the whole page; precise char-level timing.
    const fullText = segments.map((s) => s.text).join(" ");
    const clipPath = join(sessionDir, `clip_${clipNum}.mp3`);
    const { durationMs, charStartTimes } = await provider.synthesize(
      fullText,
      clipPath,
      options
    );
    log(
      `[tts:${providerName}] page ${clipNum}: char tier, ${charStartTimes?.length || 0} char times, ${durationMs}ms`
    );
    const segmentTimings = timingsFromCharTimes(segments, charStartTimes || []);
    return {
      tier: "char",
      pageDurationMs: durationMs,
      segmentTimings,
      audioClips: [{ path: clipPath, offsetWithinPageMs: 0, durationMs }],
    };
  }

  // Duration tier: synthesize each segment, measure, and chain.
  const audioClips = [];
  const segmentDurationsMs = [];
  let cursorMs = 0;

  for (let i = 0; i < segments.length; i++) {
    const segClipPath = join(sessionDir, `clip_${clipNum}_seg_${i + 1}.mp3`);
    const res = await provider.synthesize(segments[i].text, segClipPath, options);
    const durationMs = res?.durationMs || probeDurationMs(segClipPath);
    segmentDurationsMs.push(durationMs);
    audioClips.push({
      path: segClipPath,
      offsetWithinPageMs: cursorMs,
      durationMs,
    });
    cursorMs += durationMs;
  }

  log(
    `[tts:${providerName}] page ${clipNum}: duration tier, ${segments.length} segment clips, ${cursorMs}ms`
  );

  const segmentTimings = timingsFromDurations(segments, segmentDurationsMs);
  return {
    tier: "duration",
    pageDurationMs: cursorMs,
    segmentTimings,
    audioClips,
  };
}
