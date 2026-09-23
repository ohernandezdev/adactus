# adactus

A Node.js CLI supervisor that wraps interactive AI coding agents
(`claude`, `opencode`, `codex`) in a PTY, watches their output, and
injects text into their stdin when it looks like they've stalled,
paused waiting for a trivial confirmation, claimed false completion, or
are about to run out of context.

## Install

One command from the repo root:

```sh
./install.sh
```

It checks Node >= 20, runs `npm install -g --install-links .`, then
`adactus doctor`. You can run that npm command yourself instead. Keep the
`--install-links` flag: a plain `npm install -g .` on a local folder only
creates a symlink to it and does not install `node-pty`, so `adactus`
fails at startup (`adactus doctor` reports it).

After pulling new changes, run `./install.sh` again.

The only runtime dependency is `node-pty`, pinned to `1.2.0-beta.15`: the
stable `1.1.0` tarball ships its macOS `spawn-helper` without the execute
bit, so every spawn fails with `posix_spawnp failed`.

Try it without installing:

```sh
npx /path/to/adactus claude
```

Uninstall:

```sh
npm uninstall -g adactus
```

## Usage

```sh
adactus <agent> [args...]
adactus doctor
```

Everything after the agent name is passed through untouched to the
spawned agent, e.g.:

```sh
adactus claude --model sonnet
adactus opencode
adactus codex
```

## Flags

Flags must appear **before** the agent name — anything from the agent
name onward is forwarded verbatim as arguments to the agent, not parsed
by adactus.

| Flag           | Effect                                                     |
| -------------- | ----------------------------------------------------------- |
| `--dry-run`    | classify and log what adactus *would* inject, but never write it |
| `--no-latigo`  | disable `lazy_pause` / `fake_completion` injections          |
| `--no-compact` | disable `context_saturated` compaction injections            |
| `--verbose`    | show `LAYA` classification log lines, not just actions/halts |
| `--version`    | print the adactus version and exit                           |
| `--help`       | print usage and exit                                          |

## The Ctrl+] toggle

Press `Ctrl+]` at any time while an agent is running to toggle
supervision on/off. The keystroke is intercepted by adactus and never
forwarded to the wrapped agent. Turning supervision back on also resumes
after a Laya endpoint error or a `maxSameClass` halt.

## The AGENTS config map

`src/config.js` exports an `AGENTS` map keyed by agent name
(`claude`, `opencode`, `codex`). Each entry defines:

- `command` — the executable resolved on `PATH`
- `lazyPausePatterns` / `fakeCompletionPatterns` / `saturationPatterns` /
  `dangerPatterns` — regexes used by the classifier and the danger guard
- `continueText` / `confirmText` / `correctiveText` — the strings
  injected for each situation
- `compactCommand` — the agent's own slash command for compaction (e.g.
  `/compact`)

Add or tune an agent by editing this map — no other file needs to
change.

## The 4-state classification pipeline

Every time the wrapped agent goes quiet for `idleMs` (1.5s by default),
adactus classifies the current output tail into one of four states:

- **normal_running** — nothing to do
- **lazy_pause** — the agent is waiting on a trivial yes/no or "should I
  continue?" prompt → adactus answers it
- **fake_completion** — the agent claims it's done, but the phrasing
  looks premature → adactus pushes back
- **context_saturated** — the agent is warning about running out of
  context → adactus triggers a shaped `/compact`

Classification uses a deterministic weighted pattern scorer by default
(`src/laya.js`), with matches near the end of the tail weighted higher
than older ones. An optional remote classifier can be used instead by
setting `LAYA_ENDPOINT` to a `localhost`/`127.0.0.1`/`::1` URL — any
other host is rejected immediately at startup. If the remote endpoint
ever fails or times out, adactus **pauses supervision** rather than
silently falling back to the heuristic.

## Compaction flow (winnow)

```
   PTY tail (stripped)
          │
          ▼
   ┌─────────────┐
   │ splitBlocks │  split into blocks: blank-line / tool-marker boundaries
   └──────┬──────┘
          ▼
   ┌─────────────┐
   │ scoreBlock  │  keepProbability: errors, test summaries, diffs, paths ↑
   │ (per block) │  superseded reads/listings, duplicates ↓
   └──────┬──────┘
          ▼
   ┌─────────────┐
   │   winnow    │  drop blocks below threshold → { kept, dropped }
   └──────┬──────┘
          ▼
   ┌────────────────────┐
   │ buildCompactCommand │  "<agent's /compact> Preserve verbatim:\n<kept>"
   │  (≤ 2000 chars)      │  capped, dropping oldest/lowest-value lines first
   └──────────┬──────────┘
              ▼
        injected into agent's stdin
```

**Important:** adactus cannot see or edit the wrapped agent's internal
context window — that state lives entirely inside the agent process.
Winnow only shapes the *text* of the `/compact` instruction adactus
sends; the agent decides what to actually do with it.

## Safety limits

- **cooldownMs** (5s) — minimum time between injections
- **maxInjections** (50) — hard cap; once reached, adactus halts
  permanently and never injects again for that session
- **maxSameClass** (3) — if the same classification repeats with no new
  agent output between injections (beyond the pty echo of what adactus
  just typed), adactus halts and hands control back to you
- **danger guard** — if the last ~20 lines of the tail match a danger
  pattern (`rm -rf`, `git push --force`, `DROP TABLE`, `sudo`, `deploy`,
  credential/token/secret wording, etc.) *and* the agent looks like it's
  waiting on a confirmation, adactus halts instead of auto-confirming

A halt (other than the permanent `maxInjections` halt) clears as soon as
you type anything yourself.

After every injection adactus clears its tail buffer, so the prompt it
just answered cannot trigger the next classification. Injected text is
typed first and Enter follows `submitDelayMs` (150ms) later, because TUIs
such as Claude Code treat text plus Enter in one chunk as a paste.

## Known limitations

- The default classifier is a heuristic pattern scorer, not a trained
  model — it can misfire on phrasing it hasn't seen, or on a TUI redraw
  that happens to contain matching text.
- adactus cannot edit the wrapped agent's internal context; it only
  shapes the text of the `/compact` instruction it sends, it does not
  and cannot truncate the agent's real memory directly.
- `fake_completion` is a phrasing heuristic: adactus cannot check whether
  the work is really finished, so a genuine "done" also gets pushed back
  until `maxSameClass` or `maxInjections` stops it. Use `--no-latigo` or
  `Ctrl+]` when the task really is complete.
- Trigger phrases inside your own initial prompt can fire an injection:
  the TUI echoes the prompt into the output adactus classifies. Avoid
  phrases like "Shall I continue?" in the prompt you pass on the command line.
- Numbered menus and modal dialogs (folder trust, hook review, update
  offers, model pickers) are not answered. adactus classifies them as
  `normal_running` and leaves the choice to you.
- Pattern-based detection can be fooled by TUI redraws/re-renders that
  momentarily reproduce trigger phrases from earlier in the session.

## Tested with

Dogfooded on macOS (Node 22) inside real terminals:

- Claude Code 2.x with `--permission-mode acceptEdits`: answered a
  "Shall I continue?" pause, pushed back on "Task is complete", and the
  agent finished the task with passing tests.
- Codex CLI 0.156: TUI, trust dialog and injected `Continue.` submission
  work; a full task run is still pending.
- OpenCode 1.4: TUI, resize and Ctrl+C exit work under `--dry-run`.

## Credits

Inspired by [tamaratran/fast-jev-compaction](https://github.com/tamaratran/fast-jev-compaction)
and [GhalebDweikat/winnow](https://github.com/GhalebDweikat/winnow) —
adactus does not implement their exact algorithms, just borrows the
general idea of scoring and trimming context before compaction.
