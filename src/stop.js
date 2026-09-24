/**
 * Wires the Stop hook together: config and session state from disk,
 * Laya classification, the decision, and the decision log.
 */

import { decide } from "./decide.js";
import { createLaya } from "./laya.js";
import { adactusHome, appendLog, readConfig, readSession, writeSession } from "./state.js";

/**
 * @param {object} input - Claude Code Stop hook stdin JSON
 * @param {{home?: string, env?: NodeJS.ProcessEnv}} [opts]
 * @returns {Promise<{decision: "block", reason: string}|null>} hook stdout, or null to allow the stop
 */
export async function classify(input, { home, env = process.env } = {}) {
  const root = home ?? adactusHome(env);
  const config = readConfig(root);
  if (env.ADACTUS_DISABLED === "1") config.enabled = false;

  const verdict = config.enabled
    ? await createLaya({ endpoint: env.LAYA_ENDPOINT ?? null }).classify(input.last_assistant_message ?? "")
    : { label: "normal", evidence: null, dangerous: false, backend: "none" };

  const session = readSession(root, input.session_id);
  const result = decide({ input, verdict, config, session });
  writeSession(root, input.session_id, result.session);

  appendLog(root, {
    at: new Date().toISOString(),
    session: input.session_id,
    cwd: input.cwd,
    outcome: result.outcome,
    label: verdict.label,
    evidence: verdict.evidence,
    backend: verdict.backend,
    streak: result.session.consecutiveBlocks,
  });

  if (!result.block) return null;
  const evidence = verdict.evidence ? ` (adactus saw: "${verdict.evidence}")` : "";
  return { decision: "block", reason: `${result.reason}${evidence}` };
}
