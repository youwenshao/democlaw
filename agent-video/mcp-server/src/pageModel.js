// Standalone accessibility-snapshot primitive. The accessibility tree + element
// refs are useful for any web agent task (form filling, testing, bug reports),
// not just video. This extracts it as a reusable artifact rather than burying it
// inside the video pipeline.

import { setViewport, open, close, snapshot } from "./browser.js";
import { sleep } from "./session.js";

// Capture the page model for a single URL. Used by the `extract_page_model`
// tool and (indirectly) by the narration stage.
export async function extractPageModel(url, { viewport = [1280, 720] } = {}) {
  try {
    setViewport(viewport[0], viewport[1]);
    open(url, { headed: false });
    await sleep(2000);
    const { snapshot: snap, refs } = snapshot();
    return {
      url,
      capturedAt: new Date().toISOString(),
      refCount: Object.keys(refs).length,
      snapshot: snap,
      refs,
    };
  } finally {
    try {
      close();
    } catch (e) {
      /* best effort */
    }
  }
}
