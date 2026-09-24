/**
 * adactus state on disk, under ADACTUS_HOME (default ~/.adactus):
 *  - config.json: { "enabled": boolean, "dryRun": boolean }
 *  - sessions/<session_id>.json: consecutive blocks in the current stop chain
 *  - log.jsonl: one line per Stop hook decision, read by `adactus status`
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_CONFIG = { enabled: true, dryRun: false };
const LOG_MAX_BYTES = 256 * 1024;

export function adactusHome(env = process.env) {
  return env.ADACTUS_HOME || path.join(os.homedir(), ".adactus");
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function readConfig(home) {
  return { ...DEFAULT_CONFIG, ...readJson(path.join(home, "config.json"), {}) };
}

export function writeConfig(home, patch) {
  const next = { ...readConfig(home), ...patch };
  writeJson(path.join(home, "config.json"), next);
  return next;
}

function sessionFile(home, sessionId) {
  // Session ids come from Claude Code; keep them filename-safe anyway.
  const safe = String(sessionId || "unknown").replace(/[^A-Za-z0-9_-]/g, "_");
  return path.join(home, "sessions", `${safe}.json`);
}

export function readSession(home, sessionId) {
  return readJson(sessionFile(home, sessionId), { consecutiveBlocks: 0 });
}

export function writeSession(home, sessionId, value) {
  writeJson(sessionFile(home, sessionId), value);
}

export function appendLog(home, entry) {
  const file = path.join(home, "log.jsonl");
  fs.mkdirSync(home, { recursive: true });
  try {
    // lazy: rotate by truncation; keep a real rotation if history matters.
    if (fs.statSync(file).size > LOG_MAX_BYTES) fs.writeFileSync(file, "");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

export function readLog(home, limit = 20) {
  const file = path.join(home, "log.jsonl");
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  return text.trim().split("\n").filter(Boolean).slice(-limit).map((line) => JSON.parse(line));
}
