---
description: Choose the System One model adactus uses to judge Claude's final message (Laya, decider or Jev) and check that it works.
disable-model-invocation: true
---
Help the user pick an adactus backend, then configure and verify it.

1. Ask the user which backend to use, with these options:
   - **laya**: local, free, ~100ms per stop. Apple Silicon Macs only; needs `uv`.
     adactus starts its server automatically.
   - **decider**: local Mapika/decider model (CUDA, Apple MPS or CPU, also Windows).
     The user runs the decider server on port 8000 (see https://github.com/Mapika/decider).
     Ask whether they want a different model than `Mapika/decider-4b`.
   - **jev**: TypeSafe cloud. Needs `TYPESAFE_API_KEY` in the environment. Tell the
     user plainly that Claude's final message of every turn is sent to api.typesafe.ai,
     so it is not suitable for sessions that handle confidential or regulated data.
   - **custom**: any server that speaks `POST /v1/systemone`; ask for its URL and model.
2. Run the matching command:

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/adactus.js" use <laya|decider|jev>
# decider with another model:
node "${CLAUDE_PLUGIN_ROOT}/bin/adactus.js" use decider --model <model>
# custom:
node "${CLAUDE_PLUGIN_ROOT}/bin/adactus.js" use custom --url <url> --model <model> [--api-key-env <VAR>]
```

3. Run the check and show its output to the user:

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/adactus.js" doctor
```

If doctor fails, show the error and the fix it suggests; do not change backends on the
user's behalf.
