#!/usr/bin/env node
// Check that AEGIS is running before starting a demo recording.
// Exits 0 when required services for the demo phase are reachable.

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import net from "net";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH =
  process.env.AEGIS_DEMO_MANIFEST ||
  join(__dirname, "..", "..", "aegis-demo.json");

const PORT_LABELS = {
  5333: "CritiX Playground",
  5173: "CritiX Admin",
  8765: "CritiX API",
  28001: "RubriX API",
};

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    return {
      aegisRoot:
        process.env.AEGIS_ROOT || "/Users/youwen/Projects/AEGIS/evalguide_client",
      healthPorts: [5333],
    };
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
}

function requiredPorts(phase) {
  if (phase === "2") return [5173];
  if (phase === "combined") return [5333, 5173];
  return [5333];
}

function probePort(port, host = "localhost", timeoutMs = 2000) {
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
  const phase = process.env.AEGIS_DEMO_PHASE || "1";
  const ports = requiredPorts(phase);

  const checks = await Promise.all(
    ports.map(async (port) => ({
      port,
      label: PORT_LABELS[port] || `port ${port}`,
      up: await probePort(port),
    }))
  );

  const down = checks.filter((c) => !c.up);
  if (down.length === 0) {
    console.log(
      JSON.stringify(
        {
          ready: true,
          phase,
          services: checks.map((c) => ({
            port: c.port,
            label: c.label,
            url: `http://localhost:${c.port}`,
          })),
          aegisRoot: manifest.aegisRoot,
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  const missing = down
    .map((c) => `  - ${c.label} (http://localhost:${c.port})`)
    .join("\n");

  console.error(
    `AEGIS is not ready for demo phase "${phase}". Missing:\n${missing}\n\n` +
      `Start the stack first:\n` +
      `  cd ${manifest.aegisRoot}\n` +
      `  ./quickstart.sh\n\n` +
      `Then check status:\n` +
      `  ./aegis-status.sh`
  );
  process.exit(1);
}

main();
