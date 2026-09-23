/**
 * Static configuration for adactus: per-agent command definitions, pattern
 * lists used by the classifier, and global thresholds that shape
 * supervision behavior (idle detection, cooldowns, safety limits).
 */

/**
 * @typedef {object} AgentConfig
 * @property {string} command - executable name resolved on PATH
 * @property {RegExp[]} lazyPausePatterns - phrases indicating the agent stopped and is waiting for confirmation
 * @property {RegExp[]} fakeCompletionPatterns - phrases claiming the task is done
 * @property {RegExp[]} saturationPatterns - phrases indicating the context window is filling up
 * @property {RegExp[]} dangerPatterns - phrases indicating a potentially destructive action is pending
 * @property {string} continueText - text injected to nudge the agent forward
 * @property {string} confirmText - text injected to answer a yes/no style prompt
 * @property {string} correctiveText - text injected when a fake completion is detected
 * @property {string} compactCommand - the agent's own slash command to trigger context compaction
 */

const lazyPausePatterns = [
  /do you want (me )?to (proceed|continue)/i,
  /shall i (continue|proceed)/i,
  /would you like me to/i,
  /\(y\/n\)/i,
  /\[y\/n\]/i,
  /press enter to continue/i,
  /waiting for (your )?(confirmation|input|approval)/i,
  /let me know (if|when) you'?d like me to (continue|proceed)/i,
];

const fakeCompletionPatterns = [
  /task (is )?(complete|done|finished)/i,
  /all (tasks|done|set|good)\b/i,
  /i'?ve (completed|finished|implemented) (the|this|everything)/i,
  /everything (is|looks) (working|done|ready|complete)/i,
  /implementation (is )?(complete|finished|done)/i,
  /ready for (review|production|deployment)/i,
];

const saturationPatterns = [
  /context (window )?(is )?(low|full|almost full|running out)/i,
  /context left until auto-compact:\s*\d+%/i,
  /auto-compact/i,
  /conversation too long/i,
  /running low on (context|tokens)/i,
  /approaching (the )?context limit/i,
];

const dangerPatterns = [
  /rm\s+-rf/i,
  /git push\s+(--force|-f)\b/i,
  /drop\s+(table|database)/i,
  /\bdeploy\b/i,
  /\bsudo\b/i,
  /chmod\s+777/i,
  /credential/i,
  /\btoken\b/i,
  /\bsecret\b/i,
  /permission escalation/i,
  /\bdelete\b/i,
];

export const AGENTS = {
  claude: {
    command: "claude",
    lazyPausePatterns,
    fakeCompletionPatterns,
    saturationPatterns,
    dangerPatterns,
    continueText: "Continue.",
    confirmText: "Yes, proceed.",
    correctiveText:
      "The task is incomplete. Inspect files and continue working until fully operational.",
    compactCommand: "/compact",
  },
  opencode: {
    command: "opencode",
    lazyPausePatterns,
    fakeCompletionPatterns,
    saturationPatterns,
    dangerPatterns,
    continueText: "Continue.",
    confirmText: "Yes, proceed.",
    correctiveText:
      "The task is incomplete. Inspect files and continue working until fully operational.",
    compactCommand: "/compact",
  },
  codex: {
    command: "codex",
    lazyPausePatterns,
    fakeCompletionPatterns,
    saturationPatterns,
    dangerPatterns,
    continueText: "Continue.",
    confirmText: "Yes, proceed.",
    correctiveText:
      "The task is incomplete. Inspect files and continue working until fully operational.",
    compactCommand: "/compact",
  },
};

export const THRESHOLDS = {
  idleMs: 1500,
  cooldownMs: 5000,
  maxInjections: 50,
  maxSameClass: 3,
  tailBytes: 8192,
  winnowThreshold: 0.1,
  // Delay between typing the injected text and pressing Enter. TUIs such as
  // Claude Code treat text + "\r" arriving in one chunk as a paste and do
  // not submit it.
  submitDelayMs: 150,
};
