/**
 * `adactus doctor`: environment sanity checks. Exits 0 only when Node and
 * node-pty both check out; presence of the wrapped agents on PATH is
 * informational (you may install adactus before installing any agent),
 * so it never affects the exit code.
 */

import { findExecutable } from "./which.js";

const REQUIRED_MAJOR = 20;
const SUPPORTED_AGENTS = ["claude", "opencode", "codex"];

function checkNodeVersion() {
  const [major] = process.versions.node.split(".").map(Number);
  const ok = major >= REQUIRED_MAJOR;
  return {
    ok,
    label: `Node.js version (>= ${REQUIRED_MAJOR})`,
    detail: `found v${process.versions.node}`,
    fix: `install Node ${REQUIRED_MAJOR}+ (e.g. via nvm: nvm install ${REQUIRED_MAJOR})`,
  };
}

async function checkNodePty() {
  try {
    const pty = await import("node-pty");
    const [file, args] =
      process.platform === "win32" ? [process.env.ComSpec || "cmd.exe", ["/d", "/c", "echo ok"]] : ["/bin/echo", ["ok"]];
    const child = pty.spawn(file, args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: process.env,
    });

    const output = await new Promise((resolve, reject) => {
      let out = "";
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${file}`)), 3000);
      child.onData((data) => {
        out += data;
      });
      child.onExit(() => {
        clearTimeout(timer);
        resolve(out);
      });
    });

    const ok = output.includes("ok");
    return {
      ok,
      label: "node-pty loads and can spawn a process",
      detail: ok ? `spawned ${file} successfully` : `unexpected output: ${output}`,
      fix: "run `npm rebuild node-pty` (native binary may be missing or mismatched)",
    };
  } catch (err) {
    return {
      ok: false,
      label: "node-pty loads and can spawn a process",
      detail: err.message,
      fix: "run `npm rebuild node-pty` (native prebuilt binary is likely missing for this platform/Node version)",
    };
  }
}

function checkAgentsOnPath() {
  return SUPPORTED_AGENTS.map((agent) => {
    const found = findExecutable(agent);
    return {
      ok: Boolean(found),
      label: `${agent} on PATH`,
      detail: found ?? "not found",
      fix: `install ${agent} and ensure it is on PATH (optional — informational only)`,
    };
  });
}

/**
 * Run all doctor checks and print results.
 * @returns {Promise<number>} process exit code
 */
export async function runDoctor() {
  const requiredChecks = [checkNodeVersion(), await checkNodePty()];
  const informationalChecks = checkAgentsOnPath();

  console.log("adactus doctor\n");

  let requiredOk = true;
  for (const check of requiredChecks) {
    const mark = check.ok ? "\x1b[32m✔\x1b[0m" : "\x1b[31m✘\x1b[0m";
    console.log(`${mark} ${check.label} — ${check.detail}`);
    if (!check.ok) {
      requiredOk = false;
      console.log(`  fix: ${check.fix}`);
    }
  }

  console.log("\nAgents on PATH (informational):");
  for (const check of informationalChecks) {
    const mark = check.ok ? "\x1b[32m✔\x1b[0m" : "\x1b[33m✘\x1b[0m";
    console.log(`${mark} ${check.label} — ${check.detail}`);
    if (!check.ok) {
      console.log(`  fix: ${check.fix}`);
    }
  }

  return requiredOk ? 0 : 1;
}
