// Session + artifact management. Each pipeline run owns a session directory
// under ~/Movies/agent-recordings/session-<id>. Stages communicate through JSON
// artifacts in that directory so the agent can inspect/retry any single stage.

import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
  appendFileSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// agent-video package root (parent of mcp-server/), where .env lives
export const PROJECT_DIR = join(dirname(__dirname), "..");
export const SESSION_BASE = join(process.env.HOME, "Movies", "agent-recordings");

function parseEnvFile(envPath) {
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    if (line && !line.startsWith("#")) {
      const [key, ...valueParts] = line.split("=");
      const value = valueParts.join("=").replace(/^["']|["']$/g, "");
      process.env[key.trim()] = value.trim();
    }
  }
}

// Load .env from agent-video/ (primary) or mcp-server/ (legacy fallback).
export function loadEnv() {
  const candidates = [
    join(PROJECT_DIR, ".env"),
    join(dirname(__dirname), ".env"),
  ];
  for (const envPath of candidates) {
    if (existsSync(envPath)) {
      parseEnvFile(envPath);
      return;
    }
  }
}

export function newSessionId() {
  return String(Date.now());
}

export function sessionDirFor(sessionId) {
  return join(SESSION_BASE, `session-${sessionId}`);
}

// Resolve (and create) a session directory. If sessionId is omitted a fresh one
// is created; otherwise an existing session is reused (for stage-by-stage runs).
export function ensureSession(sessionId) {
  const id = sessionId || newSessionId();
  const dir = sessionDirFor(id);
  mkdirSync(dir, { recursive: true });
  return { sessionId: id, sessionDir: dir };
}

export function artifactPath(sessionId, name) {
  return join(sessionDirFor(sessionId), name);
}

export function writeArtifact(sessionId, name, data) {
  const path = artifactPath(sessionId, name);
  writeFileSync(path, JSON.stringify(data, null, 2));
  return path;
}

export function readArtifact(sessionId, name) {
  const path = artifactPath(sessionId, name);
  if (!existsSync(path)) {
    throw new Error(
      `Missing artifact "${name}" for session ${sessionId}. Run the prior stage first (expected at ${path}).`
    );
  }
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function makeLogger(sessionId) {
  const dir = sessionDirFor(sessionId);
  const debugLogPath = join(dir, "debug.log");
  return (msg) => {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    console.error(`[narrator] ${msg}`);
    try {
      appendFileSync(debugLogPath, line);
    } catch (e) {
      /* best effort */
    }
  };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
