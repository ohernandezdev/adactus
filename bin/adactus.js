#!/usr/bin/env node
/**
 * adactus CLI: picks the System One backend, toggles the Stop hook, checks
 * the setup and evaluates a backend. Used by the /adactus:* skills.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BackendError, PRESETS, resolveBackend } from "../src/backends.js";
import { judge } from "../src/judge.js";
import { ensureStarted, isHealthy, runForeground } from "../src/servers.js";
import { adactusHome, readConfig, readLog, writeConfig } from "../src/state.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const home = adactusHome();

const USAGE = `adactus <command>

Backend (System One model that judges Claude's final message):
  use laya                     local Laya on this Mac (Apple Silicon)
  use decider [--model M] [--dir D]
                               local decider server on :8000 (default Mapika/decider-4b,
                               checkout in ~/.adactus/decider); adactus starts it
  use jev                      TypeSafe cloud (needs TYPESAFE_API_KEY)
  use custom --url U --model M [--api-key-env VAR]
                               any server that speaks POST /v1/systemone
  doctor                       check the backend with a live request
  eval [cases.json]            accuracy and latency of the backend on labeled cases
  serve laya|decider           run the local server in the foreground

Hook:
  on | off                     enable or disable the Stop hook
  dry-run on|off               log decisions without blocking any stop
  status                       mode, backend and the last decisions
  --version
`;

function fail(message, code = 1) {
  process.stderr.write(`adactus: ${message}\n`);
  process.exit(code);
}

function flags(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace(/^--/, "");
    if (!["url", "model", "api-key-env", "dir"].includes(key) || args[i + 1] === undefined) {
      fail(`unexpected argument "${args[i]}"`, 2);
    }
    out[key] = args[i + 1];
  }
  return out;
}

function use(name, args) {
  if (!name) fail("usage: adactus use laya|decider|jev|custom", 2);
  if (name !== "custom" && !PRESETS[name]) fail(`unknown backend "${name}" (expected laya, decider, jev or custom)`, 2);
  if (name === "laya" && !(process.platform === "darwin" && process.arch === "arm64")) {
    fail("laya runs on Apple Silicon Macs only (MLX). Use decider or jev on this machine.");
  }
  const f = flags(args);
  const choice = { name };
  if (f.url) choice.url = f.url;
  if (f.model) choice.model = f.model;
  if (f["api-key-env"]) choice.apiKeyEnv = f["api-key-env"];
  if (f.dir) choice.dir = path.resolve(f.dir);
  try {
    resolveBackend(choice, { ...process.env, [choice.apiKeyEnv ?? PRESETS[name]?.apiKeyEnv ?? "_"]: "check" });
  } catch (err) {
    fail(err.message);
  }
  writeConfig(home, { backend: choice });
  console.log(`adactus backend: ${name}${choice.model ? ` (${choice.model})` : ""}`);
  if (PRESETS[name]) console.log(PRESETS[name].note);
  if (name === "laya") console.log("Run `adactus doctor` to start it now and check it.");
}

async function doctor() {
  const config = readConfig(home);
  let backend;
  try {
    backend = resolveBackend(config.backend);
  } catch (err) {
    fail(err.message);
  }
  console.log(`backend: ${backend.name}  model: ${backend.model}  url: ${backend.url}`);
  if (!backend.local) console.log("note: requests leave this machine.");

  if (backend.local && !(await isHealthy(backend.url))) {
    const { started, reason } = ensureStarted(backend, home);
    console.log(reason);
    if (!started && !/already starting/.test(reason)) fail("the backend is not answering and adactus cannot start it");
    const deadline = Date.now() + 300_000;
    while (!(await isHealthy(backend.url)) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 2000));
    if (!(await isHealthy(backend.url))) fail(`the ${backend.name} server did not start; see ${path.join(home, `${backend.name}-server.log`)}`);
  }

  const probe = "I've written the parser and have a plan for the tests. Shall I continue?";
  try {
    const verdict = await judge(backend, probe, config.thresholds);
    console.log(`probe: "${probe}"`);
    console.log(`verdict: ${verdict.label} in ${verdict.ms}ms (model ${verdict.model})`);
    console.log(verdict.label === "lazy_pause" ? "ok: adactus is ready." : "warning: the probe was expected to be a lazy_pause.");
  } catch (err) {
    fail(err instanceof BackendError ? err.message : `unexpected error: ${err.message}`);
  }
}

async function evaluate(file) {
  const config = readConfig(home);
  let backend;
  try {
    backend = resolveBackend(config.backend);
  } catch (err) {
    fail(err.message);
  }
  const cases = JSON.parse(fs.readFileSync(file ?? path.join(root, "eval", "cases.json"), "utf8"));
  let correct = 0;
  let dangerCorrect = 0;
  const times = [];
  for (const c of cases) {
    const verdict = await judge(backend, c.message, config.thresholds);
    times.push(verdict.ms);
    const ok = verdict.label === c.expect;
    const dangerOk = verdict.dangerous === Boolean(c.dangerous) || !c.dangerous;
    if (ok) correct += 1;
    if (c.dangerous && verdict.dangerous) dangerCorrect += 1;
    if (!ok || !dangerOk) {
      console.log(`MISS expected ${c.expect}${c.dangerous ? "+danger" : ""}, got ${verdict.label}${verdict.dangerous ? "+danger" : ""}: ${c.message}`);
    }
  }
  times.sort((a, b) => a - b);
  const dangerous = cases.filter((c) => c.dangerous).length;
  console.log(`\n${backend.name} (${backend.model}): ${correct}/${cases.length} labels correct, ${dangerCorrect}/${dangerous} dangerous pauses flagged`);
  console.log(`latency: median ${times[Math.floor(times.length / 2)]}ms, p95 ${times[Math.floor(times.length * 0.95)]}ms`);
}

function status() {
  const config = readConfig(home);
  const mode = !config.enabled ? "off" : config.dryRun ? "on (dry-run: logging only)" : "on";
  const backend = config.backend?.name
    ? `${config.backend.name}${config.backend.model ? ` (${config.backend.model})` : ""}`
    : "not configured (run /adactus:setup)";
  const lines = [`adactus ${pkg.version}: ${mode}`, `backend: ${backend}`];
  if (process.env.ADACTUS_DISABLED === "1") lines.push("ADACTUS_DISABLED=1 is set: the hook is off in this environment.");
  const log = readLog(home, 10);
  lines.push(log.length ? "Recent decisions:" : "No decisions logged yet.");
  for (const entry of log) {
    const detail = entry.error ? `  ${entry.error}` : entry.ms !== undefined ? `  ${entry.ms}ms` : "";
    lines.push(`  ${entry.at}  ${entry.outcome}${detail}  (${path.basename(entry.cwd ?? "")})`);
  }
  console.log(lines.join("\n"));
}

const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case "use":
    use(rest[0], rest.slice(1));
    break;
  case "doctor":
    await doctor();
    break;
  case "eval":
    await evaluate(rest[0]);
    break;
  case "serve": {
    if (!["laya", "decider"].includes(rest[0])) fail("usage: adactus serve laya|decider", 2);
    const current = readConfig(home).backend;
    process.exit(runForeground(resolveBackend(current?.name === rest[0] ? current : { name: rest[0] })));
    break;
  }
  case "on":
    writeConfig(home, { enabled: true });
    console.log("adactus is on.");
    break;
  case "off":
    writeConfig(home, { enabled: false });
    console.log("adactus is off: every stop goes through.");
    break;
  case "dry-run":
    if (rest[0] !== "on" && rest[0] !== "off") fail("usage: adactus dry-run on|off", 2);
    writeConfig(home, { dryRun: rest[0] === "on" });
    console.log(`adactus dry-run is ${rest[0]}.`);
    break;
  case "status":
    status();
    break;
  case "--version":
    console.log(pkg.version);
    break;
  case "--help":
  case undefined:
    process.stdout.write(USAGE);
    process.exit(command ? 0 : 2);
    break;
  default:
    fail(`unknown command "${command}"\n\n${USAGE}`, 2);
}
