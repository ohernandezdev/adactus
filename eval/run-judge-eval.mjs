#!/usr/bin/env node
/**
 * Evaluates the Stop hook's decision (the real classify() entry point)
 * against labeled final messages.
 *
 *   node eval/run-judge-eval.mjs --cases <cases.jsonl> --out <flow-dir>
 *        [--variant baseline] [--reps 1] [--only id,id] [--timeout-s 30]
 *
 * Each case: {id, message, expect: allow|block_lazy|block_fake|halt_danger, project?, verified_by?}.
 * Writes <flow-dir>/<variant>/results.jsonl, traces/<id>_rep<k>.json and
 * errors.jsonl. Resumes at the (case, rep) key. Private data never enters
 * the repo: point --cases and --out outside it.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { classify } from "../src/stop.js";
import { adactusHome, readConfig } from "../src/state.js";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const casesFile = args.cases;
const flow = args.out;
if (!casesFile || !flow) {
  process.stderr.write("usage: run-judge-eval.mjs --cases <cases.jsonl> --out <flow-dir> [--variant v] [--reps n] [--only ids]\n");
  process.exit(2);
}
const variant = args.variant ?? "baseline";
if (!/^(baseline|v\d+)$/.test(variant)) throw new Error("--variant must be baseline or v<N>");
const reps = Number(args.reps ?? 1);
const timeoutMs = Number(args["timeout-s"] ?? 30) * 1000;
const only = args.only ? new Set(args.only.split(",")) : null;

const dir = path.join(flow, variant);
fs.mkdirSync(path.join(dir, "traces"), { recursive: true });
const resultsFile = path.join(dir, "results.jsonl");
const errorsFile = path.join(dir, "errors.jsonl");
const done = new Set(
  fs.existsSync(resultsFile)
    ? fs.readFileSync(resultsFile, "utf8").trim().split("\n").filter(Boolean).map((l) => {
        const r = JSON.parse(l);
        return `${r.prompt_id}#${r.rep}`;
      })
    : [],
);

// The user's real backend config, copied into an isolated home per run so the
// eval never touches the user's session state or decision log.
const backend = readConfig(adactusHome()).backend;
if (!backend?.name) throw new Error("no backend configured: run `adactus use ...` first");
const home = fs.mkdtempSync(path.join(os.tmpdir(), "adactus-eval-"));
// --thresholds '{"messageChars":600}' overrides policy knobs for this variant.
const thresholds = args.thresholds ? JSON.parse(args.thresholds) : readConfig(adactusHome()).thresholds;
fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ enabled: true, dryRun: false, backend, thresholds }));

const ACTION = {
  block_lazy_pause: "block_lazy",
  block_fake_completion: "block_fake",
  halt_danger: "halt_danger",
  normal: "allow",
  trusted_after_pushback: "allow",
};
const PUSH = new Set(["block_lazy", "block_fake"]);

const cases = fs.readFileSync(casesFile, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((c) => !only || only.has(c.id));

async function runCase(c, rep) {
  const key = `${c.id}#${rep}`;
  if (done.has(key)) return;
  const input = { session_id: `eval-${variant}-${c.id}-${rep}`, cwd: "/eval", hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: c.message };
  const started = Date.now();
  let output;
  try {
    output = await Promise.race([
      classify(input, { home, env: { ...process.env, ADACTUS_DISABLED: "" } }),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)),
    ]);
  } catch (err) {
    const failure = /timeout/.test(err.message) ? "timeout" : "harness_or_serving_error";
    fs.appendFileSync(errorsFile, `${JSON.stringify({ prompt_id: c.id, rep, failure, error: err.message })}\n`);
    return;
  }
  const latency = (Date.now() - started) / 1000;
  const log = fs.readFileSync(path.join(home, "log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const entry = log.findLast((e) => e.session === input.session_id);
  const action = ACTION[entry.outcome];
  if (!action) throw new Error(`unmapped outcome ${entry.outcome}`);
  if (!entry.model || !entry.usage) throw new Error(`missing model/usage for ${c.id}: runner bug`);

  const shouldPush = PUSH.has(c.expect);
  const pushed = PUSH.has(action);
  const grade = {
    correct: Number(action === c.expect),
    push_ok: Number(pushed === shouldPush),
  };
  const row = {
    prompt_id: c.id,
    rep,
    prompt: c.message.slice(-2000),
    tags: [c.expect, c.project?.startsWith("-Users") ? "real" : "synthetic", ...(c.verified_by ? ["user-verified"] : [])],
    expect: c.expect,
    action,
    status: "ok",
    stop_reason: "end_turn",
    grade,
    latency_s: latency,
    model: entry.model,
    usage: { input_tokens: entry.usage.input_tokens ?? 0, output_tokens: entry.usage.output_tokens ?? 0 },
    meta: { evidence: entry.evidence, label: entry.label, reason: output?.reason ?? null },
  };
  fs.writeFileSync(
    path.join(dir, "traces", `${c.id}_rep${rep}.json`),
    JSON.stringify(
      [
        { role: "user", content: c.message.slice(-2000) },
        { role: "tool_call", name: "system_one", content: JSON.stringify({ model: entry.model, evidence: entry.evidence }, null, 2) },
        { role: "assistant", content: `action: ${action} (expected ${c.expect})${output ? `\n\nreason: ${output.reason}` : ""}` },
      ],
      null,
      2,
    ),
  );
  fs.appendFileSync(resultsFile, `${JSON.stringify(row)}\n`);
}

const started = Date.now();
const queue = cases.flatMap((c) => Array.from({ length: reps }, (_, rep) => [c, rep]));
// Default 1: Laya serves one request at a time, so extra workers only queue
// and inflate the latency column.
await Promise.all(Array.from({ length: Number(args.concurrency ?? 1) }, async () => {
  while (queue.length) await runCase(...queue.shift());
}));

const rows = fs.readFileSync(resultsFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const pct = (a, b) => (b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : "n/a");
const danger = rows.filter((r) => r.expect === "halt_danger");
const push = rows.filter((r) => PUSH.has(r.expect));
const noPush = rows.filter((r) => !PUSH.has(r.expect));
const lat = rows.map((r) => r.latency_s).sort((a, b) => a - b);
const errors = fs.existsSync(errorsFile) ? fs.readFileSync(errorsFile, "utf8").trim().split("\n").filter(Boolean).length : 0;
const n = rows.length;
const acc = rows.filter((r) => r.grade.correct).length;
console.log(`${variant}: ${n} rows, ${errors} errors, ${((Date.now() - started) / 1000).toFixed(1)}s wall-clock`);
console.log(`danger safe (never pushed): ${pct(danger.filter((r) => !PUSH.has(r.action)).length, danger.length)}`);
console.log(`push recall:  ${pct(push.filter((r) => PUSH.has(r.action)).length, push.length)}`);
console.log(`specificity:  ${pct(noPush.filter((r) => !PUSH.has(r.action)).length, noPush.length)}`);
console.log(`exact action: ${pct(acc, n)}  (95% CI ±${Math.round(196 * Math.sqrt((acc / n) * (1 - acc / n) / n))} pts)`);
console.log(`latency: median ${lat[lat.length >> 1]?.toFixed(3)}s, max ${lat.at(-1)?.toFixed(3)}s`);
