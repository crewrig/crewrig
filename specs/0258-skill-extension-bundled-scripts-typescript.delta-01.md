---
id: "0258"
slug: skill-extension-bundled-scripts-typescript
status: approved
complexity: standard
interaction-mode: MINIMAL
related-issue: 1337
version: 1.1.0
---

# Skill- and extension-bundled scripts in TypeScript

*Delta 01 of `specs/0258-skill-extension-bundled-scripts-typescript.md`. Source: the
implementation and review of ticket 1337 (pull requests #1603 to #1607): the oracle, the
differentials and the seated reviews found four differences from the shell that
requirement 31 reserved the letters (o) onward for. It runs under the release-branch
regime of `specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`, and the base ref of every protocol is
`origin/release/1231-ts-migration` (requirement 34 of that delta). This delta modifies
requirements 17, 20 and 31 and adds scenarios. Requirement 17 is modified on the
maintainer's ruling during the pull request D to S2 sequence: an Antigravity hook line
that runs a bare `node` under `cmd.exe` searches the working directory first (CWE-427),
so the line is guarded on a Windows build host. The version is a MINOR bump: no behaviour of
the shell changes, the closed list of deviations is completed with the letters (o) to
(r), each found by a test that names it, and the sentence of requirement 20 that the shell
does not satisfy is corrected. This delta opens no question.*

## ADDED

**Scenario:** A hook stays silent on a closed standard input

Given the `hello-world` hook `shell-logger.ts` started with its standard input closed
When it runs
Then it writes one line feed on standard output, nothing on standard error, and exits 0
(the shell twin prints `read: read error: 0: Bad file descriptor` on standard error and
exits 0).

**Scenario:** A wrapped tool killed by a signal is not announced by the entry

Given a stub `act` that terminates itself with `SIGTERM` and a stub `docker` that
answers
When `node simulate-job.ts <workflow> <job>` runs
Then the exit status is 143 and standard error is empty (the shell passes the same
status through and prints bash's own `Terminated` line); `lint-workflow.ts` with a stub
`actionlint` that dies the same way prints `[FAIL] <file>` and exits 1, as the shell
does, with an empty standard error.

**Scenario:** A hook keeps a partial line received before a read error

Given the `hello-world` hook `shell-logger.ts` fed `{"a":` and then a read error
(`EAGAIN`) with no more data
When it runs
Then it writes `{"a":` followed by one line feed and exits 0 (bash drops the partial
line and writes one line feed).

**Scenario:** `lint-json` validates without `jq`

Given a machine with no `jq` on the path and a file holding invalid JSON with no
trailing comma
When `node lint-json.ts <file>` runs
Then it reports `invalid JSON` and exits 1 (the shell printed that `jq` was not found,
skipped the parse and exited 0).

**Scenario:** The Antigravity hook line is guarded on a Windows build host

Given the `hello-world` extension built for the Antigravity target with the platform
injected as `win32`
When the builder writes the plugin's `hooks.json`
Then the command of `shell-logger` is
`set NoDefaultCurrentDirectoryInExePath=1&& node "hooks/shell-logger.ts"`, and with the
platform injected as `linux` it is `node "hooks/shell-logger.ts"`.

## MODIFIED

**Requirement 17 — Hook command lines.** Original, the closing sentence:

> The builders (spec 0254 requirement 10) SHALL emit the line for the four targets from this
> one source, the Antigravity line being the plugin-relative `node "hooks/<hook>.ts"`.

Replacement:

> The builders (spec 0254 requirement 10) SHALL emit the line for the four targets from this
> one source, the Antigravity line being the plugin-relative `node "hooks/<hook>.ts"` on every
> build host whose platform is not `win32`. On a `win32` build host the Antigravity line SHALL
> be `set NoDefaultCurrentDirectoryInExePath=1&& node "hooks/<hook>.ts"`, the guarded prefix
> `GUARDED_PREFIX` of `scripts/lib/hook-command.ts` that spec 0243 delta-03 adopted after
> `docs/cli-matrix.md` row 37f measured it holding on the Antigravity hooks surface, in front
> of an unquoted absolute script path: under `cmd.exe` a bare `node` is looked up in the
> working directory before `PATH` (CWE-427). The working directory of an Antigravity plugin
> hook, and the behaviour of the quoted plugin-relative remainder under `cmd.exe`, are not
> measured (row 37g and issue #1601 keep those cells as not measured; this delta claims
> neither), and the guard applies whichever directory it is. The
> builder SHALL take the platform from the build context (`ctx.platform`, set from
> `process.platform`), and a test SHALL inject `win32` and `linux` and compare both lines. This
> covers every path that can put an Antigravity `hooks.json` on a Windows machine, because the
> build host is always the machine that runs the builder: the release archive of spec 0257 is
> built on Linux CI with `--target gemini` and serves the Gemini CLI alone (option (a) of spec
> 0183 delta-01), so it can never carry an Antigravity `hooks.json`; the Antigravity plugin is
> built in place by `build-extension.ts --target antigravity` (the installer
> `scripts/lib/install/antigravity-plugin.ts` builds on the user's machine and `agy plugin
> install` copies the result); `dist-antigravity-plugin/` is git-ignored and is never
> link-or-copied. Rejected alternatives: an absolute interpreter path resolved at install time
> (it bakes a machine-specific `process.execPath` into the plugin and breaks the deterministic
> outputs and goldens); refusing to emit the Antigravity hook file on a `win32` build host
> until issue #1601 measures the plugin-root forms (zero risk, but the example hooks would be
> absent on Antigravity for Windows meanwhile); keeping the bare `node` with a recorded risk
> acceptance (ruled out by the maintainer). The Gemini, Claude Code and Copilot lines are
> unchanged: their interpreters are PowerShell and Git Bash, which do not search the working
> directory first.

**Requirement 20 — Failure silence.** Original:

<!-- markdownlint-disable-next-line MD029 -->
> 20. **Failure silence.** A hook SHALL never write to standard error and SHALL exit 0
>     on a read error, as the shell's `read` and `echo` do for a closed input.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 20. **Failure silence.** A hook SHALL never write to standard error and SHALL exit 0 on
>     a read error (a closed standard input, a non-blocking input with no data), writing
>     what it had read and one line feed. The shell twin exits 0 too, but its `read`
>     prints bash's own diagnostic on standard error in those cases and drops a partial
>     line (deviations (p) and (q)); the entry does neither.

**Requirement 31 — Deviations.** Original, the closing sentence of the introduction:

> The deviations from the shell contract are a closed list; letters from (o) onward are
> reserved for what the differential test finds and SHALL be added through a delta of this
> spec.

Replacement:

> The deviations from the shell contract are a closed list; the letters (a) to (n) are
> below and the letters (o) to (r) are the following, each found by a test that names it:
> (o) when a wrapped tool dies of `SIGTERM`, bash prints its own `Terminated` line on
> standard error and the entry prints nothing, the exit status being the same as the
> shell's (143 where the wrapped tool's status passes through, as in `simulate-job` and
> `simulate-workflow`; 1 where the script maps any failure to `[FAIL]`, as in
> `lint-workflow`); bash prints a similar line for some other signals, and only
> `SIGTERM` is pinned by a test; (p) a hook started with a closed standard input or a
> non-blocking input with no data writes one line feed and nothing on standard error,
> where the shell twin's `read` prints `read: read error: <errno text>` on standard
> error; (q) a hook that received a partial line before a read error (`EAGAIN`) writes
> what it received followed by one line feed, where bash drops the partial line and
> writes one line feed; (r) `lint-json` without `jq` on the path validates the file with
> `JSON.parse` and reports `invalid JSON` (exit 1), where the shell printed that `jq`
> was not found, skipped the parse and exited 0 for a file whose only defect the parse
> detects (it kept only the trailing-comma heuristic). Letters from (s) onward are
> reserved for what a later test finds and SHALL be added through a delta of this spec.

## REMOVED

Nothing is removed.
