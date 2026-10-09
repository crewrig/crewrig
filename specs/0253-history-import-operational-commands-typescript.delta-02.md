---
id: "0253"
slug: history-import-operational-commands-typescript
status: implemented
complexity: standard
interaction-mode: MINIMAL
related-issue: 1331
version: 2.1.0
---

# History import and operational commands in TypeScript

*Delta 02 of `specs/0253-history-import-operational-commands-typescript.md`,
cumulative over `specs/0253-history-import-operational-commands-typescript.delta-01.md`:
every Original quoted below is the current text, that is the parent as modified
by delta-01. Source: a finding of the black-box oracle
`scripts/tests/prune-transcripts-oracle.test.ts`, written by PR A and run during
DEV of PR C of ticket 1331. It runs under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`, and the base ref of every protocol is
`origin/release/1231-ts-migration`. The implementation pull requests realise the
parent plus delta-01 plus this delta (`docs/spec-pr-workflow.md`, *Delta-spec
cumulative rule*). Every requirement number is unchanged.*

*Version: MINOR, 2.0.0 to 2.1.0 (`docs/spec-format.md`, *Versioning*). The delta
adds one deviation to the closed list of requirement 25 and one scenario, and relaxes
one assertion of the oracle of requirement 26 in the single pull request that
needs it. Nothing already specified is withdrawn: an implementation that followed
delta-01 still conforms, and only gains the permission it lacked. That is an
additive normative change, not a breaking one.*

*Finding, measured in the tree. `scripts/prune-transcripts.sh` prints the script
path as invoked (`$0`) in three places: line 59, `Usage: $0 [--days <days>] [--apply]
[--project <name>]` of `--help`; line 71, the `MEMPALACE_PYTHON=/path/to/venv/bin/python
$0 ...` example of the same `--help` text; and line 76, `Run '$0 --help' for usage.`
after `Unknown option: <arg>` on standard error. Requirement 25, item 6 lists only
the first. The three have one cause: the TypeScript entry cannot know the name of
the shim that started it, so it prints its own name. Line 71 is not asserted by
the oracle, which checks `--help` for the options and the `Prerequisites:` text
only; line 76 is asserted, at line 180 of the oracle, by
`/^Run '.*prune-transcripts\.sh --help' for usage\.$/`, which the TypeScript entry
cannot satisfy. Requirement 25's closing sentence requires that any further
difference the oracle reveals be added by a delta-spec before its pull request
merges. Verification of the rest: a search for `\$0`, `BASH_SOURCE` and `basename`
over `scripts/prune-transcripts.sh` and the four `scripts/import-<cli>-history.sh`
finds `$0` only at the three lines above in `prune-transcripts.sh`. The four
importers and `prune-transcripts.sh` otherwise use `${BASH_SOURCE[0]}` only to
locate `lib/common.sh` (`import-antigravity-history.sh` line 25, `import-claude-history.sh`
line 14, `import-copilot-history.sh` line 13, `import-gemini-history.sh` line 15,
`prune-transcripts.sh` line 29), which prints nothing. No script uses `basename`.
The `$0` hits inside `scripts/lib/common.sh` are an `awk` record variable and a
regular expression and comments about a Python launcher shebang, not a printed
script name. No further deviation exists. No question that this delta can
resolve is left open.*

## ADDED

**Scenario:** An unknown option names the entry that ran

Given `prune-transcripts` and a stub on `MEMPALACE_PYTHON` recording its
invocations
When `bash scripts/prune-transcripts.sh --bogus` runs against the shell version,
then `node scripts/prune-transcripts.ts --bogus` against the TypeScript version
Then each prints `Unknown option: --bogus` as the first line of standard error and,
as the second, `Run '<name> --help' for usage.` where `<name>` is the path of the
entry that ran (`scripts/prune-transcripts.sh` for the first,
`scripts/prune-transcripts.ts` for the second), each exits 1, and the stub records
no invocation.

## MODIFIED

Requirement 25, item 6 — the hint line of an unknown option, and the `--help`
example, have the same cause as the `Usage:` line. Original, item 6:

<!-- markdownlint-disable-next-line MD029 -->
> 6. `prune-transcripts --help` prints the name of the `.ts` entry in its `Usage:`
>    line, because the shim forwards to it;

Replacement (items 1 to 5, 7 to 9 and the closing sentence of the requirement are
unchanged):

<!-- markdownlint-disable-next-line MD029 -->
> 6. `prune-transcripts` prints the name of the `.ts` entry, `scripts/prune-transcripts.ts`,
>    wherever the shell version prints the script path as invoked (`$0`),
>    because the shim forwards to the entry and the entry cannot know the name of
>    the shim that started it. That is three lines: the `Usage:` line of `--help`
>    (and `-h`), the `MEMPALACE_PYTHON=... <name> ...` example line of the same
>    `--help` text, and the `Run '<name> --help' for usage.` hint that follows
>    `Unknown option: <arg>`, written on standard error with the exit status
>    unchanged (1). Neither the text of the other lines nor the stream of any line
>    changes;

Requirement 26, last sentence of the *Dual-channel answers* paragraph — the one
oracle assertion that pins the script name must be relaxed by the pull request
that migrates `prune-transcripts`. Original:

<!-- markdownlint-disable-next-line MD029 -->
> A script and its test SHALL NOT migrate in the same pull request, and no pull
> request SHALL change an assertion of an oracle test it makes pass: the existing
> Bash tests migrate later in J1a (#1340), not here.

Replacement:

<!-- markdownlint-disable-next-line MD029 -->
> A script and its test SHALL NOT migrate in the same pull request, and no pull
> request SHALL change an assertion of an oracle test it makes pass, with one
> exception: the assertion of `scripts/tests/prune-transcripts-oracle.test.ts` that
> pins the name in the hint line of an unknown option (the regular expression
> `/^Run '.*prune-transcripts\.sh --help' for usage\.$/`, deviation 6 of
> requirement 25) SHALL be relaxed, by the pull request that migrates
> `prune-transcripts`, to accept `prune-transcripts.sh` or `prune-transcripts.ts`
> in the quoted name. That relaxation SHALL be the only edit of an oracle
> assertion in that pull request, SHALL be listed in its description, and no
> other assertion changes. The existing Bash tests migrate later in J1a (#1340),
> not here.

## REMOVED

Nothing is removed.
