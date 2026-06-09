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

export function resolveProviders(providers = {}) {
  const narration = resolveNarrationProvider(providers.narration);

  const ttsDefault = process.env.ELEVENLABS_API_KEY ? "elevenlabs" : "edge";
  const tts = pick(providers.tts, process.env.DEMOCLAW_TTS_PROVIDER, ttsDefault);

  const hostDefault =
    process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET ? "mux" : "local";
  const host = pick(providers.host, process.env.DEMOCLAW_HOST_PROVIDER, hostDefault);

  return { narration, tts, host };
}
