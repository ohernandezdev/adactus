/**
 * Static configuration for adactus: the hard danger guard, the reasons fed
 * back to Claude when a stop is blocked, and the limits that keep the push
 * bounded. Classification itself is done by a System One model.
 */

/**
 * Hard guard, applied on top of the model's own danger judgment: a pause
 * that mentions one of these always stays with the user.
 */
export const dangerPatterns = [
  /rm\s+-rf/i,
  /git\s+push\s+(--force|-f)\b/i,
  /\bforce[-\s]push/i,
  /drop\s+(table|database)/i,
  /\b(deploy|deployment|release|publish)\b/i,
  /\bsudo\b/i,
  /chmod\s+777/i,
  /\b(credentials?|secrets?|api\s+keys?|tokens?|passwords?)\b/i,
  /\bpermissions?\s+escalation\b/i,
  /\b(delete|remove|wipe|truncate)\b/i,
  /\b(migration|production|prod)\b/i,
];

// The user installed adactus to answer these check-ins on their behalf;
// say so, or Claude reasonably keeps waiting for a human reply. Claude Code
// labels every blocking Stop hook "Stop hook error"; the prefix says it is not one.
const PREFIX = "adactus (not an error: a Stop hook the user installed to answer check-ins on their behalf): ";

export const REASONS = {
  lazy_pause:
    `${PREFIX}Continue. Do not ask for confirmation for steps that follow from the task. ` +
    "Work autonomously and only stop when the task is fully done or you need a decision only the user can make.",
  // gaps: what the model saw in the message, e.g. ["failing tests or unfixed errors"]
  fake_completion: (gaps) =>
    `${PREFIX}The task is incomplete: your last message says it is done but also mentions ${gaps.join(" and ")}. ` +
    "Inspect files and continue working until fully operational. " +
    "If that remaining work is outside the task you were given, say so and stop.",
};

export const LIMITS = {
  // Consecutive blocks within one stop chain. Claude Code overrides a Stop
  // hook itself after 8; adactus hands control back well before that.
  maxConsecutiveBlocks: 3,
  // Only the end of the final message matters: that is where Claude asks.
  messageChars: 2000,
  // Policy thresholds on the System One answers (probabilities 0..1).
  // Tuned on Laya with eval/cases.json; override per backend in config.
  continueMin: 0.7, // asks whether to continue (precision over recall)
  userDecisionMax: 0.5, // at or above: a question only the user can answer
  claimMin: 0.5, // says the task is done
  unfinishedMin: 0.3, // strongest unfinished-work signal
  dangerMin: 0.5, // proposes a destructive or outward-facing action
  // The hook itself has a 10s budget in hooks/hooks.json.
  localTimeoutMs: 4000,
  remoteTimeoutMs: 7000,
};
