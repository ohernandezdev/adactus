/**
 * Lifecycle of the local Laya server (server/laya_server.py), started with
 * `uv run --script` so its Python dependencies install themselves.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server", "laya_server.py");

export function healthUrl(backendUrl) {
  const url = new URL(backendUrl);
  url.pathname = "/health";
  return url.toString();
}

export async function isHealthy(backendUrl, timeoutMs = 800) {
  try {
    const res = await fetch(healthUrl(backendUrl), { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

export function hasUv() {
  return spawnSync("uv", ["--version"], { stdio: "ignore", shell: process.platform === "win32" }).status === 0;
}

function serverArgs(backend) {
  return ["run", "--script", SERVER_SCRIPT, "--port", String(new URL(backend.url).port || 8765), "--model", backend.model];
}

/** Start the server detached, logging to <home>/laya-server.log. */
export function startDetached(backend, home) {
  fs.mkdirSync(home, { recursive: true });
  const log = fs.openSync(path.join(home, "laya-server.log"), "a");
  const child = spawn("uv", serverArgs(backend), { detached: true, stdio: ["ignore", log, log] });
  child.unref();
  return child.pid;
}

/** Run the server in the foreground (adactus serve laya). */
export function runForeground(backend) {
  return spawnSync("uv", serverArgs(backend), { stdio: "inherit" }).status ?? 1;
}
