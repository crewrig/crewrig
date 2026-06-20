---
id: "0059"
slug: sync-strict-path-fix
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 365
version: 1.0.0
---

# sync-from-upstream: strict path guard and missing-file restore

## Intent

A fork that is behind upstream but carries no local modifications to
core-layer `strict` paths completes a sync without error, and every file
present in the upstream tree at `FETCH_HEAD` — including files new in
upstream and absent from the local index — is fully restored to the working
tree.

## Requirements

1. The strict dirty-guard SHALL consider a path locally modified only when
   its working-tree blob SHA is absent from every commit in `FETCH_HEAD`
   history for that path; a blob that appears anywhere in that history SHALL
   NOT abort the sync, regardless of whether the local copy matches the
   tip of `FETCH_HEAD`.

2. For a strict entry that resolves to a tree at `FETCH_HEAD`, the guard
   SHALL enumerate every member file individually before running the
   blob-history check, so that files new in the upstream tree (absent from
   the local index) are not silently treated as deletions or false positives.

3. For a strict entry that resolves to a tree at `FETCH_HEAD`, the restore
   step SHALL enumerate the full upstream file set via `git ls-tree -r
   --name-only FETCH_HEAD` and restore each member individually, so that
   files new in upstream and absent from the local index are instantiated
   in the working tree.

4. The existing `:(exclude)` carve-out mechanism for org-owned sub-paths
   SHALL be applied to every member-level guard check and member-level
   restore performed under R2 and R3, preserving the invariant that
   org-owned content nested under a strict parent is never overwritten.

5. A strict entry that resolves to a blob (non-directory) at `FETCH_HEAD`
   SHALL continue to use the existing single-pathspec `git restore` approach;
   R2, R3, and R4 apply only to tree-typed strict entries.

6. The behavior of `adopt-on-edit` and `excluded` policy entries SHALL be
   unchanged by this fix.

7. The existing test suite for `scripts/sync-from-upstream.sh` SHALL be
   extended with at least one case covering each of the two bugs: (a) a
   fork behind upstream with zero local modifications that previously aborted
   on Bug 1, and (b) a sync that previously left a new upstream file
   uninstantiated due to Bug 2.

## Scenarios

**Scenario:** clean fork behind upstream, strict directory (happy path)

Given a fork that is three commits behind upstream with no local
modifications,
and the strict manifest entry `specs/` contains two existing files plus one
file new in the upstream tree (`specs/0099-new.md`),
When the user runs `bash scripts/sync-from-upstream.sh`,
Then the script exits zero, all three files are present in the working tree,
and no "local modifications" error is printed.

**Scenario:** genuine local modification, strict blob (guard fires correctly)

Given a fork where the user has edited `DEVELOPMENT.md` (a strict blob
entry) and the edit is not present in any upstream commit,
When the user runs `bash scripts/sync-from-upstream.sh`,
Then the script prints `Error: the following core-layer paths have local
modifications` and exits non-zero, naming `DEVELOPMENT.md`.

**Scenario:** org-owned sub-path excluded from strict directory

Given a strict manifest entry `specs/` with a nested excluded entry
`specs/org`,
and the fork has local content under `specs/org`,
When the user runs `bash scripts/sync-from-upstream.sh`,
Then `specs/org` is not overwritten, not flagged as locally modified, and
not included in any error output.

**Scenario:** new upstream file in strict directory not instantiated (Bug 2 regression)

Given the guard has been cleared (R1 satisfied),
and the upstream tree at `FETCH_HEAD` contains `specs/0099-new.md` which is
absent from the local index,
When the restore step runs for the strict `specs/` entry,
Then `specs/0099-new.md` is created in the working tree.

## Out of scope

- Changes to `adopt-on-edit` directory reconciliation logic
  (`reconcile_dir`, `reconcile_member`).
- Changes to `excluded` policy handling.
- Shallow-clone guard behaviour (already handled in the script).
- Any changes to `.crewrig/core-paths.txt` or `crewrig.config.toml` format.
- Performance optimisations to the upstream fetch step.

## Open questions

- None.
