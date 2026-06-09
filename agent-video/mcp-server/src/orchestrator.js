// Orchestrator: the backward-compatible single call. Chains all four stages
// against one shared session, threading the call-time `providers` config through
// each. Equivalent to running the four discrete tools in sequence.

import { ensureSession, makeLogger } from "./session.js";
import { generateNarration } from "./research.js";
import { synthesizeSpeech } from "./synthesize.js";
import { recordPerformance } from "./record.js";
import { produceVideo } from "./produce.js";

export async function createNarratedRecording({ persona, pages, providers }) {
  const session = ensureSession();
  const log = makeLogger(session.sessionId);
  log(`Starting session ${session.sessionId} -> ${session.sessionDir}`);

  await generateNarration({ sessionId: session.sessionId, persona, pages, providers });
  await synthesizeSpeech({ sessionId: session.sessionId, providers });
  await recordPerformance({ sessionId: session.sessionId });
  return produceVideo({ sessionId: session.sessionId, providers });
}
