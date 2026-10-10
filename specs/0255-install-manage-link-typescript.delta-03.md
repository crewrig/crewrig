---
id: "0255"
slug: install-manage-link-typescript
status: approved
complexity: standard
interaction-mode: MINIMAL
related-issue: 1334
version: 1.3.0
---

# Install, manage and link scripts in TypeScript

*Delta 03 of `specs/0255-install-manage-link-typescript.md`. Source: ticket 1334,
found while preparing the pull request that switches the references (requirements 25
and 32). It runs under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`, and the base ref of every protocol is
`origin/release/1231-ts-migration` (requirement 34 of that delta). Delta 01 of this
spec retargets the Bash assertions that read the source text of a script of
requirement 1, because a forwarding shim carries none of that text. The same class has
a second member that delta 01 did not name: case 20 of
`scripts/tests/test-component-tier-resolution.sh` (R19, "the twelve documented task
entry points") reads `Taskfile.yml` as text. Its `taskfile_cmd` extracts the single
`cmd:` of each entry, its structural arm requires that command to contain the shell
script's name (`*"$expect_script"*`), and, when go-task is absent (the CI condition),
it runs the extracted command. Parent requirement 9 and requirement 32 of the spec
require the switch pull request to rewrite every `Taskfile.yml` entry that names a
script of requirement 1 as two commands (`cmds:`, the floor guard and then `node
scripts/<entry>.ts …`, never chained with `&&`), which that extraction cannot read.
This delta extends the retargeting of delta 01 to the assertions that read the
`Taskfile.yml` entries that run such a script. The version is a MINOR bump: no
requirement is invalidated, one is made satisfiable. This delta takes the number 03
for this change, although delta 02 reserved that name in requirement 22 for the
deviations found after it; the reservation is re-pointed below, and the number of
the next delta that records deviations is 04. The retargeting it allows is made in
one additional pull request that migrates no script, separate from the one that delta
01 allowed (already merged), so requirement 26 allows two retargeting pull requests.
This delta changes no other requirement of the parent and opens no question.*

## ADDED

**Scenario:** A Taskfile entry written as two commands still runs through the oracle

Given the `Taskfile.yml` entry `install-workspace` written as two commands (`cmds:`:
the floor guard, then `node scripts/install-workspace.ts install`), and an
environment without go-task
When case 20 of `scripts/tests/test-component-tier-resolution.sh` runs that entry
Then the retargeted extraction takes both commands in order, the structural check
accepts the TypeScript entry name, the fallback runner executes the two commands in
order and stops on the first non-zero status, and the case still asserts the outcome
of the install (the files placed and the exit status) under its unchanged label.

**Scenario:** A Taskfile entry whose first command fails stops the run and turns the
case red

Given the entry `install-workspace` written as two commands whose first command exits
non-zero, and an environment without go-task
When the oracle runs it
Then the fallback runner stops on that status without running the second command, and
case 20 fails.

## MODIFIED

**Requirement 26 — Oracle: the assertions that read a script, or the entries that run
it, as text.** Original, clause (a) of requirement 26 as delta 01 left it and the
opening of its clause (b):

> […] with their assertions unchanged, save for the retargeting of (a) to (d) below;
> […] The only edits allowed are those of two pull requests that migrate no script and
> leave the thirteen scripts and the libraries of requirements 2 and 25 byte-identical
> (an empty diff, asserted in each description): the preparatory pull request […] and
> the retargeting pull request of (b).
>
> (a) An assertion that reads the source text of a script of requirement 1 (a `grep`,
> `sed`, `awk` or `cat` of the file, or of the libraries it sources) instead of running
> it cannot pass against a shim, which holds none of that text, so it is not an oracle
> of the observable contract once the script is a shim […].
>
> (b) A pull request that migrates no script, merged after the TypeScript declaration
> modules exist on the release branch and before the pull request that installs the
> shims, SHALL retarget each such assertion so that it reads the same fact from the
> TypeScript declaration. […]

Replacement:

> […] with their assertions unchanged, save for the retargeting of (a) to (e) below;
> […] The only edits allowed are those of the pull requests that migrate no script and
> leave the thirteen scripts and the libraries of requirements 2 and 25 byte-identical
> (an empty diff, asserted in each description): the preparatory pull request […] and
> the two retargeting pull requests, the one of (b) for the assertions of delta 01 and
> a second one of (e) for the assertion that reads `Taskfile.yml` entries, each merged
> before the pull request that installs the shims.
>
> (a) An assertion that reads the source text of a script of requirement 1 (a `grep`,
> `sed`, `awk` or `cat` of the file, or of the libraries it sources), **or that reads
> the `Taskfile.yml` entries that run such a script**, instead of running it cannot
> pass against the shim or against the rewritten entry, which hold none of that text, so
> it is not an oracle of the observable contract once the switch lands […].
>
> (b) A pull request that migrates no script and leaves the thirteen scripts and the
> libraries of requirements 2 and 25 byte-identical, merged after the TypeScript
> declaration modules exist on the release branch and **before the pull request that
> installs the shims and rewrites the `Taskfile.yml` entries**, SHALL retarget each such
> assertion. An assertion that reads a declared fact reads the same fact from the
> TypeScript declaration, as delta 01 states. […]
>
> (e) The assertion that reads `Taskfile.yml` entries (at authoring, case 20 of
> `scripts/tests/test-component-tier-resolution.sh`, `taskfile_cmd` and the `tsk`
> helper) SHALL be retargeted in one additional pull request that satisfies (b) (it
> migrates no script, leaves the thirteen scripts and the libraries byte-identical, and
> is merged before the pull request that installs the shims), distinct from the
> retargeting pull request that delta 01 allowed, to a form that passes against
> **both** the current `Taskfile.yml` (one `cmd:`) and the rewritten one (`cmds:`, two
> commands): the extraction SHALL take every command of the entry, in order, whichever
> of the two keys declares it; the structural check SHALL accept either the shell
> script's name or the TypeScript entry's name in the entry's commands; and, when
> go-task is absent, the fallback runner SHALL execute the extracted commands in
> order, with the same variable substitution as today, failing on the first non-zero
> status. The `go-task` driver arm is unchanged. No check is weakened or deleted. The
> retargeted case SHALL keep a vacuity guard (it fails when the extraction yields no
> command for an entry) and its mutation property for the new form: each of a Taskfile
> entry from which the second command is removed, an entry whose first command fails
> and does not stop the run, and an entry that no longer names its script in either
> spelling turns the case red, and the mutation test of the oracle covers all three. The
> case keeps its label, and the retargeted assertion is listed in the description of
> that pull request with its text before and after (clause (c)).

**Requirement 22 — the reservation of the next letters.** Original, the closing
sentence of requirement 22 as delta 02 left it:

> […] Letters (n) onward are reserved for deviations the plan's differential test
> discovers and a `delta-03` of this spec records.

Replacement:

> […] Letters (n) onward are reserved for deviations the plan's differential test
> discovers; the next delta of this spec that is not already taken records them (delta
> 04 at authoring, since delta 03 retargets an assertion and records no deviation).

## REMOVED

None.
