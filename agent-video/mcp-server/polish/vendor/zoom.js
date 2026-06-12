// OpenScreen-inspired zoom math (ported subset for headless compositor).

export function getZoomScale(depth) {
  const d = Math.min(6, Math.max(1, Number(depth) || 1));
  return 1 + (d - 1) * 0.35;
}

export function easeOutCubic(t) {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3;
}

export function computeRegionStrength(region, timeMs, easeInMs = 400, easeOutMs = 600) {
  const zoomInEnd = region.startMs + Math.min(500, (region.endMs - region.startMs) * 0.2);
  const leadInStart = zoomInEnd - easeInMs;
  const leadOutEnd = region.endMs + easeOutMs;

  if (timeMs < leadInStart || timeMs > leadOutEnd) return 0;
  if (timeMs < zoomInEnd) {
    return easeOutCubic((timeMs - leadInStart) / Math.max(1, easeInMs));
  }
  if (timeMs <= region.endMs) return 1;
  return 1 - easeOutCubic((timeMs - region.endMs) / Math.max(1, easeOutMs));
}

export function findActiveZoom(regions, timeMs, options = {}) {
  const easeInMs = options.easeInMs ?? 400;
  const easeOutMs = options.easeOutMs ?? 600;
  let best = null;
  let bestStrength = 0;

  for (const region of regions) {
    const strength = computeRegionStrength(region, timeMs, easeInMs, easeOutMs);
    if (strength > bestStrength) {
      bestStrength = strength;
      best = { region, strength };
    }
  }

  if (!best || bestStrength <= 0) {
    return { focus: { cx: 0.5, cy: 0.5 }, scale: 1, progress: 0 };
  }

  const zoomScale = getZoomScale(best.region.depth);
  const progress = best.strength;
  const scale = 1 + (zoomScale - 1) * progress;
  return {
    focus: best.region.focus,
    scale,
    progress,
    region: best.region,
  };
}

export function computeZoomTransform({
  stageWidth,
  stageHeight,
  videoRect,
  focus,
  zoomScale,
  progress = 1,
}) {
  const p = Math.min(1, Math.max(0, progress));
  const scale = 1 + (zoomScale - 1) * p;

  const focusX = videoRect.x + focus.cx * videoRect.width;
  const focusY = videoRect.y + focus.cy * videoRect.height;
  const cx = videoRect.x + videoRect.width / 2;
  const cy = videoRect.y + videoRect.height / 2;
  const tx = (cx - focusX) * p;
  const ty = (cy - focusY) * p;

  return { scale, tx, ty, videoRect };
}

export function computeVideoRect(stageWidth, stageHeight, videoWidth, videoHeight, padding) {
  const innerW = stageWidth - padding * 2;
  const innerH = stageHeight - padding * 2;
  const videoAspect = videoWidth / videoHeight;
  const innerAspect = innerW / innerH;

  let w;
  let h;
  if (videoAspect > innerAspect) {
    w = innerW;
    h = innerW / videoAspect;
  } else {
    h = innerH;
    w = innerH * videoAspect;
  }

  return {
    x: padding + (innerW - w) / 2,
    y: padding + (innerH - h) / 2,
    width: w,
    height: h,
  };
}
