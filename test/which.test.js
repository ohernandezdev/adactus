import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findExecutable, spawnTarget } from "../src/which.js";

function tempDirWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adactus-which-"));
  for (const [name, mode] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), "");
    fs.chmodSync(path.join(dir, name), mode);
  }
  return dir;
}

test("findExecutable resolves a Windows .cmd shim through PATHEXT", () => {
  const dir = tempDirWith({ "claude.cmd": 0o644 });
  const env = { PATH: dir, PATHEXT: ".EXE;.CMD" };
  assert.equal(findExecutable("claude", { platform: "win32", env }), path.join(dir, "claude.cmd"));
});

test("findExecutable on POSIX requires the execute bit", { skip: process.platform === "win32" }, () => {
  const dir = tempDirWith({ claude: 0o644, codex: 0o755 });
  const env = { PATH: dir };
  assert.equal(findExecutable("claude", { platform: "linux", env }), null);
  assert.equal(findExecutable("codex", { platform: "linux", env }), path.join(dir, "codex"));
});

test("spawnTarget launches Windows batch shims through cmd.exe", () => {
  const target = spawnTarget("C:\\npm\\codex.cmd", ["hi there"], {
    platform: "win32",
    env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
  });
  assert.deepEqual(target, {
    file: "C:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/c", "C:\\npm\\codex.cmd", "hi there"],
  });
});

test("spawnTarget runs native executables directly", () => {
  assert.deepEqual(spawnTarget("/usr/bin/claude", ["-p"], { platform: "linux", env: {} }), {
    file: "/usr/bin/claude",
    args: ["-p"],
  });
});
