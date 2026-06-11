---
id: "0016"
slug: sync-from-upstream
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 230
version: 1.0.0
---

# Sync from Upstream

## Intent

An adopting organization that forks CrewRig must be able to pull upstream
changes to core-layer paths cleanly, without risk of accidentally overwriting
its own overlay content. A dedicated `scripts/sync-from-upstream.sh` script
reads `canonical_repo` from `crewrig.config.toml`, fetches the upstream HEAD,
checks that no core-layer path has been locally modified (the dirty-core
guard), and — when the check passes — applies precisely the paths enumerated
in `.crewrig/core-paths.txt`. A machine-readable manifest
(`.crewrig/core-paths.txt`) is the single source of truth for what belongs to
the core layer at runtime; it is maintained by the upstream project in the
same PR as any change to the `docs/layers.md` classification.

## Requirements

1. The repository SHALL contain a `scripts/sync-from-upstream.sh` script,
   classified as `core` layer, that synchronizes core-layer paths from the
   upstream repository declared in `crewrig.config.toml`.

2. The repository SHALL contain a `.crewrig/core-paths.txt` file, classified
   as `core` layer, that enumerates — one entry per line — every path in the
   repository that belongs to the core layer as defined by `docs/layers.md`.
   This file is the machine-readable projection of the core-layer taxonomy and
   is the authoritative input consumed by `scripts/sync-from-upstream.sh` at
   sync time.

3. `scripts/sync-from-upstream.sh` SHALL read the value of `canonical_repo`
   from `crewrig.config.toml` before taking any other action. If the field is
   absent or its value is an empty string, the script SHALL exit non-zero and
   print an explicit, human-readable error message instructing the operator to
   set `canonical_repo` in `crewrig.config.toml` before running the sync.

4. Before applying any file changes, `scripts/sync-from-upstream.sh` SHALL
   perform a dirty-core detection pass. The detection SHALL: (a) run
   `git fetch <canonical_repo>` to obtain `FETCH_HEAD`; (b) diff every path
   enumerated in `.crewrig/core-paths.txt` against `FETCH_HEAD`. If any
   core-layer path carries a local modification relative to `FETCH_HEAD`, the
   script SHALL refuse to proceed, print the full list of offending paths, and
   exit non-zero without modifying any file in the working tree.

5. When the dirty-core detection pass produces no offending paths,
   `scripts/sync-from-upstream.sh` SHALL apply the upstream content by
   executing `git checkout FETCH_HEAD -- <path>` for each path listed in
   `.crewrig/core-paths.txt`. The sync operation SHALL NOT touch any
   overlay-layer or examples-layer path, and SHALL NOT stage or commit the
   resulting changes — staging and committing are left to the operator.

6. `.crewrig/core-paths.txt` SHALL be maintained exclusively by the upstream
   CrewRig project. Every pull request that changes the core-layer
   classification in `docs/layers.md` SHALL update `.crewrig/core-paths.txt`
   in the same diff. `AGENTS.md` SHALL document this co-maintenance rule so
   that contributors and agents are aware of it.

7. `tests/` SHALL contain automated tests (Bash or Bats) covering, at minimum,
   the following two scenarios:
   - **Clean-core sync:** all paths in `.crewrig/core-paths.txt` are
     unmodified locally → `scripts/sync-from-upstream.sh` exits zero and the
     target files are updated to the upstream HEAD content.
   - **Dirty-core refusal:** at least one core-layer path carries a local
     modification → `scripts/sync-from-upstream.sh` exits non-zero, prints
     the offending path(s), and leaves the working tree unchanged.

8. The population of `.crewrig/core-paths.txt` with the full set of core-layer
   paths defined by spec 0013 (as amended by delta-03 and delta-04) SHALL be
   completed in the same implementation pull request that introduces the file
   and the sync script.

## Scenarios

**Scenario:** Clean sync from upstream

Given an adopting organization's fork in which no file listed in
`.crewrig/core-paths.txt` has been locally modified
And `crewrig.config.toml` declares a non-empty `canonical_repo` URL
When a developer runs `bash scripts/sync-from-upstream.sh`
Then the script fetches from `canonical_repo`, the dirty-core detection
reports no offending paths, the script applies `git checkout FETCH_HEAD`
for every path listed in `.crewrig/core-paths.txt`, and the script exits zero.

**Scenario:** Dirty-core guard refuses to proceed

Given an adopting organization's fork in which a developer has modified at
least one file that is listed in `.crewrig/core-paths.txt`
When the developer runs `bash scripts/sync-from-upstream.sh`
Then the script fetches from upstream, detects the local modification,
prints the full list of offending paths, exits non-zero, and leaves every
file in the working tree exactly as it was before the script ran.

**Scenario:** Missing canonical_repo blocks sync before any network call

Given a `crewrig.config.toml` in which the `canonical_repo` field is absent
or set to an empty string
When a developer runs `bash scripts/sync-from-upstream.sh`
Then the script exits non-zero immediately, before performing any `git fetch`,
and prints an error message directing the operator to set `canonical_repo` in
`crewrig.config.toml`.

**Scenario:** Manifest out of sync with layers.md is caught at review time

Given an implementation pull request that modifies `docs/layers.md` to
reclassify a path
When a reviewer cross-checks the diff against `.crewrig/core-paths.txt`
Then the missing or stale entry in `.crewrig/core-paths.txt` is visible as a
gap and the PR fails the spec review until both files are consistent.

## Out of scope

- Migration of `community-config/` to `artifacts/` — covered by sub-spec B
  (spec 0014, issue #228).
- The adoption guide that walks an organization through the full fork
  initialization sequence — covered by sub-spec E1 (issue #231).
- Syncing overlay-layer paths (`crewrig.config.toml`, `config/ORGANIZATION.md`,
  `config/TOOLS.md`, `artifacts/community/`, `artifacts/organisation/`, etc.) —
  those paths are owned exclusively by the adopting organization and MUST NOT
  be touched by the sync mechanism.
- CI automation for scheduled or triggered upstream sync — the sync script is
  intentionally a manual, operator-invoked tool. Automating the invocation
  (e.g., a GitHub Actions workflow or a pre-push hook) is a separate concern
  outside this sub-spec.
- Assembly verification tooling that confirms built CLI outputs match sources —
  covered by sub-spec E2 (issue #232).

## Open questions

(none)
