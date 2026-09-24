import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { classifyHeuristic, createLaya, LayaError } from "../src/laya.js";

const cases = [
  // normal: real questions, plain summaries, genuine completion
  { label: "normal", message: "Which database do you prefer for this service: Postgres or SQLite?" },
  { label: "normal", message: "I refactored the parser and all 42 tests pass." },
  { label: "normal", message: "Task is complete. `npm test` reports 48 passing, 0 failing." },
  // lazy_pause
  { label: "lazy_pause", message: "I've read the codebase and have a plan. Shall I continue?" },
  { label: "lazy_pause", message: "Step 1 is done.\n\nWould you like me to proceed with step 2?" },
  { label: "lazy_pause", message: "Here is the plan above. Let me know if you'd like me to go ahead." },
  { label: "lazy_pause", message: "Apply the same change to the other modules? (y/n)" },
  // fake_completion: a done claim plus evidence it is not done
  { label: "fake_completion", message: "Task is complete!\n\nNext steps: wire the endpoint into the router." },
  { label: "fake_completion", message: "I've implemented the feature. The export button is a placeholder for now." },
  { label: "fake_completion", message: "Implementation is done, although 2 tests are still failing." },
  { label: "fake_completion", message: "All done. Remaining work: add the TODO handlers for errors." },
];

for (const [i, { label, message }] of cases.entries()) {
  test(`heuristic classifies case #${i + 1} as ${label}`, () => {
    assert.equal(classifyHeuristic(message).label, label);
  });
}

test("a pause that mentions a dangerous action is flagged", () => {
  const verdict = classifyHeuristic("Next I would run `rm -rf dist` and redeploy. Shall I continue?");
  assert.equal(verdict.label, "lazy_pause");
  assert.equal(verdict.dangerous, true);
});

test("an empty or missing message is normal", () => {
  assert.equal(classifyHeuristic("").label, "normal");
  assert.equal(classifyHeuristic(undefined).label, "normal");
});

test("LAYA_ENDPOINT must be http on localhost", () => {
  assert.throws(() => createLaya({ endpoint: "http://example.com/laya" }), LayaError);
  assert.throws(() => createLaya({ endpoint: "https://127.0.0.1:9/laya" }), LayaError);
});

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("remote backend: a valid answer is used as-is", async () => {
  await withServer(
    (req, res) => res.end(JSON.stringify({ label: "lazy_pause", evidence: "remote" })),
    async (endpoint) => {
      const verdict = await createLaya({ endpoint }).classify("anything");
      assert.equal(verdict.label, "lazy_pause");
      assert.equal(verdict.backend, "remote");
    },
  );
});

test("remote backend: a failing endpoint raises LayaError, never falls back to the heuristic", async () => {
  await withServer(
    (req, res) => {
      res.writeHead(500);
      res.end("boom");
    },
    async (endpoint) => {
      await assert.rejects(() => createLaya({ endpoint }).classify("Shall I continue?"), LayaError);
    },
  );
});
