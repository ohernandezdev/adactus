/**
 * Winnow: compaction support. adactus cannot edit the wrapped agent's
 * internal context window — that memory lives entirely inside the agent
 * process and is opaque to us. Winnow only shapes the TEXT of the
 * /compact instruction we inject into the agent's stdin, picking which
 * lines from our own observed tail are worth asking the agent to
 * preserve. Nothing here touches the agent's actual context state.
 */

const MAX_COMMAND_CHARS = 2000;

const TOOL_MARKERS = ["⏺", "●", "$ ", "Bash(", "Read("];

/**
 * Split text into blocks separated by blank lines or the start of a
 * recognizable tool-call marker line.
 * @param {string} text
 * @returns {string[]}
 */
export function splitBlocks(text) {
  const lines = text.split("\n");
  const blocks = [];
  let current = [];

  const startsNewBlock = (line) => TOOL_MARKERS.some((marker) => line.startsWith(marker));

  for (const line of lines) {
    if (line.trim() === "") {
      if (current.length > 0) {
        blocks.push(current.join("\n"));
        current = [];
      }
      continue;
    }
    if (startsNewBlock(line) && current.length > 0) {
      blocks.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) {
    blocks.push(current.join("\n"));
  }
  return blocks.filter((b) => b.trim() !== "");
}

const ERROR_RE = /(error|failed|✗|exception|traceback|stack trace)/i;
const TEST_SUMMARY_RE = /(\d+\s+(passed|passing|failed|failing))|(\bpass\b.*\bfail\b)/i;
const DIFF_RE = /^[+-][^+-]|^@@ .* @@/m;
const FILE_PATH_RE = /(\/[\w.-]+)+\.\w+/;
const LISTING_HEADER_RE = /^(Read\(|Bash\(|Listing|Directory of|ls\b)/i;

/**
 * Extract file paths referenced in a block (best-effort, used to detect
 * superseded reads/listings of the same path later in the tail).
 * @param {string} block
 * @returns {string[]}
 */
function extractPaths(block) {
  const matches = block.match(/(\/[\w.-]+)+\.\w+/g);
  return matches ? [...new Set(matches)] : [];
}

/**
 * Score a block's keep-probability using the whole text as context, to
 * detect superseded reads/listings (same path appears again later).
 * @param {string} block
 * @param {{fullText: string, allBlocks: string[], index: number}} context
 * @returns {number}
 */
export function scoreBlock(block, context) {
  let score = 0.3; // baseline

  if (ERROR_RE.test(block)) score += 0.4;
  if (TEST_SUMMARY_RE.test(block)) score += 0.3;
  if (DIFF_RE.test(block)) score += 0.3;
  if (FILE_PATH_RE.test(block)) score += 0.1;

  // Superseded content: a listing/read whose path reappears in a later block.
  const isListing = LISTING_HEADER_RE.test(block.trim());
  const paths = extractPaths(block);
  if (isListing && paths.length > 0 && context?.allBlocks) {
    const laterBlocks = context.allBlocks.slice(context.index + 1);
    const supersededElsewhere = laterBlocks.some((later) =>
      paths.some((p) => later.includes(p)),
    );
    if (supersededElsewhere) score -= 0.5;
  }

  // Identical repeated blocks: drop all but the last occurrence.
  if (context?.allBlocks) {
    const laterBlocks = context.allBlocks.slice(context.index + 1);
    if (laterBlocks.includes(block)) score -= 0.4;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Split, score, and filter text into kept/dropped blocks.
 * @param {string} text
 * @param {number} threshold - minimum keepProbability to retain a block
 * @returns {{kept: string[], dropped: string[]}}
 */
export function winnow(text, threshold) {
  const allBlocks = splitBlocks(text);
  const kept = [];
  const dropped = [];

  allBlocks.forEach((block, index) => {
    const keepProbability = scoreBlock(block, { fullText: text, allBlocks, index });
    if (keepProbability >= threshold) {
      kept.push(block);
    } else {
      dropped.push(block);
    }
  });

  return { kept, dropped };
}

/**
 * Build the /compact injection string: the agent's compact command plus
 * an instruction to preserve the kept lines verbatim, capped at
 * MAX_COMMAND_CHARS total, truncating whole lines (lowest-value/oldest
 * first) rather than cutting mid-line.
 * @param {import('./config.js').AgentConfig} agentCfg
 * @param {string[]} keptLines
 * @returns {string}
 */
export function buildCompactCommand(agentCfg, keptLines) {
  const prefix = `${agentCfg.compactCommand} Preserve verbatim:\n`;
  let body = keptLines.join("\n");
  let command = prefix + body;

  if (command.length <= MAX_COMMAND_CHARS) {
    return command;
  }

  // Truncate by dropping oldest (earliest) lines first, never mid-line.
  const lines = [...keptLines];
  while (lines.length > 0) {
    lines.shift();
    body = lines.join("\n");
    command = prefix + body;
    if (command.length <= MAX_COMMAND_CHARS) {
      return command;
    }
  }

  // Nothing left fits; hard-cap the prefix itself as a last resort.
  return prefix.slice(0, MAX_COMMAND_CHARS);
}
