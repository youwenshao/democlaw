// OpenAI-compatible narration provider. Works with the OpenAI API and any
// OpenAI-compatible endpoint (DeepSeek, Together, Groq, local vLLM/Ollama, ...)
// by overriding `baseUrl`, `model`, and `apiKeyEnv` in the provider options.
//
// Example (DeepSeek):
//   providers.narration = {
//     name: "openai",
//     baseUrl: "https://api.deepseek.com",
//     model: "deepseek-chat",
//     apiKeyEnv: "DEEPSEEK_API_KEY"
//   }

import { NARRATION_SCHEMA, buildNarrationPrompt } from "./index.js";

export async function generate(persona, pageUrl, snapshot, refs, options = {}) {
  const apiKeyEnv = options.apiKeyEnv || "OPENAI_API_KEY";
  const apiKey = process.env[apiKeyEnv];
  if (!apiKey) {
    throw new Error(
      `${apiKeyEnv} not set - required for the 'openai' narration provider`
    );
  }

  const baseUrl = (options.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = options.model || "gpt-4o-mini";
  const prompt = buildNarrationPrompt(persona, pageUrl, snapshot, refs, options);

  // DeepSeek and many OpenAI-compatible hosts lack strict json_schema; use json_object.
  const useJsonObject =
    options.jsonMode === "object" ||
    baseUrl.includes("deepseek.com") ||
    apiKeyEnv === "DEEPSEEK_API_KEY";

  const userContent = useJsonObject
    ? `${prompt}\n\nRespond with valid JSON only (no markdown fences) matching this schema:\n${JSON.stringify(NARRATION_SCHEMA)}`
    : prompt;

  const body = {
    model,
    max_tokens: options.maxTokens || 800,
    messages: [{ role: "user", content: userContent }],
  };

  if (useJsonObject) {
    body.response_format = { type: "json_object" };
  } else {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: "narration",
        strict: true,
        schema: NARRATION_SCHEMA,
      },
    };
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI-compatible API error (${baseUrl}): ${error}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI-compatible API returned no content");
  }
  return JSON.parse(content);
}
