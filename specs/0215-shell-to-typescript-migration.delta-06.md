---
id: "0215"
slug: shell-to-typescript-migration
status: implemented
complexity: large
interaction-mode: INTERMEDIATE
related-issue: 1231
version: 4.3.0
---

# Shell-to-TypeScript migration (parent spec)

*Delta 06 of `specs/0215-shell-to-typescript-migration.md`. Source: ticket #1344
(row J4, sub-spec `specs/0266-final-removal-and-termination.md`). Requirement 37 of
delta-04 leaves the merge method of the final pull request to the owner's choice at
the time. The owner has chosen: a merge commit, never a squash or a rebase, because
the recovery procedure of the `sync-from-upstream` shim (ticket 1331, pull request 1524,
<https://github.com/crewrig/crewrig/issues/1231#issuecomment-6087488677>)
restores `scripts/sync-from-upstream.sh` from commit
`cad08ac64d30dcd3ed96b4aadaf156ed7673abae` and only works while that commit, and
`3ef0e4d03c443736efe75a659a0751478ab377a8`, are ancestors of `main`. This delta
records that choice. It runs under the release-branch regime of delta-04, its
spec-PR targets `release/1231-ts-migration`, and the version is a MINOR bump:
requirement 37 is narrowed in one sentence and nothing else changes.*

## ADDED

Nothing is added.

## MODIFIED

### Requirement 37 — merge method of the final pull request

Original:

> Its merge method is the owner's choice at that time.

Replacement:

> Its merge method SHALL be a merge commit, never a squash and never a rebase,
> so that `cad08ac64d30dcd3ed96b4aadaf156ed7673abae` and
> `3ef0e4d03c443736efe75a659a0751478ab377a8` are ancestors of `main`
> (`git merge-base --is-ancestor <commit> <merge result>` exits 0 for each).

**Scenario:** The final pull request is merged with the merge commit method

Given the final pull request of requirement 37 is ready and the user has given formal
permission
When it is merged with the merge commit method
Then both commits are ancestors of `main`, and
`git checkout cad08ac64d30dcd3ed96b4aadaf156ed7673abae -- scripts/sync-from-upstream.sh`
resolves on a clone of `main`.

## REMOVED

Nothing is removed.
