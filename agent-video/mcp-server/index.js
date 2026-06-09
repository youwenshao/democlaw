#!/usr/bin/env node

// DemoClaw narrator MCP server.
// Thin registry + dispatch layer. All real work lives in ./src modules, split
// into discrete, individually-callable stages so an agent can inspect and retry
// any single step (review narration before TTS, re-run only the performance pass,
// swap providers, etc.).

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { loadEnv, ensureSession, writeArtifact, sleep } from "./src/session.js";
import { getBox, open, close, snapshot } from "./src/browser.js";
import { runActions } from "./src/actions.js";
import { extractPageModel } from "./src/pageModel.js";
import { generateNarration } from "./src/research.js";
import { synthesizeSpeech } from "./src/synthesize.js";
import { recordPerformance } from "./src/record.js";
import { produceVideo } from "./src/produce.js";
import { createNarratedRecording } from "./src/orchestrator.js";

loadEnv();

// Reusable schema fragment: provider selection, configurable per call.
const PROVIDERS_SCHEMA = {
  type: "object",
  description:
    "Optional provider overrides. Unset layers fall back to env-based defaults. Lets you swap narration/TTS/host at call time without code changes.",
  properties: {
    narration: {
      type: "object",
      description: 'Narration provider. name: "claude" | "openai" (OpenAI-compatible; covers DeepSeek via baseUrl).',
      properties: {
        name: { type: "string", enum: ["claude", "openai"] },
        model: { type: "string" },
        baseUrl: { type: "string", description: "For OpenAI-compatible endpoints (DeepSeek, vLLM, Ollama, ...)" },
        apiKeyEnv: { type: "string", description: "Env var name holding the API key" },
      },
    },
    tts: {
      type: "object",
      description: 'TTS provider. name: "elevenlabs" (char-level timing) | "edge" (free, duration timing) | "miso" (deferred local 8B model).',
      properties: {
        name: { type: "string", enum: ["elevenlabs", "edge", "miso"] },
        voice: { type: "string" },
        model: { type: "string" },
      },
    },
    host: {
      type: "object",
      description: 'Video host. name: "mux" | "local" (file output, default on-device) | "s3" (S3-compatible).',
      properties: {
        name: { type: "string", enum: ["mux", "local", "s3"] },
      },
    },
  },
};

// A single declarative browser interaction. See src/actions.js for the executor.
const ACTION_SCHEMA = {
  type: "object",
  description:
    'A browser interaction. type: "click" | "type" | "fill" | "keyboardType" | "press" | "find" | "scrollIntoView" | "wait" | "waitFor" | "enableAccessibility".',
  properties: {
    type: {
      type: "string",
      enum: [
        "click",
        "type",
        "fill",
        "keyboardType",
        "press",
        "find",
        "clickName",
        "fillName",
        "scrollIntoView",
        "wait",
        "waitFor",
        "enableAccessibility",
      ],
    },
    selector: { type: "string", description: "CSS selector or @ref (e.g. '@e12')." },
    text: { type: "string", description: "Text for type/fill/keyboardType/fillName/find actions." },
    key: { type: "string", description: "Key for press actions (e.g. 'Enter')." },
    name: {
      type: "string",
      description: "Accessible name for clickName/fillName (resolved against the live snapshot; robust for Flutter/canvas).",
    },
    exact: { type: "boolean", description: "For clickName/fillName: require an exact name match (default false = substring)." },
    by: {
      type: "string",
      description: "find locator: role | text | label | placeholder | alt | title | testid | first | last | nth.",
    },
    value: { type: "string", description: "find locator value (e.g. the placeholder text)." },
    do: { type: "string", description: "find action to perform (e.g. click | fill | type)." },
    ms: { type: "number", description: "Delay in ms for 'wait' / settle time." },
    timeoutMs: { type: "number", description: "Cap for 'waitFor' (default 30000)." },
  },
  required: ["type"],
};

const PAGES_SCHEMA = {
  type: "array",
  description:
    "Array of scenes to visit and narrate. A scene is a URL plus an optional UI state reached via entryActions; consecutive same-URL scenes can set reuseTab to avoid reloading.",
  items: {
    type: "object",
    properties: {
      url: { type: "string", description: "The URL to visit" },
      reuseTab: {
        type: "boolean",
        description:
          "If true, continue in the current tab without reloading (preserves typed text / results from a prior scene on the same URL).",
      },
      entryActions: {
        type: "array",
        description:
          "Actions performed BEFORE this scene is narrated/recorded. They run in the trimmed inter-scene gap (use for navigation, form fill, submit, and waitFor readiness).",
        items: ACTION_SCHEMA,
      },
      segments: {
        type: "array",
        description:
          "Optional explicit narration segments (scripted). Each may carry a per-segment action fired on the timeline alongside its scroll cue. If omitted, narration is auto-generated.",
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "Spoken narration for this segment." },
            scrollTo: { type: "string", description: "'top' | 'bottom' | an @ref / ref id." },
            action: ACTION_SCHEMA,
          },
          required: ["text"],
        },
      },
      narration: {
        type: "string",
        description: "Optional custom narration (single segment). If omitted (and no segments), auto-generated from page content.",
      },
      hint: {
        type: "string",
        description:
          "Optional guidance for auto-generated narration of this scene, e.g. 'Describe the AI grading results now visible'. Ignored when narration/segments are supplied.",
      },
    },
    required: ["url"],
  },
};

const server = new Server(
  { name: "narrator-mcp-server", version: "3.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "extract_page_model",
      description:
        "Capture the accessibility tree + element refs for a URL. A reusable web-agent primitive (form filling, testing, bug reports) independent of the video pipeline. Returns the page model and stores page_model.json in the session.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to inspect" },
          sessionId: { type: "string", description: "Optional existing session to store the artifact in" },
        },
        required: ["url"],
      },
    },
    {
      name: "generate_narration",
      description:
        "Stage 1: research pass. Visits each page, captures snapshots, and generates persona-flavored narration segments with scroll cues. Writes narration.json so you can review/edit before spending TTS credits. Returns a sessionId for the following stages.",
      inputSchema: {
        type: "object",
        properties: {
          persona: { type: "string", description: 'Narration persona/character, e.g. "a jaded VC", "Gordon Ramsay".' },
          pages: PAGES_SCHEMA,
          providers: PROVIDERS_SCHEMA,
          sessionId: { type: "string", description: "Optional existing session to reuse" },
        },
        required: ["persona", "pages"],
      },
    },
    {
      name: "synthesize_speech",
      description:
        "Stage 2: TTS. Reads narration.json, synthesizes audio with the configured TTS provider, and writes timing.json (segment timings + audio manifest). You can swap the TTS provider here without re-running research.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Session from generate_narration" },
          providers: PROVIDERS_SCHEMA,
        },
        required: ["sessionId"],
      },
    },
    {
      name: "record_performance",
      description:
        "Stage 3: performance pass. Reads timing.json, records the screen, and drives smooth content-aware scrolling timed to the narration. Writes marks.json. Re-run this alone if the page model changed.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Session from synthesize_speech" },
        },
        required: ["sessionId"],
      },
    },
    {
      name: "produce_video",
      description:
        "Stage 4: post-production + hosting. Reads timing.json + marks.json, assembles the final video with ffmpeg, and uploads via the configured host provider. Writes result.json and returns the playback URL.",
      inputSchema: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Session from record_performance" },
          providers: PROVIDERS_SCHEMA,
        },
        required: ["sessionId"],
      },
    },
    {
      name: "create_narrated_recording",
      description:
        "Orchestrator: runs all four stages (research -> TTS -> performance -> post-production) in one call and returns a playback URL. Accepts the same providers config. Use the discrete tools instead when you need to inspect or retry a single stage.",
      inputSchema: {
        type: "object",
        properties: {
          persona: { type: "string" },
          pages: PAGES_SCHEMA,
          providers: PROVIDERS_SCHEMA,
        },
        required: ["persona", "pages"],
      },
    },
    {
      name: "get_element_bounds",
      description:
        "Get the bounding box of a DOM element on a page. Useful for discovering coordinates for coordinate-based overlays.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL of the page to inspect" },
          selector: { type: "string", description: "CSS selector for the element" },
        },
        required: ["url", "selector"],
      },
    },
    {
      name: "run_demo_actions",
      description:
        "Reusable web-agent primitive (independent of the video pipeline): open a URL, run a list of declarative actions (click/type/fill/press/wait/waitFor/scrollIntoView/enableAccessibility), then return the resulting accessibility snapshot + refs. Useful for scripting/verifying a scene's entryActions before recording.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to open" },
          actions: { type: "array", description: "Actions to run in order", items: ACTION_SCHEMA },
          headed: { type: "boolean", description: "Run with a visible browser window (default false)." },
        },
        required: ["url"],
      },
    },
  ],
}));

function ok(result) {
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}

function fail(error) {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: error.message }, null, 2) }],
    isError: true,
  };
}

const handlers = {
  async extract_page_model(args) {
    const session = ensureSession(args.sessionId);
    const model = await extractPageModel(args.url);
    writeArtifact(session.sessionId, "page_model.json", model);
    return { sessionId: session.sessionId, ...model };
  },

  generate_narration(args) {
    return generateNarration({
      sessionId: args.sessionId,
      persona: args.persona,
      pages: args.pages,
      providers: args.providers,
    });
  },

  synthesize_speech(args) {
    return synthesizeSpeech({ sessionId: args.sessionId, providers: args.providers });
  },

  record_performance(args) {
    return recordPerformance({ sessionId: args.sessionId });
  },

  produce_video(args) {
    return produceVideo({ sessionId: args.sessionId, providers: args.providers });
  },

  create_narrated_recording(args) {
    return createNarratedRecording({
      persona: args.persona,
      pages: args.pages,
      providers: args.providers,
    });
  },

  async get_element_bounds(args) {
    try {
      open(args.url);
      await sleep(1000);
      const bounds = getBox(args.selector);
      close();
      return bounds;
    } catch (error) {
      try {
        close();
      } catch (e) {
        /* best effort */
      }
      throw error;
    }
  },

  async run_demo_actions(args) {
    try {
      open(args.url, { headed: !!args.headed });
      await sleep(2000);
      await runActions(args.actions || []);
      const { snapshot: snap, refs } = snapshot();
      close();
      return { url: args.url, refCount: Object.keys(refs).length, snapshot: snap, refs };
    } catch (error) {
      try {
        close();
      } catch (e) {
        /* best effort */
      }
      throw error;
    }
  },
};

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const handler = handlers[name];
  if (!handler) {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
  try {
    const result = await handler(args || {});
    return ok(result);
  } catch (error) {
    console.error(`[narrator] Tool ${name} failed: ${error.message}`);
    return fail(error);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[narrator] DemoClaw MCP server started (modular, provider-agnostic)");
}

main().catch((error) => {
  console.error("[narrator] Fatal error:", error);
  process.exit(1);
});
