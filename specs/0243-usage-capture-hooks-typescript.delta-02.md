---
id: "0243"
slug: usage-capture-hooks-typescript
status: implemented
complexity: standard
interaction-mode: MINIMAL
related-issue: 1326
version: 3.0.0
---

# Usage-capture hook and Antigravity statusline in TypeScript

*Delta 02 of `specs/0243-usage-capture-hooks-typescript.md`, cumulative on
`specs/0243-usage-capture-hooks-typescript.delta-01.md`. Sources: the row 37e
measurement of Antigravity CLI's `statusLine.command` on Windows
(<https://github.com/crewrig/crewrig/issues/1389#issuecomment-5914514220>),
which records the surface as conforming to row 37b and shows that a bare `node`
in it resolves from the directory the user starts `agy` in, before `PATH`;
security review finding 1 on the implementation of #1326
(<https://github.com/crewrig/crewrig/issues/1326#issuecomment-5912896318>), which
gated the Windows Antigravity status line on that measurement and asked for a
delta of this spec before row 37e lands; and the follow-up ticket #1392, which
owns the safe form. The owner settled the remedy (option B): the implementation
records row 37e and its measured-surface entry as `conforming`, but the module
refuses to produce a Windows Antigravity `statusLine.command`, with a diagnostic
naming the reason and #1392, until a later delta sets a shape that does not
depend on the lookup. macOS and Linux are unchanged. The Antigravity CLI hooks
surface is not changed by this delta; rows 37 to 37d do not record its working
directory, so requirement 33 makes the current-directory lookup hazard an
assessment that any later row must make before it wires that surface on
Windows. This delta runs under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`. Revised after seat `specs/1326` pass 7 (findings
`s7-F1`, `s7-F2` and `s7-F3`). The version is a MAJOR bump because a requirement
the in-flight implementation was written against — that a `conforming` entry
yields a command line — is invalidated.*

## ADDED

**Requirement 31 — Measurement record and caveats.** Row 37e of
`docs/cli-matrix.md` SHALL record, for Antigravity CLI's `statusLine.command` on
Windows, the four fields of requirement 18 as the source measurement states them
— interpreter `cmd.exe` (the command wrapped by `agy.exe` as `cmd /c "<command>"`
with each inner `"` escaped as `\"`, which `cmd.exe` does not honour, so a
double-quoted argument does not group); quoting `cmd-no-grouping`; working
directory the directory `agy` is started in (`ANTIGRAVITY_PROJECT_DIR` is not
set); path separators both accepted — and a fifth,
the planted-binary result: a `node.cmd` placed in that working directory ran on
every status-line draw and the real `node` ran on none. The row and the
constant's entry of requirement 18 SHALL carry these caveats, stated as the
source states them, so that no reader takes the row as wider than it is:

- The measurement ran on Windows 11 Pro 10.0.26200 **ARM64** in a virtual
  machine, whereas the CI job of requirement 28 runs on `windows-latest`, which
  is x64; it was not repeated on x64 hardware.
- It ran on Antigravity CLI **1.2.14**, whereas row 37b was measured on
  **1.2.13**; the `conforming` verdict compares two versions.
- It observed `statusLine.command` on the idle start-up screen of an
  interactive `agy` session, because the scripted prompt did not reach `agy`;
  the surface ran on every draw of that screen, and no turn was observed.
- The planted-binary result was measured with `node.cmd` only, with
  `NoDefaultCurrentDirectoryInExePath` unset (the Windows default); `node.bat`,
  `node.exe` and other candidates were not planted, and no alternative command
  form was measured.

The `windows-latest` leg of requirement 28(b) is the only repetition on x64
that this ticket makes, and only for the planted-binary case; it does not turn
the row's ARM64 or version caveats into findings about x64 or about another
Antigravity CLI release. The test of requirement 18 SHALL also fail when the
planted-binary result recorded in row 37e and the one carried by the constant's
entry differ, when the entry lacks the result whatever its status, or when the
row lacks it while the entry carries it. The null case: a row or entry that
omits the planted-binary result is malformed, and the module SHALL treat a
Windows `statusLine.command` entry that lacks it as unmeasured — whatever its
status, `contradicting` included — and refuse under the diagnostic of
requirement 18 for an absent entry, which requirement 32(a) states. The
permitted path for a reader who needs a different Windows,
architecture or release coverage: a later delta that records its own measurement
in a new row or a revised entry, in one diff, never a silent widening of this
one.

**Requirement 32 — Precedence among the statusline diagnostics.** For a Windows
Antigravity `statusLine.command` the module SHALL report exactly one refusal
diagnostic, chosen from the constant alone by the entry's state, and that
diagnostic SHALL come before, and SHALL replace, any judgement of the checkout
path under requirement 17: (a) no entry, or an entry that lacks the
planted-binary result whatever its status — the surface is unmeasured
(requirement 18); (b) an entry that carries the planted-binary result and is
`contradicting` — the recorded shape (requirement 18); (c) an entry that
carries the planted-binary result and is `conforming` — the working-directory
lookup of requirement 16(c), named in the wording of that item. The three are
mutually exclusive by construction: (b) and (c) apply only to an entry that
carries the planted-binary result, and an entry that lacks it, `contradicting`
included, falls under (a) and under no other, which is also what requirement 31
and its guard test provide. No ordering among them is needed; the ordering
that matters is each of them against requirement 17, and each precedes it,
because each concerns the surface and none concerns the path. A checkout path that requirement 17 would
refuse gives the same single diagnostic as one it would accept. The null case:
on macOS and Linux, and for every surface other than the Windows Antigravity
`statusLine.command`, none of (a) to (c) applies and requirement 17 is judged as
before.

**Requirement 33 — The hooks surface is assessed before it is wired on
Windows.** Rows 37 to 37d of `docs/cli-matrix.md` do not record the working
directory of Antigravity CLI's hooks surface. This delta does not change that
surface or the form that requirement 16(c) gives it. No later row SHALL wire the
Antigravity CLI hooks surface on Windows until the same current-directory lookup
hazard has been assessed for it and the result recorded in `docs/cli-matrix.md`:
the working directory measured, and a planted-binary check — a `node.cmd` placed
in that directory, recording which program the `cmd.exe` that parses its hook
command lines launches — made as for row 37e, with the result and its caveats
carried the way requirement 31 carries them. The null case: a row that does not
wire that surface on Windows is not bound by this requirement. The permitted
paths when the assessment finds that the lookup applies: the row refuses the
hooks surface on Windows as requirement 16(c) now refuses the statusline, or a
delta of this spec sets a shape that does not depend on the lookup, in one diff
with the row that records the assessment. Ticket #1392 is where the safe form of
the statusline is designed, and is the reference for this assessment.

**Scenario:** A conforming row 37e still does not wire a Windows statusline

Given row 37e recording `cmd.exe` and `cmd-no-grouping` for Antigravity CLI's
`statusLine.command` with the planted-binary result, the constant's entry
carrying the same values with the status `conforming`, and a Windows checkout
at `C:/Users/ana/crewrig` (then another at `C:/Users/Ana Diaz/crewrig`)
When setup is asked for the Antigravity CLI `statusLine.command`, for a fresh
enable and for a configuration that already holds a statusline command
Then the module produces no command line, setup writes neither
`statusLine.command` nor `<usage root>/state/antigravity-statusline.json`,
creates no backup and leaves the existing command byte-identical; the single
diagnostic says that the bare `node` of the command resolves from the directory
the user starts Antigravity CLI in, before `PATH`, and names #1392, and it is
the same diagnostic for both paths, without naming the space; the refusal is
reported as a parity gap with its evidence in `docs/cli-matrix.md`; the
Antigravity CLI hooks surface and the other three CLIs keep the command lines of
requirement 16; and macOS and Linux still receive their `statusLine.command`.

**Scenario:** The planted-binary case pins the reason of the refusal

Given a `windows-latest` job, a temporary directory holding a `node.cmd` that
only appends a line to a file under another temporary directory, and the bare
`node <abs> <args>` text of requirement 16(c) used as a fixture and never
produced by the module for this surface
When the job runs that text through the invocation row 37e records — `cmd /c`
with the whole command wrapped in one pair of quotes and each inner `"` escaped
as `\"` — with the temporary directory as working directory
Then the planted `node.cmd` runs and the real `node` does not; and when the
planted one does not run, the job fails naming the premise of the refusal, so
the refusal is revisited instead of staying on an outdated premise.

**Scenario:** An entry without the planted-binary result is unmeasured

Given a constant whose Windows Antigravity `statusLine.command` entry has the
status `contradicting` (then `conforming`) and records no planted-binary result
When setup is asked for that `statusLine.command`, and when the guard test runs
Then the module produces no command line and reports the diagnostic that the
surface is unmeasured, not the recorded-shape one and not the
working-directory-lookup one, and the guard test fails naming the missing
planted-binary result.

**Out of scope item.** The safe form of a Windows Antigravity CLI
`statusLine.command` — an absolute interpreter path, a generated shim, or any
other form that does not depend on the `cmd.exe` working-directory lookup —
which is ticket #1392, through its own specs, plan and measurement; and any
delta of spec 0215 that a form with an intermediate entry point would need.
This delta chooses none of the candidate forms.

**Out of scope item.** Changing the Antigravity CLI hooks surface, wired by
later rows: its form stays that of requirement 16(c), and this delta neither
measures its working directory nor assesses whether a bare `node` there carries
a lookup exposure. Rows 37 to 37d do not record that directory, and the only
statement of it in the record is an unrecorded parenthetical observation in
the comment of ticket #1389. That assessment is a precondition on the later row
that wires the surface on Windows (requirement 33), not work of this delta.

**Out of scope item.** Reading, setting or unsetting the Windows
`NoDefaultCurrentDirectoryInExePath` policy. The refusal does not depend on it:
it is unconditional for the triple, decided from the constant alone, and setup
changes no machine policy.

## MODIFIED

Requirement 16, item (c) — the conforming branch of the statusline form no
longer yields a command line. The hooks surface and every other item are
unchanged. The original paragraph is kept, and only the two sentences that
follow the form of item (c) change:

Original:

<!-- markdownlint-disable-next-line MD029 -->
> 16. **Per-CLI command-line shape.** One shared TypeScript module under
>     `scripts/lib/` (spec 0240 requirement 11) SHALL be the single source of the
>     direct `node` command line each CLI receives, in the form the interpreter
>     that CLI uses on Windows parses (rows 37–37d of `docs/cli-matrix.md`):
>     (a) Claude Code (Git Bash) and, on macOS and Linux, all four CLIs:
>     `node "<abs>" <args>`, path in double quotes; (b) Gemini CLI and Copilot CLI
>     (Windows PowerShell 5.1): the same text, with the absolute path spelled out
>     — never a `$GEMINI_PROJECT_DIR`, `${GEMINI_PROJECT_DIR}` or
>     `${COPILOT_PROJECT_DIR:-$PWD}` token, which those CLIs do not expand
>     correctly on Windows (row 37c), and never a `NAME=value` prefix (row 37c,
>     `CommandNotFoundException`) — and for Copilot CLI only under the `command`
>     or `powershell` key, never `bash` (row 37); (c) Antigravity CLI on Windows:
>     `node <abs> <args>` with the path unquoted, because a double-quoted argument
>     does not group in the `cmd.exe` that parses its hook command lines (row 37b).
>     Row 37b measured Antigravity CLI's hooks surface only, and the module wires
>     only its `statusLine.command` surface (requirement 18), so the form of
>     this item applies to `statusLine.command` on Windows if and only if row 37e
>     records the same interpreter and quoting for it. If row 37e records
>     otherwise, the module SHALL refuse a Windows `statusLine.command`, and a
>     delta of this spec SHALL set its shape before any is written; the hooks
>     surface, wired by later rows, keeps the form of this item. Every absolute
>     path SHALL use forward slashes on Windows (rows 37b and 37d) and be the
>     physical path of the checkout.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 16. **Per-CLI command-line shape (reworded at delta-02).** One shared
>     TypeScript module under
>     `scripts/lib/` (spec 0240 requirement 11) SHALL be the single source of the
>     direct `node` command line each CLI receives, in the form the interpreter
>     that CLI uses on Windows parses (rows 37–37d of `docs/cli-matrix.md`):
>     (a) Claude Code (Git Bash) and, on macOS and Linux, all four CLIs:
>     `node "<abs>" <args>`, path in double quotes; (b) Gemini CLI and Copilot CLI
>     (Windows PowerShell 5.1): the same text, with the absolute path spelled out
>     — never a `$GEMINI_PROJECT_DIR`, `${GEMINI_PROJECT_DIR}` or
>     `${COPILOT_PROJECT_DIR:-$PWD}` token, which those CLIs do not expand
>     correctly on Windows (row 37c), and never a `NAME=value` prefix (row 37c,
>     `CommandNotFoundException`) — and for Copilot CLI only under the `command`
>     or `powershell` key, never `bash` (row 37); (c) Antigravity CLI on Windows:
>     `node <abs> <args>` with the path unquoted, because a double-quoted argument
>     does not group in the `cmd.exe` that parses its hook command lines (row 37b).
>     Row 37b measured Antigravity CLI's hooks surface only, and the module wires
>     only its `statusLine.command` surface (requirement 18). Row 37e records the
>     same interpreter and quoting for that surface, so the shape of this item
>     would apply to it, but the module SHALL nevertheless refuse to produce a
>     Windows `statusLine.command`: the `cmd.exe` that runs it resolves the bare
>     `node` of this item from the directory the user starts Antigravity CLI in,
>     before `PATH` (CWE-427), so a repository that ships a `node.cmd` would run
>     its own code on every draw of the status line (row 37e, requirement 31).
>     The diagnostic SHALL name that reason and ticket #1392, and the refusal
>     stands until a delta of this spec sets a shape that does not depend on the
>     lookup, landing in one diff with the row and the entry of requirement 18.
>     Should row 37e ever record an interpreter or quoting other than row 37b's,
>     the module likewise refuses (requirement 18). The hooks surface, wired by
>     later rows, keeps the form of this item, and this delta does not change it;
>     requirement 33 makes the lookup hazard an assessment that precedes the
>     wiring of that surface on Windows.
>     Every absolute path SHALL use forward slashes on Windows (rows 37b and 37d)
>     and be the physical path of the checkout.

Requirement 17 — the space-in-path parity gap on the Windows statusline surface
becomes moot, because that surface now refuses for every path, and the
diagnostic that precedes the path judgement is generalised from requirement 18's
alone to the statusline diagnostics of requirement 32. The path refusal itself
is unchanged for every interpreter that can still be wired. The second half of
the original is replaced:

Original:

<!-- markdownlint-disable-next-line MD029 -->
> 17. **Unsafe path refusal.** The module SHALL refuse, with a diagnostic naming
>     the character and the path and without writing anything, a checkout path
>     that its target interpreter would read as syntax: `"`, `$`, a backtick or a
>     newline for every interpreter, plus, for `cmd.exe`, whitespace and any of
>     `& | < > ^ % ( )`. Refusing is the null case of requirement 16(c), and
>     applies to the Windows `statusLine.command` only once requirement 18 no
>     longer refuses it: a Windows checkout path containing a space cannot then
>     be wired for Antigravity CLI, is reported as a parity gap per parent
>     requirement 19 in `docs/cli-matrix.md` in the implementation PR, and no
>     command line that cannot launch is ever written. When requirements 17 and
>     18 would both refuse, the diagnostic of requirement 18 SHALL be the one
>     reported, since it concerns the surface and precedes any judgement of the
>     path.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 17. **Unsafe path refusal (reworded at delta-02).** The module SHALL refuse,
>     with a diagnostic naming
>     the character and the path and without writing anything, a checkout path
>     that its target interpreter would read as syntax: `"`, `$`, a backtick or a
>     newline for every interpreter, plus, for `cmd.exe`, whitespace and any of
>     `& | < > ^ % ( )`. Refusing is the null case of requirement 16(c) for the
>     Antigravity CLI hooks surface on Windows, where a checkout path containing
>     a space cannot be wired and is reported as a parity gap per parent
>     requirement 19 in `docs/cli-matrix.md` in the implementation PR. The
>     Windows `statusLine.command` is not judged by this requirement: it refuses
>     for every path under requirement 16(c) and requirement 32, so a path with a
>     space is no longer a separate parity gap for that surface — the gap
>     recorded for it is the refusal itself, with the evidence of row 37e and
>     ticket #1392 — and no command line that cannot launch, or that would launch
>     the wrong program, is ever written. When requirement 17 and a statusline
>     diagnostic of requirement 32 would both refuse, the statusline diagnostic
>     SHALL be the one reported, since it concerns the surface and precedes any
>     judgement of the path.

Requirement 18 — the `conforming` branch now ends in a refusal, the measurement
the implementation PR had to reproduce is the one already made on #1389, and
the row and the entry carry the planted-binary result and the caveats of
requirement 31. The original paragraph:

Original:

<!-- markdownlint-disable-next-line MD029 -->
> 18. **Statusline surface unmeasured.** Row 37 records how each CLI parses a
>     hook command line in its hooks file; `statusLine.command` in
>     `~/.gemini/antigravity-cli/settings.json` is a different surface whose
>     Windows parsing is not recorded. The implementation PR SHALL reproduce it on
>     Windows with the probe of spec 0237 and add a row 37e to
>     `docs/cli-matrix.md` (interpreter, quoting, working directory, path
>     separators) before setup writes a Windows statusline command line. The
>     module SHALL hold a constant with one entry per measured (CLI, surface,
>     operating system) triple, each entry carrying the recorded interpreter and
>     quoting rule and a status, `conforming` when they equal row 37b's for
>     Antigravity CLI and `contradicting` when they differ. It SHALL hold no
>     Windows statusline entry until the implementation PR adds row 37e and the
>     entry in the same diff. The module SHALL refuse to produce a Windows
>     statusline command line when the entry is absent, with a diagnostic saying
>     the surface is unmeasured, and when the entry is `contradicting`, with a
>     diagnostic naming the recorded shape, so the refusal of requirement 16(c) is
>     decided from the constant alone; it SHALL NOT read `docs/cli-matrix.md` at
>     run time. A test, which does read the matrix, SHALL fail when the presence
>     of row 37e and the presence of the entry disagree, or when the entry's
>     recorded interpreter and quoting differ from row 37e's. A delta of this spec
>     that resets the shape after a `contradicting` row SHALL land in one diff
>     with the row and the entry, so no head shows them out of step. macOS and
>     Linux are unaffected.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 18. **Statusline surface measured, and refused (reworded at delta-02).** Row 37
>     records how each CLI parses a
>     hook command line in its hooks file; `statusLine.command` in
>     `~/.gemini/antigravity-cli/settings.json` is a different surface whose
>     Windows parsing was measured on ticket #1389
>     (<https://github.com/crewrig/crewrig/issues/1389#issuecomment-5914514220>).
>     The implementation PR SHALL record that measurement as a row 37e in
>     `docs/cli-matrix.md` (interpreter, quoting, working directory, path
>     separators, and the planted-binary result and caveats of requirement 31)
>     before setup writes, or refuses to write, a Windows statusline command
>     line on the strength of it; it need not reproduce the measurement. The
>     module SHALL hold a constant with one entry per measured (CLI, surface,
>     operating system) triple, each entry carrying the recorded interpreter and
>     quoting rule, the planted-binary result and a status, `conforming` when the
>     interpreter and quoting equal row 37b's for Antigravity CLI and
>     `contradicting` when they differ. It SHALL hold no Windows statusline entry
>     until the implementation PR adds row 37e and the entry in the same diff;
>     that diff SHALL add the entry as `conforming`. The module SHALL refuse to
>     produce a Windows statusline command line in every state of the entry, with
>     one diagnostic chosen from the constant alone (requirement 32): when the
>     entry is absent, or lacks the planted-binary result whatever its status,
>     saying the surface is unmeasured; when the entry carries that result and is
>     `contradicting`, naming the recorded shape; and when it carries that result
>     and is `conforming`, naming the working-directory lookup of requirement
>     16(c) and ticket #1392. The refusal of requirement 16(c) is thus decided
>     from the constant alone, and the module SHALL NOT read `docs/cli-matrix.md`
>     at run time. When it refuses, setup SHALL change neither
>     `statusLine.command` nor `<usage root>/state/antigravity-statusline.json`,
>     SHALL leave an existing statusline command as registered, without a backup,
>     and SHALL report the refusal as requirement 26 reports a command it left.
>     The implementation PR SHALL also record the refusal as a parity gap, with
>     the evidence of row 37e and ticket #1392, in `docs/cli-matrix.md`, as
>     parent requirement 19 of spec 0215 requires of every (CLI × operating
>     system) cell where a migrated component cannot work. A test, which does
>     read the matrix, SHALL fail when the presence of row 37e and the presence
>     of the entry disagree, when the entry's recorded interpreter and quoting
>     differ from row 37e's, or as requirement 31 provides for the
>     planted-binary result. A delta of this spec that sets a safe shape, or that
>     resets the shape after a `contradicting` row, SHALL land in one diff with
>     the row and the entry, so no head shows them out of step. macOS and Linux
>     are unaffected.

Requirement 28, item (b) — the statusline leg cannot run a command line the
module no longer produces, so it asserts the refusal and the planted-binary
case instead. Items (a) and (c) and the rest of the item are unchanged. The
original paragraph:

Original:

<!-- markdownlint-disable-next-line MD029 -->
> 28. **`windows-latest` proof (parent requirement 17).** The implementation PR
>     SHALL add jobs, copied from the template of spec 0240 requirement 12 and
>     recorded in `ci/ci-capabilities.yml` as `portability: specific`
>     (spec 0240 requirement 15), that from a non-POSIX interpreter (a) invoke
>     `hooks/usage-capture.ts` and `hooks/antigravity-statusline-shim.ts` and
>     assert a record appears in a temporary usage root, the prior command's
>     output is forwarded, and standard error is empty; (b) run the command line
>     produced for each of the four CLIs through the invocation row 37 records
>     for that CLI — `bash -c` for Claude Code, `powershell.exe -NoProfile
>     -NonInteractive -Command` for Gemini CLI and Copilot CLI, `cmd /c` for
>     Antigravity CLI's hooks surface, and the interpreter row 37e records for
>     its `statusLine.command` surface — and assert the hook ran; the
>     `cmd /c` leg proves the launch semantics of that interpreter, not which
>     interpreter Antigravity CLI uses for a status line, which is row 37e's
>     to state; and (c) enforce the budgets of
>     requirement 15.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 28. **`windows-latest` proof (parent requirement 17) (reworded at delta-02).**
>     The implementation PR
>     SHALL add jobs, copied from the template of spec 0240 requirement 12 and
>     recorded in `ci/ci-capabilities.yml` as `portability: specific`
>     (spec 0240 requirement 15), that from a non-POSIX interpreter (a) invoke
>     `hooks/usage-capture.ts` and `hooks/antigravity-statusline-shim.ts` and
>     assert a record appears in a temporary usage root, the prior command's
>     output is forwarded, and standard error is empty; (b) run the command line
>     produced for each CLI and surface the module still produces through the
>     invocation row 37 records for that CLI — `bash -c` for Claude Code,
>     `powershell.exe -NoProfile -NonInteractive -Command` for Gemini CLI and
>     Copilot CLI, and `cmd /c` for Antigravity CLI's hooks surface — and assert
>     the hook ran, the `cmd /c` leg proving the launch semantics of that
>     interpreter; and, for Antigravity CLI's `statusLine.command` surface, which
>     the module refuses on Windows (requirements 16(c), 18 and 32), assert
>     instead (b1) that the module produces no command line for it and reports the
>     single diagnostic of requirement 32(c), from a checkout path with a space
>     and from one without, and (b2) the planted-binary case of requirement 31,
>     through the invocation row 37e records, from a working directory holding a
>     planted `node.cmd`, which asserts that the planted one runs and fails the
>     job naming the premise of the refusal when it does not; and (c) enforce the
>     budgets of requirement 15.

Scenario "Each CLI's command line launches on Windows" — the Antigravity CLI
statusline shape no longer exists to be run, so its clause is removed, and the
scenario adds what its hooks surface still proves. The original scenario:

Original:

> **Scenario:** Each CLI's command line launches on Windows
>
> Given a `windows-latest` job with a temporary usage root
> When it runs the command line the module produces for each CLI through that CLI's
> interpreter invocation — for Antigravity CLI the hooks-surface shape of row 37b
> and, once row 37e exists, the statusline shape it records — from a checkout path
> that has no space for Antigravity CLI
> Then all four launch the hook and a record or a fast-path exit results.

Replacement:

> **Scenario:** Each CLI's command line launches on Windows (reworded at delta-02)
>
> Given a `windows-latest` job with a temporary usage root
> When it runs the command line the module produces for each CLI through that CLI's
> interpreter invocation — for Antigravity CLI the hooks-surface shape of row 37b
> only, since the module produces no `statusLine.command` on Windows
> (requirement 18) — from a checkout path that has no space for Antigravity CLI
> Then all four launch the hook and a record or a fast-path exit results.

Scenario "A Windows path with a space cannot be wired for Antigravity CLI" — its
Given now yields the statusline refusal, not the path refusal, so the Then
changes; the path-with-space refusal it described is carried by the hooks
surface alone. The original scenario:

Original:

> **Scenario:** A Windows path with a space cannot be wired for Antigravity CLI
>
> Given row 37e records `cmd.exe` and unquoted-path parsing for
> `statusLine.command`, the module's measured-surface constant carries the entry,
> and a Windows checkout at `C:/Users/Ana Diaz/crewrig`
> When the module is asked for the Antigravity CLI `statusLine.command`
> Then it writes nothing, names the space and the path, and the gap is recorded in
> `docs/cli-matrix.md`.

Replacement:

> **Scenario:** A Windows path with a space is refused for the statusline by
> the surface, not by the path (reworded at delta-02)
>
> Given row 37e records `cmd.exe` and unquoted-path parsing for
> `statusLine.command`, the module's measured-surface constant carries the entry
> with the status `conforming`, and a Windows checkout at
> `C:/Users/Ana Diaz/crewrig`
> When the module is asked for the Antigravity CLI `statusLine.command`
> Then it writes nothing and reports the working-directory-lookup diagnostic of
> requirement 32(c) naming #1392, without naming the space or the path as the
> reason; and, when the module is asked instead for the Antigravity CLI hooks
> surface from that same checkout, it writes nothing, names the space and the
> path, and the gap is recorded in `docs/cli-matrix.md`.

Scenario "Row 37e contradicts the hooks-surface shape" — its entry now carries
the planted-binary result, because an entry without it is unmeasured under
requirement 32(a), so the `Given` names it. The original scenario:

Original:

> **Scenario:** Row 37e contradicts the hooks-surface shape
>
> Given row 37e records that Antigravity CLI parses `statusLine.command` with an
> interpreter or quoting other than row 37b's, and the constant's entry carries
> that recorded shape with the status `contradicting`
> When setup is asked for a Windows `statusLine.command`
> Then the module refuses with a diagnostic naming the recorded shape, no command
> line is written, and the guard test passes; no command line is written until a
> delta of this spec sets the shape, landing in one diff with the row and the
> entry.

Replacement:

> **Scenario:** Row 37e contradicts the hooks-surface shape (reworded at delta-02)
>
> Given row 37e records that Antigravity CLI parses `statusLine.command` with an
> interpreter or quoting other than row 37b's, and the constant's entry carries
> that recorded shape and the planted-binary result with the status
> `contradicting`
> When setup is asked for a Windows `statusLine.command`
> Then the module refuses with a diagnostic naming the recorded shape, no command
> line is written, and the guard test passes; no command line is written until a
> delta of this spec sets the shape, landing in one diff with the row and the
> entry.

Requirements 19, 26, 27 and 30, and the scenario "A Windows statusline line is
not written before it is measured", need no change, and their absence is
recorded here so it is a decision. Requirement 19's rewrite of
`statusLine.command` and requirement 26's report already cover a command the
module declines to produce, by requirement 18 as reworded above; the scenario
keeps describing the state with no entry, which this delta leaves in force;
requirement 27 lists deviations from the shell behaviour, and a status line that
cannot be wired on Windows is a parity gap under parent requirement 19, not a
deviation; and requirement 30, which lists the documentation pages, workflow
files and manifests to update and names neither row 37e nor a parity-gap entry,
is left as it stands because the recording of row 37e is the duty of
requirements 18 and 31 and the recording of the parity gap the duty of
requirement 18 as reworded above. Requirement 20's and requirement 22's
behaviour is untouched.

## REMOVED

Nothing is removed.
