---
id: "0031"
slug: core-paths-phantom-tolerance
status: draft
complexity: standard
interaction-mode: AUTO
related-issue: 310
version: 1.0.0
---

# Core-paths manifest phantom-entry tolerance

## Intent

An adopter pulling the latest core layer from upstream always completes the
synchronization, even when the manifest names a path that has no content to
fetch: instead of aborting the whole operation, the sync reports the
unresolved entry and finishes restoring the rest. Every core-layer path the
framework documents as an intended layer resolves to real, tracked content
upstream, so a documented layer is never itself the cause of such a skip.
And a manifest entry that points at nothing can no longer reach the canonical
branch, because the project rejects it before merge.

## Requirements

1. A core-layer path that the manifest declares and that the documentation
   describes as an intended layer SHALL resolve to real tracked content in
   the upstream repository, so that synchronizing it never fails for absence
   of content.
2. The upstream-synchronization process SHALL NOT abort the entire
   synchronization when one manifest entry cannot be resolved in the fetched
   upstream tree.
3. When a manifest entry cannot be resolved in the fetched upstream tree, the
   synchronization process SHALL skip that entry, emit a warning that
   identifies the unresolved entry, and continue processing every remaining
   entry.
4. A synchronization run in which one or more manifest entries were skipped
   for non-resolution SHALL still exit successfully, having restored every
   entry that did resolve.
5. Continuous integration SHALL fail a pull request when any entry in the
   core-paths manifest does not resolve to tracked content at the repository
   HEAD.
6. The warn-and-skip behavior described in requirements 2 through 4 SHALL be
   covered by an automated regression scenario.

## Scenarios

**Scenario:** A documented intended layer resolves at upstream

Given a core-layer path that the manifest declares and the documentation
describes as an intended layer
When an adopter synchronizes the core layer from upstream
Then that path resolves to tracked content
And it is restored without any unresolved-entry warning

**Scenario:** A manifest entry absent from upstream is skipped and the sync
still succeeds

Given the manifest declares an entry that has no tracked content in the
fetched upstream tree
And the manifest also declares other entries that do resolve
When the adopter runs the upstream synchronization
Then the synchronization emits a warning that identifies the unresolved entry
And it restores every entry that did resolve
And it exits successfully

**Scenario:** A fully resolvable manifest syncs cleanly

Given every entry in the manifest resolves to tracked content in the fetched
upstream tree
When the adopter runs the upstream synchronization
Then every entry is restored
And no unresolved-entry warning is emitted
And the synchronization exits successfully

**Scenario:** Continuous integration rejects a phantom manifest entry

Given a pull request in which a core-paths manifest entry does not resolve to
tracked content at the repository HEAD
When continuous integration runs
Then the manifest-resolution check fails the pull request

## Out of scope

- Populating the public-communications layer with real talk or demo content;
  this spec requires only that the declared path resolve to tracked content,
  not that the content be substantive.
- Reworking the GitHub Pages publication pipeline.
- Changing the sync policy model (strict / adopt-on-edit / excluded)
  established by spec 0020.
- Migrating or back-filling any manifest entry other than the one this spec
  materializes.

## Open questions

- None. The data decision is settled: the offending documented layer is
  materialized so it resolves upstream, rather than removed, because removing
  it would orphan a downstream publication channel that already depends on it
  (see *Out of scope*). The verified blast-radius analysis backing this choice
  lives on issue #310.
