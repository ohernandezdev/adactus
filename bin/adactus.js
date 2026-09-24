#!/usr/bin/env node
/**
 * adactus CLI: toggles the Stop hook and shows its recent decisions.
 * Used by the /adactus:on, /adactus:off and /adactus:status skills.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adactusHome, readConfig, readLog, writeConfig } from "../src/state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));

const USAGE = `adactus <command>

Commands:
  on               enable the Stop hook
  off              disable the Stop hook (every stop goes through)
  dry-run on|off   log decisions without blocking any stop
  status           show the current mode and the last decisions
  --version        print the version
`;

function status(home) {
  const config = readConfig(home);
  const mode = !config.enabled ? "off" : config.dryRun ? "on (dry-run: logging only)" : "on";
  const lines = [`adactus ${pkg.version}: ${mode}`];
  if (process.env.ADACTUS_DISABLED === "1") lines.push("ADACTUS_DISABLED=1 is set: the hook is off in this environment.");
  const log = readLog(home, 10);
  lines.push(log.length ? "Recent decisions:" : "No decisions logged yet.");
  for (const entry of log) {
    const evidence = entry.evidence ? ` "${entry.evidence}"` : "";
    lines.push(`  ${entry.at}  ${entry.outcome}${evidence}  (${path.basename(entry.cwd ?? "")})`);
  }
  return lines.join("\n");
}

const [command, arg] = process.argv.slice(2);
const home = adactusHome();

switch (command) {
  case "on":
    writeConfig(home, { enabled: true });
    console.log("adactus is on.");
    break;
  case "off":
    writeConfig(home, { enabled: false });
    console.log("adactus is off: every stop goes through.");
    break;
  case "dry-run":
    if (arg !== "on" && arg !== "off") {
      process.stderr.write("usage: adactus dry-run on|off\n");
      process.exit(2);
    }
    writeConfig(home, { dryRun: arg === "on" });
    console.log(`adactus dry-run is ${arg}.`);
    break;
  case "status":
    console.log(status(home));
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
    process.stderr.write(`adactus: unknown command "${command}"\n\n${USAGE}`);
    process.exit(2);
}
