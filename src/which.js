/**
 * Resolve an agent command on PATH the way a shell would, on every
 * platform, and describe how node-pty must launch it.
 *
 * On Windows, npm-installed CLIs are usually `.cmd` shims. ConPTY cannot
 * execute a batch file directly, so those are launched through cmd.exe.
 */

import fs from "node:fs";
import path from "node:path";

const WINDOWS_DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

function isExecutable(candidate, platform) {
  try {
    // Windows has no execute bit: existence of a PATHEXT match is enough.
    fs.accessSync(candidate, platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function extensionsFor(command, platform, env) {
  if (platform !== "win32") return [""];
  if (path.extname(command)) return [""];
  const pathExt = env.PATHEXT || WINDOWS_DEFAULT_PATHEXT;
  return pathExt.split(";").filter(Boolean).map((ext) => ext.toLowerCase());
}

/**
 * @param {string} command - bare name ("claude") or a path
 * @param {{platform?: string, env?: NodeJS.ProcessEnv}} [opts]
 * @returns {string|null} absolute path of the executable, or null
 */
export function findExecutable(command, { platform = process.platform, env = process.env } = {}) {
  const extensions = extensionsFor(command, platform, env);
  const hasDir = command.includes("/") || (platform === "win32" && command.includes("\\"));
  const dirs = hasDir ? [""] : (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean);

  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = hasDir ? path.resolve(command + ext) : path.join(dir, command + ext);
      if (isExecutable(candidate, platform)) return candidate;
    }
  }
  return null;
}

/**
 * Build the node-pty spawn target for a resolved executable.
 * @param {string} executable - absolute path from findExecutable
 * @param {string[]} args
 * @param {{platform?: string, env?: NodeJS.ProcessEnv}} [opts]
 * @returns {{file: string, args: string[]}}
 */
export function spawnTarget(executable, args, { platform = process.platform, env = process.env } = {}) {
  if (platform === "win32" && /\.(cmd|bat)$/i.test(executable)) {
    // No "/s": cmd.exe would then strip the outer quotes of the whole
    // command line, which breaks quoted prompt arguments.
    return { file: env.ComSpec || "cmd.exe", args: ["/d", "/c", executable, ...args] };
  }
  return { file: executable, args };
}
