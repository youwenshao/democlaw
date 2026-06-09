// ElevenLabs TTS provider - char tier.
// Uses the /with-timestamps endpoint to recover character-level start times,
// which yields the most precise scroll sync.

import { writeFileSync } from "fs";

export const tier = "char";

export async function synthesize(text, clipPath, options = {}) {
  const voiceId =
    options.voice || process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";
  const apiKey = process.env[options.apiKeyEnv || "ELEVENLABS_API_KEY"];
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY not set");
  }

  const modelId = options.model || "eleven_multilingual_v2";

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text, model_id: modelId }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ElevenLabs API error: ${error}`);
  }

  const data = await response.json();

  const audioBuffer = Buffer.from(data.audio_base64, "base64");
  writeFileSync(clipPath, audioBuffer);

  const alignment = data.alignment || {};
  const charStartTimes = alignment.character_start_times_seconds || [];
  const charEndTimes = alignment.character_end_times_seconds || [];
  const durationSec =
    charEndTimes.length > 0 ? charEndTimes[charEndTimes.length - 1] : 3;

  return {
    durationMs: Math.round(durationSec * 1000),
    charStartTimes,
  };
}
