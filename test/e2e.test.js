import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pty from "node-pty";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.join(__dirname, "..", "bin", "adactus.js");
const fakeAgent = path.join(__dirname, "..", "fixtures", "fake-agent.js");

/** Put a fake `claude` on PATH: a .cmd shim on Windows, a shell script elsewhere. */
function fakeClaudeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adactus-e2e-"));
  if (process.platform === "win32") {
    fs.writeFileSync(path.join(dir, "claude.cmd"), `@"${process.execPath}" "${fakeAgent}" %*\r\n`);
  } else {
    const script = path.join(dir, "claude");
    fs.writeFileSync(script, `#!/bin/sh\nexec "${process.execPath}" "${fakeAgent}" "$@"\n`);
    fs.chmodSync(script, 0o755);
  }
  return dir;
}

test("adactus wraps a real PTY agent, answers its lazy pause and mirrors its exit code", async () => {
  const dir = fakeClaudeDir();
  // Windows spells it "Path"; adding a second "PATH" key would be ignored.
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  const env = { ...process.env, [pathKey]: `${dir}${path.delimiter}${process.env[pathKey]}` };
  const child = pty.spawn(process.execPath, [binPath, "claude"], { cols: 100, rows: 30, env });

  let output = "";
  child.onData((data) => {
    output += data;
  });
  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out; output so far: ${output}`)), 15000);
    child.onExit(({ exitCode: code }) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

  assert.equal(exitCode, 7);
  // ConPTY re-renders the screen and may put cursor moves between the color
  // and the text, so check both separately.
  assert.match(output, /\x1b\[32m/, "ANSI colors pass through");
  assert.match(output, /fake agent ready/);
  assert.match(output, /GOT:"Continue\.\\r"/, "the lazy pause was answered and submitted");
});
