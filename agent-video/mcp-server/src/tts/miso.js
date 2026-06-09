// MisoTTS provider - duration tier. DEFERRED.
//
// MisoLabs/MisoTTS is an 8B, ~32.8 GB local model (Mimi / Sesame-CSM style,
// English-only, optional ~10s reference clip for voice cloning). It emits audio
// only (no timestamps), so it uses the duration tier exactly like Edge TTS.
//
// It is intentionally NOT bundled here: it realistically needs a machine like an
// M2 Ultra Mac Studio (64GB unified memory). The interface below is complete and
// will work as soon as a local inference wrapper is provided.
//
// To enable on capable hardware, set MISO_TTS_CMD to a command that:
//   - reads narration text from the file given after --file
//   - writes a wav/mp3 to the path given after --out
//   - (optionally) accepts a reference voice clip after --voice
// e.g. on the Mac Studio, in the MisoLabsAI/MisoTTS repo:
//   MISO_TTS_CMD="uv run python run_misotts.py"
// (adapt run_misotts.py to accept --file/--out/--voice, or wrap it.)

import { spawnSync } from "child_process";
import { writeFileSync } from "fs";

export const tier = "duration";

export async function synthesize(text, clipPath, options = {}) {
  const cmdEnv = process.env.MISO_TTS_CMD;
  if (!cmdEnv) {
    throw new Error(
      "MisoTTS provider is deferred (not bundled). It needs the ~32.8GB MisoLabs/MisoTTS " +
        "model and capable hardware (e.g. M2 Ultra / 64GB). To enable, set MISO_TTS_CMD to a " +
        "local inference command accepting --file <text> --out <audio> [--voice <ref-clip>]. " +
        "Until then, use the 'edge' (free) or 'elevenlabs' TTS provider."
    );
  }

  const runner = cmdEnv.trim().split(/\s+/);
  const [cmd, ...baseArgs] = runner;

  const textPath = `${clipPath}.txt`;
  writeFileSync(textPath, text);

  const args = [...baseArgs, "--file", textPath, "--out", clipPath];
  const voiceRef = options.voice || process.env.MISO_TTS_VOICE_REF;
  if (voiceRef) args.push("--voice", voiceRef);

  const result = spawnSync(cmd, args, { encoding: "utf-8", timeout: options.timeout || 600000 });
  if (result.status !== 0) {
    throw new Error(
      `MisoTTS failed (${cmd} ${args.join(" ")}): ${result.stderr || result.error?.message || "unknown error"}`
    );
  }

  // Duration is measured by the caller via ffprobe.
  return {};
}
