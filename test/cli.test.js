import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.join(__dirname, "..", "bin", "adactus.js");

test("unknown agent name exits with code 2 and lists supported agents", () => {
  const result = spawnSync(process.execPath, [binPath, "nope"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown agent/i);
  assert.match(result.stderr, /claude/);
  assert.match(result.stderr, /opencode/);
  assert.match(result.stderr, /codex/);
});

test("no args exits with code 2 and prints usage to stderr", () => {
  const result = spawnSync(process.execPath, [binPath], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /adactus <agent>/);
});

test("--help exits with code 0 and prints usage to stdout", () => {
  const result = spawnSync(process.execPath, [binPath, "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /adactus <agent>/);
});

test("--version exits with code 0 and prints a version string", () => {
  const result = spawnSync(process.execPath, [binPath, "--version"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
});
