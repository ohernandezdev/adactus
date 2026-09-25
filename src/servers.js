/**
 * Local System One servers adactus can start on its own: Laya (bundled
 * server/laya_server.py, via `uv run --script`) and decider (an existing
 * decider checkout with its virtualenv). Other backends are never started.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LAYA_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server", "laya_server.py");
// A cold start downloads and loads the model; do not launch a second copy
// while the first may still be loading.
const START_GRACE_MS = 5 * 60 * 1000;

export function healthUrl(backendUrl) {
  const url = new URL(backendUrl);
  url.pathname = "/health";
  url.search = "";
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

function hasUv() {
  return spawnSync("uv", ["--version"], { stdio: "ignore", shell: process.platform === "win32" }).status === 0;
}

export function deciderDir(backend) {
  return backend.dir ?? path.join(os.homedir(), ".adactus", "decider");
}

function deciderUvicorn(dir) {
  const bin = process.platform === "win32" ? path.join("Scripts", "uvicorn.exe") : path.join("bin", "uvicorn");
  return [".venv312", ".venv"].map((venv) => path.join(dir, venv, bin)).find((p) => fs.existsSync(p)) ?? null;
}

/**
 * How to launch the backend's server, or why it cannot be launched.
 * @returns {{command: string, args: string[], cwd?: string, env?: object}|{error: string}|null} null: not startable by adactus
 */
export function startRecipe(backend) {
  const url = new URL(backend.url);
  const port = url.port || "80";
  const host = url.hostname === "localhost" ? "127.0.0.1" : url.hostname;
  if (backend.name === "laya") {
    if (!hasUv()) return { error: "the Laya backend needs uv: https://docs.astral.sh/uv/" };
    return { command: "uv", args: ["run", "--script", LAYA_SCRIPT, "--port", port, "--model", backend.model] };
  }
  if (backend.name === "decider") {
    const dir = deciderDir(backend);
    const uvicorn = deciderUvicorn(dir);
    if (!uvicorn) {
      return {
        error:
          `decider is not installed in ${dir}. Install it with: git clone https://github.com/Mapika/decider ${dir} && ` +
          `cd ${dir} && uv venv -p 3.12 .venv312 && VIRTUAL_ENV=.venv312 uv pip install -e ".[serve]"`,
      };
    }
    return {
      command: uvicorn,
      args: ["decider.serve:app", "--host", host, "--port", port],
      cwd: dir,
      env: { ...process.env, DECIDER_MODEL: backend.model, DECIDER_COMPILE: "0" },
    };
  }
  return null;
}

function lockFile(home, backend) {
  return path.join(home, `${backend.name}-server.lock`);
}

/**
 * Start the backend's server in the background unless a start is already
 * in flight. Logs to <home>/<name>-server.log.
 * @returns {{started: boolean, reason: string}}
 */
export function ensureStarted(backend, home, now = Date.now()) {
  const recipe = startRecipe(backend);
  if (!recipe) return { started: false, reason: `adactus does not start ${backend.name} servers` };
  if (recipe.error) return { started: false, reason: recipe.error };

  const lock = lockFile(home, backend);
  try {
    const { at } = JSON.parse(fs.readFileSync(lock, "utf8"));
    if (now - at < START_GRACE_MS) return { started: false, reason: `${backend.name} server is already starting` };
  } catch (err) {
    if (err.code !== "ENOENT" && !(err instanceof SyntaxError)) throw err;
  }

  fs.mkdirSync(home, { recursive: true });
  const log = fs.openSync(path.join(home, `${backend.name}-server.log`), "a");
  const child = spawn(recipe.command, recipe.args, {
    cwd: recipe.cwd,
    env: recipe.env,
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  fs.writeFileSync(lock, JSON.stringify({ at: now, pid: child.pid }));
  return { started: true, reason: `starting the ${backend.name} server (log: ${path.join(home, `${backend.name}-server.log`)})` };
}

/** Run the server in the foreground (adactus serve <name>). */
export function runForeground(backend) {
  const recipe = startRecipe(backend);
  if (!recipe) throw new Error(`adactus does not start ${backend.name} servers`);
  if (recipe.error) throw new Error(recipe.error);
  return spawnSync(recipe.command, recipe.args, { cwd: recipe.cwd, env: recipe.env, stdio: "inherit" }).status ?? 1;
}
