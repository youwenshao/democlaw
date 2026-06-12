// Timed action beats for scene recording (actionScript + legacy entryActions).

export const FOCUS_ACTIONS = new Set([
  "click",
  "clickName",
  "fill",
  "fillName",
  "type",
]);

/** Convert legacy entryActions into timed actionScript beats. */
export function entryActionsToScript(entryActions = []) {
  const script = [];
  let atMs = 0;
  for (const action of entryActions) {
    script.push({ atMs, action });
    if (action.type === "wait") {
      atMs += action.ms || 0;
    } else if (action.type === "waitFor") {
      atMs += 800;
    } else {
      atMs += 450;
    }
  }
  return script;
}

/** Resolve timed actions for a scene (explicit actionScript or legacy entryActions). */
export function resolveActionScript(page) {
  if (Array.isArray(page.actionScript) && page.actionScript.length > 0) {
    return page.actionScript.map((beat) => ({
      atMs: beat.atMs ?? 0,
      action: beat.action,
      source: "actionScript",
    }));
  }
  return entryActionsToScript(page.entryActions || []).map((beat) => ({
    ...beat,
    source: "entryActions",
  }));
}
