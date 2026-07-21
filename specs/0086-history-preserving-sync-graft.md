---
id: "0086"
slug: history-preserving-sync-graft
status: draft
complexity: standard
related-issue: 584
version: 1.0.0
---

# History-preserving mode for sync-from-upstream.sh

## Intent

An organization that forks CrewRig and periodically synchronizes core-layer
content from the upstream project can optionally keep the upstream project's
own commit history reachable from its own branch after a sync, instead of
losing it to a plain file restore. Today, once a sync completes, the specific
upstream commits that were incorporated are not part of the adopter's own
history: they cannot be found with ordinary history-inspection commands, and
the only trace of what was pulled is a line in the sync's own commit subject,
which disappears entirely once that commit is folded into a larger one.
Enabling this optional behavior for a given sync leaves the resulting files
exactly as an ordinary sync would produce them, while additionally making the
specific upstream commit that was fetched a real ancestor of the adopter's
branch going forward, so that later inspection of the project's history
surfaces the upstream lineage directly. An adopter who does not request this
behavior notices no difference at all: the sync keeps updating the working
tree without creating any commit, exactly as it does today.

## Requirements

1. `scripts/sync-from-upstream.sh` SHALL accept an optional command-line
   flag, `--preserve-history`, that activates a history-preserving sync mode.
   The flag SHALL default to off and SHALL NOT be enabled by any
   configuration file, environment variable, or other implicit mechanism —
   enabling it is always an explicit, per-invocation operator choice.

2. Absent `--preserve-history`, the script's observable behavior SHALL be
   unchanged from the contract already established by specs 0016, 0020,
   0059, and 0064, including that the script neither stages nor commits any
   change.

3. When `--preserve-history` is supplied, the script SHALL first perform the
   existing policy-aware restore in full — the dirty-core detection and the
   per-path apply loop for `strict`, `adopt-on-edit`, and `excluded` entries —
   exactly as already specified; the history-preserving step SHALL introduce
   no change to that restore's behavior, ordering, or per-path policy
   resolution.

4. If the policy-aware restore aborts the sync for any reason, including the
   strict dirty-core guard, the history-preserving step SHALL NOT run: no
   ancestry SHALL be recorded and no commit SHALL be created.

5. When the policy-aware restore completes without aborting, the
   history-preserving step SHALL cause the upstream commit fetched as
   `FETCH_HEAD` to become an ancestor of the adopter's current branch tip,
   observable through ordinary history-inspection commands such as `git log`,
   `git merge-base`, and `git bisect`.

6. The file content resulting from the history-preserving step SHALL be
   byte-for-byte identical to the file content the policy-aware restore alone
   would have produced; the step SHALL perform no automatic reconciliation of
   content between the adopter's tree and the upstream tree.

7. The history-preserving step SHALL commit, on the adopter's current branch,
   exactly the file changes produced by the policy-aware restore and its
   accompanying marker bookkeeping; for this opt-in mode only, this commit is
   a deliberate, explicit exception to the "neither stages nor commits"
   contract named in Requirement 2.

8. Before creating the commit required by Requirement 7, the script SHALL
   verify that the working tree carries no uncommitted change outside the
   paths governed by `.crewrig/core-paths.txt` and its marker bookkeeping. If
   such a change is present, the script SHALL abort the history-preserving
   step, leave the already-restored files in the working tree, print the
   offending path(s), and exit non-zero.

9. The commit message of the commit created under Requirement 7 SHALL
   conform to the repository's Gitmoji naming convention and SHALL identify
   the upstream commit or commit range incorporated by the sync.

10. The read/write semantics of `.crewrig/.synced-markers/` (the
    adopt-on-edit bookkeeping defined by spec 0020) SHALL be unchanged by the
    history-preserving step; marker content and location SHALL be identical
    whether or not `--preserve-history` is supplied.

11. When the fetched `FETCH_HEAD` commit is already an ancestor of the
    adopter's current branch tip at the time `--preserve-history` runs, the
    script SHALL create no new commit for the history-preserving step and
    SHALL exit zero.

12. When `--preserve-history` is supplied and the adopter's local repository
    is a shallow clone, the script SHALL exit non-zero before performing any
    file restore or commit, and SHALL print a message directing the operator
    to remove the shallow limitation or omit the flag.

13. The regression-test suite for `scripts/sync-from-upstream.sh` SHALL be
    extended with at least one case covering each of: the history-preserving
    happy path (Requirements 5–6), the no-op case (Requirement 11), the
    shallow-clone refusal (Requirement 12), and the unrelated-uncommitted-
    change refusal (Requirement 8).

## Scenarios

**Scenario:** Provenance recorded without changing file content

Given an adopter fork with `crewrig.config.toml` declaring a valid
`canonical_repo`, and no core-layer path carries a local modification
relative to `FETCH_HEAD`
When the operator runs `bash scripts/sync-from-upstream.sh --preserve-history`
Then the script fetches upstream, applies the existing policy-aware restore
exactly as an ordinary sync would, creates a new commit on the current
branch, and — once the command completes — the upstream commit fetched as
`FETCH_HEAD` is an ancestor of the current branch tip, while every restored
file is byte-identical to what an ordinary sync without the flag would have
produced.

**Scenario:** Repeated invocation accumulates ancestry without loss

Given a fork that has already run `--preserve-history` once, so a previously
fetched upstream commit is already an ancestor of the current branch
When the operator runs `bash scripts/sync-from-upstream.sh --preserve-history`
again against a newer upstream state
Then the newly fetched `FETCH_HEAD` commit becomes an ancestor of the current
branch tip, and every upstream commit that was already an ancestor from the
prior invocation remains an ancestor.

**Scenario:** No-op when upstream is already an ancestor

Given a fork where the currently fetched `FETCH_HEAD` commit is already an
ancestor of the current branch tip
When the operator runs `bash scripts/sync-from-upstream.sh --preserve-history`
Then the script performs the existing policy-aware restore, creates no new
commit, and exits zero.

**Scenario:** Dirty-core guard still blocks the mode (failure path)

Given a core-layer `strict` path carries a local modification relative to
`FETCH_HEAD`
When the operator runs `bash scripts/sync-from-upstream.sh --preserve-history`
Then the script aborts exactly as an ordinary sync would, prints the
offending path(s), exits non-zero, creates no commit, and records no
ancestry change.

**Scenario:** Shallow clone refuses the mode (failure path)

Given the adopter's local repository is a shallow clone
When the operator runs `bash scripts/sync-from-upstream.sh --preserve-history`
Then the script exits non-zero before performing any file restore or commit,
and prints a message directing the operator to remove the shallow limitation
or omit the flag.

**Scenario:** Unrelated uncommitted change blocks the provenance commit (failure path)

Given the working tree carries an uncommitted change to a file outside the
paths governed by `.crewrig/core-paths.txt`
When the operator runs `bash scripts/sync-from-upstream.sh --preserve-history`
Then the script performs the policy-aware restore, then aborts the
history-preserving step, prints the offending path, leaves the restored
files in the working tree, and exits non-zero.

## Out of scope

- A true three-way content merge of the upstream branch (full line-level
  `git blame` provenance) as an alternative or additional opt-in mode —
  deliberately rejected for this spec per the issue's own
  alternative-considered analysis; it would require a per-file recombination
  guard and post-merge policy reconciliation of its own, and is left to a
  future spec if line-level blame provenance is ever deemed necessary.
- Any interaction between a future true-merge mode and the ancestry recorded
  by this spec's mode — deferred to that future spec, since no true-merge
  mode exists yet.
- Line-level blame or attribution provenance: `git blame` is not required,
  and is not expected, to attribute restored lines to their originating
  upstream commits under this mode; only topological (graph) provenance is
  in scope.
- Retroactively rewriting the history of sync commits made before this mode
  existed: the mode only affects invocations made after its introduction; no
  rewriting of past, already-merged sync commits is provided.
- Automating invocation of the history-preserving mode (CI, scheduled jobs,
  pre-push hooks): `scripts/sync-from-upstream.sh` remains a manual,
  operator-invoked tool, per spec 0016's existing carve-out.
- Per-CLI documentation impact: the opt-in mode introduces no new
  integration surface for Claude Code, Gemini CLI, GitHub Copilot CLI, or
  Antigravity CLI — the script remains plain, operator-invoked Bash tooling
  outside `docs/cli-matrix.md`'s scope; no matrix row is required by this
  change.
- Changes to the per-path policy resolution itself (`strict` /
  `adopt-on-edit` / `excluded`, as defined by specs 0016 and 0020) or to the
  marker bookkeeping algorithm defined by spec 0020 — both are reused
  unmodified.
- Any change to the shallow-clone guard already governing `adopt-on-edit`
  directory reconciliation (spec 0020's directory reconciliation path) —
  unaffected by this spec's new, separate shallow-clone refusal for the
  history-preserving step.

## Open questions

(none)
