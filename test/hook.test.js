import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { finished, lazyPause, startFakeSystemOne } from "./fake-systemone.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const hook = path.join(root, "hooks", "stop.js");
const cli = path.join(root, "bin", "adactus.js");

const freshHome = () => fs.mkdtempSync(path.join(os.tmpdir(), "adactus-home-"));
const env = (home, extra = {}) => ({ ...process.env, ADACTUS_HOME: home, ADACTUS_DISABLED: "", ...extra });

// Async on purpose: the fake System One server runs in this process.
function runHook(home, input, extraEnv) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [hook], { env: env(home, extraEnv) });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(JSON.stringify({ session_id: "s1", cwd: root, hook_event_name: "Stop", ...input }));
  });
}

const runCli = (home, ...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: env(home) });

async function withBackend(answer, fn) {
  const fake = await startFakeSystemOne(answer);
  const home = freshHome();
  assert.equal(runCli(home, "use", "custom", "--url", fake.url, "--model", "fake").status, 0);
  try {
    await fn(home, fake);
  } finally {
    await fake.close();
  }
}

test("Stop hook blocks a lazy pause judged by the System One backend", async () => {
  await withBackend(lazyPause, async (home) => {
    const result = await runHook(home, { last_assistant_message: "Plan ready. Shall I continue?", stop_hook_active: false });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.decision, "block");
    assert.match(output.reason, /Continue\./);
  });
});

test("Stop hook lets a genuine final answer through", async () => {
  await withBackend(finished, async (home) => {
    const result = await runHook(home, { last_assistant_message: "Done: 12 tests pass.", stop_hook_active: false });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
  });
});

test("Stop hook keeps its streak across calls and hands control back at the limit", async () => {
  await withBackend(lazyPause, async (home) => {
    const decisions = [];
    for (let i = 0; i < 4; i++) {
      const result = await runHook(home, { last_assistant_message: "Shall I continue?", stop_hook_active: i > 0 });
      decisions.push(result.stdout === "" ? "allow" : JSON.parse(result.stdout).decision);
    }
    assert.deepEqual(decisions, ["block", "block", "block", "allow"]);
  });
});

test("a dangerous pause is handed back even when the model calls it lazy", async () => {
  await withBackend(lazyPause, async (home) => {
    const result = await runHook(home, { last_assistant_message: "Next: git push --force to main. Shall I continue?" });
    assert.equal(result.stdout, "");
  });
});

test("off / on toggles the hook, and status shows backend and decisions", async () => {
  await withBackend(lazyPause, async (home) => {
    assert.equal(runCli(home, "off").status, 0);
    assert.equal((await runHook(home, { last_assistant_message: "Shall I continue?" })).stdout, "");
    assert.equal(runCli(home, "on").status, 0);
    assert.match((await runHook(home, { last_assistant_message: "Shall I continue?" })).stdout, /"block"/);

    const logged = fs.readFileSync(path.join(home, "log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(logged.at(-1).usage, { input_tokens: 1, output_tokens: 0 });

    const status = runCli(home, "status");
    assert.match(status.stdout, /backend: custom \(fake\)/);
    assert.match(status.stdout, /disabled/);
    assert.match(status.stdout, /block_lazy_pause/);
  });
});

test("an unconfigured backend fails visibly and never blocks", async () => {
  const result = await runHook(freshHome(), { last_assistant_message: "Shall I continue?" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /no System One backend configured/);
});

test("an unreachable backend fails visibly and never blocks", async () => {
  const home = freshHome();
  runCli(home, "use", "custom", "--url", "http://127.0.0.1:9/v1/systemone", "--model", "x");
  const result = await runHook(home, { last_assistant_message: "Shall I continue?" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /unreachable/);
  assert.match(runCli(home, "status").stdout, /error/);
});

test("use validates its input", () => {
  const home = freshHome();
  assert.equal(runCli(home, "use", "nope").status, 2);
  assert.equal(runCli(home, "use", "custom", "--url", "http://example.com/x", "--model", "m").status, 1);
  assert.equal(runCli(home, "use", "decider").status, 0);
  assert.match(runCli(home, "status").stdout, /backend: decider/);
});
