// Dynamic export timeout from polish plan duration.

export function computeExportTimeoutMs(plan) {
  const durationMs = plan.timeline?.totalDurationMs ?? 0;
  const playbackRate = plan.export?.playbackRate ?? 1;
  const marginMs = plan.export?.timeoutMarginMs ?? 120_000;
  return Math.max(
    300_000,
    Math.ceil((durationMs / playbackRate) * 2) + marginMs
  );
}
