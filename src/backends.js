/**
 * System One backends. All of them speak the TypeSafe wire format
 * (`POST /v1/systemone`), so adding a new model is a new preset or a
 * `custom` URL, never new code.
 */

export const PRESETS = {
  laya: {
    url: "http://127.0.0.1:8765/v1/systemone",
    model: "convaiinnovations/laya",
    local: true,
    // Laya reads at most 512 tokens; a longer tail loses the ending, which is
    // where Claude asks. 500 chars measured best on the judge eval.
    thresholds: { messageChars: 500 },
    note: "Runs on this machine (Apple Silicon, MLX). adactus starts it when a session starts.",
  },
  decider: {
    url: "http://127.0.0.1:8000/v1/systemone",
    model: "Mapika/decider-4b",
    local: true,
    // decider-4b on Apple MPS: latency grows with tokens (~1 s per padded
    // length bucket). Real stops at 500 chars took 3-7 s and one hit the
    // timeout; 300 chars cut the eval median from 3.1 s to 2.1 s with the
    // same danger safety and push recall (specificity 92% -> 90%).
    // The hook's own budget is 10 s.
    timeoutMs: 8000,
    // Tuned on half of the judge eval, confirmed on the held-out half:
    // decider is well calibrated, so a low continueMin pushes more real
    // pauses, and its danger judgment already covers what user_decision caught.
    thresholds: { messageChars: 300, continueMin: 0.2, userDecisionMax: 1.01, claimMin: 0.5, unfinishedMin: 0.5, dangerMin: 0.5 },
    note: "Runs on this machine (CUDA, Apple MPS or CPU). adactus starts it from ~/.adactus/decider (or --dir) when a session starts.",
  },
  jev: {
    url: "https://api.typesafe.ai/v1/systemone",
    model: "jev-latest",
    local: false,
    apiKeyEnv: "TYPESAFE_API_KEY",
    note: "TypeSafe cloud: Claude's final message of each turn is sent to api.typesafe.ai.",
  },
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export class BackendError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "BackendError";
  }
}

/**
 * Merge a preset with the user's overrides into a request target.
 * @param {{name?: string, url?: string, model?: string, apiKeyEnv?: string}|undefined} choice - config.backend
 * @param {NodeJS.ProcessEnv} env
 * @returns {{name: string, url: string, model: string, headers: Record<string, string>, local: boolean}}
 */
export function resolveBackend(choice, env = process.env) {
  if (!choice?.name) {
    throw new BackendError("no System One backend configured: run /adactus:setup or `adactus use laya|decider|jev`");
  }
  const preset = PRESETS[choice.name] ?? {};
  if (choice.name !== "custom" && !PRESETS[choice.name]) {
    throw new BackendError(`unknown backend "${choice.name}" (expected laya, decider, jev or custom)`);
  }

  const url = choice.url ?? preset.url;
  const model = choice.model ?? preset.model;
  if (!url || !model) throw new BackendError(`backend "${choice.name}" needs both a url and a model`);

  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    throw new BackendError(`invalid backend url: ${url}`, { cause: err });
  }
  const local = LOCAL_HOSTS.has(parsed.hostname);
  // Anything that leaves this machine must be encrypted.
  if (!local && parsed.protocol !== "https:") {
    throw new BackendError(`remote backend url must use https: ${url}`);
  }

  const headers = { "Content-Type": "application/json" };
  const apiKeyEnv = choice.apiKeyEnv ?? preset.apiKeyEnv;
  if (apiKeyEnv) {
    const key = env[apiKeyEnv];
    if (!key) throw new BackendError(`backend "${choice.name}" needs the ${apiKeyEnv} environment variable`);
    headers.Authorization = `Bearer ${key}`;
  }
  return { name: choice.name, url, model, headers, local, dir: choice.dir, timeoutMs: preset.timeoutMs, thresholds: preset.thresholds ?? {} };
}
