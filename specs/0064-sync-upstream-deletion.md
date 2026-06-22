---
id: "0064"
slug: sync-upstream-deletion
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 474
version: 1.0.0
---

# sync-from-upstream.sh strict-directory deletion

## Intent

When the sync script mirrors a strict directory from upstream, files that were
deleted in upstream but still exist in the adopter's working tree are silently
left behind as orphans. Adopters discover the gap only by manual inspection or
when a later sync or build fails unexpectedly. The script should leave the
working tree identical to the upstream state for every strict directory it
processes, including removing files that upstream has deleted.

## Requirements

**R1.** For each strict directory entry processed during the sync, after all
upstream files have been restored from `FETCH_HEAD`, the script SHALL enumerate
every file tracked under that directory in the adopter's working tree.

**R2.** For each such tracked file that does NOT resolve to an object at
`FETCH_HEAD` AND is not covered by an excluded child pathspec of that entry,
the script SHALL delete the file from the working tree.

**R3.** For each file deleted under R2, the script SHALL emit
`Removed (upstream-deleted): <path>` to stdout, consistent with the existing
output convention.

**R4.** Excluded child paths nested under a strict directory SHALL NOT be
deleted by the R2 mechanism; they are org-owned and their presence in the
working tree is intentional.

**R5.** The dirty-detection phase SHALL NOT abort the sync on the sole basis
that a strict directory contains locally tracked files absent from `FETCH_HEAD`;
those files are handled by the deletion phase under R2 rather than treated as a
dirty modification.

**R6.** The sync script's regression-test suite SHALL be extended with at least
one test case covering R2–R3 (orphan deleted from a strict directory) and at
least one test case covering R4 (excluded child preserved despite being absent
from upstream).

## Scenarios

**Scenario:** Orphaned file removed from strict directory

Given a strict directory manifest entry (e.g. `scripts`) that contains a file
in the adopter's working tree (`scripts/old-file.sh`)
When the upstream state at `FETCH_HEAD` no longer contains `scripts/old-file.sh`
Then the file is deleted from the working tree, `Removed (upstream-deleted):
scripts/old-file.sh` is printed to stdout, and the sync exits 0.

---

**Scenario:** Excluded child preserved

Given a strict directory entry with an excluded child (e.g. `specs` with
`specs/org` excluded)
When the adopter's working tree contains a file under `specs/org/` that does
not exist in `FETCH_HEAD`
Then the file is NOT deleted, no `Removed` line is printed for it, and the
sync exits 0.

---

**Scenario:** No orphaned files — behavior unchanged

Given a strict directory entry where every locally tracked file still exists
in `FETCH_HEAD`
When the sync runs
Then no `Removed` line is printed and the working tree is identical to the
outcome of the existing implementation.

---

**Scenario:** Dirty-detection does not abort on upstream-deleted file

Given a strict directory entry that contains a locally tracked file absent
from `FETCH_HEAD`
When the sync runs
Then the dirty-detection phase does NOT abort the sync; the apply phase deletes
the file and exits 0.

## Out of scope

- Adopt-on-edit directory cleanup: the `reconcile_dir` function's handling of
  files present locally but absent from upstream is intentional (org-owned
  files are never overwritten or deleted under adopt-on-edit policy) and is not
  changed by this spec.
- Strict blob manifest entries that are absent from `FETCH_HEAD` at the manifest
  level: the existing "Warning: skipping manifest entry absent from upstream"
  behavior is unchanged.
- Untracked files (not in the git index) under strict directories: only
  index-tracked files are considered by R1.

## Open questions

_None._
