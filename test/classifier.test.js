import { test } from "node:test";
import assert from "node:assert/strict";
import { createLaya } from "../src/laya.js";

const laya = createLaya({ agent: "claude" });

const cases = [
  // normal_running
  { label: "normal_running", tail: "Writing file... Done writing chunk. Running tests..." },
  { label: "normal_running", tail: "$ npm test\nPASS src/foo.test.js" },
  { label: "normal_running", tail: "Editing src/index.js\nApplying patch..." },

  // lazy_pause
  { label: "lazy_pause", tail: "Do you want me to proceed?" },
  { label: "lazy_pause", tail: "Shall I continue?" },
  { label: "lazy_pause", tail: "Delete the old config? (y/n)" },

  // fake_completion
  {
    label: "fake_completion",
    tail: "I've completed the implementation. Task is done.",
  },
  { label: "fake_completion", tail: "All done! Implementation is complete." },
  { label: "fake_completion", tail: "Everything is working, ready for review." },

  // context_saturated
  { label: "context_saturated", tail: "Context window is low, consider compacting." },
  { label: "context_saturated", tail: "context left until auto-compact: 10%" },
  {
    label: "context_saturated",
    tail: "Warning: conversation too long, running low on context.",
  },
];

for (const [i, { label, tail }] of cases.entries()) {
  test(`classifies fixture #${i + 1} (${label}) as ${label}`, async () => {
    const result = await laya.classify(tail);
    assert.equal(result.label, label);
    assert.equal(result.backend, "heuristic");
    assert.ok(result.confidence > 0);
  });
}

test("normal_running fixtures never misclassify as an action state", async () => {
  const normalFixtures = cases.filter((c) => c.label === "normal_running");
  for (const { tail } of normalFixtures) {
    const result = await laya.classify(tail);
    assert.equal(result.label, "normal_running");
  }
});
