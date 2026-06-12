// Cursor interpolation for synthetic overlay (OpenScreen-compatible shape).

function easeInOutCubic(t) {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

export function interpolateCursorAt(telemetry, timeMs) {
  if (!telemetry?.length) return { cx: 0.5, cy: 0.55 };

  if (timeMs <= telemetry[0].timeMs) {
    return { cx: telemetry[0].cx, cy: telemetry[0].cy };
  }

  const last = telemetry[telemetry.length - 1];
  if (timeMs >= last.timeMs) {
    return { cx: last.cx, cy: last.cy };
  }

  let lo = 0;
  let hi = telemetry.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >>> 1;
    if (telemetry[mid].timeMs <= timeMs) lo = mid;
    else hi = mid;
  }

  const before = telemetry[lo];
  const after = telemetry[hi];
  const span = after.timeMs - before.timeMs;
  const t = span > 0 ? easeInOutCubic((timeMs - before.timeMs) / span) : 0;

  return {
    cx: before.cx + (after.cx - before.cx) * t,
    cy: before.cy + (after.cy - before.cy) * t,
  };
}

export function mapCursorToStage(focus, videoRect, transform) {
  const localX = focus.cx * videoRect.width - videoRect.width / 2;
  const localY = focus.cy * videoRect.height - videoRect.height / 2;
  const cx = videoRect.x + videoRect.width / 2 + transform.tx + localX * transform.scale;
  const cy = videoRect.y + videoRect.height / 2 + transform.ty + localY * transform.scale;
  return { x: cx, y: cy };
}

export function isNearClick(timeMs, clickTimestamps, windowMs = 150) {
  return clickTimestamps.some((t) => Math.abs(timeMs - t) <= windowMs);
}

export function drawCursor(ctx, x, y, { scale = 1.2, clickPulse = false } = {}) {
  const r = 8 * scale;
  ctx.save();
  if (clickPulse) {
    ctx.beginPath();
    ctx.arc(x, y, r * 1.8, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.strokeStyle = "rgba(0,0,0,0.45)";
  ctx.lineWidth = 2;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
