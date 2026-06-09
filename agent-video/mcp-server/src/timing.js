// The timing engine. It produces a uniform `segmentTimings` shape regardless of
// which TTS provider was used, so the performance pass and post-production never
// need to know how timing was derived.
//
// Two tiers feed this module:
//   - char tier  (e.g. ElevenLabs): exact character_start_times_seconds.
//   - duration tier (e.g. Edge TTS, MisoTTS): per-segment audio durations.
//
// Output segment shape:
//   { text, scrollTo, startTimeSec, endTimeSec, startTimeMs, endTimeMs }

// Char tier: map each segment onto character-level start times of the full text.
export function timingsFromCharTimes(segments, charStartTimes) {
  const segmentTimings = [];
  let charOffset = 0;

  for (const segment of segments) {
    const segmentText = segment.text;

    const startTime =
      charOffset < charStartTimes.length ? charStartTimes[charOffset] : 0;

    const endCharOffset = charOffset + segmentText.length;
    const endTime =
      endCharOffset < charStartTimes.length
        ? charStartTimes[endCharOffset]
        : charStartTimes[charStartTimes.length - 1] || startTime;

    segmentTimings.push({
      text: segmentText,
      scrollTo: segment.scrollTo,
      ...(segment.action ? { action: segment.action } : {}),
      startTimeSec: startTime,
      endTimeSec: endTime,
      startTimeMs: Math.round(startTime * 1000),
      endTimeMs: Math.round(endTime * 1000),
    });

    charOffset = endCharOffset + 1; // +1 for the joining space
  }

  return segmentTimings;
}

// Duration tier: each segment was synthesized separately; chain durations.
// segmentDurationsMs[i] is the measured duration of segment i's audio clip.
export function timingsFromDurations(segments, segmentDurationsMs) {
  const segmentTimings = [];
  let cursorMs = 0;

  segments.forEach((segment, i) => {
    const durationMs = segmentDurationsMs[i] || 0;
    const startTimeMs = cursorMs;
    const endTimeMs = cursorMs + durationMs;

    segmentTimings.push({
      text: segment.text,
      scrollTo: segment.scrollTo,
      ...(segment.action ? { action: segment.action } : {}),
      startTimeSec: startTimeMs / 1000,
      endTimeSec: endTimeMs / 1000,
      startTimeMs,
      endTimeMs,
    });

    cursorMs = endTimeMs;
  });

  return segmentTimings;
}
