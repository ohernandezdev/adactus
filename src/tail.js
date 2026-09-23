/**
 * Bounded tail buffer for PTY output, plus an ANSI-stripping utility used
 * to produce a plain-text copy for classification. The raw buffer always
 * keeps the original bytes/string so passthrough to the real terminal
 * stays intact.
 */

function cursorPositionRe() {
  return /\x1b\[(\d*)(?:;\d*)?[Hf]/g;
}

/**
 * Absolute cursor positioning (CUP, "ESC[row;colH"): a jump within the same
 * row separates words, a jump to another row starts a new line.
 */
function cursorPositionToWhitespace() {
  let lastRow = null;
  return (_match, row) => {
    const current = row === "" ? "1" : row;
    const sameRow = current === lastRow;
    lastRow = current;
    return sameRow ? " " : "\n";
  };
}

/**
 * Strip common ANSI/VT escape sequences from a string: CSI sequences
 * (cursor movement, colors, erase), OSC sequences (window title, hyperlinks),
 * and a handful of other single/two-character escapes.
 * @param {string} str
 * @returns {string}
 */
export function stripAnsi(str) {
  if (!str) return "";
  return (
    str
      // OSC sequences: ESC ] ... (BEL or ESC \)
      .replace(/\x1b\][\s\S]*?(\x07|\x1b\\)/g, "")
      // TUIs such as Claude Code lay text out with cursor moves instead of
      // spaces and newlines. Horizontal moves (CHA "G", CUF "C") become a
      // space, vertical moves ("A", "B") become a newline, and absolute
      // positioning ("H", "f") becomes a space or a newline depending on
      // whether the row changed, so words stay separated for classification.
      .replace(/\x1b\[[0-9;]*[GC]/g, " ")
      .replace(/\x1b\[[0-9]*[AB]/g, "\n")
      .replace(cursorPositionRe(), cursorPositionToWhitespace())
      // Remaining CSI sequences: ESC [ ... final byte in @-~
      .replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]/g, "")
      // Character set designation: ESC ( B, ESC ) 0 and similar
      .replace(/\x1b[()*+][0-9A-Za-z]/g, "")
      // Other two-byte escapes: ESC followed by a single char in @-Z or a-z
      .replace(/\x1b[@-Z\\-_]/g, "")
      // Lone carriage returns used for redraws
      .replace(/\r(?!\n)/g, "")
      // Remaining C0 control bytes (SI/SO, BEL, ...) except tab and newline
      .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
  );
}

export class TailBuffer {
  /**
   * @param {number} size - maximum number of characters retained
   */
  constructor(size) {
    this.size = size;
    this.buffer = "";
  }

  /**
   * Append a chunk of raw output, trimming from the front once the
   * buffer exceeds its configured size.
   * @param {string} chunk
   */
  push(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > this.size) {
      this.buffer = this.buffer.slice(this.buffer.length - this.size);
    }
  }

  /**
   * @returns {string} the current raw tail content
   */
  getTail() {
    return this.buffer;
  }

  /**
   * @returns {string} the current tail content with ANSI sequences removed
   */
  getStrippedTail() {
    return stripAnsi(this.buffer);
  }

  clear() {
    this.buffer = "";
  }
}
