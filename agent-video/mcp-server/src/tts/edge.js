// Edge TTS provider - duration tier. Free, no API key, good for local/smoke runs.
// Shells out to Microsoft's `edge-tts` Python CLI. By default it is run through
// `uvx` so no global install is required:
//
//   EDGE_TTS_CMD="uvx edge-tts"   (default)
//   EDGE_TTS_CMD="edge-tts"       (if installed globally)
//
// edge-tts emits audio only (no timestamps), so duration is measured by ffprobe
// upstream in tts/index.js.

import { spawnSync } from "child_process";
import { writeFileSync } from "fs";

export const tier = "duration";

export async function synthesize(text, clipPath, options = {}) {
  const voice = options.voice || process.env.EDGE_TTS_VOICE || "en-US-AriaNeural";
  const runner = (process.env.EDGE_TTS_CMD || "uvx edge-tts").trim().split(/\s+/);
  const [cmd, ...baseArgs] = runner;

  // Pass text via a file to avoid shell-escaping/injection issues.
  const textPath = `${clipPath}.txt`;
  writeFileSync(textPath, text);

  const args = [
    ...baseArgs,
    "--file",
    textPath,
    "--write-media",
    clipPath,
    "--voice",
    voice,
  ];
  if (options.rate) args.push("--rate", options.rate);
  if (options.pitch) args.push("--pitch", options.pitch);

  const result = spawnSync(cmd, args, { encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(
      `edge-tts failed (${cmd} ${args.join(" ")}): ${result.stderr || result.error?.message || "unknown error"}`
    );
  }

  // Duration is measured by the caller via ffprobe.
  return {};
}
