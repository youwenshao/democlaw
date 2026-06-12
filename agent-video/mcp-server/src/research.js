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
  getBox,
} from "./browser.js";
import { runActions } from "./actions.js";
import {
  isAdminUrl,
  ensureAdminPageReady,
  resolveAdminCredentials,
  findFirstAdminPageIndex,
} from "./adminSession.js";
import { resolveActionScript } from "./actionScript.js";
import { ensureSession, writeArtifact, makeLogger, sleep } from "./session.js";
import { getNarrationProvider } from "./narration/index.js";
import { resolveProviders } from "./config.js";
import { join } from "path";

// Below this many named refs we treat the accessibility tree as too sparse to
// narrate from (common with Flutter/canvas apps) and fall back to DOM text.
const SPARSE_REF_THRESHOLD = 4;

function normalizeScrollTarget(scrollTo) {
  if (!scrollTo || scrollTo === "top" || scrollTo === "bottom") return scrollTo || "top";
  const ref = String(scrollTo).replace(/^@/, "");
  if (/^e\d+$/i.test(ref)) return "top";
  return scrollTo;
}

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

const GROUNDING_TEXT_MAX = 4000;

function summarizeRefs(refs, maxEntries = 40, viewport = [1280, 720]) {
  return Object.entries(refs)
    .filter(([, info]) => info.name || info.role)
    .slice(0, maxEntries)
    .map(([id, info]) => {
      const entry = {
        id,
        role: info.role || null,
        name: info.name || null,
        selector: info.selector || null,
      };
      if (info.selector) {
        try {
          const bounds = getBox(info.selector);
          if (bounds?.width > 0) {
            entry.focusBounds = {
              cx: Math.min(1, Math.max(0, (bounds.x + bounds.width / 2) / viewport[0])),
              cy: Math.min(1, Math.max(0, (bounds.y + bounds.height / 2) / viewport[1])),
            };
          }
        } catch {
          /* best effort */
        }
      }
      return entry;
    });
}

function buildGrounding({ clipNum, sessionDir, snap, refs, mode, domTextContent, screenshotTaken, viewport }) {
  const refSummary = summarizeRefs(refs, 40, viewport);
  const snapshotText = (domTextContent || snap || "").slice(0, GROUNDING_TEXT_MAX);
  const screenshotPath = screenshotTaken
    ? join(sessionDir, `scene_${clipNum}.png`)
    : undefined;
  return {
    refCount: Object.keys(refs).length,
    mode,
    snapshotText,
    refSummary,
    ...(screenshotPath ? { screenshotPath } : {}),
  };
}

function captureSceneState(session, clipNum, viewport = [1280, 720]) {
  const { snapshot: snap, refs } = snapshot();
  const refCount = Object.keys(refs).length;
  const text = domText(GROUNDING_TEXT_MAX);
  let mode = "a11y";
  let screenshotTaken = false;

  if (refCount < SPARSE_REF_THRESHOLD) {
    mode = "dom-text";
    try {
      screenshot(join(session.sessionDir, `scene_${clipNum}.png`));
      screenshotTaken = true;
    } catch (e) {
      /* best effort */
    }
  }

  const grounding = buildGrounding({
    clipNum,
    sessionDir: session.sessionDir,
    snap,
    refs,
    mode: refCount >= SPARSE_REF_THRESHOLD && text ? "a11y+dom" : mode,
    domTextContent: text || snap,
    screenshotTaken,
    viewport,
  });

  return { snap, refs, text, refCount, mode: grounding.mode, grounding };
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
  const creds =
    findFirstAdminPageIndex(pages) >= 0 ? resolveAdminCredentials() : null;
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
      if (creds && isAdminUrl(page.url) && !page.reuseTab) {
        await ensureAdminPageReady(page, i, creds, { log });
      }

      const script = resolveActionScript(page);
      if (script.length > 0) {
        log(`Scene ${i + 1}: running ${script.length} actionScript beat(s)`);
        for (const beat of script) {
          await runActions([beat.action], {
            log,
            failFast: !!page.loginScene,
          });
        }
        await sleep(500);
      } else if (creds && isAdminUrl(page.url) && page.reuseTab) {
        await ensureAdminPageReady(page, i, creds, { log });
      }

      let segments;
      let grounding;

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
        const captured = captureSceneState(session, i + 1);
        grounding = { ...captured.grounding, mode: "scripted" };
      } else if (page.narration) {
        segments = [{ text: page.narration, scrollTo: "top" }];
        log(`Scene ${i + 1}: using caller-provided narration`);
        const captured = captureSceneState(session, i + 1);
        grounding = { ...captured.grounding, mode: "scripted-single" };
      } else {
        const captured = captureSceneState(session, i + 1);
        const { snap, refs, text, refCount } = captured;
        let groundedSnapshot = snap;
        let mode = captured.mode;
        if (refCount < SPARSE_REF_THRESHOLD) {
          groundedSnapshot = text
            ? `Accessibility tree is sparse (${refCount} refs). DOM text content:\n${text}`
            : snap;
        } else if (text) {
          groundedSnapshot = `${snap}\n\nVisible page text (for grounding):\n${text}`;
        }
        log(`Scene ${i + 1} (${page.url}): ${refCount} refs, narrating from ${mode}`);
        const data = await narrate(persona, page.url, groundedSnapshot, refs, {
          ...resolved.narration,
          hint: page.hint,
        });
        segments = data.segments.map((s) => ({
          ...s,
          scrollTo: normalizeScrollTarget(s.scrollTo),
        }));
        grounding = captured.grounding;
        log(`Scene ${i + 1}: generated ${segments.length} segments`);
      }

      pageResults.push({
        url: page.url,
        ...(page.reuseTab ? { reuseTab: true } : {}),
        ...(page.loginScene ? { loginScene: true } : {}),
        ...(page.actionScript ? { actionScript: page.actionScript } : {}),
        ...(page.entryActions ? { entryActions: page.entryActions } : {}),
        ...(page.hint ? { hint: page.hint } : {}),
        segments,
        grounding,
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
