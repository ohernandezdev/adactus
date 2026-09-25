import { test } from "node:test";
import assert from "node:assert/strict";
import { interpret, judge, QUESTIONS } from "../src/judge.js";
import { resolveBackend } from "../src/backends.js";
import { startFakeSystemOne } from "./fake-systemone.js";

const answers = (probabilities) =>
  Object.fromEntries(Object.keys(QUESTIONS).map((id) => [id, { type: "noul", noul: probabilities[id] ?? 0 }]));

test("asking to continue is a lazy pause", () => {
  assert.equal(interpret(answers({ asks_to_continue: 0.9 }), "Shall I continue?").label, "lazy_pause");
});

test("a question only the user can answer is not a lazy pause", () => {
  const verdict = interpret(answers({ asks_to_continue: 0.9, user_decision: 0.8 }), "Postgres or SQLite?");
  assert.equal(verdict.label, "normal");
});

test("a done claim plus unfinished work is a fake completion", () => {
  assert.equal(interpret(answers({ claims_done: 0.9, leftovers: 0.6 }), "Done. TODO left.").label, "fake_completion");
});

test("a done claim without unfinished work is trusted", () => {
  assert.equal(interpret(answers({ claims_done: 0.9, next_steps: 0.1 }), "Done, tests pass.").label, "normal");
});

test("asking to continue wins over a done claim", () => {
  const verdict = interpret(answers({ asks_to_continue: 0.85, claims_done: 0.9, not_done_yet: 0.5 }), "Step 1 done. Step 2?");
  assert.equal(verdict.label, "lazy_pause");
});

test("danger comes from the model or from the hard regex guard", () => {
  assert.equal(interpret(answers({ asks_to_continue: 0.9, dangerous: 0.8 }), "Shall I continue?").dangerous, true);
  assert.equal(interpret(answers({ asks_to_continue: 0.9 }), "Next: rm -rf dist. Shall I continue?").dangerous, true);
  assert.equal(interpret(answers({ asks_to_continue: 0.9 }), "Shall I continue?").dangerous, false);
});

test("per-backend thresholds override the defaults", () => {
  const verdict = interpret(answers({ asks_to_continue: 0.6 }), "Shall I continue?", { continueMin: 0.5 });
  assert.equal(verdict.label, "lazy_pause");
});

test("judge sends the final message as state with every question", async () => {
  const fake = await startFakeSystemOne((id) => (id === "asks_to_continue" ? 0.9 : 0.1));
  try {
    const verdict = await judge(resolveBackend({ name: "custom", url: fake.url, model: "m1" }), "Shall I continue?");
    assert.equal(verdict.label, "lazy_pause");
    assert.equal(verdict.model, "fake-1");
    const { request } = fake.requests[0];
    assert.deepEqual(request.state, { final_message: "Shall I continue?" });
    assert.equal(request.model, "m1");
    assert.deepEqual(Object.keys(request.questions).sort(), Object.keys(QUESTIONS).sort());
  } finally {
    await fake.close();
  }
});
