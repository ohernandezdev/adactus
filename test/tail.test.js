import { test } from "node:test";
import assert from "node:assert/strict";
import { stripAnsi, TailBuffer } from "../src/tail.js";

test("stripAnsi removes SGR, OSC, charset designation and stray control bytes", () => {
  const raw = "\x1b[32mgreen\x1b[0m \x1b]0;title\x07label\x1b(B\x0f done\r\n";
  assert.equal(stripAnsi(raw), "green label done\n");
});

test("stripAnsi keeps words apart when a TUI positions them with cursor moves", () => {
  // Captured from Claude Code's trust dialog.
  const raw = "Quick\x1b[8Gsafety\x1b[15Gcheck:\x1b[22GIs\x1b[25Gthis\x1b[2Aproject\x1b[3Cyou";
  assert.equal(stripAnsi(raw), "Quick safety check: Is this\nproject you");
});

test("stripAnsi turns same-row cursor positioning into spaces and row changes into newlines", () => {
  // Captured from Codex's trust dialog.
  const raw = "\x1b[10;1H1. Trust and continue\x1b[11;3H2.\x1b[11;6HQuit\x1b[13;3Henter";
  assert.equal(stripAnsi(raw), "\n1. Trust and continue\n2. Quit\nenter");
});

test("TailBuffer keeps only the last `size` characters and the raw bytes intact", () => {
  const tail = new TailBuffer(8);
  tail.push("\x1b[31mabc");
  tail.push("defghij");
  assert.equal(tail.getTail().length, 8);
  assert.equal(tail.getTail(), "cdefghij");
});
