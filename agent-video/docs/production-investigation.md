# DemoClaw production investigation

Reference notes from architecture review (narration LLMs, agent review, auto-critique,
OpenScreen polish, cursor/zoom). Use this when designing `performance.json`,
`assess_grounding`, or review gates.

Related: [`README.md`](../README.md), [`AGENTS.md`](../../AGENTS.md),
[`.cursor/rules/democlaw-critique.mdc`](../../.cursor/rules/democlaw-critique.mdc),
[`aegis-demo.json`](../aegis-demo.json).

---

## 1. Pipeline overview

DemoClaw produces narrated demo videos in four discrete stages, exchanging JSON
artifacts under `~/Movies/agent-recordings/session-<id>/`:

| Stage | MCP tool | Primary artifact |
|-------|----------|------------------|
| 1 Research + narration | `generate_narration` | `narration.json` |
| 2 TTS | `synthesize_speech` | `timing.json` + audio clips |
| 3 Performance recording | `record_performance` | `marks.json` + `recording.webm` |
| 4 Post-production + host | `produce_video` | `output.mp4`, `result.json` |

`create_narrated_recording` (in `src/orchestrator.js`) chains all four stages in one
call. With critique enabled (default for AEGIS CLI), it delegates to
`createNarratedRecordingWithCritique` in `src/critique/runLoop.js`.

**Important naming distinction:** `orchestrator.js` is a **Node.js stage runner**,
not an LLM agent. It does not call any language model.

---

## 2. Narration / TTS script generation

The spoken script lives in `narration.json` → `pages[].segments[]` with `{ text,
scrollTo, action? }`.

### Three modes per scene (`src/research.js`)

| Mode | Trigger | LLM used? |
|------|---------|-----------|
| **Scripted** | `page.segments[]` | No — verbatim manifest text |
| **Single scripted** | `page.narration` | No |
| **Auto** | No segments/narration; snapshot + optional `hint` | **Yes** — external API |

Auto mode calls a registered narration provider (`src/narration/`):

- `claude` — Anthropic Messages API + structured output
- `openai` — OpenAI-compatible HTTP (`fetch` to `baseUrl`); used for DeepSeek when
  `DEEPSEEK_API_KEY` is set

Provider resolution (`src/config.js`): explicit call arg → env → credential sniff
(DeepSeek → OpenAI → Claude).

**TTS** (Edge, ElevenLabs, Miso) only synthesizes audio from segment text. It does
not use an LLM.

### AEGIS demo mix (`aegis-demo.json`)

- **Phase 1 scenes 1–2:** fully scripted segments (no LLM)
- **Phase 1 scene 3** (grading results): `hint`-driven auto LLM, grounded in
  post-submit snapshot
- **Phase 2:** intro scenes scripted; dashboard/users/submissions/rubrix use auto
  LLM via `hint`; security has one scripted segment plus hint

Default env for AEGIS: DeepSeek narration + Edge TTS + OpenScreen polish
(`demo-with-cursor` preset).

### Cursor agent vs API LLM today

The pipeline was split so **a Cursor agent can inspect/edit artifacts between
stages** — especially `narration.json` before TTS spend. When running from
Cursor, the agent orchestrates via MCP tools, but `generate_narration` still calls
the configured **external API** for auto scenes.

There is **no** `cursor` or `agent` narration provider yet. Wiring the Cursor
agent’s LLM would require a new provider implementing the same
`generate(persona, pageUrl, snapshot, refs, options) → { segments }` contract.

---

## 3. Agent mid-pipeline review (recommended quality layer)

For quality-critical demos (AEGIS), **agent review of `narration.json` before TTS**
is the recommended primary quality gate — not a fallback.

**Already supported workflow:**

```
generate_narration  →  agent reads/edits narration.json  →  synthesize_speech
```

Partial retry after a full run:

```
edit narration.json
→ synthesize_speech({ clipNums })
→ record_performance({ clipNums, merge: true })
→ produce_video
```

See `scripts/continue-critique.mjs` and `AGENTS.md` § Auto-critique loop.

### Why the default one-shot run feels weak

`createNarratedRecordingWithCritique` runs start-to-finish without pausing for agent
reasoning. The automated critique loop handles only a **narrow** defect set:

| Defect type | Auto-handled? |
|-------------|---------------|
| Workflow (login/nav/focus) → partial re-record | Yes |
| Pacing (rushing/dragging) → edit narration text | **No** — stops with “manual narration edits may be needed” |
| Invented facts vs grounding | **No** |
| `mustShow` / `mustSay` from goals | **No** |
| Persona drift, weak open/close, redundancy | **No** |

The critique rule (`.cursor/rules/democlaw-critique.mdc`) describes agent-written
`goals.json` and `critique.json`, but the code path uses:

- `writeGoalsFromNarration` — heuristic goals from URL/hints (`src/critique/goals.js`)
- `buildAutoCritique` — WPM + workflow log only (`src/critique/autoCritique.js`)

`mustShow` in goals is never validated (`autoCritique.js` no-ops on it).

### Known gaps to mitigate (future work)

1. **Pre-TTS review gate** — orchestrator returns after stage 1 with
   `{ status: "awaiting_narration_review" }`
2. **`assess_grounding`** — deterministic check: numbers/nouns in narration ⊆
   `grounding.snapshotText`
3. **Agent or LLM critique pass** — real `critique.json` vs goals + grounding
4. **Partial narration regen** — `generate_narration({ sessionId, clipNums })`
5. **Richer goals in manifest** — not only auto-derived from URL paths

---

## 4. OpenScreen polish: how the final cut gets cursor and zoom

AEGIS CLI defaults to `postProd: { name: "openscreen", preset: "demo-with-cursor" }`.

### Two layers

```
Stage 3 record_performance          Stage 4 produce_video (openscreen)
─────────────────────────          ─────────────────────────────────
agent-browser screencast    →      concat_silent.mp4
Real DOM actions (click,            +
fillName, scroll)                   buildPolishPlan → polish_plan.json
                                   +
focusEvents (cx/cy timestamps)       export-worker (Playwright canvas)
                                   → synthetic zoom + cursor overlay
                                   → polished_silent.mp4 + narration audio
```

**The pointer and camera in the polished cut are not captured from the screen.**
They are **reconstructed in post** from metadata.

### Data flow into `polish_plan.json` (`src/polish/buildPlan.js`)

| Input | Drives |
|-------|--------|
| `marks.json` → `focusEvents` | Click/focus positions at action time |
| `timing.json` → `segmentTimings` + `segment.action` | When actions fire vs narration |
| `timing.json` → `actionScript` / `entryActions` | Timed beats (admin nav, waits) |
| `grounding.refSummary` | Fallback focus for `scrollTo` refs |
| Preset `demo-with-cursor` | `zoom.clickDepth`, `cursor.enabled`, easing |

Compositor: `polish/export-worker.html` reads `zoomRegions` + `cursorTelemetry`,
renders frame-by-frame on canvas (`polish/vendor/zoom.js`, `polish/vendor/cursor.js`).

### Presets (`src/polish/presets.js`)

| Preset | Cursor | Zoom |
|--------|--------|------|
| `demo-default` | off | on |
| `demo-with-cursor` | on | on (`clickDepth: 3`, `holdMs: 2000`) |
| `fast` | off | off |

---

## 5. Performance recording: actions and focusEvents

### Timeline replay (`src/sceneReplay.js`)

`performSceneTimeline()` merges:

1. **`actionScript`** beats (explicit `atMs` or converted from `entryActions` with
   fixed +450ms spacing)
2. **Segment beats** at each `segmentTimings[].startTimeMs` — run `segment.action`,
   then scroll to `scrollTo`

Actions run in the **recorded** scene while narration audio duration is enforced by
sleeping for `page.pageDurationMs`.

### Focus capture

Before each focusable action, `captureFocusEvent()` calls `getBox(selector)` and
storesEvents` with normalized `{ cx, cy }` in viewport space.

**`FOCUS_ACTIONS`** (`src/actionScript.js`): `click`, `clickName`, `fill`,
`fillName`, `type` — not `keyboardType`, `press`, or `scrollIntoView`.

### `fillName` behavior (`src/actions.js`)

Flutter-safe fill: `click` field by accessible name → `sleep(200)` →
`keyboardType(text)`. The **recording** may show keystrokes in the webview; polish
gets **one cursor anchor + one click pulse** at action start, not a typing path.

### Best sync pattern for demos

Prefer **`segment.action` on the segment that speaks the action**:

- ✅ “I'll drop it in the input box” + `fillName` on that segment
- ✅ “Click Submit” + `clickName` on that segment

Weaker patterns:

- `entryActions` → `actionScript` with fixed 450ms gaps (not tied to spoken words)
- Long `actionScript` waits (e.g. 22s grading) parallel to unrelated narration
- `scrollTo` on Flutter `e*` refs normalized to `"top"` in research — zoom/cursor
  fall back to generic center

---

## 6. Why polish motion often feels unnatural

1. **Single snap focus per action** — no move → dwell → type → click choreography
2. **Sparse cursor telemetry** — `buildCursorTelemetry()` + `densifyPath()` insert
   eased midpoints between anchors; not story-aware
3. **Rule-based zoom** — `clickDepth` vs `defaultDepth`, fixed `holdMs`; no
   keyframes or narrator-driven framing
4. **No typing motion in compositor** — instant fill in DOM; overlay cursor doesn’t
   animate across typing duration
5. **`focus_missing`** — admin nav without valid `getBox` → default center focus
   (`assess_workflow.js` flags this)
6. **No agent-facing performance vocabulary** — `polish_plan.json` is code-generated
   only; `trimRegions` always `[]`; `cursorRecordingData` always `null`

---

## 7. What the Cursor orchestrator can read today

| Artifact | Performance / quality insight |
|----------|------------------------------|
| `narration.json` | `segments[].text`, `scrollTo`, `action` |
| `timing.json` | `segmentTimings`, `actionScript`, `pageDurationMs` |
| `marks.json` | `focusEvents`, `sceneClips`, scene offsets |
| `polish_plan.json` | Final `zoomRegions`, `cursorTelemetry` (after produce) |
| `goals.json` | Scene intent, mustShow/mustSay (underused by auto-critique) |
| `assess_timing.json` | WPM / pacing flags |
| `assess_workflow.json` | login/nav/focus defects |
| `scene_N.png` | Sparse Flutter grounding screenshots |

Nothing validates **“cursor visits what the narrator mentions”** or **“zoom frames
the right control”** today.

---

## 8. Recommended direction: Performance Plan

To let the Cursor agent **understand and convey** intent through the final video,
introduce a declarative **Performance Plan** layer between narration and polish.

### Short term (no code changes)

When orchestrating AEGIS from Cursor:

1. **Words** — `narration.json` segments
2. **Actions** — `segment.action` timed to those segments
3. **Framing** — `scrollTo` refs that exist in `grounding.refSummary`

After `record_performance`, read `marks.json` → `focusEvents`. If
`assess_workflow` reports `focus_missing`, partial re-record before OpenScreen
polish.

### Medium term (planned follow-up)

1. **`performance.json`** — agent-readable/writable beat timeline (focus, zoom,
   cursor, typing mode); `buildPolishPlan` preferss it when present
2. **`assess_performance`** — narration mentions vs focusEvents vs zoomRegions
3. **Compositor typing tracks** — keystroke cursor path for `fillName`/`type` segments
4. **MCP tools** — `build_performance_plan`, `preview_polish_plan`,
   `edit_performance_plan`
5. **Review gates** — pre-TTS (narration + performance draft), pre-polish
   (focusEvents vs plan)

See **§ Next** below for the schema sketch (separate follow-up).

### Relationship to other mitigations

| Mitigation | Primary concern |
|------------|-----------------|
| `assess_grounding` | Truthful narration (no invented scores) |
| `reviewGate` (narration) | Agent quality pass before TTS spend |
| `performance.json` | **Visual** storytelling (zoom, cursor, typing) |
| Pre-polish review gate | Recorded focus matches performance intent |

---

## 9. Key source files

| Topic | Path |
|-------|------|
| Stage 1 narration | `mcp-server/src/research.js` |
| Narration providers | `mcp-server/src/narration/` |
| Provider resolution | `mcp-server/src/config.js` |
| Orchestrator | `mcp-server/src/orchestrator.js` |
| Critique loop | `mcp-server/src/critique/runLoop.js`, `autoCritique.js`, `goals.js` |
| Recording + focus | `mcp-server/src/record.js`, `sceneReplay.js` |
| Polish plan | `mcp-server/src/polish/buildPlan.js`, `cursorTelemetry.js`, `focusUtils.js` |
| Export compositor | `mcp-server/polish/export-worker.html`, `export-worker.mjs` |
| Presets | `mcp-server/src/polish/presets.js` |
| AEGIS manifest | `aegis-demo.json` |

---

## Next

- [ ] Sketch **`performance.json`** schema and merge rules with `focusEvents`
  (override vs fallback) — follow-up task after this document.
