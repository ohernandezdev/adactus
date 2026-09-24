import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const hook = path.join(root, "hooks", "stop.js");
const cli = path.join(root, "bin", "adactus.js");

function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "adactus-home-"));
}

function runHook(home, input, extraEnv = {}) {
  return spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ session_id: "s1", cwd: root, hook_event_name: "Stop", ...input }),
    encoding: "utf8",
    env: { ...process.env, ADACTUS_HOME: home, LAYA_ENDPOINT: "", ...extraEnv },
  });
}

function runCli(home, ...args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { ...process.env, ADACTUS_HOME: home } });
}

test("Stop hook prints a block decision for a lazy pause", () => {
  const result = runHook(freshHome(), { last_assistant_message: "Plan ready. Shall I continue?", stop_hook_active: false });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.decision, "block");
  assert.match(output.reason, /Continue\./);
});

test("Stop hook prints nothing for a genuine final answer", () => {
  const result = runHook(freshHome(), { last_assistant_message: "Done: 12 tests pass.", stop_hook_active: false });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
});

test("Stop hook keeps its streak across calls and hands control back at the limit", () => {
  const home = freshHome();
  const decisions = [];
  for (let i = 0; i < 4; i++) {
    const result = runHook(home, { last_assistant_message: "Shall I continue?", stop_hook_active: i > 0 });
    decisions.push(result.stdout === "" ? "allow" : JSON.parse(result.stdout).decision);
  }
  assert.deepEqual(decisions, ["block", "block", "block", "allow"]);
});

test("adactus off / on toggles the hook, and status reports the decisions", () => {
  const home = freshHome();
  assert.equal(runCli(home, "off").status, 0);
  assert.equal(runHook(home, { last_assistant_message: "Shall I continue?" }).stdout, "");

  assert.equal(runCli(home, "on").status, 0);
  assert.match(runHook(home, { last_assistant_message: "Shall I continue?" }).stdout, /"block"/);

  const status = runCli(home, "status");
  assert.equal(status.status, 0);
  assert.match(status.stdout, /: on/);
  assert.match(status.stdout, /disabled/);
  assert.match(status.stdout, /block_lazy_pause/);
});

test("ADACTUS_DISABLED=1 turns the hook off for that environment", () => {
  const result = runHook(freshHome(), { last_assistant_message: "Shall I continue?" }, { ADACTUS_DISABLED: "1" });
  assert.equal(result.stdout, "");
});

test("a broken hook input fails without blocking the stop", () => {
  const result = spawnSync(process.execPath, [hook], {
    input: "not json",
    encoding: "utf8",
    env: { ...process.env, ADACTUS_HOME: freshHome() },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /adactus:/);
});
