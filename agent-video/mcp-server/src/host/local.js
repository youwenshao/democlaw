// Local host provider - the default for on-device runs. No upload, no network.
// Optionally copies the output to a configured directory; returns a file:// URL.

import { copyFileSync, mkdirSync } from "fs";
import { join, basename } from "path";

export async function upload(videoPath, options = {}) {
  let finalPath = videoPath;

  const destDir = options.outputDir || process.env.DEMOCLAW_LOCAL_OUTPUT_DIR;
  if (destDir) {
    mkdirSync(destDir, { recursive: true });
    finalPath = join(destDir, basename(videoPath));
    copyFileSync(videoPath, finalPath);
  }

  return {
    url: `file://${finalPath}`,
    path: finalPath,
  };
}
