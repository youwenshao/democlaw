// Resolve provider selection at call time, with environment-based fallbacks so
// the same scaffold runs against paid cloud services or fully local/free ones
// without code changes.
//
// Precedence for each layer: explicit call arg > env override > smart default
// based on which credentials are present.

function pick(explicit, envValue, smartDefault) {
  if (explicit && explicit.name) return explicit;
  if (envValue) return { name: envValue };
  return smartDefault;
}

function resolveNarrationProvider(explicit) {
  if (explicit?.name) return explicit;

  const envName = process.env.DEMOCLAW_NARRATION_PROVIDER;
  if (envName === "openai" && process.env.DEEPSEEK_API_KEY) {
    return {
      name: "openai",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKeyEnv: "DEEPSEEK_API_KEY",
    };
  }
  if (envName) return { name: envName };

  if (process.env.DEEPSEEK_API_KEY) {
    return {
      name: "openai",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKeyEnv: "DEEPSEEK_API_KEY",
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return { name: "openai" };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { name: "claude" };
  }
  return { name: "claude" };
}

export function resolvePostProd(explicit = {}) {
  const name =
    explicit.name ||
    process.env.DEMOCLAW_POSTPROD_PROVIDER ||
    "ffmpeg";

  const preset =
    explicit.preset ||
    (name === "openscreen"
      ? process.env.DEMOCLAW_POSTPROD_PRESET || "demo-with-cursor"
      : undefined);

  const base = { name };
  if (preset) base.preset = preset;

  const merged = { ...base, ...explicit, name, ...(preset ? { preset } : {}) };
  if (process.env.DEMOCLAW_WALLPAPER) {
    merged.wallpaper = process.env.DEMOCLAW_WALLPAPER;
  }
  return merged;
}

export function resolveProviders(providers = {}) {
  const narration = resolveNarrationProvider(providers.narration);

  const ttsDefault = process.env.ELEVENLABS_API_KEY ? "elevenlabs" : "edge";
  const tts = pick(providers.tts, process.env.DEMOCLAW_TTS_PROVIDER, ttsDefault);

  const hostDefault =
    process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET ? "mux" : "local";
  const host = pick(providers.host, process.env.DEMOCLAW_HOST_PROVIDER, hostDefault);

  const postProd = resolvePostProd(providers.postProd || {});

  return { narration, tts, host, postProd };
}
