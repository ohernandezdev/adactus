#!/usr/bin/env node
/**
 * Claude Code Stop hook. Reads the hook input JSON on stdin, classifies
 * Claude's final message, and prints {"decision":"block","reason":...}
 * when Claude should keep working. Printing nothing lets the stop happen.
 */

import { classify } from "../src/stop.js";

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", async () => {
  try {
    const output = await classify(JSON.parse(raw));
    if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
    process.exit(0);
  } catch (err) {
    // Non-blocking error: Claude Code shows stderr to the user and lets the
    // stop happen. adactus never blocks on its own failure.
    process.stderr.write(`adactus: ${err.message}\n`);
    process.exit(1);
  }
});
