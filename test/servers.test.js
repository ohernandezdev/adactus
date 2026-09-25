import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureStarted, startRecipe } from "../src/servers.js";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "adactus-servers-"));
const decider = (dir) => ({ name: "decider", url: "http://127.0.0.1:8000/v1/systemone", model: "Mapika/decider-4b", local: true, dir });

test("decider without a checkout explains how to install it", () => {
  const recipe = startRecipe(decider(path.join(tmp(), "missing")));
  assert.match(recipe.error, /git clone https:\/\/github.com\/Mapika\/decider/);
});

test("decider with a checkout is started on localhost with the configured model", { skip: process.platform === "win32" }, () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, ".venv312", "bin"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".venv312", "bin", "uvicorn"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const recipe = startRecipe(decider(dir));
  assert.deepEqual(recipe.args, ["decider.serve:app", "--host", "127.0.0.1", "--port", "8000"]);
  assert.equal(recipe.env.DECIDER_MODEL, "Mapika/decider-4b");
});

test("a second start while the first is loading is skipped", { skip: process.platform === "win32" }, () => {
  const dir = tmp();
  const home = tmp();
  fs.mkdirSync(path.join(dir, ".venv312", "bin"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".venv312", "bin", "uvicorn"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  assert.equal(ensureStarted(decider(dir), home, 1_000).started, true);
  assert.match(ensureStarted(decider(dir), home, 2_000).reason, /already starting/);
  assert.equal(ensureStarted(decider(dir), home, 1_000 + 6 * 60 * 1000).started, true);
});

test("remote backends are never started", () => {
  assert.equal(startRecipe({ name: "jev", url: "https://api.typesafe.ai/v1/systemone", model: "jev-latest" }), null);
});
