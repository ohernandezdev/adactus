import { test } from "node:test";
import assert from "node:assert/strict";
import { stripAnsi, TailBuffer } from "../src/tail.js";

test("stripAnsi removes SGR, OSC, charset designation and stray control bytes", () => {
  const raw = "\x1b[32mgreen\x1b[0m \x1b]0;title\x07label\x1b(B\x0f done\r\n";
  assert.equal(stripAnsi(raw), "green label done\n");
});

test("TailBuffer keeps only the last `size` characters and the raw bytes intact", () => {
  const tail = new TailBuffer(8);
  tail.push("\x1b[31mabc");
  tail.push("defghij");
  assert.equal(tail.getTail().length, 8);
  assert.equal(tail.getTail(), "cdefghij");
});
