import { test } from "node:test";
import assert from "node:assert/strict";
import { BackendError, resolveBackend } from "../src/backends.js";
import { askSystemOne } from "../src/systemone.js";
import { startFakeSystemOne } from "./fake-systemone.js";

test("presets resolve to the documented endpoints", () => {
  assert.equal(resolveBackend({ name: "laya" }).url, "http://127.0.0.1:8765/v1/systemone");
  assert.equal(resolveBackend({ name: "decider" }).model, "Mapika/decider-4b");
  const jev = resolveBackend({ name: "jev" }, { TYPESAFE_API_KEY: "k" });
  assert.equal(jev.url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(jev.headers.Authorization, "Bearer k");
  assert.equal(jev.local, false);
});

test("jev without an API key is a configuration error", () => {
  assert.throws(() => resolveBackend({ name: "jev" }, {}), /TYPESAFE_API_KEY/);
});

test("no backend configured is an explicit error", () => {
  assert.throws(() => resolveBackend(undefined), BackendError);
});

test("remote custom backends must use https", () => {
  assert.throws(() => resolveBackend({ name: "custom", url: "http://example.com/v1/systemone", model: "m" }), /https/);
  assert.equal(resolveBackend({ name: "custom", url: "https://example.com/v1/systemone", model: "m" }).local, false);
});

test("a failing backend raises BackendError", async () => {
  const fake = await startFakeSystemOne(() => 0.5, { status: 500 });
  try {
    const backend = resolveBackend({ name: "custom", url: fake.url, model: "m" });
    await assert.rejects(() => askSystemOne(backend, "s", { q: { type: "noul", instructions: "?" } }, { timeoutMs: 2000 }), BackendError);
  } finally {
    await fake.close();
  }
});

test("an unreachable backend raises BackendError", async () => {
  const backend = resolveBackend({ name: "custom", url: "http://127.0.0.1:9/v1/systemone", model: "m" });
  await assert.rejects(() => askSystemOne(backend, "s", { q: { type: "noul", instructions: "?" } }, { timeoutMs: 1000 }), BackendError);
});
