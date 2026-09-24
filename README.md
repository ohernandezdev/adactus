# adactus

*adactus* (Latin: "driven, compelled").

adactus is a Claude Code plugin that keeps Claude working. When Claude ends a
turn with a lazy check-in ("Shall I continue?") or says the task is complete
while its own message still lists TODOs, failing tests or next steps, a native
`Stop` hook blocks the stop and tells Claude to keep going. When the check-in
is about something dangerous, or the push repeats without progress, adactus
lets the stop through and the decision stays with you.

It has no dependencies, needs no build step, and works wherever Claude Code
runs (macOS, Linux, Windows).

## Install

In Claude Code:

```text
/plugin marketplace add ohernandezdev/adactus
/plugin install adactus@adactus
```

Then restart Claude Code (or run `/reload-plugins` if your version has it).
Requires Node.js >= 20 on your PATH, which the hook uses to run.

From a terminal, the same thing:

```sh
claude plugin marketplace add ohernandezdev/adactus
claude plugin install adactus@adactus
```

To try it for one session without installing:

```sh
git clone https://github.com/ohernandezdev/adactus.git
claude --plugin-dir ./adactus
```

Uninstall with `/plugin uninstall adactus@adactus`.

## Commands

| Command            | Effect                                                   |
| ------------------ | -------------------------------------------------------- |
| `/adactus:status`  | show whether adactus is on and its last decisions        |
| `/adactus:off`     | let every stop through until you turn it back on         |
| `/adactus:on`      | turn it back on                                          |

The same switches work from a terminal with `node <plugin>/bin/adactus.js
on|off|status|dry-run on|off`. Setting `ADACTUS_DISABLED=1` in the
environment turns the hook off for that environment only.

## How it works

Every time Claude is about to end its turn, Claude Code runs the `Stop` hook
with the final assistant message (`last_assistant_message`). adactus
classifies it:

```text
                   Claude ends its turn
                            │
                            ▼
          Stop hook: classify last_assistant_message
                            │
       ┌────────────────────┼────────────────────────┐
       ▼                    ▼                        ▼
  lazy_pause          fake_completion             normal
  "Shall I continue?" "done" + TODO / failing     anything else
       │              tests / next steps            │
       │                    │                       │
       ▼                    ▼                       ▼
  dangerous?  ──yes──►  let the stop through  ◄─────┘
       │no                  ▲
       ▼                    │
  3 blocks in a row? ─yes───┘
       │no
       ▼
  {"decision": "block", "reason": "... Continue ..."}
  Claude keeps working
```

- **lazy_pause**: Claude asks permission for work that follows from the task.
  adactus answers "Continue" and tells Claude to work autonomously.
- **fake_completion**: Claude claims the task is complete *and* the same
  message shows it is not (TODO, placeholder, "next steps", "you will need
  to", failing tests, "couldn't"). adactus answers "The task is incomplete.
  Inspect files and continue working until fully operational." A completion
  claim without that evidence is trusted.
- **normal**: real questions ("Postgres or SQLite?"), summaries and genuine
  completions go through untouched.

The block reason tells Claude that adactus is a hook you installed to answer
check-ins on your behalf. Without that, Claude reasonably keeps waiting for a
human.

## Safety limits

- **Dangerous check-ins stay with you.** A pause that mentions `rm -rf`,
  force pushes, `DROP TABLE`, deploys, releases, production, migrations,
  deletes, `sudo`, credentials, tokens or secrets is never answered.
- **Three consecutive blocks at most.** After three blocks in the same stop
  chain adactus lets the stop through. Claude Code itself overrides any Stop
  hook after 8.
- **Permission prompts are untouched.** adactus only acts on the Stop event;
  tool permission dialogs stay with you.
- **Failures never block.** If the hook input is broken or the classifier
  fails, the hook exits with an error message and the stop goes through.

## Decision log

Every decision is appended to `~/.adactus/log.jsonl` (override the folder
with `ADACTUS_HOME`) and shown by `/adactus:status`. Dry-run mode
(`adactus dry-run on`) logs what adactus would do without blocking anything,
which is a good way to see how it behaves on your sessions first.

## Custom classifier (optional)

Set `LAYA_ENDPOINT` to an `http://localhost` (or `127.0.0.1` / `::1`) URL to
replace the built-in pattern matcher with your own model. adactus POSTs
`{"message": "<final assistant message>"}` and expects
`{"label": "normal" | "lazy_pause" | "fake_completion", "evidence": "..."}`.
Non-local hosts are rejected. If the endpoint fails, the stop goes through
with an error; adactus never silently falls back to the heuristic.

## Known limitations

- The built-in classifier is pattern-based, not a trained model. Unusual
  phrasing can slip past it, and it only reads the final message of the turn.
- Context compaction is out of scope: Claude Code hooks cannot trigger
  `/compact`, and Claude Code already compacts on its own.
- Codex CLI and OpenCode are not supported yet. An earlier PTY-wrapper
  version that supervises any terminal agent lives on the
  [`pty-wrapper`](https://github.com/ohernandezdev/adactus/tree/pty-wrapper)
  branch.

## Development

```sh
npm test                                   # node:test, no dependencies
claude plugin validate .                   # validate the manifests
claude --plugin-dir . -p "..."             # run Claude with the local plugin
```

## License

MIT
