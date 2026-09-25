#!/usr/bin/env node
/**
 * Claude Code SessionStart hook: when the configured backend is a local
 * server adactus can start (Laya, decider) and it is not answering, start
 * it in the background so the Stop hook has a model to ask.
 */

import { resolveBackend } from "../src/backends.js";
import { ensureStarted, isHealthy } from "../src/servers.js";
import { adactusHome, readConfig } from "../src/state.js";

const home = adactusHome();
const config = readConfig(home);

if (config.enabled && config.backend?.name && process.env.ADACTUS_DISABLED !== "1") {
  const backend = resolveBackend(config.backend);
  if (backend.local && !(await isHealthy(backend.url))) {
    const { started, reason } = ensureStarted(backend, home);
    if (!started && !/already starting|does not start/.test(reason)) {
      process.stderr.write(`adactus: ${reason}\n`);
      process.exit(1);
    }
  }
}
