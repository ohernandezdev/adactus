/**
 * The supervisor: watches PTY output, waits for idle silence, classifies
 * the tail via Laya, and injects text into the agent's stdin when it
 * looks stalled, falsely "done", or saturated on context.
 *
 * Timers: the supervisor takes a `clock` object ({ setTimeout, clearTimeout,
 * now }) instead of calling global timer functions directly, and every
 * scheduling call goes through it. The default clock forwards to the real
 * global functions at call time (not captured at import time), so tests
 * can either inject a fully fake clock or use node:test's `mock.timers`,
 * which patches the same globals this default clock reads from.
 *
 * "New output since last injection" bookkeeping (used by the maxSameClass
 * guard): after an injection we snapshot the stripped tail length and the
 * length of the text we just wrote (its pty echo). On the next idle cycle
 * we treat the tail as having grown only from echo if its growth doesn't
 * exceed that snapshot length plus a small margin. onUserInput also marks
 * "new activity" directly (not just via tail growth) — this covers
 * environments where local echo is disabled and typed input never shows
 * up in the captured output stream, in which case tail growth alone would
 * under-count real interaction.
 */

import { winnow, buildCompactCommand } from "./winnow.js";
import { TailBuffer } from "./tail.js";
import { LayaError } from "./laya.js";

const ECHO_MARGIN = 8;
const CTRL_RIGHT_BRACKET = 0x1d;

const YES_NO_RE = /\(y\/n\)|\[y\/n\]/i;

function defaultClock() {
  return {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    now: () => Date.now(),
  };
}

function endsWithYesNoPrompt(strippedTail) {
  const lines = strippedTail.split("\n").filter((l) => l.trim() !== "");
  const lastLines = lines.slice(-3).join("\n");
  return YES_NO_RE.test(lastLines);
}

/**
 * @param {object} opts
 * @param {import('./config.js').AgentConfig} opts.agentCfg
 * @param {typeof import('./config.js').THRESHOLDS} opts.thresholds
 * @param {{classify: (tail: string) => Promise<{label: string, confidence: number, backend: string}>}} opts.laya
 * @param {(text: string) => void} opts.write - writes to the pty stdin
 * @param {ReturnType<typeof import('./logger.js').createLogger>} opts.logger
 * @param {{dryRun?: boolean, noLatigo?: boolean, noCompact?: boolean, verbose?: boolean}} opts.flags
 * @param {{setTimeout: Function, clearTimeout: Function, now: Function}} [opts.clock]
 */
export function createSupervisor({ agentCfg, thresholds, laya, write, logger, flags, clock }) {
  const timer = clock ?? defaultClock();
  const tailBuffer = new TailBuffer(thresholds.tailBytes);

  let idleTimerId = null;
  let enabled = true;
  let paused = false;
  let halted = false;
  let permanentlyHalted = false;

  let lastInjectionTime = -Infinity;
  let injectionCount = 0;
  let lastInjectedClass = null;
  let sameClassStreak = 0;
  let lastInjectionTailSnapshot = null;
  let lastInjectionTextLength = 0;
  let userActivitySinceLastInjection = false;

  function hadNewOutputSinceLastInjection(strippedTail) {
    if (lastInjectionTailSnapshot === null) return true;
    const grown = strippedTail.length - lastInjectionTailSnapshot;
    const grewBeyondEcho = grown > lastInjectionTextLength + ECHO_MARGIN;
    return grewBeyondEcho || userActivitySinceLastInjection;
  }

  function recordInjection(label, text, now) {
    lastInjectionTime = now;
    injectionCount += 1;
    const grewBeyondEcho = hadNewOutputSinceLastInjection(tailBuffer.getStrippedTail());
    sameClassStreak = label === lastInjectedClass && !grewBeyondEcho ? sameClassStreak + 1 : 1;
    lastInjectedClass = label;
    // Forget the output we already reacted to, so the same stale prompt
    // text cannot trigger the next classification.
    tailBuffer.clear();
    lastInjectionTailSnapshot = 0;
    lastInjectionTextLength = text.length + 1;
    userActivitySinceLastInjection = false;
  }

  function buildInjectionText(label, strippedTail) {
    if (label === "lazy_pause") {
      if (flags.noLatigo) return null;
      return endsWithYesNoPrompt(strippedTail) ? agentCfg.confirmText : agentCfg.continueText;
    }
    if (label === "fake_completion") {
      if (flags.noLatigo) return null;
      return agentCfg.correctiveText;
    }
    if (label === "context_saturated") {
      if (flags.noCompact) return null;
      const { kept } = winnow(strippedTail, thresholds.winnowThreshold);
      const text = buildCompactCommand(agentCfg, kept);
      logger.winnow(`compacting context: kept ${kept.length} block(s), dropped rest`);
      return text;
    }
    return null;
  }

  async function handleIdle() {
    idleTimerId = null;

    if (!enabled || paused || permanentlyHalted || halted) {
      logger.flush();
      return;
    }

    const strippedTail = tailBuffer.getStrippedTail();
    let result;
    try {
      result = await laya.classify(strippedTail);
    } catch (err) {
      if (err instanceof LayaError) {
        logger.layaError(
          `classification failed, pausing supervision (Ctrl+] twice to resume): ${err.message}`,
        );
        logger.flush();
        paused = true;
        return;
      }
      logger.flush();
      throw err;
    }

    const { label, confidence, backend } = result;
    if (flags.verbose) {
      logger.laya(`label=${label} confidence=${confidence.toFixed(2)} backend=${backend}`);
    }

    if (label === "normal_running") {
      logger.flush();
      return;
    }

    const dangerZone = strippedTail.split("\n").slice(-20).join("\n");
    const dangerMatch = agentCfg.dangerPatterns.some((pattern) => pattern.test(dangerZone));
    if (dangerMatch && label === "lazy_pause") {
      halted = true;
      logger.halt(
        "Potential destructive action pending confirmation — halting, review manually.",
      );
      logger.flush();
      return;
    }

    const now = timer.now();
    if (now - lastInjectionTime < thresholds.cooldownMs) {
      logger.flush();
      return;
    }

    if (injectionCount >= thresholds.maxInjections) {
      halted = true;
      permanentlyHalted = true;
      logger.halt(`Reached maxInjections (${thresholds.maxInjections}) — halting permanently.`);
      logger.flush();
      return;
    }

    const text = buildInjectionText(label, strippedTail);
    if (!text) {
      logger.flush();
      return;
    }

    const grewBeyondEcho = hadNewOutputSinceLastInjection(strippedTail);
    const prospectiveStreak =
      label === lastInjectedClass && !grewBeyondEcho ? sameClassStreak + 1 : 1;
    if (prospectiveStreak > thresholds.maxSameClass) {
      halted = true;
      logger.halt(
        `Same classification (${label}) repeated ${prospectiveStreak} times with no new output — halting.`,
      );
      logger.flush();
      return;
    }

    if (flags.dryRun) {
      logger.latigo(`would inject (${label}): ${text}`);
    } else {
      write(text);
      timer.setTimeout(() => write("\r"), thresholds.submitDelayMs);
      logger.latigo(`injected (${label}): ${text}`);
    }
    recordInjection(label, text, now);

    logger.flush();
  }

  return {
    onOutput(chunk) {
      tailBuffer.push(chunk);
      if (idleTimerId !== null) {
        timer.clearTimeout(idleTimerId);
      }
      idleTimerId = timer.setTimeout(() => {
        handleIdle().catch((err) => {
          // Programming errors during classification should not crash the
          // wrapped agent's PTY session; surface them and keep running.
          logger.layaError(`unexpected classification error: ${err.message}`);
          logger.flush();
        });
      }, thresholds.idleMs);
    },

    onUserInput(data) {
      if (data.length === 1 && data[0] === CTRL_RIGHT_BRACKET) return;
      halted = false;
      userActivitySinceLastInjection = true;
    },

    setEnabled(value) {
      enabled = value;
      if (value) {
        // Re-enabling is an explicit user decision: resume after a Laya
        // error or a same-class halt. A maxInjections halt stays permanent.
        paused = false;
        halted = false;
      }
    },

    isEnabled() {
      return enabled;
    },

    isPaused() {
      return paused;
    },

    isHalted() {
      return halted || permanentlyHalted;
    },

    getInjectionCount() {
      return injectionCount;
    },
  };
}
