// Stage 1: research pass + narration generation.
// Walks a sequence of scenes. A scene is a URL plus an optional UI state reached
// by running entryActions (and any scripted per-segment actions). After reaching
// each scene's state it captures the accessibility snapshot and produces narration:
//   - scripted: page.segments (verbatim, may carry per-segment actions)
//   - scripted single: page.narration
//   - auto: ask the narration provider, grounded in the (post-action) snapshot,
//           with a DOM-text fallback when the accessibility tree is sparse.
// Writes narration.json so the agent can review/edit it before spending TTS credits.

import {
  setViewport,
  open,
  close,
  snapshot,
  evalJs,
  screenshot,
} from "./browser.js";
import { runActions } from "./actions.js";
import { ensureSession, writeArtifact, makeLogger, sleep } from "./session.js";
import { getNarrationProvider } from "./narration/index.js";
import { resolveProviders } from "./config.js";
import { join } from "path";

// Below this many named refs we treat the accessibility tree as too sparse to
// narrate from (common with Flutter/canvas apps) and fall back to DOM text.
const SPARSE_REF_THRESHOLD = 4;

// Best-effort DOM innerText, used to ground narration when the a11y tree is empty.
function domText(maxChars = 4000) {
  try {
    const raw = evalJs(
      "(function(){return (document.body&&document.body.innerText||'').replace(/\\s+/g,' ').trim();})()"
    );
    return String(raw).slice(0, maxChars);
  } catch (e) {
    return "";
  }
}

export async function generateNarration({
  sessionId,
  persona,
  pages,
  providers,
  viewport = [1280, 720],
}) {
  const session = ensureSession(sessionId);
  const log = makeLogger(session.sessionId);
  const resolved = resolveProviders(providers);
  const narrate = getNarrationProvider(resolved.narration.name);

  log(`=== RESEARCH PASS === persona="${persona}" scenes=${pages.length} provider=${resolved.narration.name}`);

  const pageResults = [];
  let browserOpen = false;
  try {
    setViewport(viewport[0], viewport[1]);

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const reuse = page.reuseTab && browserOpen;

      if (!reuse) {
        open(page.url, { headed: false });
        browserOpen = true;
        await sleep(2000);
      } else {
        log(`Scene ${i + 1} (${page.url}): reusing current tab (no reload)`);
      }

      // Reach this scene's UI state.
      if (Array.isArray(page.entryActions) && page.entryActions.length > 0) {
        log(`Scene ${i + 1}: running ${page.entryActions.length} entryActions`);
        await runActions(page.entryActions, { log });
        await sleep(500);
      }

      let segments;
      if (Array.isArray(page.segments) && page.segments.length > 0) {
        // Scripted segments: use verbatim. Execute their actions in order so the
        // cumulative UI state advances for later (reuseTab) scenes, mirroring what
        // the performance pass will replay.
        segments = page.segments.map((s) => ({
          text: s.text,
          scrollTo: s.scrollTo || "top",
          ...(s.action ? { action: s.action } : {}),
        }));
        log(`Scene ${i + 1}: using ${segments.length} scripted segment(s)`);
        for (const s of segments) {
          if (s.action) await runActions([s.action], { log });
        }
      } else if (page.narration) {
        segments = [{ text: page.narration, scrollTo: "top" }];
        log(`Scene ${i + 1}: using caller-provided narration`);
      } else {
        const { snapshot: snap, refs } = snapshot();
        const refCount = Object.keys(refs).length;
        const text = domText();
        let groundedSnapshot = snap;
        let mode = "a11y";
        if (refCount < SPARSE_REF_THRESHOLD) {
          // Tree too sparse to narrate from (Flutter/canvas) - rely on DOM text.
          groundedSnapshot = text
            ? `Accessibility tree is sparse (${refCount} refs). DOM text content:\n${text}`
            : snap;
          mode = "dom-text";
          try {
            screenshot(join(session.sessionDir, `scene_${i + 1}.png`));
          } catch (e) {
            /* best effort */
          }
        } else if (text) {
          // Healthy tree, but append visible text so dynamic content (scores,
          // results) the a11y tree may omit is always available for grounding.
          groundedSnapshot = `${snap}\n\nVisible page text (for grounding):\n${text}`;
          mode = "a11y+dom";
        }
        log(`Scene ${i + 1} (${page.url}): ${refCount} refs, narrating from ${mode}`);
        const data = await narrate(persona, page.url, groundedSnapshot, refs, {
          ...resolved.narration,
          hint: page.hint,
        });
        segments = data.segments;
        log(`Scene ${i + 1}: generated ${segments.length} segments`);
      }

      pageResults.push({
        url: page.url,
        ...(page.reuseTab ? { reuseTab: true } : {}),
        ...(page.entryActions ? { entryActions: page.entryActions } : {}),
        segments,
      });
    }
  } finally {
    try {
      close();
    } catch (e) {
      /* best effort */
    }
  }

  const narration = {
    persona,
    providers: resolved,
    pages: pageResults,
    createdAt: new Date().toISOString(),
  };
  writeArtifact(session.sessionId, "narration.json", narration);
  return { sessionId: session.sessionId, ...narration };
}
