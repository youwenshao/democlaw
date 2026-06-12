// Deterministic critique.json builder from assess_timing + goals.json + workflow.

const FLAG_TO_DEFECT = {
  rushing: { type: "rushing", fix: "Shorten text or split into two segments" },
  dragging: { type: "dragging", fix: "Tighten copy or increase scene duration" },
  too_short: { type: "rushing", fix: "Segment too short for word count — slow down or shorten text" },
  too_long: { type: "dragging", fix: "Segment too long — trim narration or split scene" },
};

const WORKFLOW_RERECORD = new Set([
  "login_failed",
  "nav_failed",
  "wrong_page",
  "workflow_logic",
]);

export function buildAutoCritique({
  goals,
  timingReport,
  workflowReport = null,
  iteration = 1,
  forceRerecordClipNums = [],
}) {
  const forceSet = new Set(forceRerecordClipNums || []);
  const sceneResults = [];
  let hasMaterialDefects = false;
  const workflowByClip = new Map(
    (workflowReport?.scenes || []).map((s) => [s.clipNum, s.defects || []])
  );

  for (const scene of timingReport.scenes || []) {
    const defects = [];
    const goal = goals?.scenes?.find((g) => g.clipNum === scene.clipNum);

    for (const seg of scene.segments || []) {
      for (const flag of seg.flags || []) {
        const mapped = FLAG_TO_DEFECT[flag] || { type: "pacing", fix: "Adjust pacing" };
        defects.push({
          type: mapped.type,
          severity: flag === "rushing" || flag === "too_short" ? "medium" : "low",
          evidence: `segment ${seg.idx} WPM ${seg.wpm} (${flag})`,
          fix: mapped.fix,
        });
      }
    }

    if (scene.flags?.includes("segment_pacing") && defects.length === 0) {
      defects.push({
        type: "pacing",
        severity: "low",
        evidence: `scene WPM ${scene.sceneWpm}`,
        fix: "Review scene pacing against goals",
      });
    }

    if (forceSet.has(scene.clipNum)) {
      defects.push({
        type: "workflow_logic",
        severity: "high",
        evidence: "Admin session expired during recording — nav clicks failed",
        fix: "Re-record with admin session keepalive",
      });
    }

    for (const wf of workflowByClip.get(scene.clipNum) || []) {
      defects.push(wf);
    }

    const material = defects.filter(
      (d) =>
        WORKFLOW_RERECORD.has(d.type) ||
        d.type === "rushing" ||
        d.severity === "medium" ||
        d.severity === "high"
    );

    let action = "keep";
    if (defects.some((d) => WORKFLOW_RERECORD.has(d.type))) {
      action = "rerecord";
      hasMaterialDefects = true;
    } else if (material.length > 0) {
      action = "edit";
      hasMaterialDefects = true;
    }

    if (goal?.mustShow?.length && defects.length === 0) {
      void goal;
    }

    sceneResults.push({
      clipNum: scene.clipNum,
      defects,
      action,
    });
  }

  if (workflowReport?.hasMaterialDefects) {
    hasMaterialDefects = true;
  }

  const verdict = hasMaterialDefects ? "revise" : "pass";
  return {
    iteration,
    verdict,
    scenes: sceneResults,
    structural: workflowReport?.global || [],
    next: verdict === "pass" ? "polish" : "scene-fix",
    source: "auto",
    createdAt: new Date().toISOString(),
  };
}
