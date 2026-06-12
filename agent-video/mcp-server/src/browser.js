// Thin wrapper around the `agent-browser` CLI (vercel-labs/agent-browser).
// All browser interaction in the pipeline goes through here so the rest of the
// codebase never shells out to the binary directly.

import { execSync } from "child_process";

const AGENT_BROWSER_BIN = process.env.AGENT_BROWSER_BIN || "agent-browser";

// POSIX single-quote escaping so arbitrary text (essays, selectors, JS) can be
// interpolated into the shell command without breaking on spaces/quotes/newlines.
function shq(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function agentBrowser(command, options = {}) {
  const fullCommand = `${AGENT_BROWSER_BIN} ${command}`;
  console.error(`[browser] $ ${fullCommand}`);
  try {
    const result = execSync(fullCommand, {
      encoding: "utf-8",
      timeout: options.timeout || 30000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim();
  } catch (error) {
    console.error(`[browser] Command failed: ${error.message}`);
    if (error.stderr) console.error(`[browser] stderr: ${error.stderr}`);
    throw error;
  }
}

export function setViewport(width = 1280, height = 720) {
  agentBrowser(`set viewport ${width} ${height}`);
}

export function open(url, { headed = false, timeout = 60000 } = {}) {
  agentBrowser(`open "${url}"${headed ? " --headed" : ""}`, { timeout });
}

export function close() {
  agentBrowser(`close`);
}

// Returns { snapshot: string, refs: { [id]: { role, name, selector } } }
export function snapshot() {
  const raw = agentBrowser(`snapshot --json`);
  const jsonStart = raw.indexOf("{");
  const data = JSON.parse(raw.substring(jsonStart));
  return {
    snapshot: data.data.snapshot,
    refs: data.data.refs || {},
  };
}

export function evalJs(expression) {
  return agentBrowser(`eval ${shq(expression)}`);
}

export function scrollIntoView(ref) {
  agentBrowser(`scrollintoview @${ref}`);
}

// --- Interaction primitives (thin wrappers over the agent-browser CLI) -------
// A `selector` may be a CSS selector or an @ref from the latest snapshot.

export function click(selector) {
  agentBrowser(`click ${shq(selector)}`);
}

export function type(selector, text) {
  agentBrowser(`type ${shq(selector)} ${shq(text)}`);
}

export function fill(selector, text) {
  agentBrowser(`fill ${shq(selector)} ${shq(text)}`);
}

export function press(key) {
  agentBrowser(`press ${shq(key)}`);
}

// Wait for a selector to appear, or for a fixed number of milliseconds.
// agent-browser's `wait` accepts either a selector or a millisecond count.
export function waitForSelector(selectorOrMs, { timeout = 30000 } = {}) {
  const execTimeout = Math.max(timeout + 60_000, 120_000);
  agentBrowser(`wait ${shq(String(selectorOrMs))}`, { timeout: execTimeout });
}

export function screenshot(path) {
  agentBrowser(`screenshot ${shq(path)}`);
}

export function getText(selector) {
  return agentBrowser(`get text ${shq(selector)}`);
}

// Locate an element by a semantic locator and perform an action on it. Maps to
// `agent-browser find <by> <value> <action> [text]`. More resilient than numeric
// @refs for canvas/Flutter apps (locate by placeholder/role/label/text).
export function findAction(by, value, action, text) {
  const textPart = text !== undefined && text !== null ? ` ${shq(text)}` : "";
  return agentBrowser(`find ${by} ${shq(value)} ${action}${textPart}`);
}

// Type real keystrokes into the currently focused element (no selector). Useful
// for Flutter web text fields that only accept input via their hidden editable.
export function keyboardType(text) {
  agentBrowser(`keyboard type ${shq(text)}`);
}

// Click Flutter's hidden "Enable accessibility" placeholder so the semantics
// tree (and thus snapshot refs) is populated. Best-effort: returns the eval
// result string ("clicked" | "not-found").
export function enableFlutterAccessibility() {
  return evalJs(
    "(function(){var el=document.querySelector('flt-semantics-placeholder')||document.querySelector('[aria-label=\"Enable accessibility\"]');if(el){(el.click?el.click():el.dispatchEvent(new MouseEvent('click',{bubbles:true})));return 'clicked';}return 'not-found';})()"
  );
}

export function scrollToTop() {
  evalJs("window.scrollTo({ top: 0, behavior: 'smooth' })");
}

export function scrollToBottom() {
  evalJs("window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })");
}

export function enableSmoothScroll() {
  evalJs("document.documentElement.style.scrollBehavior = 'smooth'");
}

export function pageDimensions() {
  return evalJs(
    "JSON.stringify({ scrollHeight: document.body.scrollHeight, viewportHeight: window.innerHeight, scrollable: document.body.scrollHeight > window.innerHeight })"
  );
}

export function recordStart(videoPath) {
  agentBrowser(`record start "${videoPath}"`);
}

export function recordStop() {
  agentBrowser(`record stop`);
}

export function authLogin(profile) {
  agentBrowser(`auth login ${shq(profile)}`, { timeout: 90000 });
}

export function getBox(selector) {
  const result = agentBrowser(`get box ${shq(selector)} --json`);
  const parsed = JSON.parse(result);
  if (parsed?.data && typeof parsed.data === "object") {
    return parsed.data;
  }
  return parsed;
}
