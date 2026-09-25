/**
 * Wires the Stop hook together: config and session state from disk, the
 * System One judgment, the decision, and the decision log.
 */

import { resolveBackend } from "./backends.js";
import { decide } from "./decide.js";
import { judge } from "./judge.js";
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
  const base = { at: new Date().toISOString(), session: input.session_id, cwd: input.cwd };

  if (!config.enabled) {
    appendLog(root, { ...base, outcome: "disabled" });
    writeSession(root, input.session_id, { consecutiveBlocks: 0, lastBlocked: null });
    return null;
  }

  let verdict;
  let backend;
  try {
    backend = resolveBackend(config.backend, env);
    verdict = await judge(backend, input.last_assistant_message ?? "", { ...backend.thresholds, ...config.thresholds });
  } catch (err) {
    // No fallback: the stop goes through and the failure is visible.
    appendLog(root, { ...base, outcome: "error", error: err.message });
    writeSession(root, input.session_id, { consecutiveBlocks: 0, lastBlocked: null });
    throw err;
  }

  const session = readSession(root, input.session_id);
  const result = decide({ input, verdict, config, session });
  writeSession(root, input.session_id, result.session);
  appendLog(root, {
    ...base,
    outcome: result.outcome,
    label: verdict.label,
    backend: backend.name,
    model: verdict.model,
    ms: verdict.ms,
    usage: verdict.usage,
    evidence: verdict.evidence,
    streak: result.session.consecutiveBlocks,
  });

  if (!result.block) return null;
  return { decision: "block", reason: result.reason };
}
