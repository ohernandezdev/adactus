#!/usr/bin/env node
/**
 * adactus CLI entry point. Parses flags that appear before the agent
 * name, dispatches to `doctor` or to the PTY runner, and passes
 * everything after the agent name through to the spawned agent untouched.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS, THRESHOLDS } from "../src/config.js";
import { createLaya } from "../src/laya.js";
import { createLogger } from "../src/logger.js";
import { runDoctor } from "../src/doctor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));

const SUPPORTED_AGENTS = Object.keys(AGENTS);

const KNOWN_FLAGS = new Set(["--dry-run", "--no-latigo", "--no-compact", "--verbose"]);

const USAGE = `adactus <agent> [args...]

Wraps an interactive AI coding agent in a PTY, detects stalls, false
completions and context saturation, and injects text to keep it working.

Agents:
  claude
  opencode
  codex

Subcommands:
  doctor              run environment diagnostics

Flags (must appear before the agent name):
  --dry-run            classify and log, but never inject
  --no-latigo           disable lazy_pause / fake_completion injections
  --no-compact          disable context_saturated compaction
  --verbose             show classification (LAYA) log lines
  --version              print the adactus version
  --help                 show this help

Toggle supervision on/off at any time with Ctrl+].
`;

function printUsage(stream) {
  stream.write(USAGE);
}

function parseArgs(argv) {
  const flags = { dryRun: false, noLatigo: false, noCompact: false, verbose: false };
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      return { kind: "help" };
    }
    if (arg === "--version" || arg === "-v") {
      return { kind: "version" };
    }
    if (KNOWN_FLAGS.has(arg)) {
      if (arg === "--dry-run") flags.dryRun = true;
      if (arg === "--no-latigo") flags.noLatigo = true;
      if (arg === "--no-compact") flags.noCompact = true;
      if (arg === "--verbose") flags.verbose = true;
      i += 1;
      continue;
    }
    // First non-flag token is the agent name (or "doctor"); everything
    // after it is passed through untouched.
    const name = arg;
    const rest = argv.slice(i + 1);
    return { kind: "agent", name, flags, agentArgs: rest };
  }

  return { kind: "empty" };
}

async function main() {
  const argv = process.argv.slice(2);
  const parsed = parseArgs(argv);

  if (parsed.kind === "empty") {
    printUsage(process.stderr);
    process.exit(2);
  }

  if (parsed.kind === "help") {
    printUsage(process.stdout);
    process.exit(0);
  }

  if (parsed.kind === "version") {
    process.stdout.write(`${pkg.version}\n`);
    process.exit(0);
  }

  if (parsed.name === "doctor") {
    const code = await runDoctor();
    process.exit(code);
  }

  if (!SUPPORTED_AGENTS.includes(parsed.name)) {
    process.stderr.write(
      `adactus: unknown agent "${parsed.name}". Supported agents: ${SUPPORTED_AGENTS.join(", ")}.\n`,
    );
    process.exit(2);
  }

  const agentCfg = AGENTS[parsed.name];
  const { flags, agentArgs } = parsed;

  const logger = createLogger({ verbose: flags.verbose });

  let laya;
  try {
    laya = createLaya({ agent: parsed.name });
  } catch (err) {
    process.stderr.write(`adactus: failed to initialize Laya classifier: ${err.message}\n`);
    process.exit(1);
    return;
  }

  // Loaded lazily: run.js needs the node-pty native module, and `doctor`,
  // `--help` and argument errors must keep working when it is broken.
  const { runAgent } = await import("../src/run.js");
  runAgent({ agentCfg, agentArgs, thresholds: THRESHOLDS, laya, logger, flags });
}

main().catch((err) => {
  process.stderr.write(`adactus: fatal error: ${err.stack || err.message}\n`);
  process.exit(1);
});
