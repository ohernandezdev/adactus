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
    note: "Runs on this machine (Apple Silicon, MLX). adactus starts it when a session starts.",
  },
  decider: {
    url: "http://127.0.0.1:8000/v1/systemone",
    model: "Mapika/decider-4b",
    local: true,
    note: "Runs on this machine (CUDA, Apple MPS or CPU). Start it with the decider server, e.g. `scripts/serve.sh Mapika/decider-4b 8000`.",
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
  return { name: choice.name, url, model, headers, local };
}
