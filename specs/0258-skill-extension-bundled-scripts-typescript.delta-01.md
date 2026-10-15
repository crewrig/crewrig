---
id: "0258"
slug: skill-extension-bundled-scripts-typescript
status: draft
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
requirements 20 and 31 and adds scenarios. The version is a MINOR bump: no behaviour of
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

Given a stub `actionlint` that terminates itself with `SIGTERM`
When `node lint-workflow.ts <workflow>` runs
Then the exit status is 143 and standard error is empty (the shell prints bash's own
`Terminated` line).

**Scenario:** `lint-json` validates without `jq`

Given a machine with no `jq` on the path and a file holding invalid JSON
When `node lint-json.ts <file>` runs
Then it reports `invalid JSON` and exits 1 (the shell printed that `jq` was not found,
skipped the parse and exited 0 for a file that only the parse could reject).

## MODIFIED

**Requirement 20 — Failure silence.** Original:

<!-- markdownlint-disable-next-line MD029 -->
> 20. **Failure silence.** A hook SHALL never write to standard error and SHALL exit 0
>     on a read error, as the shell's `read` and `echo` do for a closed input.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> 20. **Failure silence.** A hook SHALL never write to standard error and SHALL exit 0 on
>     a read error (a closed standard input, a non-blocking input with no data), writing
>     what it had read and one line feed. The shell twin exits 0 too, but its `read`
>     prints bash's own diagnostic on standard error in those cases (deviation (p)); the
>     entry does not.

**Requirement 31 — Deviations.** Original, the closing sentence of the introduction:

> The deviations from the shell contract are a closed list; letters from (o) onward are
> reserved for what the differential test finds and SHALL be added through a delta of this
> spec.

Replacement:

> The deviations from the shell contract are a closed list; the letters (a) to (n) are
> below and the letters (o) to (r) are the following, each found by a test that names it:
> (o) when a wrapped tool or a scripted child dies of `SIGTERM`, bash prints its own
> `Terminated` line on standard error and the entry prints nothing, the exit status
> (128 plus the signal) being the same; (p) a hook started with a closed standard input
> or a non-blocking input with no data writes one line feed and nothing on standard
> error, where the shell twin's `read` prints `read: read error: <errno text>` on
> standard error; (q) a hook that received a partial line before a read error (`EAGAIN`)
> writes what it received followed by one line feed, where bash drops the partial line
> and writes one line feed; (r) `lint-json` without `jq` on the path validates the file
> with `JSON.parse` and reports `invalid JSON` (exit 1), where the shell printed that
> `jq` was not found, skipped the parse and exited 0 (it kept only the trailing-comma
> heuristic). Letters from (s) onward are reserved for what a later test finds and SHALL
> be added through a delta of this spec.

## REMOVED

Nothing is removed.
