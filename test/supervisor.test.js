import { test } from "node:test";
import assert from "node:assert/strict";
import { createSupervisor } from "../src/supervisor.js";
import { createLaya } from "../src/laya.js";
import { createLogger } from "../src/logger.js";
import { AGENTS, THRESHOLDS } from "../src/config.js";

/**
 * A deterministic, manually-advanced fake clock. Timers fire synchronously
 * (but their callbacks may still be async) once `advance()` moves `now`
 * past their scheduled time. This keeps tests fast and avoids any real
 * sleeps.
 */
function createFakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...timers.entries()]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
  };
}

/** Let queued microtasks (promise chains inside handleIdle) settle. */
async function flushMicrotasks() {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function makeSupervisor(overrides = {}) {
  const agentCfg = AGENTS.claude;
  const thresholds = { ...THRESHOLDS, ...(overrides.thresholds ?? {}) };
  const laya = overrides.laya ?? createLaya({ agent: "claude" });
  const writes = [];
  // The Enter key is sent as a separate delayed "\r"; count only the text.
  const write = overrides.write ?? ((text) => text !== "\r" && writes.push(text));
  const logger = createLogger({ verbose: false, stream: { write: () => {} } });
  const clock = overrides.clock ?? createFakeClock();
  const flags = { dryRun: false, noLatigo: false, noCompact: false, verbose: false, ...(overrides.flags ?? {}) };

  const supervisor = createSupervisor({ agentCfg, thresholds, laya, write, logger, flags, clock });
  return { supervisor, writes, clock, thresholds, agentCfg };
}

test("cooldown: rapid repeated triggers within cooldownMs only inject once", async () => {
  const { supervisor, writes, clock, thresholds } = makeSupervisor({
    thresholds: { idleMs: 10, cooldownMs: 5000 },
  });

  supervisor.onOutput("Shall I continue? (y/n)\n");
  clock.advance(thresholds.idleMs);
  await flushMicrotasks();
  assert.equal(writes.length, 1);

  supervisor.onOutput(".");
  clock.advance(thresholds.idleMs);
  await flushMicrotasks();
  assert.equal(writes.length, 1, "second trigger within cooldown must not inject");
});

test("maxInjections halts and stops injecting permanently", async () => {
  const { supervisor, writes, clock, thresholds } = makeSupervisor({
    thresholds: { idleMs: 10, cooldownMs: 0, maxInjections: 2, maxSameClass: 100 },
  });

  for (let i = 0; i < 5; i++) {
    supervisor.onOutput(`Shall I continue? (y/n) [${i}]\n`);
    clock.advance(thresholds.idleMs);
    await flushMicrotasks();
  }

  assert.equal(writes.length, 2, "should stop injecting once maxInjections is reached");
  assert.equal(supervisor.isHalted(), true);

  // Further triggers, even after user input, must never inject again.
  supervisor.onUserInput(Buffer.from("x"));
  supervisor.onOutput("Shall I continue? (y/n) [more]\n");
  clock.advance(thresholds.idleMs);
  await flushMicrotasks();
  assert.equal(writes.length, 2, "maxInjections halt must be permanent");
});

test("stale prompt text already reacted to does not re-trigger an injection", async () => {
  const { supervisor, writes, clock, thresholds } = makeSupervisor({
    thresholds: { idleMs: 10, cooldownMs: 0, maxInjections: 100, maxSameClass: 3 },
  });

  supervisor.onOutput("Shall I continue? (y/n)\n");
  clock.advance(thresholds.idleMs);
  await flushMicrotasks();
  assert.equal(writes.length, 1);

  supervisor.onOutput(".");
  clock.advance(thresholds.idleMs);
  await flushMicrotasks();
  assert.equal(writes.length, 1, "a bare '.' after the injection must not re-trigger");
});

test("maxSameClass allows maxSameClass injections, then halts", async () => {
  const { supervisor, writes, clock, thresholds } = makeSupervisor({
    thresholds: { idleMs: 10, cooldownMs: 0, maxInjections: 100, maxSameClass: 3 },
  });

  for (let i = 0; i < 5; i++) {
    supervisor.onOutput("Shall I continue?\n");
    clock.advance(thresholds.idleMs);
    await flushMicrotasks();
  }

  assert.equal(writes.length, 3);
  assert.equal(supervisor.isHalted(), true);
});

test("injection sends text first, then Enter after submitDelayMs", async () => {
  const raw = [];
  const { supervisor, clock, thresholds } = makeSupervisor({
    thresholds: { idleMs: 10, cooldownMs: 0, submitDelayMs: 150 },
    write: (text) => raw.push(text),
  });

  supervisor.onOutput("Shall I continue?\n");
  clock.advance(thresholds.idleMs);
  await flushMicrotasks();
  assert.deepEqual(raw, [AGENTS.claude.continueText]);

  clock.advance(150);
  assert.deepEqual(raw, [AGENTS.claude.continueText, "\r"]);
});

test("re-enabling supervision resumes after a same-class halt", async () => {
  const { supervisor, writes, clock, thresholds } = makeSupervisor({
    thresholds: { idleMs: 10, cooldownMs: 0, maxSameClass: 1 },
  });

  for (let i = 0; i < 2; i++) {
    supervisor.onOutput("Shall I continue?\n");
    clock.advance(thresholds.idleMs);
    await flushMicrotasks();
  }
  assert.equal(supervisor.isHalted(), true);

  supervisor.setEnabled(false);
  supervisor.setEnabled(true);
  assert.equal(supervisor.isHalted(), false);
  assert.equal(writes.length, 1);
});

test("danger guard halts instead of confirming a dangerous prompt", async () => {
  const { supervisor, writes, clock, thresholds } = makeSupervisor({
    thresholds: { idleMs: 10, cooldownMs: 0 },
  });

  supervisor.onOutput("About to run: rm -rf /important\nShall I continue? (y/n)\n");
  clock.advance(thresholds.idleMs);
  await flushMicrotasks();

  assert.equal(writes.length, 0, "danger guard must block injection");
  assert.equal(supervisor.isHalted(), true);
});

test("dry-run never calls write()", async () => {
  const { supervisor, writes, clock, thresholds } = makeSupervisor({
    thresholds: { idleMs: 10, cooldownMs: 0 },
    flags: { dryRun: true },
  });

  supervisor.onOutput("Shall I continue? (y/n)\n");
  clock.advance(thresholds.idleMs);
  await flushMicrotasks();

  assert.equal(writes.length, 0);
});

test("no injection while output keeps streaming (idle never reached)", async () => {
  const { supervisor, writes, clock, thresholds } = makeSupervisor({
    thresholds: { idleMs: 500, cooldownMs: 0 },
  });

  // Simulate ~5s of chunks arriving every ~450ms, each one resetting the
  // idle timer before it can fire.
  for (let i = 0; i < 11; i++) {
    supervisor.onOutput("Shall I continue? (y/n)\n");
    clock.advance(450);
    await flushMicrotasks();
  }

  assert.equal(writes.length, 0, "streaming output must never trigger an injection");
});

test("Ctrl+]-level toggle (setEnabled) disables supervision", async () => {
  const { supervisor, writes, clock, thresholds } = makeSupervisor({
    thresholds: { idleMs: 10, cooldownMs: 0 },
  });

  supervisor.setEnabled(false);
  supervisor.onOutput("Shall I continue? (y/n)\n");
  clock.advance(thresholds.idleMs);
  await flushMicrotasks();

  assert.equal(writes.length, 0);
  assert.equal(supervisor.isEnabled(), false);
});
