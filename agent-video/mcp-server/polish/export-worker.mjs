#!/usr/bin/env node
// Headless Playwright export worker for OpenScreen-style polish.

import { createServer } from "http";
import { readFileSync, existsSync, createWriteStream, statSync } from "fs";
import { join, dirname, extname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { computeExportTimeoutMs } from "../src/polish/exportTimeout.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function createCombinedServer(sessionDir, polishDir) {
  const webmPath = join(sessionDir, "polished_silent.webm");

  return createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);

    if (req.method === "POST" && urlPath === "/export-upload") {
      const out = createWriteStream(webmPath);
      req.pipe(out);
      out.on("finish", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, path: webmPath }));
      });
      out.on("error", (err) => {
        res.writeHead(500);
        res.end(err.message);
      });
      req.on("error", (err) => {
        res.writeHead(500);
        res.end(err.message);
      });
      return;
    }

    let filePath;
    if (urlPath.startsWith("/polish/")) {
      filePath = join(polishDir, urlPath.slice("/polish/".length));
    } else {
      filePath = join(sessionDir, urlPath.replace(/^\//, "") || "polish_plan.json");
    }

    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end(`Not found: ${urlPath}`);
      return;
    }
    const ext = extname(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(readFileSync(filePath));
  });
}

async function runExport(sessionDir, { timeoutMs: timeoutOverride } = {}) {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch (e) {
    throw new Error(
      "playwright is not installed. Run: npm install && npx playwright install chromium"
    );
  }

  const planPath = join(sessionDir, "polish_plan.json");
  if (!existsSync(planPath)) {
    throw new Error(`Missing polish_plan.json in ${sessionDir}`);
  }

  const plan = JSON.parse(readFileSync(planPath, "utf-8"));
  const timeoutMs =
    timeoutOverride ||
    Number(process.env.DEMOCLAW_EXPORT_TIMEOUT_MS) ||
    computeExportTimeoutMs(plan);

  const polishDir = __dirname;
  const server = createCombinedServer(sessionDir, polishDir);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const browser = await playwright.chromium.launch({
    headless: true,
    args: [
      "--enable-unsafe-swiftshader",
      "--use-gl=swiftshader",
      "--disable-dev-shm-usage",
    ],
  });

  let progressTimer = null;

  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(timeoutMs);

    const exportUrl = `${base}/polish/export-worker.html?plan=${encodeURIComponent(`${base}/polish_plan.json`)}&video=${encodeURIComponent(`${base}/concat_silent.mp4`)}`;

    console.error(
      `[export-worker] timeout=${timeoutMs}ms duration=${plan.timeline?.totalDurationMs ?? 0}ms playbackRate=${plan.export?.playbackRate ?? 1}`
    );

    await page.goto(exportUrl, { waitUntil: "load", timeout: timeoutMs });

    progressTimer = setInterval(async () => {
      try {
        const progress = await page.evaluate(() => window.__EXPORT_PROGRESS__ || null);
        if (progress) {
          console.error(
            `[export-worker] progress ${progress.percentage}% (${progress.timeMs ?? 0}/${progress.totalMs ?? 0}ms)`
          );
        }
      } catch {
        /* page may be closing */
      }
    }, 5000);

    await page.waitForFunction(
      () => window.__EXPORT_RESULT__ != null,
      null,
      { timeout: timeoutMs }
    );

    clearInterval(progressTimer);
    progressTimer = null;

    const result = await page.evaluate(() => window.__EXPORT_RESULT__);
    if (!result.success) {
      throw new Error(result.error || "Export failed");
    }

    const webmPath = join(sessionDir, "polished_silent.webm");
    if (!existsSync(webmPath) || statSync(webmPath).size === 0) {
      throw new Error(`Missing or empty polished_silent.webm at ${webmPath}`);
    }

    const mp4Path = join(sessionDir, "polished_silent.mp4");
    const ff = spawnSync(
      FFMPEG,
      ["-y", "-i", webmPath, "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-an", mp4Path],
      { encoding: "utf-8" }
    );
    if (ff.status !== 0) {
      throw new Error(`ffmpeg convert failed: ${ff.stderr}`);
    }

    return { webmPath, mp4Path, frames: result.frames };
  } finally {
    if (progressTimer) clearInterval(progressTimer);
    await browser.close();
    server.close();
  }
}

const sessionDir = process.argv[2];
if (!sessionDir) {
  console.error("Usage: node polish/export-worker.mjs <sessionDir>");
  process.exit(1);
}

runExport(sessionDir)
  .then((out) => {
    console.log(JSON.stringify({ ok: true, ...out }));
  })
  .catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
    process.exit(1);
  });
