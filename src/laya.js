/**
 * Laya: classifies Claude's final message of a turn into one of
 * normal | lazy_pause | fake_completion.
 *
 * Two backends:
 *  - heuristic (default): deterministic pattern matching, no network.
 *  - remote: an optional HTTP classifier on localhost, used when
 *    LAYA_ENDPOINT is set. Any failure raises LayaError; adactus never
 *    silently switches to the heuristic.
 */

import http from "node:http";
import {
  completionClaimPatterns,
  dangerPatterns,
  incompletenessPatterns,
  lazyPausePatterns,
  LIMITS,
} from "./config.js";

export const LABELS = ["normal", "lazy_pause", "fake_completion"];

export class LayaError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "LayaError";
  }
}

const firstMatch = (patterns, text) => {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
};

/**
 * @param {string} message - Claude's final message of the turn
 * @returns {{label: string, evidence: string|null, dangerous: boolean, backend: string}}
 */
export function classifyHeuristic(message) {
  const text = (message ?? "").slice(-LIMITS.tailChars);
  const dangerous = firstMatch(dangerPatterns, text) !== null;

  const pause = firstMatch(lazyPausePatterns, text);
  if (pause) return { label: "lazy_pause", evidence: pause, dangerous, backend: "heuristic" };

  // Search the whole message for incompleteness: it is usually listed
  // above the final "done" line.
  const claim = firstMatch(completionClaimPatterns, message ?? "");
  const gap = claim ? firstMatch(incompletenessPatterns, message ?? "") : null;
  if (claim && gap) return { label: "fake_completion", evidence: gap, dangerous, backend: "heuristic" };

  return { label: "normal", evidence: null, dangerous, backend: "heuristic" };
}

function isLocalHost(hostname) {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
}

/**
 * @param {string} endpoint
 * @param {string} message
 * @returns {Promise<{label: string, evidence: string|null, dangerous: boolean, backend: string}>}
 */
function classifyRemote(endpoint, message) {
  const url = new URL(endpoint);
  const payload = JSON.stringify({ message });
  const dangerous = firstMatch(dangerPatterns, (message ?? "").slice(-LIMITS.tailChars)) !== null;

  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
        timeout: LIMITS.remoteTimeoutMs,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
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
          resolve({ label: parsed.label, evidence: parsed.evidence ?? null, dangerous, backend: "remote" });
        });
      },
    );
    req.on("timeout", () => req.destroy(new LayaError(`Laya endpoint timed out after ${LIMITS.remoteTimeoutMs}ms`)));
    req.on("error", (err) =>
      reject(err instanceof LayaError ? err : new LayaError(`Laya endpoint request failed: ${err.message}`, { cause: err })),
    );
    req.end(payload);
  });
}

/**
 * @param {{endpoint?: string|null}} [opts] - defaults to process.env.LAYA_ENDPOINT
 */
export function createLaya({ endpoint = process.env.LAYA_ENDPOINT ?? null } = {}) {
  if (endpoint) {
    let url;
    try {
      url = new URL(endpoint);
    } catch (err) {
      throw new LayaError(`Invalid LAYA_ENDPOINT URL: ${endpoint}`, { cause: err });
    }
    if (url.protocol !== "http:" || !isLocalHost(url.hostname)) {
      throw new LayaError(`LAYA_ENDPOINT must be http on localhost/127.0.0.1/::1, got: ${endpoint}`);
    }
  }
  return {
    classify: async (message) => (endpoint ? classifyRemote(endpoint, message) : classifyHeuristic(message)),
  };
}
