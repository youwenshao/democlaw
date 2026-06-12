// Stage 2: TTS synthesis + timing.
// Reads narration.json, synthesizes audio with the configured TTS provider, and
// writes timing.json (the uniform segment-timing + audio-clip manifest consumed
// by the performance and post-production stages). The TTS provider can be swapped
// here (e.g. ElevenLabs -> Edge) without re-running research.

import { ensureSession, readArtifact, writeArtifact, makeLogger } from "./session.js";
import { synthesizePageAudio } from "./tts/index.js";
import { resolveProviders } from "./config.js";

function pageIndicesForClipNums(pages, clipNums) {
  return clipNums
    .map((n) => n - 1)
    .filter((i) => i >= 0 && i < pages.length);
}

async function synthesizePageAtIndex({
  narration,
  pageIndex,
  resolved,
  session,
  log,
}) {
  const page = narration.pages[pageIndex];
  const audio = await synthesizePageAudio({
    providerName: resolved.tts.name,
    segments: page.segments,
    sessionDir: session.sessionDir,
    pageIndex,
    options: resolved.tts,
    log,
  });
  return {
    url: page.url,
    ...(page.reuseTab ? { reuseTab: true } : {}),
    ...(page.loginScene ? { loginScene: true } : {}),
    ...(page.actionScript ? { actionScript: page.actionScript } : {}),
    ...(page.entryActions ? { entryActions: page.entryActions } : {}),
    ...(page.hint ? { hint: page.hint } : {}),
    ...(page.grounding ? { grounding: page.grounding } : {}),
    segments: page.segments,
    ...audio,
  };
}

export async function synthesizeSpeech({ sessionId, providers, clipNums = null }) {
  const session = ensureSession(sessionId);
  const log = makeLogger(session.sessionId);
  const narration = readArtifact(session.sessionId, "narration.json");

  const resolved = resolveProviders({ ...(narration.providers || {}), ...(providers || {}) });
  const ttsName = resolved.tts.name;
  const partial = Array.isArray(clipNums) && clipNums.length > 0;

  log(
    `=== AUDIO GENERATION === provider=${ttsName}${partial ? ` partial=${clipNums.join(",")}` : ""}`
  );

  let pages;

  if (partial) {
    const existing = readArtifact(session.sessionId, "timing.json");
    pages = [...existing.pages];
    const indices = pageIndicesForClipNums(narration.pages, clipNums);

    for (const i of indices) {
      pages[i] = await synthesizePageAtIndex({
        narration,
        pageIndex: i,
        resolved,
        session,
        log,
      });
      log(`Patched timing page ${i + 1} (clip ${i + 1})`);
    }
  } else {
    pages = [];
    for (let i = 0; i < narration.pages.length; i++) {
      pages.push(
        await synthesizePageAtIndex({
          narration,
          pageIndex: i,
          resolved,
          session,
          log,
        })
      );
    }
  }

  const timing = {
    providers: resolved,
    ttsTier: pages[0]?.tier,
    pages,
    createdAt: new Date().toISOString(),
  };
  writeArtifact(session.sessionId, "timing.json", timing);

  if (partial) {
    try {
      const marksData = readArtifact(session.sessionId, "marks.json");
      if (marksData.marks && marksData.sceneClips) {
        const updatedMarks = marksData.marks.map((m) => {
          const page = pages[m.clipNum - 1];
          if (clipNums.includes(m.clipNum) && page?.pageDurationMs) {
            return { ...m, durationMs: page.pageDurationMs };
          }
          return m;
        });
        const updatedClips = marksData.sceneClips.map((c) => {
          const page = pages[c.clipNum - 1];
          if (clipNums.includes(c.clipNum) && page?.pageDurationMs) {
            return { ...c, durationMs: page.pageDurationMs };
          }
          return c;
        });
        writeArtifact(session.sessionId, "marks.json", {
          ...marksData,
          marks: updatedMarks,
          sceneClips: updatedClips,
        });
      }
    } catch {
      /* marks.json optional during partial synth before first record */
    }
  }

  return { sessionId: session.sessionId, ...timing };
}
