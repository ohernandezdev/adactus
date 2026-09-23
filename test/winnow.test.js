import { test } from "node:test";
import assert from "node:assert/strict";
import { splitBlocks, scoreBlock, winnow, buildCompactCommand } from "../src/winnow.js";
import { AGENTS } from "../src/config.js";

test("splitBlocks separates on blank lines and tool markers", () => {
  const text = [
    "⏺ Read(src/app.js)",
    "  contents here",
    "",
    "$ npm test",
    "1 failed, 2 passed",
  ].join("\n");
  const blocks = splitBlocks(text);
  assert.ok(blocks.length >= 2);
});

test("winnow keeps a block containing an error", () => {
  const text = [
    "⏺ Read(src/app.js)",
    "  export function foo() {}",
    "",
    "Error: Cannot find module 'bar'",
    "  at Object.<anonymous> (src/app.js:1:1)",
  ].join("\n");
  const { kept } = winnow(text, 0.1);
  const hasErrorBlock = kept.some((b) => b.includes("Error: Cannot find module"));
  assert.ok(hasErrorBlock, "expected the error block to be kept");
});

test("winnow keeps a block containing a test result summary", () => {
  const text = ["Running suite...", "", "12 passed, 1 failed"].join("\n");
  const { kept } = winnow(text, 0.1);
  const hasSummary = kept.some((b) => b.includes("12 passed, 1 failed"));
  assert.ok(hasSummary, "expected the test summary block to be kept");
});

test("winnow drops a superseded file listing whose path is read again later", () => {
  const text = [
    "Read(src/old.js)",
    "line one",
    "line two",
    "",
    "some unrelated normal narration here",
    "",
    "Read(src/old.js)",
    "line one (updated)",
    "line two (updated)",
  ].join("\n");
  const { kept, dropped } = winnow(text, 0.3);
  const firstReadDropped = dropped.some(
    (b) => b.startsWith("Read(src/old.js)") && b.includes("line one\n"),
  );
  assert.ok(firstReadDropped, "expected the earlier, superseded read to be dropped");
  const secondReadKeptOrPresent = kept.some((b) => b.includes("line one (updated)"));
  assert.ok(secondReadKeptOrPresent, "expected the later read to survive");
});

test("scoreBlock scores an identical repeated block lower on its earlier occurrence", () => {
  const block = "some repeated narration line";
  const allBlocks = [block, "different content", block];
  const scoreFirst = scoreBlock(allBlocks[0], { allBlocks, index: 0 });
  const scoreLast = scoreBlock(allBlocks[2], { allBlocks, index: 2 });
  assert.ok(scoreFirst < scoreLast);
});

test("buildCompactCommand output is always <= 2000 chars, even with huge input", () => {
  const hugeLines = Array.from({ length: 5000 }, (_, i) => `line ${i}: some content here`);
  const command = buildCompactCommand(AGENTS.claude, hugeLines);
  assert.ok(command.length <= 2000);
});

test("buildCompactCommand output is always <= 2000 chars for small input", () => {
  const command = buildCompactCommand(AGENTS.claude, ["a short kept line"]);
  assert.ok(command.length <= 2000);
  assert.ok(command.startsWith("/compact"));
});

test("buildCompactCommand never truncates mid-line", () => {
  const lines = Array.from({ length: 300 }, (_, i) => `L${i}-${"x".repeat(20)}`);
  const command = buildCompactCommand(AGENTS.claude, lines);
  const body = command.replace(/^\/compact Preserve verbatim:\n/, "");
  for (const line of body.split("\n")) {
    if (line === "") continue;
    assert.ok(
      lines.includes(line),
      `truncated output should only contain whole original lines, got: ${line}`,
    );
  }
});
