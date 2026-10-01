---
id: "0243"
slug: usage-capture-hooks-typescript
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1392
version: 3.1.0
---

# Usage-capture hook and Antigravity statusline in TypeScript

*Delta 03 of `specs/0243-usage-capture-hooks-typescript.md`, cumulative on
`specs/0243-usage-capture-hooks-typescript.delta-01.md` and
`specs/0243-usage-capture-hooks-typescript.delta-02.md`. Source: ticket #1392,
which owns the safe form of the Windows Antigravity CLI `statusLine.command`
that delta-02 refused. Delta-02 refused it because the `cmd.exe` that runs it
resolves a bare `node` from the directory the user starts `agy` in, before
`PATH` (row 37e, the measurement on #1389,
<https://github.com/crewrig/crewrig/issues/1389#issuecomment-5914514220>).
The owner chose, at a user-validate gate, the **guarded form**
`set NoDefaultCurrentDirectoryInExePath=1&& node <abs> <args>`. `cmd.exe`
leaves out the current-directory step of its program search when that
environment variable exists. This is the documented
`NeedCurrentDirectoryForExePathW` behaviour. `set` is a `cmd.exe` builtin, so
no file can stand in for it, and the variable lives only in that `cmd.exe`
process and its children, so no machine policy changes. The form applies to
both Antigravity CLI surfaces on Windows, `statusLine.command` and the hooks
surface. For each surface it is conditional: the module produces it only when
that surface's row and the constant's entry record a measurement of the
guarded form itself under Antigravity CLI. The row, the entry and the
implementation land in one diff, as requirements 18 and 31 already provide.
Reference measurement under Antigravity CLI
(<https://github.com/crewrig/crewrig/issues/1392#issuecomment-5934346722>):
the guarded form holds on both surfaces. With a `node.cmd`, `node.bat` or
`node.exe` planted in the surface's working directory, it ran the real
`C:\Program Files\nodejs\node.exe` on all 27 status-line draws and all
3 hooks firings. The bare `node` controls were hijacked by all three plants on
both surfaces. The status line runs in the directory `agy` is started in, and
the hooks in `~\.gemini\config`. In both cases `agy` wraps the command as
`cmd /c "<command>"` with each inner `"` escaped as `\"`. The `&&` stays
outside any quote run, and `node` sees the value `1` exactly. An exploratory
pre-check had found the same: a synthetic `cmd.exe /c "<command>"` harness on
Windows 11 26200 ARM64, without `agy`. This delta also corrects a factual
statement of delta-02 requirement 33. Row 37 does record the working directory
of Antigravity CLI's hooks surface on Windows (`~\.gemini\config`, Antigravity
CLI 1.2.13, case I). What no row recorded for that surface was a planted-binary
result, which the measurement above supplies. That directory is the user's own
configuration directory, not a repository, so the exposure there is lower. The
bare form is not kept for that reason. This delta runs under the release-branch
regime of `specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR
targets `release/1231-ts-migration`. The version is a MINOR bump. Every change
here applies only once an entry carries a guarded-form result, and no entry on
the release branch carries one yet. In the state the shipped implementation
records, without that result, each requirement reworded below still resolves
to what delta-02 specified: the refusal for `statusLine.command`, the bare form
for the hooks surface. No requirement the shipped implementation satisfies is
invalidated.*

## ADDED

**Requirement 34 — Recognition of the guarded form.** The guarded prefix is the
exact text `set NoDefaultCurrentDirectoryInExePath=1&&` followed by one
space. That is `set`, one
space, the variable name in this letter case, `=1`, `&&` with no space before
it, and one space after it, followed by `node`, one space, an unquoted
forward-slash absolute path and the arguments of requirement 16(c). Setup SHALL
recognise a command made of that prefix and the direct form of requirement 16(c)
as the direct form of requirement 16, and treat it as it treats any
direct-form command, for keep, remove and re-point. In particular:

- keep: a recognised guarded command is already the direct form, so it writes
  nothing and creates no backup;
- remove: restoring the prior command, which identifies the framework's status
  line by the equality of the marker of requirement 19, behaves as before;
- re-point: the command is rebuilt from the registered path's checkout as a
  direct-form command would be.

This recognition SHALL be distinct from the POSIX `NAME=value` prefix grammar
that requirement 20 accepts and that delta-01's requirement 19 leaves
unchanged. The guarded prefix is not an environment assignment in the sense of
delta-01. A guarded command is never left or reported for carrying one. Delta-01
neither widens nor narrows the POSIX grammar.
The guarded prefix SHALL be accepted only for the descriptors whose command
lines the module produces in that form: in this ticket, the Antigravity CLI
statusline descriptor, and the Antigravity CLI hooks-surface descriptors that
rows C2 and C3 register (requirement 33). The usage-capture
signature of requirement 20 SHALL keep rejecting it in both twins. The shared
fixture corpus SHALL gain rejection cases proving this, in the Bash library and
in the TypeScript module alike.

On Windows, a statusline command that setup recognises as the framework's, by
the marker equality of requirement 19, and that has the bare
`node <abs> <args>` shape of requirement 16(c) without the guarded prefix,
SHALL be rewritten to the guarded form when requirement 32(e) applies, as
requirement 19 rewrites any shape that is not current. It SHALL be left and
reported otherwise. A bare `node` command line is never kept silently on
Windows as if it were the current form.

The null case: a command that differs from the guarded prefix by any byte is
not the framework's guarded form, and setup SHALL NOT treat it as one. Examples
are another variable (`set FOO=1&& node …`), a second `set` before or after
ours, a space before `&&`, another letter case, a quoted path or other
arguments. Setup leaves it as an unrecognised shape, rewrites, removes and
deduplicates nothing on its strength, and reports it as requirement 26 reports
a command it left. On macOS and Linux the module never produces the guarded
form, and the shapes of requirement 16(a) are recognised as before. The
permitted path for an operator who wants their own `set …&&` prefix: they keep
it outside the framework's command, since setup only ever writes and recognises
its own.

**Requirement 35 — Propagation of the variable is intended.** The variable set
by the guarded prefix is inherited by the `node` process it launches and by
every child process of it. That includes the prior command that
`hooks/antigravity-statusline-shim.ts` hands to `%ComSpec%` under requirement 13
(`priorStatusLineCommand`), and every process a hook started through the
guarded form on the hooks surface launches (requirement 33). That prior command and anything it launches
therefore no longer find a program in the current directory without a path.
This SHALL be the intended behaviour, not a deviation to mitigate. A prior
status line that relied on that lookup was exposed to the same hijack the guard
closes.

Setup SHALL report this in the install and rewrite messages for a Windows
statusline when the marker records a non-empty `priorStatusLineCommand`. The
implementation PR SHALL document it beside the guarded form in
`docs/usage-capture.md` and in row 37e. The null case: with an empty or absent
prior command nothing inherits the variable except the shim itself, and setup
reports nothing more. On macOS and Linux nothing changes. The permitted path
for an operator whose prior command needs a program in the current directory:
they name that program by an explicit path in their prior command.

**Requirement 36 — What the guard does not cover.** The guard SHALL be
described, in row 37e and in `docs/usage-capture.md`, as closing the implicit
current-directory step of the `cmd.exe` search only. It does not close a `PATH`
that itself names the current directory: a `.` entry, an empty entry, a
relative entry, or an entry that the user can write and that comes before the
real `node`. The module SHALL NOT read, rewrite or judge `PATH`. The null case:
a `PATH` with no such entry leaves the real `node` as the only candidate the
search can reach. The permitted path for a user whose `PATH` holds such an
entry: they remove it. That is machine configuration and outside setup's
writes.

**Scenario:** A measured guarded form wires the Windows statusline

Given row 37e and the constant's entry, `conforming`, carrying the bare
planted-binary result of requirement 31 and a guarded-form result recording
that the real `node` ran and the planted one did not, with no prior status line
(then one prior command `mytool --brief`), and a Windows checkout at
`C:/Users/ana/crewrig`
When setup is asked for the Antigravity CLI `statusLine.command`, for a fresh
enable
Then setup writes the command
`set NoDefaultCurrentDirectoryInExePath=1&& node C:/Users/ana/crewrig/hooks/antigravity-statusline-shim.ts`
to `statusLine.command` and records it as `installedStatusLineCommand` in the
marker, after a 0600 backup. With the prior command, setup's message also says
that `mytool --brief` now runs with the current-directory lookup disabled. A
second run, answering `keep`, writes nothing and creates no backup. Answering
`remove` restores the prior command.

**Scenario:** A path with a space is refused by the path for the statusline

Given the entry of the previous scenario and a Windows checkout at
`C:/Users/Ana Diaz/crewrig`
When setup is asked for the Antigravity CLI `statusLine.command`
Then the module produces no command line and reports the diagnostic of
requirement 17 naming the whitespace and the path, not a statusline diagnostic
of requirement 32. Setup writes nothing and creates no backup. The case is the
parity gap of requirement 17 recorded in `docs/cli-matrix.md`.

**Scenario:** An entry without a guarded-form result keeps the delta-02 refusal

Given row 37e and the entry, `conforming`, carrying the bare planted-binary
result and no guarded-form result, as the release branch records them before
this delta is implemented
When setup is asked for a Windows `statusLine.command`, from
`C:/Users/ana/crewrig` and from `C:/Users/Ana Diaz/crewrig`
Then the module produces no command line and reports, for both paths, the
single working-directory-lookup diagnostic of requirement 32(c) naming #1392.

**Scenario:** A guarded form that does not hold is refused

Given an entry whose guarded-form result records that the planted binary ran
When setup is asked for a Windows `statusLine.command`
Then the module produces no command line and reports the single diagnostic of
requirement 32(d), saying that the recorded measurement found the guarded form
hijacked and naming #1392. Setup writes nothing.

**Scenario:** Only the framework's own guarded prefix is recognised

Given a marker whose `installedStatusLineCommand` equals the current
`statusLine.command`, and that command being, in turn,
`set FOO=1&& node C:/repo/hooks/antigravity-statusline-shim.ts`,
`set NoDefaultCurrentDirectoryInExePath=1 && node C:/repo/hooks/antigravity-statusline-shim.ts`
and
`set NoDefaultCurrentDirectoryInExePath=1&& node C:/repo/hooks/antigravity-statusline-shim.ts`
When setup runs with `keep`
Then the first two are left byte-identical and reported as an unrecognised
shape, and the third is kept as the direct form, with nothing written in any of
the three cases. And when the usage-capture signature of requirement 20, in
both twins, is given
`set NoDefaultCurrentDirectoryInExePath=1&& node "/repo/hooks/usage-capture.ts" claude-code Stop`,
it rejects it. When the signature is given
`NoDefaultCurrentDirectoryInExePath=1 node "/repo/hooks/usage-capture.ts" claude-code Stop`,
it still recognises it, under the POSIX `NAME=value` grammar that delta-01
leaves unchanged.

**Scenario:** A framework statusline in the bare form is upgraded on Windows

Given a Windows `statusLine.command` equal to the marker's
`installedStatusLineCommand` and reading
`node C:/Users/ana/crewrig/hooks/antigravity-statusline-shim.ts`, and an entry
under which requirement 32(e) applies
When setup runs with `keep`
Then the command is rewritten to the guarded form in the three ordered writes
of requirement 19, after a 0600 backup, and the rewrite is reported. Under an
entry where requirement 32(e) does not apply, the command is left byte-identical
and reported with the statusline diagnostic of requirement 32.

**Scenario:** The hooks surface receives the guarded form once row 37f exists

Given row 37f and the constant's Antigravity CLI hooks entry, `conforming`,
carrying the bare planted-binary result and a guarded-form result recording
that the real `node` ran, and a descriptor registered by a later row (the
fixture descriptor of requirement 25 in this ticket's tests)
When the module is asked for that descriptor's Antigravity CLI hooks command
line on Windows, from `C:/Users/ana/crewrig` (then from
`C:/Users/Ana Diaz/crewrig`)
Then it produces `set NoDefaultCurrentDirectoryInExePath=1&& node <abs> <args>`
with the path unquoted and in forward slashes, and from the path with a space
it refuses with the diagnostic of requirement 17 naming the whitespace. When
the hooks entry carries no guarded-form result instead, the module produces
the bare form of requirement 16(c), and the guard test fails, because row 37f
carries a result that the entry does not.

**Scenario:** The guarded prefix is recognised on a hooks descriptor

Given the hooks entry in state (e) of requirement 32, and a Windows Antigravity
CLI `hooks.json` holding two entries for the fixture descriptor of requirement
25: the command the module produces for it,
`set NoDefaultCurrentDirectoryInExePath=1&& node C:/repo/hooks/<fixture>.ts <args>`,
and the same text with a space before `&&`
When setup runs over that file with `keep` (then with `remove`)
Then, with `keep`, the first entry is kept as the direct form and the second
is left byte-identical and reported as an unrecognised shape, with nothing
written and no backup created. With `remove`, the first entry is deleted after
a 0600 backup and the second is left byte-identical.

**Scenario:** A mixed guarded-form result is hijacked

Given a statusline entry, `conforming`, carrying the bare planted-binary result
and a guarded-form result whose `node.cmd` and `node.bat` plants were bypassed
but whose `node.exe` plant ran
When setup is asked for a Windows `statusLine.command`
Then the entry is in state (d) of requirement 32, and the module refuses with
that state's diagnostic.

**Scenario:** macOS and Linux are untouched

Given the entry of the first scenario and a checkout on macOS (then Linux)
When setup is asked for the Antigravity CLI `statusLine.command`
Then it writes `node "<abs>/hooks/antigravity-statusline-shim.ts"` as before,
without the guarded prefix.

**Out of scope item.** Alternatives rejected for the safe form, recorded so the
choice is a decision:

- (A) An absolute interpreter path in its 8.3 short form, needed because a
  quoted spaced path does not launch under this wrapper (row 37e, Q0). 8.3
  names can be disabled per volume. The path would also be pinned at setup, so
  it breaks as soon as nvm-windows, volta or fnm switches the active Node.js.
- (C) A generated `.cmd` shim at a fixed absolute path. It needs a delta of
  spec 0215 (requirements 1 and 15), since it adds an intermediate entry point.
  The shim's own path must contain no space. `C:\ProgramData` would be a new
  surface where a file could be planted. A naive shim that calls a bare `node`
  is itself hijacked: only `%~$PATH:` resolution protects it.
- (D)+(A) The guarded form with an 8.3 fallback: two code paths for a risk that
  the measurement of the guarded form removes.

**Out of scope item.** Planting `node.exe`, or a candidate other than
`node.cmd` and `node.bat`, in the `windows-latest` job of requirement 28(b).
The CI leg plants those two text scripts only, and the bare-node control of
(b3) plants `node.cmd` only. The wider coverage stays with the exploratory
pre-check and the recorded measurement, as caveats of requirement 31 state.

## MODIFIED

Requirement 16, item (c) — the conforming branch now yields the guarded form
on both Antigravity CLI surfaces, under the condition requirement 32(e) states
for the statusline and requirement 33 for the hooks surface. Original
(delta-02 replacement):

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

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 16. **Per-CLI command-line shape (reworded at delta-03).** One shared
>     TypeScript module under
>     `scripts/lib/` (spec 0240 requirement 11) SHALL be the single source of the
>     direct `node` command line each CLI receives, in the form the interpreter
>     that CLI uses on Windows parses (rows 37–37f of `docs/cli-matrix.md`):
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
>     For its `statusLine.command` surface, which row 37e records with the same
>     interpreter and quoting, the bare `node` of that form is resolved from the
>     directory the user starts Antigravity CLI in, before `PATH` (CWE-427,
>     row 37e, requirement 31). The module SHALL therefore produce for that
>     surface only the **guarded form**
>     `set NoDefaultCurrentDirectoryInExePath=1&& node <abs> <args>`, with the
>     path unquoted. `cmd.exe` then leaves out its current-directory step. `set`
>     is a builtin that no file can replace, and the variable lives only in that
>     `cmd.exe` process and its children (requirement 35). The module SHALL
>     produce the guarded form only under requirement 32(e), that is, when row
>     37e and the entry of requirement 18 record a measurement of the guarded
>     form under Antigravity CLI in which the real `node` ran and a planted one
>     did not. In every other state it SHALL refuse with the single diagnostic
>     of requirement 32, which names ticket #1392. The `&&` and the `=` belong to
>     the template and are never judged as part of the path, which requirement
>     17 judges for `cmd.exe` as before. The hooks surface, whose `cmd.exe` runs
>     in `~\.gemini\config` (row 37), SHALL receive the same guarded form under
>     requirement 33. The outcome for each surface is the one requirement 32
>     gives in the state of that surface's own row and entry. In the states
>     where requirement 32 gives the hooks surface the bare form of this item,
>     that text is the module's output only, and no row writes it on Windows
>     (requirement 33). Should row 37e
>     ever record an interpreter or quoting other than row 37b's, the module
>     refuses (requirement 18). Every absolute path SHALL use forward slashes on
>     Windows (rows 37b and 37d) and be the physical path of the checkout. The
>     null case: on macOS and Linux no form carries the guarded prefix.

Requirement 17 — the statusline is judged by the path again once it can be
wired, so a Windows checkout path with a space becomes a parity gap of that
surface again. The template's `&` is not a character of the path. The parity
gap entry is reworded accordingly. Original (delta-02 replacement):

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

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 17. **Unsafe path refusal (reworded at delta-03).** The module SHALL refuse,
>     with a diagnostic naming
>     the character and the path and without writing anything, a checkout path
>     that its target interpreter would read as syntax: `"`, `$`, a backtick or a
>     newline for every interpreter, plus, for `cmd.exe`, whitespace and any of
>     `& | < > ^ % ( )`. Only the checkout path is judged. The `&&` and `=` of
>     the guarded prefix of requirement 16(c) belong to the template, which the
>     module writes itself. Refusing is the null case of requirement 16(c) for
>     both Antigravity CLI surfaces on Windows. For the hooks surface, and for
>     the `statusLine.command` once requirement 32(e) applies, a checkout path
>     containing a space cannot be wired. The implementation PR reports it as a
>     parity gap per parent requirement 19 in `docs/cli-matrix.md`. The
>     parity-gap entry SHALL name both surfaces in that case. While requirement
>     32(e) does not apply, it SHALL state the statusline refusal of requirement
>     32 as a separate case, with the evidence of row 37e and ticket #1392. It
>     SHALL state the residual of requirement 36. When requirement 17 and a
>     statusline refusal of requirement 32 would both refuse, the
>     statusline diagnostic SHALL be the one reported, since it concerns the
>     surface and precedes any judgement of the path. No command line that
>     cannot launch, or that would launch the wrong program, is ever written.

Requirement 18 — the module no longer refuses the Windows statusline in every
state of the entry. The entry carries a second result, for the guarded form.
Original (delta-02 replacement):

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

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 18. **Statusline surface measured, guarded or refused (reworded at
>     delta-03).** Row 37 records how each CLI parses a
>     hook command line in its hooks file; `statusLine.command` in
>     `~/.gemini/antigravity-cli/settings.json` is a different surface whose
>     Windows parsing was measured on ticket #1389
>     (<https://github.com/crewrig/crewrig/issues/1389#issuecomment-5914514220>),
>     and whose guarded form was measured on ticket #1392
>     (<https://github.com/crewrig/crewrig/issues/1392#issuecomment-5934346722>).
>     Row 37e of `docs/cli-matrix.md` SHALL record the interpreter,
>     the quoting, the working directory and the path separators. It SHALL also
>     record the planted-binary result of the bare form and the planted-binary
>     result of the guarded form, each with its caveats (requirement 31). The
>     module SHALL hold a constant with one entry per measured (CLI, surface,
>     operating system) triple. Each entry SHALL carry the recorded interpreter
>     and quoting rule, the planted-binary result of the bare form, the
>     guarded-form result where one is recorded, and a status: `conforming` when
>     the interpreter and quoting equal row 37b's for Antigravity CLI,
>     `contradicting` when they differ. The implementation PR of ticket #1392
>     SHALL add the guarded-form result to row 37e and to the entry in one diff
>     with the code that produces the guarded form. It SHALL do the same, in
>     that diff, for the Antigravity CLI hooks surface, through the row and the
>     hooks entry of requirement 33.
>
>     The module SHALL produce a Windows statusline command line only in state
>     (e) of requirement 32. In each other state it SHALL refuse with the single
>     diagnostic that requirement 32 chooses from the constant alone. It SHALL
>     NOT read `docs/cli-matrix.md` at run time. When it refuses, setup SHALL
>     change neither `statusLine.command` nor
>     `<usage root>/state/antigravity-statusline.json`. It SHALL leave an
>     existing statusline command as registered, without a backup, and SHALL
>     report the refusal as requirement 26 reports a command it left. Every
>     state that refuses is a parity gap recorded per requirement 17.
>
>     A test, which does read the matrix, SHALL fail in each of these cases:
>     the presence of row 37e and the presence of the entry disagree; the
>     entry's recorded interpreter and quoting differ from row 37e's; or a
>     planted-binary result disagrees as requirement 31 provides. A delta of
>     this spec that changes the shape, or that resets it after a
>     `contradicting` row, SHALL land in one diff with the row and the entry, so
>     no head shows them out of step. macOS and Linux are unaffected.

Requirement 28, item (b) — the statusline leg runs the guarded form and pins
both results. Items (a) and (c) are unchanged. Original (delta-02 replacement):

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

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 28. **`windows-latest` proof (parent requirement 17) (reworded at delta-03).**
>     The implementation PR
>     SHALL add jobs, copied from the template of spec 0240 requirement 12 and
>     recorded in `ci/ci-capabilities.yml` as `portability: specific`
>     (spec 0240 requirement 15). From a non-POSIX interpreter, the jobs SHALL:
>
>     - (a) invoke `hooks/usage-capture.ts` and
>       `hooks/antigravity-statusline-shim.ts` and assert that a record appears
>       in a temporary usage root, that the prior command's output is forwarded,
>       and that standard error is empty;
>     - (b) run the command line the module produces for each CLI and surface
>       through the invocation row 37 or row 37e records for it, and assert that
>       the hook ran. The invocations are `bash -c` for Claude Code,
>       `powershell.exe -NoProfile -NonInteractive -Command` for Gemini CLI and
>       Copilot CLI, and, for both Antigravity CLI surfaces, the guarded form
>       through `cmd /c` with the whole command in one pair of quotes and each
>       inner `"` escaped as `\"` (rows 37e and 37f). Each leg proves the launch
>       semantics of its interpreter. For the `statusLine.command` the jobs
>       SHALL further assert (b1), and for both Antigravity CLI surfaces (b2)
>       and (b3):
>       - (b1) the module's result from a checkout path with a space, which is
>         the refusal of requirement 17 naming the whitespace when requirement
>         32(e) applies, and the single diagnostic of requirement 32 otherwise;
>       - (b2) with a working directory holding a planted `node.cmd`, and
>         separately with one holding a planted `node.bat`, the guarded form
>         produced by the module for the surface runs the real `node` and not the planted one.
>         When a planted one runs, the job SHALL fail naming the guard and the
>         planted file;
>       - (b3) from the same working directory, the bare `node <abs> <args>`
>         text of requirement 16(c), used as a fixture and never produced by the
>         module for this surface, still runs the planted `node.cmd` and not the
>         real `node`. When it does not, the job SHALL fail naming the premise
>         of the guard, so that the guard is revisited instead of staying on an
>         outdated premise;
>     - (c) enforce the budgets of requirement 15.

Requirement 31 — the row and the entry carry a second result, for the guarded
form, with its own caveats. The guard test covers it. Original (delta-02, ADDED,
the paragraph that follows the caveat list):

> The `windows-latest` leg of requirement 28(b) is the only repetition on x64
> that this ticket makes, and only for the planted-binary case; it does not turn
> the row's ARM64 or version caveats into findings about x64 or about another
> Antigravity CLI release. The test of requirement 18 SHALL also fail when the
> planted-binary result recorded in row 37e and the one carried by the constant's
> entry differ, when the entry lacks the result whatever its status, or when the
> row lacks it while the entry carries it. The null case: a row or entry that
> omits the planted-binary result is malformed, and the module SHALL treat a
> Windows `statusLine.command` entry that lacks it as unmeasured — whatever its
> status, `contradicting` included — and refuse under the diagnostic of
> requirement 18 for an absent entry, which requirement 32(a) states. The
> permitted path for a reader who needs a different Windows,
> architecture or release coverage: a later delta that records its own measurement
> in a new row or a revised entry, in one diff, never a silent widening of this
> one.

Replacement:

> The `windows-latest` leg of requirement 28(b) is the only repetition on x64
> that this ticket makes, and only for the planted-binary cases; it does not turn
> the row's ARM64 or version caveats into findings about x64 or about another
> Antigravity CLI release. The test of requirement 18 SHALL also fail when the
> planted-binary result recorded in row 37e and the one carried by the constant's
> entry differ, when the entry lacks the result whatever its status, or when the
> row lacks it while the entry carries it.
>
> **Guarded-form result (added at delta-03).** Row 37e and the entry SHALL also
> carry the result of the guarded form of requirement 16(c), measured under
> Antigravity CLI from a working directory holding a planted binary. The result
> says whether the real `node` ran and the planted one did not. It comes with
> its caveats, stated as the source states them
> (<https://github.com/crewrig/crewrig/issues/1392#issuecomment-5934346722>).
> The recorded result: with a `node.cmd`, a `node.bat` or a `node.exe` planted
> in the working directory, the guarded form ran the real
> `C:\Program Files\nodejs\node.exe` on every draw (11, 7 and 9 draws) and the
> planted one on none, while the bare-`node` controls ran the planted one on
> every draw (12, 9 and 2 draws). The caveats:
>
> - Windows 11 Pro 10.0.26200 **ARM64** in a virtual machine, whereas
>   `windows-latest` is x64; Antigravity CLI **1.2.14**, the release of the
>   first row 37e measurement; Node.js 24.21.0.
> - `statusLine.command` was observed on the idle start-up screen only, as on
>   #1389, and no turn was observed.
> - One plant was present per run, in the surface's working directory only.
>   Nothing was planted earlier on `PATH` (requirement 36).
> - The measurement used a purpose-built marker probe, not the probe of spec
>   0237: that probe hides the value of `NoDefaultCurrentDirectoryInExePath`.
>   The parent command line was captured from inside `cmd.exe` through
>   `%CMDCMDLINE%`, because `wmic` is no longer present on the host.
> - The `node.exe` bare control drew twice in 60 s, against 7 to 12 draws for
>   every other case; the cause was not investigated.
>
> The fourth caveat of the list above SHALL be reworded: the #1389 bare result
> was measured with `node.cmd` only and no alternative form, whereas the #1392
> measurement planted `node.cmd`, `node.bat` and `node.exe` for both the bare
> and the guarded form. The test of requirement 18 SHALL fail when row 37e and the entry
> disagree on the guarded-form result or its caveats, and when one carries the
> result and the other does not.
>
> The null case: an entry that carries no guarded-form result is not malformed.
> It is the delta-02 state. When it also carries the bare result and is
> `conforming`, it is state (c) of requirement 32, and the module SHALL refuse
> the statusline under that state.
> A row or entry that omits the bare planted-binary result is still malformed,
> and the module SHALL treat a Windows `statusLine.command` entry that lacks it
> as unmeasured — whatever its status, `contradicting` included, and whatever
> guarded-form result it carries — and refuse under requirement 32(a). The
> permitted path for a reader who needs a different Windows, architecture or
> release coverage: a later delta that records its own measurement in a new
> row or a revised entry, in one diff, never a silent widening of this one.

Requirement 32 — one exhaustive list of entry states now covers both
Antigravity CLI surfaces on Windows, with an outcome for each surface. The
statusline outcomes of delta-02's (a) and (b) are unchanged, and its (c) splits
in three, one of which yields a command line judged by requirement 17.
Original (delta-02, ADDED):

> **Requirement 32 — Precedence among the statusline diagnostics.** For a Windows
> Antigravity `statusLine.command` the module SHALL report exactly one refusal
> diagnostic, chosen from the constant alone by the entry's state, and that
> diagnostic SHALL come before, and SHALL replace, any judgement of the checkout
> path under requirement 17: (a) no entry, or an entry that lacks the
> planted-binary result whatever its status — the surface is unmeasured
> (requirement 18); (b) an entry that carries the planted-binary result and is
> `contradicting` — the recorded shape (requirement 18); (c) an entry that
> carries the planted-binary result and is `conforming` — the working-directory
> lookup of requirement 16(c), named in the wording of that item. The three are
> mutually exclusive by construction: (b) and (c) apply only to an entry that
> carries the planted-binary result, and an entry that lacks it, `contradicting`
> included, falls under (a) and under no other, which is also what requirement 31
> and its guard test provide. No ordering among them is needed; the ordering
> that matters is each of them against requirement 17, and each precedes it,
> because each concerns the surface and none concerns the path. A checkout path that requirement 17 would
> refuse gives the same single diagnostic as one it would accept. The null case:
> on macOS and Linux, and for every surface other than the Windows Antigravity
> `statusLine.command`, none of (a) to (c) applies and requirement 17 is judged as
> before.

Replacement:

> **Requirement 32 — States of the Windows Antigravity CLI entries (reworded
> at delta-03).** For each Antigravity CLI surface on Windows, the
> `statusLine.command` and the hooks surface, the module SHALL decide from the
> constant alone, by the state of that surface's entry, between exactly one
> refusal diagnostic, the bare form of requirement 16(c) and the guarded form.
> The state is read from four facts about the entry: whether it exists, whether
> it carries the bare planted-binary result, its status, and its guarded-form
> result, which is absent, holding or hijacked. A guarded-form result is
> **holding** only when every planted candidate it records was bypassed, so
> that the real `node` ran and no planted one did. A single hijack, even one
> among several candidates, makes the result **hijacked**.
>
> | State | Entry | `statusLine.command` | Hooks surface |
> |---|---|---|---|
> | (a1) | none | refusal: unmeasured | refusal: unmeasured |
> | (a2) | no bare result, a guarded-form result (malformed, requirement 31) | refusal: unmeasured | refusal: unmeasured |
> | (a3) | no bare result, no guarded-form result, `conforming` (malformed, requirement 31; transitional) | refusal: unmeasured | bare form |
> | (a4) | no bare result, no guarded-form result, `contradicting` (malformed, requirement 31; transitional) | refusal: unmeasured | refusal: the recorded shape |
> | (b) | bare result, `contradicting`, any guarded-form result | refusal: the recorded shape | refusal: the recorded shape |
> | (c) | bare result, `conforming`, no guarded-form result | refusal: the working-directory lookup, naming #1392 (the delta-02 diagnostic) | bare form |
> | (d) | bare result, `conforming`, a hijacked guarded-form result | refusal: the guarded form was found hijacked, naming #1392 | refusal: the same, worded for the hooks surface |
> | (e) | bare result, `conforming`, a holding guarded-form result | guarded form | guarded form |
>
> The states are mutually exclusive and exhaustive by construction. (a1)
> takes the absent entries. (a2) to (a4) divide the entries without the bare
> result: those that carry a guarded-form result, then those that carry none,
> by status. (b) takes the `contradicting` entries among the rest. (c), (d) and
> (e) divide the `conforming` ones by their guarded-form result: absent,
> hijacked or holding. A reference elsewhere in this spec to requirement 32(a)
> means states (a1) to (a4). States (a2) to (a4) are all malformed under
> requirement 31, and the guard test fails on each of them once it covers the
> entry. None is a steady state. (a3) is the state of the hooks entry on the
> release branch only until the implementation PR of ticket #1392 adds row 37f
> and the hooks entry's results in one diff (requirement 33). From then on, the
> guard test of requirements 18 and 31 keeps both entries out of (a2) to (a4).
> The outcomes in the table are what the module returns if such an entry is
> met anyway. Three decisions are deliberate:
>
> - A `contradicting` entry refuses on both surfaces, even with a holding
>   guarded-form result. The guarded form is the row 37b shape with a prefix,
>   so an interpreter or quoting other than row 37b's leaves the template itself
>   unproven, and a delta must set the shape (requirement 18).
> - The status line refuses in (a3) and (c), as delta-02 specified, while the
>   hooks surface yields the bare form there. This is not an exposure. No row
>   writes the hooks surface on Windows unless its entry is in (e)
>   (requirement 33), so in those states the bare form is only the module's
>   text, as delta-02 left it for rows 37 to 37d, and never a command line
>   written to `hooks.json`. Keeping it avoids changing an output the shipped
>   implementation already returns.
> - (a4) on the hooks surface keeps the recorded-shape refusal that requirement
>   18 gives every `contradicting` hooks triple.
>
> Each refusal comes before, and replaces, any judgement of the checkout path
> under requirement 17, because it concerns the surface and not the path. In
> those states a path that requirement 17 would refuse gives the same single
> diagnostic as one it would accept. Wherever the outcome is the bare form or
> the guarded form, requirement 17 then judges the path. The null case: on
> macOS and Linux, and for every CLI other than Antigravity CLI on Windows,
> none of these states applies, and requirements 16 and 17 apply as before.

Requirement 33 — the hooks surface is now measured, and receives the same
guarded form. The statement that rows 37 to 37d do not record its
working directory is corrected. Original (delta-02, ADDED):

> **Requirement 33 — The hooks surface is assessed before it is wired on
> Windows.** Rows 37 to 37d of `docs/cli-matrix.md` do not record the working
> directory of Antigravity CLI's hooks surface. This delta does not change that
> surface or the form that requirement 16(c) gives it. No later row SHALL wire the
> Antigravity CLI hooks surface on Windows until the same current-directory lookup
> hazard has been assessed for it and the result recorded in `docs/cli-matrix.md`:
> the working directory measured, and a planted-binary check — a `node.cmd` placed
> in that directory, recording which program the `cmd.exe` that parses its hook
> command lines launches — made as for row 37e, with the result and its caveats
> carried the way requirement 31 carries them. The null case: a row that does not
> wire that surface on Windows is not bound by this requirement. The permitted
> paths when the assessment finds that the lookup applies: the row refuses the
> hooks surface on Windows as requirement 16(c) now refuses the statusline, or a
> delta of this spec sets a shape that does not depend on the lookup, in one diff
> with the row that records the assessment. Ticket #1392 is where the safe form of
> the statusline is designed, and is the reference for this assessment.

Replacement:

> **Requirement 33 — The hooks surface is measured and guarded on Windows
> (reworded at delta-03).** Row 37 of `docs/cli-matrix.md` records the working
> directory of Antigravity CLI's hooks surface on Windows as `~\.gemini\config`,
> the directory holding `hooks.json` (Antigravity CLI 1.2.13, case I). The
> measurement on ticket #1392
> (<https://github.com/crewrig/crewrig/issues/1392#issuecomment-5934346722>)
> confirmed that directory under Antigravity CLI 1.2.14. On a `Stop` firing,
> with a `node.cmd`, a `node.bat` or a `node.exe` planted there, the bare
> `node` form ran the planted one each time and the guarded form ran the real
> `node` each time. The implementation PR of ticket #1392 SHALL record this in
> a row 37f of `docs/cli-matrix.md`, following the pattern of row 37e. The row
> SHALL carry one machine-parseable `[measured: …]` token with the interpreter,
> the quoting, the bare planted-binary result, the guarded-form result and the
> caveats, and it SHALL state the working directory and the caveats in prose.
> The caveats are those of requirement 31, except that the surface was fired
> once per run by `Stop`, from a non-interactive `agy --print` in the console
> session, the method of row 37. In the same diff, the hooks entry of the
> constant of requirement 18 SHALL carry the same values. The guard test of
> requirements 18 and 31 SHALL apply to row 37f and that entry as it applies to
> row 37e and the statusline entry.
>
> The module SHALL decide the hooks surface on Windows by the hooks-surface
> column of requirement 32: the guarded form in (e), the bare form in (a3) and
> (c), and the refusal of that column in every other state. Rows C2 and
> C3 SHALL wire the Antigravity CLI hooks surface on Windows only through this
> module and in the guarded form. That surface's working directory is the
> user's own configuration directory, not a repository, so a plant there needs
> write access to the user's home. The exposure is lower than on the status
> line, and this is not a reason to keep the bare form. No row SHALL write an
> Antigravity CLI hooks command line on Windows while the hooks entry is in a
> state other than (e).
>
> The null case: the release branch, before this delta is implemented, holds
> the hooks entry in state (a3). There the module keeps returning the bare form
> of requirement 16(c) for that surface, as delta-02 specified, and no row
> wires the surface on Windows. On macOS
> and Linux nothing changes. The permitted path for a later measurement that
> contradicts this one: a delta of this spec that revises row 37f and the hooks
> entry in one diff, never a silent change of either.

Scenario "A conforming row 37e still does not wire a Windows statusline"
(delta-02, ADDED) — it still holds, but only for an entry without a
guarded-form result. Its `Given` names that state. Original:

> **Scenario:** A conforming row 37e still does not wire a Windows statusline
>
> Given row 37e recording `cmd.exe` and `cmd-no-grouping` for Antigravity CLI's
> `statusLine.command` with the planted-binary result, the constant's entry
> carrying the same values with the status `conforming`, and a Windows checkout
> at `C:/Users/ana/crewrig` (then another at `C:/Users/Ana Diaz/crewrig`)

Replacement:

> **Scenario:** A conforming row 37e without a guarded-form result does not wire
> a Windows statusline (reworded at delta-03)
>
> Given row 37e recording `cmd.exe` and `cmd-no-grouping` for Antigravity CLI's
> `statusLine.command` with the planted-binary result and no guarded-form
> result, the constant's entry carrying the same values with the status
> `conforming`, and a Windows checkout at `C:/Users/ana/crewrig` (then another
> at `C:/Users/Ana Diaz/crewrig`)

The `When` and `Then` of that scenario are unchanged.

Scenario "A Windows path with a space is refused for the statusline by the
surface, not by the path" (delta-02, MODIFIED replacement) — it holds only for
an entry without a guarded-form result. The added scenario "A path with a
space is refused by the path for the statusline" covers state (e). Only the
`Given` changes. Original:

> Given row 37e records `cmd.exe` and unquoted-path parsing for
> `statusLine.command`, the module's measured-surface constant carries the entry
> with the status `conforming`, and a Windows checkout at
> `C:/Users/Ana Diaz/crewrig`

Replacement:

> Given row 37e records `cmd.exe` and unquoted-path parsing for
> `statusLine.command`, the module's measured-surface constant carries the entry
> with the status `conforming`, the bare planted-binary result and no
> guarded-form result (requirement 32(c)), and a Windows checkout at
> `C:/Users/Ana Diaz/crewrig`

Out of scope item "The safe form of a Windows Antigravity CLI
`statusLine.command`" (delta-02, ADDED) — this delta sets that form. Original:

> **Out of scope item.** The safe form of a Windows Antigravity CLI
> `statusLine.command` — an absolute interpreter path, a generated shim, or any
> other form that does not depend on the `cmd.exe` working-directory lookup —
> which is ticket #1392, through its own specs, plan and measurement; and any
> delta of spec 0215 that a form with an intermediate entry point would need.
> This delta chooses none of the candidate forms.

Replacement:

> **Out of scope item (reworded at delta-03).** Any delta of spec 0215 that a
> form with an intermediate entry point would need. Delta-03 sets the safe form
> of the Windows Antigravity CLI `statusLine.command` to the guarded form of
> requirement 16(c), which needs none. It records the rejected alternatives in
> its own out-of-scope item.

Out of scope item "Changing the Antigravity CLI hooks surface, wired by later
rows" (delta-02, ADDED) — requirement 33 now defines what that surface
receives, so the item is narrowed to the wiring itself. Original:

> **Out of scope item.** Changing the Antigravity CLI hooks surface, wired by
> later rows: its form stays that of requirement 16(c), and this delta neither
> measures its working directory nor assesses whether a bare `node` there carries
> a lookup exposure. Rows 37 to 37d do not record that directory, and the only
> statement of it in the record is an unrecorded parenthetical observation in
> the comment of ticket #1389. That assessment is a precondition on the later row
> that wires the surface on Windows (requirement 33), not work of this delta.

Replacement:

> **Out of scope item (reworded at delta-03).** Wiring the Antigravity CLI
> hooks surface, the work of rows C2 and C3: their descriptors, their entries
> in `hooks.json` and their setup flow. This delta sets the form that surface
> receives on Windows, its measurement record and its guard test
> (requirement 33). C2 and C3 consume that form through the module and do not
> redefine it.

Requirements 19, 20, 22, 26, 27 and 30, and delta-02's out-of-scope item on the
`NoDefaultCurrentDirectoryInExePath` policy, need no change, and their absence
is recorded here so it is a decision:

- Requirement 19 already rewrites a recognised framework command to the current
  shape. Requirement 34 states how that applies to the guarded and bare forms.
- Requirement 20's signature, the POSIX `NAME=value` grammar and the corpus
  behaviour on that grammar are unchanged. Requirement 34 adds rejection cases
  only.
- Requirement 22's idempotence holds, because a recognised guarded command
  writes nothing on a second run.
- Requirement 26 already reports every command left. Requirement 35 adds the
  propagation note to the install and rewrite messages.
- Requirement 27 lists deviations from the shell behaviour. The shell never
  wired a Windows status line, so the guarded form is not one of them.
- Requirement 30 is satisfied by updating row 8c, rows 37e and 37f, the parity-gap entry
  and the Windows section of `docs/usage-capture.md`. Requirements 17, 18, 35
  and 36 assign those updates.
- The policy item holds as written. Setup reads, sets and unsets no machine or
  user policy. The guarded prefix sets the variable only in the environment of
  the `cmd.exe` process that Antigravity CLI starts for each draw.

## REMOVED

Nothing is removed.
