/**
 * The Stop hook decision, as a pure function of the hook input, the
 * classification and the stored state. No I/O here, so it is easy to test.
 */

import { LIMITS, REASONS } from "./config.js";

/**
 * @param {object} args
 * @param {{stop_hook_active?: boolean}} args.input - Stop hook stdin JSON
 * @param {{label: string, gaps?: string[], dangerous: boolean}} args.verdict - from judge.js
 * @param {{enabled: boolean, dryRun: boolean}} args.config
 * @param {{consecutiveBlocks: number, lastBlocked?: string|null}} args.session
 * @returns {{block: boolean, reason: string|null, outcome: string, session: {consecutiveBlocks: number, lastBlocked: string|null}}}
 */
export function decide({ input, verdict, config, session }) {
  // A stop that does not come from one of our own blocks starts a new chain.
  const streak = input.stop_hook_active ? session.consecutiveBlocks : 0;
  const allow = (outcome) => ({ block: false, reason: null, outcome, session: { consecutiveBlocks: 0, lastBlocked: null } });

  if (!config.enabled) return allow("disabled");
  if (verdict.label === "normal") return allow("normal");
  // Any push about a dangerous action stays with the user, whatever the label.
  if (verdict.dangerous) return allow("halt_danger");
  if (streak >= LIMITS.maxConsecutiveBlocks) return allow("halt_max_blocks");
  // Claude already answered one pushback in this chain; a repeated "done"
  // is an informed answer (for example: the rest is out of scope).
  if (verdict.label === "fake_completion" && streak > 0 && session.lastBlocked === "fake_completion") {
    return allow("trusted_after_pushback");
  }

  const reason = verdict.label === "fake_completion" ? REASONS.fake_completion(verdict.gaps ?? []) : REASONS[verdict.label];
  if (config.dryRun) {
    return { block: false, reason, outcome: `dry_run_${verdict.label}`, session: { consecutiveBlocks: streak + 1, lastBlocked: verdict.label } };
  }
  return { block: true, reason, outcome: `block_${verdict.label}`, session: { consecutiveBlocks: streak + 1, lastBlocked: verdict.label } };
}
