import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../src/decide.js";
import { LIMITS } from "../src/config.js";

const on = { enabled: true, dryRun: false };
const fresh = { consecutiveBlocks: 0 };
const lazy = { label: "lazy_pause", dangerous: false };

test("blocks a lazy pause and starts a streak", () => {
  const result = decide({ input: { stop_hook_active: false }, verdict: lazy, config: on, session: fresh });
  assert.equal(result.block, true);
  assert.match(result.reason, /Continue\./);
  assert.equal(result.session.consecutiveBlocks, 1);
});

test("blocks a fake completion with the corrective reason", () => {
  const verdict = { label: "fake_completion", gaps: ["failing tests or unfixed errors"], dangerous: false };
  const result = decide({ input: {}, verdict, config: on, session: fresh });
  assert.equal(result.block, true);
  assert.match(result.reason, /The task is incomplete: .* mentions failing tests or unfixed errors\./);
  assert.match(result.reason, /outside the task you were given, say so and stop/);
});

test("lets a normal stop through and resets the streak", () => {
  const verdict = { label: "normal", dangerous: false };
  const result = decide({ input: { stop_hook_active: true }, verdict, config: on, session: { consecutiveBlocks: 2 } });
  assert.equal(result.block, false);
  assert.equal(result.session.consecutiveBlocks, 0);
});

test("hands a dangerous pause back to the user", () => {
  const result = decide({ input: {}, verdict: { ...lazy, dangerous: true }, config: on, session: fresh });
  assert.equal(result.block, false);
  assert.equal(result.outcome, "halt_danger");
});

test(`stops pushing after ${LIMITS.maxConsecutiveBlocks} consecutive blocks in one chain`, () => {
  let session = fresh;
  const outcomes = [];
  for (let i = 0; i < LIMITS.maxConsecutiveBlocks + 1; i++) {
    const result = decide({ input: { stop_hook_active: i > 0 }, verdict: lazy, config: on, session });
    outcomes.push(result.outcome);
    session = result.session;
  }
  assert.deepEqual(outcomes, [
    ...Array(LIMITS.maxConsecutiveBlocks).fill("block_lazy_pause"),
    "halt_max_blocks",
  ]);
});

test("a stop that is not caused by our block starts a new chain", () => {
  const result = decide({
    input: { stop_hook_active: false },
    verdict: lazy,
    config: on,
    session: { consecutiveBlocks: LIMITS.maxConsecutiveBlocks },
  });
  assert.equal(result.block, true);
  assert.equal(result.session.consecutiveBlocks, 1);
});

test("disabled never blocks", () => {
  const result = decide({ input: {}, verdict: lazy, config: { enabled: false, dryRun: false }, session: fresh });
  assert.equal(result.block, false);
  assert.equal(result.outcome, "disabled");
});

test("dry-run records the decision without blocking", () => {
  const result = decide({ input: {}, verdict: lazy, config: { enabled: true, dryRun: true }, session: fresh });
  assert.equal(result.block, false);
  assert.equal(result.outcome, "dry_run_lazy_pause");
});

test("a fake completion is pushed once per chain, then Claude's answer is trusted", () => {
  const verdict = { label: "fake_completion", gaps: ["next steps or remaining work"], dangerous: false };
  const first = decide({ input: { stop_hook_active: false }, verdict, config: on, session: fresh });
  assert.equal(first.block, true);
  const second = decide({ input: { stop_hook_active: true }, verdict, config: on, session: first.session });
  assert.equal(second.block, false);
  assert.equal(second.outcome, "trusted_after_pushback");
});

test("a fake completion after a lazy-pause block is still pushed", () => {
  const verdict = { label: "fake_completion", gaps: ["failing tests or unfixed errors"], dangerous: false };
  const session = { consecutiveBlocks: 1, lastBlocked: "lazy_pause" };
  assert.equal(decide({ input: { stop_hook_active: true }, verdict, config: on, session }).block, true);
});
