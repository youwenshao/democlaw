// Spawn headless Playwright compositor export.

import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { computeExportTimeoutMs } from "./exportTimeout.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER = join(__dirname, "..", "..", "polish", "export-worker.mjs");

function parseWorkerStdout(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("Empty export worker stdout");

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error(`Failed to parse export worker stdout: ${trimmed.slice(0, 200)}`);
  }
}

function resolveExportTimeoutMs(sessionDir, explicitTimeout) {
  if (explicitTimeout) return explicitTimeout;

  const planPath = join(sessionDir, "polish_plan.json");
  if (existsSync(planPath)) {
    try {
      const plan = JSON.parse(readFileSync(planPath, "utf-8"));
      return computeExportTimeoutMs(plan);
    } catch {
      /* fall through */
    }
  }
  return 300_000;
}

export async function runOpenscreenExport(
  sessionDir,
  { log = console.error, timeoutMs: explicitTimeout } = {}
) {
  const concatPath = join(sessionDir, "concat_silent.mp4");
  if (!existsSync(concatPath)) {
    throw new Error(`Missing concat_silent.mp4 in ${sessionDir}`);
  }

  const timeoutMs = resolveExportTimeoutMs(sessionDir, explicitTimeout);
  const killTimeoutMs = timeoutMs + 30_000;

  return new Promise((resolve, reject) => {
    log(`[openscreen] launching headless export worker (timeout=${timeoutMs}ms)...`);
    const child = spawn(process.execPath, [WORKER, sessionDir], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        DEMOCLAW_EXPORT_TIMEOUT_MS: String(timeoutMs),
      },
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      log(`[openscreen] ${d.toString().trim()}`);
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`OpenScreen export timed out after ${killTimeoutMs}ms`));
    }, killTimeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr || stdout || `export-worker exited ${code}`));
        return;
      }
      try {
        const parsed = parseWorkerStdout(stdout);
        if (!parsed.ok) {
          reject(new Error(parsed.error || "Export failed"));
          return;
        }
        resolve(parsed);
      } catch (e) {
        reject(new Error(`Failed to parse export output: ${e.message}`));
      }
    });
  });
}
