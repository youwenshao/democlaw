// Browser action executor. Turns the declarative `{ type, ... }` action objects
// used in demo manifests into agent-browser calls. Shared by the research pass
// (to reach each scene's UI state before snapshotting) and the performance pass
// (to replay the same interactions on the recorded timeline).
//
// Supported action types:
//   { type: "click",              selector }
//   { type: "type",               selector, text }   // types into (appends)
//   { type: "fill",               selector, text }   // clears then fills
//   { type: "keyboardType",       text }             // real keystrokes, focused el
//   { type: "press",              key }               // e.g. "Enter", "Tab"
//   { type: "find",               by, value, do, text? } // DOM locate + act
//   { type: "clickName",          name, exact? }      // click by accessible name (snapshot)
//   { type: "fillName",           name, text, exact? } // focus-by-name + real keystrokes (Flutter-safe)
//   { type: "scrollIntoView",     selector }          // accepts "e12" or "@e12"
//   { type: "wait",               ms }                // fixed delay
//   { type: "waitFor",            selector, timeoutMs? }
//   { type: "enableAccessibility" }                   // Flutter semantics unlock

import {
  click,
  type as typeText,
  fill,
  press,
  waitForSelector,
  scrollIntoView,
  enableFlutterAccessibility,
  findAction,
  keyboardType,
  snapshot,
} from "./browser.js";
import { sleep } from "./session.js";

// Resolve a live @ref by its accessible name. Far more robust than hardcoded
// numeric refs for canvas/Flutter apps, whose ref IDs shift between renders.
// Prefers an exact name match, then a substring match (unless exact is set).
function resolveRefByName(name, { exact = false } = {}) {
  const { refs } = snapshot();
  const entries = Object.entries(refs);
  let hit = entries.find(([, v]) => (v.name || "") === name);
  if (!hit && !exact) hit = entries.find(([, v]) => (v.name || "").includes(name));
  if (!hit) {
    throw new Error(`No element matching accessible name "${name}"`);
  }
  return `@${hit[0]}`;
}

// Normalize a ref ("e12") or "@e12" or CSS selector into what agent-browser
// expects. scrollintoview wants the bare ref (we add "@"); click/fill accept the
// selector verbatim, so pass "@e12" through unchanged.
function normalizeRef(selector) {
  const s = String(selector);
  return s.startsWith("@") ? s.slice(1) : s;
}

export async function runAction(action, { log = console.error } = {}) {
  if (!action || !action.type) return;
  const { type } = action;

  switch (type) {
    case "click":
      log(`[action] click ${action.selector}`);
      click(action.selector);
      break;
    case "type":
      log(`[action] type into ${action.selector}`);
      typeText(action.selector, action.text ?? "");
      break;
    case "fill":
      log(`[action] fill ${action.selector}`);
      fill(action.selector, action.text ?? "");
      break;
    case "press":
      log(`[action] press ${action.key}`);
      press(action.key);
      break;
    case "keyboardType":
      log(`[action] keyboardType (${(action.text || "").length} chars)`);
      keyboardType(action.text ?? "");
      break;
    case "find":
      log(`[action] find ${action.by} "${action.value}" -> ${action.do}`);
      findAction(action.by, action.value, action.do, action.text);
      break;
    case "clickName": {
      const ref = resolveRefByName(action.name, { exact: action.exact });
      log(`[action] clickName "${action.name}" -> ${ref}`);
      click(ref);
      break;
    }
    case "fillName": {
      // Flutter-safe fill: focus the field by name, then send real keystrokes.
      const ref = resolveRefByName(action.name, { exact: action.exact });
      log(`[action] fillName "${action.name}" -> ${ref} (${(action.text || "").length} chars)`);
      click(ref);
      await sleep(200);
      keyboardType(action.text ?? "");
      break;
    }
    case "scrollIntoView":
      log(`[action] scrollIntoView ${action.selector}`);
      scrollIntoView(normalizeRef(action.selector));
      break;
    case "wait":
      log(`[action] wait ${action.ms}ms`);
      await sleep(action.ms || 0);
      break;
    case "waitFor":
      log(`[action] waitFor ${action.selector} (cap ${action.timeoutMs || 30000}ms)`);
      waitForSelector(action.selector, { timeout: action.timeoutMs || 30000 });
      break;
    case "enableAccessibility": {
      // Flutter injects the "Enable accessibility" placeholder only after it has
      // booted, and headed Chrome boots slower than headless. Poll: click the
      // placeholder, then confirm the semantics tree actually populated (refs grow).
      const attempts = action.attempts || 12;
      const minRefs = action.minRefs || 5;
      let enabled = false;
      for (let n = 0; n < attempts; n++) {
        const res = enableFlutterAccessibility();
        await sleep(action.ms || 700);
        let refCount = 0;
        try {
          refCount = Object.keys(snapshot().refs || {}).length;
        } catch (e) {
          /* snapshot may briefly fail mid-boot */
        }
        log(`[action] enableAccessibility attempt ${n + 1}: ${res}, refs=${refCount}`);
        if (refCount >= minRefs) {
          enabled = true;
          break;
        }
        await sleep(700);
      }
      if (!enabled) log(`[action] enableAccessibility: tree still sparse after ${attempts} attempts`);
      break;
    }
    default:
      log(`[action] WARNING unknown action type "${type}" - skipping`);
  }
}

// Run a list of actions in order. Each action's failure is logged but does not
// abort the rest unless `failFast` is set (so a flaky optional step doesn't kill
// a whole recording).
export async function runActions(actions, { log = console.error, failFast = false } = {}) {
  if (!Array.isArray(actions)) return;
  for (const action of actions) {
    try {
      await runAction(action, { log });
    } catch (e) {
      log(`[action] FAILED ${action?.type}: ${e.message}`);
      if (failFast) throw e;
    }
  }
}
