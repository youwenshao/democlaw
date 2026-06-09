// Narration provider registry. A narration provider turns a page's
// accessibility snapshot into structured, persona-flavored segments with scroll
// cues:
//
//   generate(persona, pageUrl, snapshot, refs, options)
//     -> { segments: [{ text, scrollTo }] }
//
// Providers are selected at call time via the `providers.narration` config.

import { generate as claudeGenerate } from "./claude.js";
import { generate as openaiGenerate } from "./openai.js";

// JSON schema shared by every provider that supports structured output.
export const NARRATION_SCHEMA = {
  type: "object",
  properties: {
    segments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The spoken narration for this segment",
          },
          scrollTo: {
            type: "string",
            description:
              "Element ref ID to scroll to (e.g. 'e13', 'e83') or 'top'/'bottom'. Must be from the provided refs list.",
          },
        },
        required: ["text", "scrollTo"],
        additionalProperties: false,
      },
    },
  },
  required: ["segments"],
  additionalProperties: false,
};

// Build the prompt that every narration provider sends.
// `options.hint` (optional) steers the narration toward a specific scene state,
// e.g. "Describe the AI grading results now visible".
export function buildNarrationPrompt(persona, pageUrl, snapshot, refs, options = {}) {
  const refsWithNames = Object.entries(refs)
    .filter(([, info]) => info.name && info.role)
    .map(([id, info]) => `${id}: ${info.role} "${info.name}"`)
    .join("\n");

  const hintBlock = options.hint
    ? `\nScene focus (narrate with this in mind): ${options.hint}\n`
    : "";

  return `You are narrating a screen recording of a website visit. Your persona: ${persona}

You are currently viewing: ${pageUrl}
${hintBlock}
Here is the snapshot of what is currently on screen (accessibility tree, or DOM text if the tree was sparse):
${snapshot}

Here are the available element refs you can scroll to (only use refs from this list):
${refsWithNames || "(no named refs available - use only \"top\" and \"bottom\" for scrollTo)"}

Generate narration that flows naturally through the page from top to bottom. As you mention different parts of the page, we'll scroll to show them.

Guidelines:
- Create 3-5 segments that flow naturally as one continuous narration
- Each segment should be 1-2 sentences
- Start at the top of the page and work your way down
- For scrollTo, use "top" for the first segment, then use ref IDs (e.g. "e13", "e83", "e121") for elements you want to scroll to
- ONLY use ref IDs that appear in the list above - do not invent selectors. If no refs are listed, use only "top" or "bottom".
- Describe ONLY what actually appears in the snapshot/text above. Do NOT invent features, numbers, or UI that is not shown.
- Pick refs for headings, sections, or landmarks that match what you're talking about
- Keep it natural and conversational - this will be converted to speech
- Stay in character throughout`;
}

const PROVIDERS = {
  claude: claudeGenerate,
  openai: openaiGenerate, // OpenAI-compatible; covers DeepSeek via baseUrl
};

export function getNarrationProvider(name) {
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(
      `Unknown narration provider "${name}". Available: ${Object.keys(PROVIDERS).join(", ")}`
    );
  }
  return provider;
}
