// Auto-critique loop orchestration (ralph-loop).

import { ensureSession, makeLogger, readArtifact, writeArtifact } from "../session.js";
import { resolveProviders } from "../config.js";
import { generateNarration } from "../research.js";
import { synthesizeSpeech } from "../synthesize.js";
import { recordPerformance } from "../record.js";
import { produceVideo } from "../produce.js";
import { assessTimingFromArtifacts } from "./assessTiming.js";
import { assessWorkflowFromSession } from "./assessWorkflow.js";
import { writeGoalsFromNarration } from "./goals.js";
import { buildAutoCritique } from "./autoCritique.js";

function iterationProviders(providers, { final = false } = {}) {
  const resolved = resolveProviders(providers);
  if (final) return resolved;
  return {
    ...resolved,
    postProd: { name: "ffmpeg" },
  };
}

function clipNumsNeedingWork(critique) {
  const nums = [];
  for (const scene of critique.scenes || []) {
    if (scene.action === "rerecord" || scene.action === "edit") {
      nums.push(scene.clipNum);
    }
  }
  return [...new Set(nums)].sort((a, b) => a - b);
}

export async function runCritiqueIteration({
  sessionId,
  providers,
  iteration,
  clipNums = null,
  merge = true,
  forceRerecordClipNums = [],
}) {
  const session = ensureSession(sessionId);
  const log = makeLogger(session.sessionId);
  const iterProviders = iterationProviders(providers);

  if (clipNums?.length) {
    await recordPerformance({
      sessionId: session.sessionId,
      clipNums,
      merge,
    });
  } else {
    await synthesizeSpeech({ sessionId: session.sessionId, providers: iterProviders });
    await recordPerformance({ sessionId: session.sessionId });
  }

  const timing = readArtifact(session.sessionId, "timing.json");
  const timingReport = assessTimingFromArtifacts(timing);
  writeArtifact(session.sessionId, "assess_timing.json", timingReport);

  let marksData = {};
  try {
    marksData = readArtifact(session.sessionId, "marks.json");
  } catch {
    /* marks unavailable */
  }

  const workflowReport = assessWorkflowFromSession({
    sessionDir: session.sessionDir,
    timing,
    marksData,
  });
  writeArtifact(session.sessionId, "assess_workflow.json", workflowReport);

  let goals;
  try {
    goals = readArtifact(session.sessionId, "goals.json");
  } catch {
    const narration = readArtifact(session.sessionId, "narration.json");
    goals = writeGoalsFromNarration(session.sessionId, narration);
  }

  const critique = buildAutoCritique({
    goals,
    timingReport,
    workflowReport,
    iteration,
    forceRerecordClipNums,
  });
  writeArtifact(session.sessionId, "critique.json", critique);

  log(
    `=== CRITIQUE iter=${iteration} verdict=${critique.verdict} next=${critique.next} flagged=${clipNumsNeedingWork(critique).join(",") || "none"} ===`
  );

  await produceVideo({
    sessionId: session.sessionId,
    providers: iterProviders,
  });

  return { sessionId: session.sessionId, timingReport, critique };
}

export async function createNarratedRecordingWithCritique({
  persona,
  pages,
  providers,
  critique = {},
}) {
  const maxIterations = critique.maxIterations ?? 3;
  const session = ensureSession();
  const log = makeLogger(session.sessionId);
  const resolved = resolveProviders(providers);

  log(`Starting critique session ${session.sessionId} -> ${session.sessionDir}`);

  const narration = await generateNarration({
    sessionId: session.sessionId,
    persona,
    pages,
    providers: resolved,
  });
  writeGoalsFromNarration(session.sessionId, narration);

  let lastCritique = null;
  let clipNumsToFix = null;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (iteration === 1) {
      const result = await runCritiqueIteration({
        sessionId: session.sessionId,
        providers: resolved,
        iteration,
      });
      lastCritique = result.critique;
    } else {
      const result = await runCritiqueIteration({
        sessionId: session.sessionId,
        providers: resolved,
        iteration,
        clipNums: clipNumsToFix,
        merge: true,
      });
      lastCritique = result.critique;
    }

    if (lastCritique.verdict === "pass") break;

    clipNumsToFix = clipNumsNeedingWork(lastCritique);
    if (!clipNumsToFix.length) break;

    const rerecordOnly = lastCritique.scenes
      .filter((s) => clipNumsToFix.includes(s.clipNum) && s.action === "rerecord")
      .map((s) => s.clipNum);

    if (rerecordOnly.length === clipNumsToFix.length) {
      log(`Iteration ${iteration}: partial re-record clips ${rerecordOnly.join(",")}`);
      clipNumsToFix = rerecordOnly;
      continue;
    }

    log(
      `Iteration ${iteration}: pacing defects on clips ${clipNumsToFix.join(",")} — manual narration edits may be needed; stopping auto-fix`
    );
    break;
  }

  const finalProviders = iterationProviders(providers, { final: true });
  if (lastCritique?.verdict !== "pass") {
    log(
      "=== FINAL OUTPUT (no polish) === workflow or pacing defects remain; using ffmpeg postProd"
    );
    finalProviders.postProd = { name: "ffmpeg" };
  } else {
    log(`=== FINAL POLISH === postProd=${finalProviders.postProd.name}`);
  }
  return produceVideo({
    sessionId: session.sessionId,
    providers: finalProviders,
  });
}
