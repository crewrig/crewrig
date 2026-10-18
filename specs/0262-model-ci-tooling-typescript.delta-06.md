---
id: "0262"
slug: model-ci-tooling-typescript
status: implemented
complexity: standard
interaction-mode: MINIMAL
related-issue: 1339
version: 1.6.0
---

# Model, CI and spec-workflow tooling in TypeScript

*Delta 06 of `specs/0262-model-ci-tooling-typescript.md`, on top of deltas 01 to 05. Source: the
review and the proofs of the twins of `ci-cache-guard`, `ci-changeset-coverage` and
`sweep-en-us` (PRs 2b and 5 of ticket #1339), which declared four edge differences that no
item of the closed list of requirement 24 covers. They concern the wrapped commands of the two
CI runners and the diagnostic text of the sweep. It runs under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`. This delta modifies requirement 24 as replaced by delta 05 (one
item added). The version is a MINOR bump: one case is added to a closed list. This delta opens
no question.*

<!-- markdownlint-disable MD029 -->

## ADDED

**Scenario:** A wrapped command that reads standard input

Given a capability command of a `changeset-gated` capability that reads standard input
When  `ci-changeset-coverage` runs as the TypeScript entry
Then  the command sees a closed standard input, where the shell fed it the remaining output of
      `yq`.

**Scenario:** A key environment name that is an internal variable

Given `ci-cache-guard --key-env CACHE_DIR`
When  it runs as the TypeScript entry
Then  the key reads the process environment variable `CACHE_DIR`, where the shell read its own
      internal variable of that name.

## MODIFIED

24. **Deviations (closed list).** Requirement 24 of the base spec, as replaced by delta 05, is
    replaced again by items (a) to (j) of deltas 01 to 05, unchanged, followed by one item.
    (k) Four edge differences of the CI runners and the sweep, none of which a repository
    caller exercises: (1) the commands that `ci-changeset-coverage` runs have a closed standard
    input, where the shell feeds them the remaining output of `yq` (an accident of its
    `while read` loop); (2) a `--key-env` name of `ci-cache-guard` that equals a variable the
    shell script uses internally reads the process environment, where the shell reads its own
    variable; (3) the `usage:` line of `sweep-en-us` names the path by which the entry was
    invoked, where the shell prints `$0`, and the entry is the same file after the shim
    switch; (4) an unreadable or non-UTF-8 file makes `sweep-en-us` print one
    `sweep-en-us: <reason>` line and exit 1, where the Python engine printed a traceback and
    exited 1 (the exit status is compared, the text is not). Each item is asserted directly by a
    test of the twin. No other deviation is permitted.

## REMOVED

None.
