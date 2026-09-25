#!/usr/bin/env node
/**
 * Claude Code SessionStart hook: when the configured backend is Laya and
 * its local server is not answering, start it in the background so the
 * Stop hook has a model to ask. Other backends are left alone.
 */

import { resolveBackend } from "../src/backends.js";
import { hasUv, isHealthy, startDetached } from "../src/laya-server.js";
import { adactusHome, readConfig } from "../src/state.js";

const home = adactusHome();
const config = readConfig(home);

if (config.enabled && config.backend?.name === "laya" && process.env.ADACTUS_DISABLED !== "1") {
  const backend = resolveBackend(config.backend);
  if (!(await isHealthy(backend.url))) {
    if (!hasUv()) {
      process.stderr.write("adactus: the Laya backend needs uv (https://docs.astral.sh/uv/) to start its server\n");
      process.exit(1);
    }
    startDetached(backend, home);
  }
}
