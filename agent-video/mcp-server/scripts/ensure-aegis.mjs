#!/usr/bin/env node
// Check that AEGIS is running before starting a demo recording.
// Exits 0 if CritiX teacher UI (:5333) is reachable; exits 1 with instructions.

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import net from "net";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH =
  process.env.AEGIS_DEMO_MANIFEST ||
  join(__dirname, "..", "..", "aegis-demo.json");

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    return {
      aegisRoot: process.env.AEGIS_ROOT || "/Users/youwen/Projects/AEGIS/evalguide_client",
      healthPorts: [5333],
    };
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
}

function probePort(port, host = "127.0.0.1", timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => done(true));
    socket.on("timeout", () => done(false));
    socket.on("error", () => done(false));
  });
}

async function main() {
  const manifest = loadManifest();
  const critixPort = 5333;
  const up = await probePort(critixPort);

  if (up) {
    console.log(
      JSON.stringify(
        {
          ready: true,
          critixUrl: `http://localhost:${critixPort}`,
          aegisRoot: manifest.aegisRoot,
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  console.error(
    `AEGIS is not reachable on http://localhost:${critixPort}.\n\n` +
      `Start the stack first:\n` +
      `  cd ${manifest.aegisRoot}\n` +
      `  ./quickstart.sh\n\n` +
      `Then check status:\n` +
      `  ./aegis-status.sh`
  );
  process.exit(1);
}

main();
