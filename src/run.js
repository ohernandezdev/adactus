/**
 * Spawns the wrapped agent inside a PTY, wires stdin/stdout passthrough,
 * and feeds all traffic through the supervisor.
 */

import fs from "node:fs";
import path from "node:path";
import pty from "node-pty";
import { createSupervisor } from "./supervisor.js";

const CTRL_RIGHT_BRACKET = 0x1d;

/**
 * Resolve a command name against PATH, the way a shell would, so we can
 * fail with a clear error before handing an unresolvable command to
 * node-pty (which would otherwise surface an opaque ENOENT).
 * @param {string} command
 * @returns {string|null} absolute path, or null if not found
 */
function resolveOnPath(command) {
  if (command.includes(path.sep)) {
    try {
      fs.accessSync(command, fs.constants.X_OK);
      return path.resolve(command);
    } catch {
      return null;
    }
  }

  const pathEnv = process.env.PATH ?? "";
  const pathExt = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of pathExt) {
      const candidate = path.join(dir, command + ext);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        // not found here, keep looking
      }
    }
  }
  return null;
}

/**
 * Spawn the agent under node-pty, pipe its output to process.stdout and
 * to the supervisor, forward stdin (minus the Ctrl+] toggle byte), and
 * exit this process mirroring the child's exit status.
 * @param {object} opts
 * @param {import('./config.js').AgentConfig} opts.agentCfg
 * @param {string[]} opts.agentArgs
 * @param {typeof import('./config.js').THRESHOLDS} opts.thresholds
 * @param {{classify: (tail: string) => Promise<{label: string, confidence: number, backend: string}>}} opts.laya
 * @param {ReturnType<typeof import('./logger.js').createLogger>} opts.logger
 * @param {{dryRun?: boolean, noLatigo?: boolean, noCompact?: boolean, verbose?: boolean}} opts.flags
 */
export function runAgent({ agentCfg, agentArgs, thresholds, laya, logger, flags }) {
  const resolved = resolveOnPath(agentCfg.command);
  if (!resolved) {
    process.stderr.write(
      `adactus: could not find "${agentCfg.command}" on PATH. Is it installed?\n`,
    );
    process.exit(127);
  }

  const isTty = process.stdin.isTTY;
  let rawModeWasSet = false;

  const child = pty.spawn(resolved, agentArgs, {
    name: process.env.TERM || "xterm-256color",
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
    cwd: process.cwd(),
    env: process.env,
  });

  const supervisor = createSupervisor({
    agentCfg,
    thresholds,
    laya,
    write: (text) => child.write(text),
    logger,
    flags,
  });

  child.onData((data) => {
    process.stdout.write(data);
    supervisor.onOutput(data);
  });

  if (isTty) {
    process.stdin.setRawMode(true);
    rawModeWasSet = true;
  }
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  process.stdin.on("data", (data) => {
    const buf = Buffer.from(data, "utf8");
    if (buf.length === 1 && buf[0] === CTRL_RIGHT_BRACKET) {
      const next = !supervisor.isEnabled();
      supervisor.setEnabled(next);
      logger.latigo(`supervision ${next ? "enabled" : "disabled"} (Ctrl+])`);
      logger.flush();
      return;
    }
    supervisor.onUserInput(buf);
    child.write(data);
  });

  const resize = () => {
    child.resize(process.stdout.columns || 80, process.stdout.rows || 24);
  };
  // Node refreshes stdout.columns/rows on SIGWINCH and then emits
  // "resize"; a raw SIGWINCH listener would read the stale size.
  process.stdout.on("resize", resize);

  const forwardSignal = (signal) => {
    try {
      child.kill(signal);
    } catch {
      // child may already be gone
    }
  };
  process.on("SIGTERM", () => forwardSignal("SIGTERM"));
  process.on("SIGHUP", () => forwardSignal("SIGHUP"));

  child.onExit(({ exitCode, signal }) => {
    if (rawModeWasSet) {
      process.stdin.setRawMode(false);
    }
    if (signal) {
      process.exit(128 + signal);
    } else {
      process.exit(exitCode);
    }
  });
}
