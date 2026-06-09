// Anthropic Claude narration provider (uses structured outputs).

import { NARRATION_SCHEMA, buildNarrationPrompt } from "./index.js";

export async function generate(persona, pageUrl, snapshot, refs, options = {}) {
  const apiKey = process.env[options.apiKeyEnv || "ANTHROPIC_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY not set - required for the 'claude' narration provider"
    );
  }

  const model = options.model || "claude-sonnet-4-5-20250929";
  const prompt = buildNarrationPrompt(persona, pageUrl, snapshot, refs, options);

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "structured-outputs-2025-11-13",
    },
    body: JSON.stringify({
      model,
      max_tokens: options.maxTokens || 800,
      messages: [{ role: "user", content: prompt }],
      output_format: {
        type: "json_schema",
        schema: NARRATION_SCHEMA,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${error}`);
  }

  const data = await response.json();
  return JSON.parse(data.content[0].text);
}
