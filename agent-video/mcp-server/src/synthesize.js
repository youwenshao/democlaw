// Stage 2: TTS synthesis + timing.
// Reads narration.json, synthesizes audio with the configured TTS provider, and
// writes timing.json (the uniform segment-timing + audio-clip manifest consumed
// by the performance and post-production stages). The TTS provider can be swapped
// here (e.g. ElevenLabs -> Edge) without re-running research.

import { ensureSession, readArtifact, writeArtifact, makeLogger } from "./session.js";
import { synthesizePageAudio } from "./tts/index.js";
import { resolveProviders } from "./config.js";

export async function synthesizeSpeech({ sessionId, providers }) {
  const session = ensureSession(sessionId);
  const log = makeLogger(session.sessionId);
  const narration = readArtifact(session.sessionId, "narration.json");

  // Explicit call-time providers override what was stored at research time.
  const resolved = resolveProviders({ ...(narration.providers || {}), ...(providers || {}) });
  const ttsName = resolved.tts.name;
  log(`=== AUDIO GENERATION === provider=${ttsName}`);

  const pages = [];
  for (let i = 0; i < narration.pages.length; i++) {
    const page = narration.pages[i];
    const audio = await synthesizePageAudio({
      providerName: ttsName,
      segments: page.segments,
      sessionDir: session.sessionDir,
      pageIndex: i,
      options: resolved.tts,
      log,
    });
    pages.push({
      url: page.url,
      ...(page.reuseTab ? { reuseTab: true } : {}),
      ...(page.entryActions ? { entryActions: page.entryActions } : {}),
      segments: page.segments,
      ...audio,
    });
  }

  const timing = {
    providers: resolved,
    ttsTier: pages[0]?.tier,
    pages,
    createdAt: new Date().toISOString(),
  };
  writeArtifact(session.sessionId, "timing.json", timing);
  return { sessionId: session.sessionId, ...timing };
}
