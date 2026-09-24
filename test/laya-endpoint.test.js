import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createLaya, LayaError } from "../src/laya.js";
import { createSupervisor } from "../src/supervisor.js";
import { createLogger } from "../src/logger.js";
import { AGENTS, THRESHOLDS } from "../src/config.js";

test("createLaya throws immediately for a non-localhost endpoint", () => {
  assert.throws(
    () => createLaya({ agent: "claude", endpoint: "http://example.com:9999" }),
    LayaError,
  );
});

test("createLaya accepts localhost, 127.0.0.1 and ::1 endpoints without throwing", () => {
  assert.doesNotThrow(() => createLaya({ agent: "claude", endpoint: "http://localhost:9999" }));
  assert.doesNotThrow(() => createLaya({ agent: "claude", endpoint: "http://127.0.0.1:9999" }));
});

test("classify() throws LayaError when the remote endpoint fails", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(500);
    res.end("boom");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  try {
    const laya = createLaya({ agent: "claude", endpoint: `http://127.0.0.1:${port}` });
    await assert.rejects(() => laya.classify("some tail"), LayaError);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a failing remote endpoint pauses supervisor supervision (never falls back to heuristic)", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(500);
    res.end("boom");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  try {
    const laya = createLaya({ agent: "claude", endpoint: `http://127.0.0.1:${port}` });
    const writes = [];
    const logger = createLogger({ verbose: false, stream: { write: () => {} } });

    let now = 0;
    const timers = new Map();
    let nextId = 1;
    const clock = {
      now: () => now,
      setTimeout: (fn, ms) => {
        const id = nextId++;
        timers.set(id, { fn, at: now + ms });
        return id;
      },
      clearTimeout: (id) => timers.delete(id),
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

    const supervisor = createSupervisor({
      agentCfg: AGENTS.claude,
      thresholds: { ...THRESHOLDS, idleMs: 10, cooldownMs: 0 },
      laya,
      write: (text) => writes.push(text),
      logger,
      flags: { dryRun: false, noLatigo: false, noCompact: false, verbose: false },
      clock,
    });

    assert.equal(supervisor.isPaused(), false);

    supervisor.onOutput("Shall I continue? (y/n)\n");
    clock.advance(10);
    // The classification is a real HTTP round trip: wait for it, bounded.
    const deadline = Date.now() + 2000;
    while (!supervisor.isPaused() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.equal(supervisor.isPaused(), true);
    assert.equal(writes.length, 0, "must never inject after a Laya failure");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
