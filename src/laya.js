/**
 * Laya: the classification layer. Given the current (stripped) PTY tail,
 * decides which of the four supervision states the agent is in:
 * normal_running | lazy_pause | fake_completion | context_saturated.
 *
 * Two backends:
 *  - heuristic (default): a deterministic weighted pattern scorer, no network.
 *  - remote: an optional HTTP classifier reachable only on localhost, used
 *    when LAYA_ENDPOINT is set. Any failure raises LayaError instead of
 *    silently degrading to the heuristic backend.
 */

import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { AGENTS } from "./config.js";

const LABELS = [
  "normal_running",
  "lazy_pause",
  "fake_completion",
  "context_saturated",
];

const MIN_CONFIDENCE = 0.15;
const REMOTE_TIMEOUT_MS = 2000;

/** Error thrown when the remote Laya backend fails, times out, or replies invalidly. */
export class LayaError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "LayaError";
  }
}

function isLocalHost(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

/**
 * Score a class's patterns against the tail, weighting hits by how close
 * to the end of the tail they occur (recency bias): later lines score
 * closer to 1.0, earlier lines closer to a small floor weight.
 * @param {RegExp[]} patterns
 * @param {string[]} lines
 * @returns {number}
 */
function scoreClass(patterns, lines) {
  if (lines.length === 0 || patterns.length === 0) return 0;
  let score = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    // Recency weight: 0.2 (oldest) .. 1.0 (newest)
    const recency = 0.2 + (0.8 * i) / Math.max(1, lines.length - 1);
    for (const pattern of patterns) {
      if (pattern.test(line)) {
        score += recency;
      }
    }
  }
  return score;
}

/**
 * Deterministic heuristic classifier: single pass over the tail split into
 * lines, scores each class by weighted pattern hits, then normalizes into
 * a confidence value. Falls back to normal_running below MIN_CONFIDENCE.
 * @param {string} tail
 * @param {import('./config.js').AgentConfig} agentCfg
 * @returns {{label: string, confidence: number, backend: string}}
 */
function heuristicClassify(tail, agentCfg) {
  const lines = tail.split("\n");
  const scores = {
    lazy_pause: scoreClass(agentCfg.lazyPausePatterns, lines),
    fake_completion: scoreClass(agentCfg.fakeCompletionPatterns, lines),
    context_saturated: scoreClass(agentCfg.saturationPatterns, lines),
  };

  const total = scores.lazy_pause + scores.fake_completion + scores.context_saturated;
  if (total === 0) {
    return { label: "normal_running", confidence: 1, backend: "heuristic" };
  }

  let bestLabel = "normal_running";
  let bestScore = 0;
  for (const [label, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestLabel = label;
    }
  }

  const confidence = bestScore / total;
  if (confidence < MIN_CONFIDENCE) {
    return { label: "normal_running", confidence: 1 - confidence, backend: "heuristic" };
  }
  return { label: bestLabel, confidence, backend: "heuristic" };
}

/**
 * POST the tail to the configured remote endpoint and await a JSON verdict.
 * @param {string} endpoint
 * @param {string} tail
 * @param {string} agent
 * @returns {Promise<{label: string, confidence: number}>}
 */
function remoteClassify(endpoint, tail, agent) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(endpoint);
    } catch (err) {
      reject(new LayaError(`Invalid LAYA_ENDPOINT URL: ${endpoint}`, { cause: err }));
      return;
    }

    const transport = url.protocol === "https:" ? https : http;
    const payload = JSON.stringify({ tail, agent });

    const req = transport.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: REMOTE_TIMEOUT_MS,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new LayaError(`Laya endpoint returned status ${res.statusCode}`));
            return;
          }
          let parsed;
          try {
            parsed = JSON.parse(body);
          } catch (err) {
            reject(new LayaError("Laya endpoint returned invalid JSON", { cause: err }));
            return;
          }
          if (!LABELS.includes(parsed.label)) {
            reject(new LayaError(`Laya endpoint returned invalid label: ${parsed.label}`));
            return;
          }
          resolve({
            label: parsed.label,
            confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
          });
        });
      },
    );

    req.on("timeout", () => {
      req.destroy(new LayaError(`Laya endpoint timed out after ${REMOTE_TIMEOUT_MS}ms`));
    });
    req.on("error", (err) => {
      if (err instanceof LayaError) {
        reject(err);
        return;
      }
      reject(new LayaError(`Laya endpoint request failed: ${err.message}`, { cause: err }));
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Create a Laya classifier bound to a given agent config.
 * @param {object} opts
 * @param {string} opts.agent - agent key (e.g. "claude")
 * @param {string} [opts.endpoint] - optional remote classifier URL; defaults to process.env.LAYA_ENDPOINT
 * @returns {{classify: (tail: string) => Promise<{label: string, confidence: number, backend: string}>}}
 */
export function createLaya({ agent, endpoint } = {}) {
  const agentCfg = AGENTS[agent];
  if (!agentCfg) {
    throw new Error(`Unknown agent for Laya classifier: ${agent}`);
  }

  const resolvedEndpoint = endpoint ?? process.env.LAYA_ENDPOINT ?? null;

  if (resolvedEndpoint) {
    let url;
    try {
      url = new URL(resolvedEndpoint);
    } catch (err) {
      throw new LayaError(`Invalid LAYA_ENDPOINT URL: ${resolvedEndpoint}`, { cause: err });
    }
    if (!isLocalHost(url.hostname)) {
      throw new LayaError(
        `LAYA_ENDPOINT must point to localhost/127.0.0.1/::1, got: ${url.hostname}`,
      );
    }
  }

  return {
    async classify(tail) {
      if (resolvedEndpoint) {
        const { label, confidence } = await remoteClassify(resolvedEndpoint, tail, agent);
        return { label, confidence, backend: "remote" };
      }
      return heuristicClassify(tail, agentCfg);
    },
  };
}
