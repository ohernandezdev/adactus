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
  /do\s+you\s+want\s+(me\s+)?to\s+(proceed|continue)/i,
  /shall\s+i\s+(continue|proceed)/i,
  /would\s+you\s+like\s+me\s+to/i,
  /\(y\/n\)/i,
  /\[y\/n\]/i,
  /press\s+enter\s+to\s+continue/i,
  /waiting\s+for\s+(your\s+)?(confirmation|input|approval)/i,
  /let\s+me\s+know\s+(if|when)\s+you'?d\s+like\s+me\s+to\s+(continue|proceed)/i,
];

const fakeCompletionPatterns = [
  /task\s+(is\s+)?(complete|done|finished)/i,
  /all\s+(tasks|done|set|good)\b/i,
  /i'?ve\s+(completed|finished|implemented)\s+(the|this|everything)/i,
  /everything\s+(is|looks)\s+(working|done|ready|complete)/i,
  /implementation\s+(is\s+)?(complete|finished|done)/i,
  /ready\s+for\s+(review|production|deployment)/i,
];

const saturationPatterns = [
  /context\s+(window\s+)?(is\s+)?(low|full|almost\s+full|running\s+out)/i,
  /context\s+left\s+until\s+auto-compact:\s*\d+%/i,
  /auto-compact/i,
  /conversation\s+too\s+long/i,
  /running\s+low\s+on\s+(context|tokens)/i,
  /approaching\s+(the\s+)?context\s+limit/i,
];

const dangerPatterns = [
  /rm\s+-rf/i,
  /git\s+push\s+(--force|-f)\b/i,
  /drop\s+(table|database)/i,
  /\bdeploy\b/i,
  /\bsudo\b/i,
  /chmod\s+777/i,
  /credential/i,
  /\btoken\b/i,
  /\bsecret\b/i,
  /permission\s+escalation/i,
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
