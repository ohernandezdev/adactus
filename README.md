# adactus

*adactus* (Latin: "driven, compelled").

adactus is a Claude Code plugin that keeps Claude working. When Claude ends a
turn with a lazy check-in ("Shall I continue?") or says the task is complete
while its own message still lists TODOs, failing tests or next steps, a native
`Stop` hook blocks the stop and tells Claude to keep going. When the check-in is
about something dangerous, or the push repeats without progress, adactus lets
the stop through and the decision stays with you.

The judgment comes from a **System One model**: a small, fast decision model
that returns calibrated probabilities instead of generating text. adactus
supports three of them through the same wire format, and any new one that
speaks it.

## Install

In Claude Code:

```text
/plugin marketplace add ohernandezdev/adactus
/plugin install adactus@adactus
```

Restart Claude Code, then pick a model:

```text
/adactus:setup
```

Requires Node.js >= 20 on your PATH.

## Pick a System One model

| Backend   | Runs on                                   | Cost per stop | Setup |
| --------- | ----------------------------------------- | ------------- | ----- |
| `laya`    | this Mac, Apple Silicon (MLX)             | free, ~120 ms | [`uv`](https://docs.astral.sh/uv/) installed; adactus starts the server itself |
| `decider` | this machine: CUDA, Apple MPS or CPU (Windows too) | free | run the [decider](https://github.com/Mapika/decider) server on port 8000 |
| `jev`     | TypeSafe cloud                            | TypeSafe pricing | `TYPESAFE_API_KEY` in your environment |
| `custom`  | anything that speaks `POST /v1/systemone` | yours         | a URL and a model name |

`/adactus:setup` walks you through it. From a terminal, the same commands:

```sh
node <plugin>/bin/adactus.js use laya
node <plugin>/bin/adactus.js use decider --model Mapika/decider-4b
node <plugin>/bin/adactus.js use jev
node <plugin>/bin/adactus.js use custom --url http://127.0.0.1:9000/v1/systemone --model my-model
node <plugin>/bin/adactus.js doctor     # live check
```

A new System One model is a `use custom` (or a new preset), never new code:
all backends speak the [TypeSafe wire format](https://docs.typesafe.ai/api.md)
(`{state, model, questions}` in, typed `answers` with probabilities out).

**Privacy.** `laya` and `decider` never leave your machine. `jev` sends
Claude's final message of every turn to `api.typesafe.ai`; do not use it for
sessions that handle confidential or regulated data. Remote custom backends
must use https.

### Laya

adactus ships a tiny server (`server/laya_server.py`) that loads
[`convaiinnovations/laya`](https://huggingface.co/convaiinnovations/laya) with
[`laya-mlx`](https://pypi.org/project/laya-mlx/) once and answers on
`127.0.0.1:8765`. The `SessionStart` hook starts it in the background when it is
not running; its log is `~/.adactus/laya-server.log`. Run it in the foreground
with `adactus serve laya`.

### decider

Serve a [decider](https://github.com/Mapika/decider) model with its own server,
for example `scripts/serve.sh Mapika/decider-4b 8000`. It exposes
`POST /v1/systemone`, which is what adactus calls.

## Commands

| Command           | Effect                                          |
| ----------------- | ----------------------------------------------- |
| `/adactus:setup`  | choose and check the System One backend          |
| `/adactus:status` | mode, backend and the last decisions             |
| `/adactus:off`    | let every stop through until you turn it back on |
| `/adactus:on`     | turn it back on                                  |

`ADACTUS_DISABLED=1` in the environment turns the hook off for that
environment only. `adactus dry-run on` logs decisions without blocking.

## How it works

On every stop, adactus asks the model eight narrow yes/no questions (`noul`)
about `last_assistant_message`, in one request:

| Question            | Meaning                                                    |
| ------------------- | ---------------------------------------------------------- |
| `asks_to_continue`  | ends by asking whether to continue or go ahead             |
| `user_decision`     | asks for something only the user can decide or provide     |
| `dangerous`         | proposes deleting data, force pushing, deploying, credentials |
| `claims_done`       | says the task is finished                                  |
| `not_done_yet`, `next_steps`, `leftovers`, `failing_tests` | signs of unfinished work |

Code owns the policy:

```text
asks_to_continue >= 0.7 and user_decision < 0.5      -> lazy_pause
claims_done >= 0.5 and max(unfinished signals) >= 0.3 -> fake_completion
otherwise                                            -> normal

lazy_pause + dangerous (model >= 0.5 or hard regex guard) -> hand back to you
3 blocks in a row                                        -> hand back to you
fake_completion again right after a fake_completion block  -> trust it, let the stop through
lazy_pause / fake_completion                             -> {"decision": "block", "reason": ...}
```

Small, concrete questions that name the field they read work far better than
one three-way choice: on Laya a single `choice` got 1 of 7 cases right, the
decomposed questions 6 of 7. Thresholds can be overridden per backend with a
`thresholds` object in `~/.adactus/config.json`.

### Measured

Two evals ship with adactus:

- `adactus eval` runs `eval/cases.json` (31 hand-written messages) against the
  configured backend: a quick sanity check.
- `eval/run-judge-eval.mjs` runs the real Stop hook entry point over any labeled
  JSONL set and reports danger safety, push recall and specificity. Point it at
  your own transcripts; keep that data outside the repo.

On 150 labeled real final messages (Laya, Apple Silicon):

```text
danger safe  6/6    (a dangerous check-in is never pushed)
push recall  45%    (lazy pauses and fake "done" that got pushed)
specificity  81%    (messages that should stand, left alone)
latency      median 0.33 s
```

Laya reads at most 512 tokens, so the `laya` preset sends only the last 500
characters; with 2000 it lost the ending and pushed 68% of messages that
should stand. Tuning thresholds on a held-out split did not beat the defaults:
on real messages Laya is the ceiling, not the policy. Measure a stronger
System One (decider, Jev) with the same runner before trusting it more.

## Safety limits

- **Dangerous check-ins stay with you**: the model's `dangerous` judgment plus a
  hard regex guard (`rm -rf`, force push, `DROP TABLE`, deploy, production,
  migrations, credentials...).
- **Three consecutive blocks at most**; Claude Code itself overrides a Stop hook
  after 8.
- **One pushback per false "done".** The fake-completion reason names what the
  model saw (for example "failing tests or unfixed errors") and lets Claude say
  the rest is out of scope. If Claude still says it is done after that, adactus
  trusts the answer.
- **Permission prompts are untouched.** adactus only acts on the Stop event.
- **No silent fallback.** If the backend is not configured, unreachable or
  answers badly, the hook exits with an error you can see, the stop goes
  through, and `/adactus:status` logs it.

## Decision log

Every decision, with the model's probabilities and latency, is appended to
`~/.adactus/log.jsonl` (override the folder with `ADACTUS_HOME`).

## Known limitations

- adactus only reads Claude's final message of the turn, not the whole task.
- Context compaction is out of scope: hooks cannot trigger `/compact`, and
  Claude Code compacts on its own.
- Laya needs Apple Silicon. On Windows or Linux use decider or Jev.
- Codex CLI and OpenCode are not supported yet. An earlier PTY-wrapper version
  lives on the [`pty-wrapper`](https://github.com/ohernandezdev/adactus/tree/pty-wrapper)
  branch.

## Development

```sh
npm test                       # node:test, no dependencies
claude plugin validate .       # validate the manifests
claude --plugin-dir . -p "..." # run Claude with the local plugin
node bin/adactus.js eval       # accuracy and latency of the configured backend
```

## License

MIT
