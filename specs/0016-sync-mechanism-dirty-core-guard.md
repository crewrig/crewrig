---
id: "0016"
slug: sync-mechanism-dirty-core-guard
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 230
version: 1.0.0
---

# Synchronisation Mechanism with Dirty-Core Guard

## Intent

Adopting organisations gain a bespoke synchronisation script —
`scripts/sync-from-upstream.sh` — that pulls the latest upstream core-layer
content into their fork without touching any overlay-layer path. Before
applying any upstream change, the script checks whether the adopting
organisation has locally modified any core-layer path; if so, it halts
immediately, lists the offending paths, and exits with a non-zero status code.
A clean fork synchronises in a single command with no merge conflicts on
overlay content.

## Requirements

1. The repository SHALL contain an executable script at
   `scripts/sync-from-upstream.sh`.
2. The script SHALL accept the upstream remote name or URL as an argument and
   refuse to proceed if no remote is specified.
3. The script SHALL derive the list of core-layer paths from `docs/layers.md`,
   treating every path classified as `core` in that document as subject to the
   dirty-core guard.
4. Before applying any upstream change, the script SHALL compare the current
   state of every core-layer path against the upstream version and detect any
   local modification.
5. If one or more core-layer paths have been locally modified, the script
   SHALL print the full list of offending paths to standard error, emit a
   human-readable guidance message explaining how to migrate the modification
   into the overlay layer, and exit with a non-zero status code without
   applying any upstream change.
6. If no core-layer path has been locally modified, the script SHALL apply the
   upstream changes to all core-layer paths, leave all overlay-layer and
   examples-layer paths untouched, and exit with status code 0.
7. The script SHALL print a summary of applied changes (paths updated and
   their upstream versions) to standard output on successful synchronisation.
8. The script SHALL be idempotent: running it twice in succession on an
   already-synchronised fork SHALL produce no change and SHALL exit with status
   code 0.
9. The script SHALL operate without requiring the adopting organisation's
   repository to share git history with the upstream repository.

## Scenarios

**Scenario:** Clean fork synchronises successfully

Given an adopting organisation's repository in which no core-layer path has
been locally modified
When the organisation runs `scripts/sync-from-upstream.sh <upstream-remote>`
Then all core-layer paths are updated to their upstream versions, all
overlay-layer and examples-layer paths are untouched, the script prints the
list of updated paths to standard output, and the script exits with status 0.

**Scenario:** Dirty core blocks synchronisation

Given an adopting organisation's repository in which a contributor has edited
`scripts/build-components.sh` (a core-layer path)
When the organisation runs `scripts/sync-from-upstream.sh <upstream-remote>`
Then the script halts before applying any upstream change, prints
`scripts/build-components.sh` (and any other modified core paths) to standard
error, emits guidance on migrating the modification into the overlay layer,
and exits with a non-zero status code.

**Scenario:** Missing upstream remote argument

Given a developer who runs `scripts/sync-from-upstream.sh` with no arguments
Then the script prints a usage message and exits with a non-zero status code
without touching any file.

**Scenario:** Idempotent re-run

Given a fork that has just been successfully synchronised with upstream
When the organisation runs `scripts/sync-from-upstream.sh <upstream-remote>`
a second time immediately after
Then the script produces no file changes and exits with status 0.

## Out of scope

- A graphical or CI-integrated synchronisation interface — the script is the
  primitive; CI wrappers are each adopting organisation's responsibility.
- Automated migration of locally modified core files into the overlay layer —
  the script reports offending paths and provides guidance; the migration
  itself is manual.
- Conflict resolution within overlay-layer paths — the script never touches
  overlay paths, so no conflicts can arise there.
- Scheduled or webhook-triggered synchronisation — each adopting organisation
  decides when to run the script.
- The full adoption guide (how to set up a new fork from scratch) — covered
  by sub-spec E1.

## Open questions

(none)
