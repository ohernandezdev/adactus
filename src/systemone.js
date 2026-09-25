/**
 * Minimal client for the TypeSafe System One wire format:
 * POST {state, model, questions} -> {model, answers, usage}.
 */

import { BackendError } from "./backends.js";

/**
 * @param {ReturnType<typeof import('./backends.js').resolveBackend>} backend
 * @param {unknown} state
 * @param {Record<string, object>} questions
 * @param {{timeoutMs: number}} opts
 * @returns {Promise<{model: string, answers: Record<string, any>, usage?: object}>}
 */
export async function askSystemOne(backend, state, questions, { timeoutMs }) {
  let res;
  try {
    res = await fetch(backend.url, {
      method: "POST",
      headers: backend.headers,
      body: JSON.stringify({ state, model: backend.model, questions }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const why = err.name === "TimeoutError" ? `timed out after ${timeoutMs}ms` : err.cause?.code ?? err.message;
    throw new BackendError(`${backend.name} backend unreachable at ${backend.url} (${why})`, { cause: err });
  }

  const body = await res.text();
  if (!res.ok) {
    throw new BackendError(`${backend.name} backend returned HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    throw new BackendError(`${backend.name} backend returned invalid JSON`, { cause: err });
  }
  for (const id of Object.keys(questions)) {
    if (!parsed?.answers?.[id]) throw new BackendError(`${backend.name} backend answered without "${id}"`);
  }
  return parsed;
}
