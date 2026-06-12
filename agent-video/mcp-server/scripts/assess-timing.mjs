#!/usr/bin/env node
// CLI wrapper for assess_timing — npm run assess-timing -- <sessionId>

import { assessTiming } from "../src/critique/assessTiming.js";
import { loadEnv } from "../src/session.js";

loadEnv();

const sessionId = process.argv[2];
if (!sessionId) {
  console.error("Usage: npm run assess-timing -- <sessionId>");
  process.exit(1);
}

try {
  const result = await assessTiming({ sessionId });
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error(`[assess-timing] FAILED: ${err.message}`);
  process.exit(1);
}
