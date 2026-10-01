---
id: "0243"
slug: usage-capture-hooks-typescript
status: implemented
complexity: standard
interaction-mode: MINIMAL
related-issue: 1326
version: 2.0.0
---

# Usage-capture hook and Antigravity statusline in TypeScript

*Delta 01 of `specs/0243-usage-capture-hooks-typescript.md`. Source: security
review finding 3 on the implementation of #1326
(<https://github.com/crewrig/crewrig/issues/1326#issuecomment-5912896318>): the
setup rewrite rebuilds a capture command from its script path and arguments and
discards everything before the path, so
`CREWRIG_USAGE_ROOT=/Volumes/enc/usage bash "<abs>/hooks/usage-capture.sh" claude-code Stop`
becomes `node "<abs>/hooks/usage-capture.ts" claude-code Stop`. Records then go
to the default usage root instead of the one the operator chose (for example an
encrypted volume), and the report says only that the command was rewritten. The
input is in contract, since requirement 20 recognises `NAME=value` words before
the interpreter. The owner settled the remedy: leave such a command unchanged
and say why, in the manner of requirement 21. This delta does not touch the
signature of requirement 20: it works on the prefix grammar that signature
already accepts, and nothing else. Revised after seat `specs/1326` pass 4
(findings `s4-F1` and `s4-F2`). This delta runs under the release-branch regime
of `specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`. The version is a MAJOR bump because the rewrite of
an in-flight implementation must change.*

## ADDED

**Scenario:** A capture command with an environment prefix is left and reported

Given a Claude Code settings file holding
`CREWRIG_USAGE_ROOT=/Volumes/enc/usage bash "/repo/hooks/usage-capture.sh" claude-code Stop`
and `CREWRIG_USAGE_ROOT=/Volumes/enc/usage env bash "/repo/hooks/usage-capture.sh" claude-code SessionEnd`,
and a checkout at `/repo` that holds `hooks/usage-capture.ts`
When the user re-runs `scripts/setup-claude-interactive.sh` and keeps capture
Then both commands are byte-identical to what they were, setup creates no
backup for them, and its report lists each one by event and registered script
path with the reason that it carries the environment assignment
`CREWRIG_USAGE_ROOT` and that rewriting would drop it, without printing the
value `/Volumes/enc/usage`; setup offers `keep` or `remove` and not the enable
question, because both commands still count as capture commands under
requirement 20; a second run writes nothing; and choosing `remove` deletes
both.

**Scenario:** A vanished path on an assignment-prefixed command is re-pointed
only where the prefix still launches

Given a settings file whose capture command is
`CREWRIG_USAGE_ROOT=/Volumes/enc/usage bash "/old/hooks/usage-capture.sh" <cli-id> Stop`,
with `/old/hooks/usage-capture.sh` no longer existing, for Claude Code, and for
Gemini CLI and Copilot CLI on each platform
When the user re-runs setup for that CLI and keeps capture
Then for Claude Code, and for Gemini CLI and Copilot CLI on macOS and Linux,
the command is re-pointed at the current checkout's script with the prefix and
the arguments kept, after a 0600 backup; and for Gemini CLI and Copilot CLI on
Windows the command is left byte-identical, creates no backup, and is reported
with its vanished path, the variable name `CREWRIG_USAGE_ROOT` and the reason
that writing the prefix is unusable on Windows PowerShell 5.1 (row 37c), and no
value is printed.

**Out of scope item.** An assignment placed after `env`, as in
`env NAME=value bash "<abs>/hooks/usage-capture.sh" <cli-id> <Event>`: the
signature of requirement 20 accepts assignments only before `env`, so that
command is not recognised as a capture command, and this delta neither widens
the signature nor gives that form any treatment. Widening a positive signature
that the Bash library and the TypeScript module share, and their fixture
corpus, is a change to requirement 20 for a later delta to decide.

**Out of scope item.** Choosing, among several capture commands registered on
one event, the one that carries an environment assignment: the live-path rule
of spec 0211 requirement 11 (requirement 22) is unchanged by this delta. It
decides by the liveness of the registered path alone, so a duplicate that
carries an assignment can still lose to one that carries none, exactly as it
could before this delta. Noted here so the gap is a recorded decision, not a
silent one; a later delta may close it.

## MODIFIED

Requirement 19 — a capture command that carries an environment assignment is
left as registered instead of being rewritten, per security review finding 3,
and the re-point of a vanished path on such a command is written only where its
prefix still launches (`s4-F2`). The original sentence is kept and the exception
is added after it:

Original:

<!-- markdownlint-disable-next-line MD029 -->
> 19. **Rewrite on the next setup run.** On every run of
>     `scripts/setup-claude-interactive.sh`, `scripts/setup-gemini-interactive.sh`,
>     `scripts/setup-copilot-interactive.sh` and
>     `scripts/setup-antigravity-interactive.sh`, when the CLI already has a
>     registered capture command and the user does not choose to remove it, setup
>     SHALL rewrite each such command to the shape of requirement 16, keeping its
>     event, selector, key order, every other key and every other entry exactly as
>     they were. For Antigravity CLI the same applies to `statusLine.command`, and
>     the `installedStatusLineCommand` value in
>     `<usage root>/state/antigravity-statusline.json` SHALL change in the same run,
>     so the framework's own status line never reads as foreign; a crash between
>     the two writes SHALL leave a state from which the next run still recognises
>     the command as the framework's.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 19. **Rewrite on the next setup run (reworded at delta-01).** On every run of
>     `scripts/setup-claude-interactive.sh`, `scripts/setup-gemini-interactive.sh`,
>     `scripts/setup-copilot-interactive.sh` and
>     `scripts/setup-antigravity-interactive.sh`, when the CLI already has a
>     registered capture command and the user does not choose to remove it, setup
>     SHALL rewrite each such command to the shape of requirement 16, keeping its
>     event, selector, key order, every other key and every other entry exactly as
>     they were, except a command that carries an environment assignment, which
>     the next paragraph leaves unchanged. For Antigravity CLI the same applies to
>     `statusLine.command`, and
>     the `installedStatusLineCommand` value in
>     `<usage root>/state/antigravity-statusline.json` SHALL change in the same run,
>     so the framework's own status line never reads as foreign; a crash between
>     the two writes SHALL leave a state from which the next run still recognises
>     the command as the framework's.
>
>     **Environment assignment.** A recognised capture command whose prefix
>     carries an environment assignment — one or more `NAME=value` words that
>     precede any `env` or interpreter word, the grammar the signature of
>     requirement 20 already accepts (`NAME=value … [env] [bash|sh|node] <path>
>     <cli-id> <Event>`) — and which setup would otherwise rewrite, SHALL be left
>     byte for byte as registered, because the direct form of requirement 16 has
>     no place for the assignment (row 37c records `NAME=value` as unusable on
>     Windows PowerShell 5.1) and dropping it would silently lose the operator's
>     setting, such as `CREWRIG_USAGE_ROOT`, which moves the usage root
>     (requirement 8). Leaving a command writes nothing, so it makes no backup.
>     Setup SHALL report it as requirement 26 says. Such a command stays a
>     capture command under requirement 20 for every purpose — keep,
>     deduplication, re-pointing and removal (spec 0211 requirements 10 to 12,
>     requirement 22) — with this delta changing neither requirement 20 nor
>     requirement 22. Re-pointing a vanished path changes the path token only
>     and keeps the prefix, as it did before this delta, and is written only
>     where the prefix still launches: on Gemini CLI and Copilot CLI on Windows
>     (Windows PowerShell 5.1, row 37c) setup SHALL leave the command as
>     registered and report it instead, since the re-pointed line would carry a
>     prefix that interpreter cannot launch; for Claude Code on every platform
>     and for the other CLIs on macOS and Linux the re-point is written. A
>     re-point that is written is a write like any other under requirement 23:
>     backup-first, mode 0600, every other entry preserved. The null case: a
>     prefix that holds only `env`, an interpreter (`bash`, `sh` or `node`) or
>     nothing carries no assignment, and its command is rewritten as before. The
>     permitted path to the direct form: the operator edits the assignment out
>     of the registered command or chooses `remove` and enables capture again,
>     and supplies the variable through the environment of the CLI; the next
>     setup run then rewrites or registers the direct form. This paragraph
>     concerns the hook commands that requirement 20 recognises and adds nothing
>     for `statusLine.command`; a command whose assignment follows `env` is not
>     recognised by requirement 20 and is outside this paragraph.

Requirement 26 — the report names the commands left for an environment
assignment, whether left by the rewrite or by a re-point, and the ban on
unusable tokens is scoped to the command lines setup itself writes, since a
command left under requirement 19 carries whatever its operator put there and a
re-point that would write an unusable prefix is left instead. Only the second
and third sentences change:

Original:

<!-- markdownlint-disable-next-line MD029 -->
> 26. **Wiring files and reports.** `hooks/claude-usage-capture-hooks.json`,
>     `hooks/gemini-usage-capture-hooks.json` and
>     `hooks/copilot-usage-capture-hooks.json` SHALL carry the direct `node …
>     usage-capture.ts <cli-id> <Event>` form with the tokens they carry today,
>     which setup always replaces with the absolute path; no installed command
>     line SHALL carry a token that row 37c records as unusable on its CLI. Setup
>     SHALL tell the user, by name and count, which commands it rewrote, which it
>     left and why, and the disclosure before enabling capture SHALL name the
>     direct form.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 26. **Wiring files and reports (reworded at delta-01).**
>     `hooks/claude-usage-capture-hooks.json`,
>     `hooks/gemini-usage-capture-hooks.json` and
>     `hooks/copilot-usage-capture-hooks.json` SHALL carry the direct `node …
>     usage-capture.ts <cli-id> <Event>` form with the tokens they carry today,
>     which setup always replaces with the absolute path; no command line that
>     setup writes SHALL carry a token that row 37c records as unusable on its
>     CLI, and a command left under requirement 19 is not one setup wrote, nor
>     is a re-point that requirement 19 leaves unwritten. Setup
>     SHALL tell the user, by name and count, which commands it rewrote, which it
>     left and why, and the disclosure before enabling capture SHALL name the
>     direct form. A command left for an environment assignment, by the rewrite
>     or by a re-point, SHALL appear in that report with its event, its
>     registered script path and the name of each variable the prefix assigns,
>     SHALL say that rewriting would drop the setting (or, for a re-point, that
>     the prefix cannot launch on that CLI's Windows interpreter), and SHALL
>     never print a value, which can hold a secret; when another reason to leave
>     the command also holds (requirement 21), the line SHALL name each reason.

Requirement 27 needs no change, and is recorded here so its absence is a
decision. Its list holds the deviations from the shell behaviour, and a command
left as registered is not one: the shell scripts never rewrote a command, and
the command a user left runs exactly as before through the forwarding shim of
requirement 2. Requirements 20 and 22 stand as written: the recognition of
requirement 20 already accepts `NAME=value` words before the interpreter, and
this delta adds no form to it, so the fixture corpus that both twins run is
unchanged. Requirement 22's live-path rule and its idempotence are read as
before; a left command writes nothing, so a second run still writes nothing.
Its last sentence, that re-pointing a vanished path keeps working for both
forms, holds except as requirement 19 provides.

## REMOVED

Nothing is removed.
