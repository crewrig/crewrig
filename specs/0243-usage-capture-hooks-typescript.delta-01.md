---
id: "0243"
slug: usage-capture-hooks-typescript
status: draft
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
input is in contract, since requirement 20 recognises an environment prefix.
The owner settled the remedy: leave such a command unchanged and say why, in
the manner of requirement 21. This delta runs under the release-branch regime
of `specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`. The version is a MAJOR bump because the rewrite of
an in-flight implementation must change.*

## ADDED

**Scenario:** A capture command with an environment prefix is left and reported

Given a Claude Code settings file holding
`CREWRIG_USAGE_ROOT=/Volumes/enc/usage bash "/repo/hooks/usage-capture.sh" claude-code Stop`
and `env CREWRIG_USAGE_ROOT=/Volumes/enc/usage bash "/repo/hooks/usage-capture.sh" claude-code SessionEnd`,
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

**Out of scope item.** Choosing, among several capture commands registered on
one event, the one that carries an environment assignment: the live-path rule
of spec 0211 requirement 11 (requirement 22) is unchanged by this delta. It
decides by the liveness of the registered path alone, so a duplicate that
carries an assignment can still lose to one that carries none, exactly as it
could before this delta. Noted here so the gap is a recorded decision, not a
silent one; a later delta may close it.

## MODIFIED

Requirement 19 — a capture command that carries an environment assignment is
left as registered instead of being rewritten, per security review finding 3.
The original sentence is kept and the exception is added after it:

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
>     carries an environment assignment — one or more `NAME=value` words before
>     the script path, with or without a leading `env` — and which setup would
>     otherwise rewrite, SHALL be left byte for byte as registered, with no
>     backup made for it alone, because the direct form of requirement 16 has no
>     place for the assignment (row 37c records `NAME=value` as unusable on
>     Windows PowerShell 5.1) and dropping it would silently lose the operator's
>     setting, such as `CREWRIG_USAGE_ROOT`, which moves the usage root
>     (requirement 8). Setup SHALL report it as requirement 26 says. Such a
>     command stays a capture command under requirement 20 for every purpose —
>     keep, deduplication, re-pointing and removal (specs 0211 requirements 10 to
>     12, requirement 22) — and re-pointing a vanished path changes the path
>     token only and keeps the prefix, as it did before this delta. The null
>     case: a prefix that holds only `env`, an interpreter (`bash`, `sh` or
>     `node`) or nothing carries no assignment, and its command is rewritten as
>     before. The permitted path to the direct form: the operator edits the
>     assignment out of the registered command or chooses `remove` and enables
>     capture again, and supplies the variable through the environment of the
>     CLI; the next setup run then rewrites or registers the direct form. This
>     paragraph concerns the hook commands that requirement 20 recognises and
>     adds nothing for `statusLine.command`.

Requirement 26 — the report names the commands left for an environment
assignment, and the ban on unusable tokens is scoped to the command lines setup
itself writes, since a command left under requirement 19 carries whatever its
operator put there. Only the second and third sentences change:

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
>     CLI, and a command left under requirement 19 is not one setup wrote. Setup
>     SHALL tell the user, by name and count, which commands it rewrote, which it
>     left and why, and the disclosure before enabling capture SHALL name the
>     direct form. A command left for an environment assignment SHALL appear in
>     that report with its event, its registered script path and the name of
>     each variable the prefix assigns, SHALL say that rewriting would drop the
>     setting, and SHALL never print a value, which can hold a secret; when
>     another reason to leave the command also holds (requirement 21), the line
>     SHALL name each reason.

Requirement 27 needs no change, and is recorded here so its absence is a
decision. Its list holds the deviations from the shell behaviour, and a command
left as registered is not one: the shell scripts never rewrote a command, and
the command a user left runs exactly as before through the forwarding shim of
requirement 2. Requirements 20 and 22 also stand as written; this delta reads
them, through requirement 19 above, as keeping an environment-prefixed command
recognised.

## REMOVED

Nothing is removed.
