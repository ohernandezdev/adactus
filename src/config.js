/**
 * Static configuration for adactus: the phrases the classifier looks for
 * in Claude's final message of a turn, the reasons fed back to Claude when
 * a stop is blocked, and the limits that keep the push bounded.
 */

/** Claude stops to ask permission for work that already follows from the task. */
export const lazyPausePatterns = [
  /shall\s+i\s+(continue|proceed|go\s+ahead|keep\s+going)/i,
  /should\s+i\s+(continue|proceed|go\s+ahead|keep\s+going)/i,
  /(do|would)\s+you\s+(want|like)\s+me\s+to\s+(continue|proceed|go\s+ahead|keep\s+going|finish|start)/i,
  /want\s+me\s+to\s+(continue|proceed|go\s+ahead|keep\s+going)/i,
  /let\s+me\s+know\s+(if|when)\s+you('d|\s+would)?\s+(like|want)\s+me\s+to\s+(continue|proceed|go\s+ahead)/i,
  /ready\s+to\s+(continue|proceed)\s+when(ever)?\s+you\s+are/i,
  /\((y\/n|yes\/no)\)\s*\??\s*$/im,
];

/** Claude claims the work is finished. */
export const completionClaimPatterns = [
  /task\s+(is\s+)?(now\s+)?(complete|done|finished)/i,
  /(implementation|feature|work)\s+(is\s+)?(now\s+)?(complete|finished|done)/i,
  /i('ve|\s+have)\s+(completed|finished|implemented)\s+(the|this|everything|all)/i,
  /everything\s+(is|looks)\s+(working|done|ready|complete)/i,
  /all\s+(tasks|done|set)\b/i,
  /ready\s+for\s+(review|production|deployment)/i,
];

/**
 * Evidence, in the same message, that the claimed-complete work is not.
 * A completion claim without any of these is trusted and the stop allowed.
 */
export const incompletenessPatterns = [
  /\bTODO\b|\bFIXME\b/,
  /not\s+(yet\s+)?implemented/i,
  /\b(placeholder|stub(bed)?)\b/i,
  /\b(remaining|outstanding)\s+(work|tasks?|items?|steps?)/i,
  /\bnext\s+steps?\b/i,
  /you('ll|\s+will)\s+(need|have)\s+to/i,
  /\btests?\s+(are\s+|is\s+)?(still\s+)?failing\b|\b[1-9]\d*\s+(tests?\s+)?fail(ed|ing|ures?)\b/i,
  /\b(couldn't|could\s+not|unable\s+to|wasn't\s+able\s+to)\b/i,
  /\b(skipped|left\s+out|not\s+(yet\s+)?(done|finished|wired))\b/i,
];

/** A pause that asks about one of these stays with the user. */
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
// say so, or Claude reasonably keeps waiting for a human reply.
const PREFIX = "adactus (a Stop hook the user installed to answer check-ins on their behalf): ";

export const REASONS = {
  lazy_pause:
    `${PREFIX}Continue. Do not ask for confirmation for steps that follow from the task. ` +
    "Work autonomously and only stop when the task is fully done or you need a decision only the user can make.",
  fake_completion:
    `${PREFIX}The task is incomplete. Inspect files and continue working until fully operational.`,
};

export const LIMITS = {
  // Consecutive blocks within one stop chain. Claude Code overrides a Stop
  // hook itself after 8; adactus hands control back well before that.
  maxConsecutiveBlocks: 3,
  // Only the end of the final message matters: that is where Claude asks.
  tailChars: 1200,
  remoteTimeoutMs: 2000,
};
