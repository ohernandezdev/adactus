/**
 * Logger: writes tagged, colored diagnostic lines to stderr. Lines are
 * queued rather than written immediately, so the supervisor can flush()
 * them only while the wrapped agent is idle — this keeps adactus output
 * from interleaving mid-stream with the agent's live TUI redraws.
 */

const COLORS = {
  reset: "\x1b[0m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
};

const TAGS = {
  latigo: { text: "⚡ [ADACTUS] [LATIGO]", color: COLORS.yellow },
  winnow: { text: "🛡️ [ADACTUS] [WINNOW-SIEVING]", color: COLORS.cyan },
  laya: { text: "🧠 [ADACTUS] [LAYA]", color: COLORS.magenta },
  halt: { text: "⛔ [ADACTUS] [HALT]", color: COLORS.red },
};

export function createLogger({ verbose = false, stream = process.stderr } = {}) {
  const queue = [];

  function enqueue(kind, message, always = false) {
    if (kind === "laya" && !verbose && !always) return;
    const tag = TAGS[kind];
    queue.push(`\r\n${tag.color}${tag.text}${COLORS.reset} ${message}`);
  }

  return {
    latigo: (message) => enqueue("latigo", message),
    winnow: (message) => enqueue("winnow", message),
    laya: (message) => enqueue("laya", message),
    /** Laya errors are always shown, even without --verbose. */
    layaError: (message) => enqueue("laya", message, true),
    halt: (message) => enqueue("halt", message),
    /** Write all queued lines to the stream now and clear the queue. */
    flush() {
      if (queue.length === 0) return;
      stream.write(queue.join(""));
      queue.length = 0;
    },
    /** @returns {number} number of lines currently queued, unflushed */
    pending() {
      return queue.length;
    },
  };
}
