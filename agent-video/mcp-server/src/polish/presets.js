// postProd preset definitions for OpenScreen-style polish.

export const POSTPROD_PRESETS = {
  "demo-default": {
    width: 1920,
    height: 1080,
    frameRate: 30,
    bitrate: 8_000_000,
    wallpaper: "#0f172a",
    padding: 48,
    borderRadius: 12,
    showShadow: true,
    motionBlurAmount: 0.15,
    zoom: {
      enabled: true,
      defaultDepth: 1,
      clickDepth: 3,
      holdMs: 2000,
      mergeGapMs: 400,
      easeInMs: 400,
      easeOutMs: 600,
    },
    cursor: {
      enabled: false,
      scale: 1.2,
      smoothing: 0.6,
    },
    export: {
      playbackRate: 1,
      timeoutMarginMs: 120_000,
    },
  },
  "demo-with-cursor": {
    width: 1920,
    height: 1080,
    frameRate: 30,
    bitrate: 8_000_000,
    wallpaper: "macos",
    padding: 48,
    borderRadius: 12,
    showShadow: true,
    motionBlurAmount: 0.15,
    zoom: {
      enabled: true,
      defaultDepth: 1,
      clickDepth: 3,
      holdMs: 2000,
      mergeGapMs: 400,
      easeInMs: 400,
      easeOutMs: 600,
    },
    cursor: {
      enabled: true,
      scale: 1.2,
      smoothing: 0.6,
    },
    export: {
      playbackRate: 1,
      timeoutMarginMs: 120_000,
    },
  },
  fast: {
    width: 1280,
    height: 720,
    frameRate: 24,
    bitrate: 4_000_000,
    wallpaper: "#0f172a",
    padding: 32,
    borderRadius: 8,
    showShadow: false,
    motionBlurAmount: 0,
    zoom: { enabled: false },
    cursor: { enabled: false },
    export: {
      playbackRate: 1.5,
      timeoutMarginMs: 60_000,
    },
  },
};

export function resolvePostProdOptions(explicit = {}) {
  const presetName = explicit.preset || "demo-default";
  const preset = POSTPROD_PRESETS[presetName] || POSTPROD_PRESETS["demo-default"];
  return {
    name: explicit.name || "ffmpeg",
    preset: presetName,
    ...preset,
    ...explicit,
    zoom: { ...preset.zoom, ...(explicit.zoom || {}) },
    cursor: { ...preset.cursor, ...(explicit.cursor || {}) },
    export: { ...preset.export, ...(explicit.export || {}) },
  };
}
