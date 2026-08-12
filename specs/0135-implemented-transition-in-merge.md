---
id: "0135"
slug: implemented-transition-in-merge
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 863
version: 1.0.0
---

# Fold the spec approved→implemented transition into the implementation merge

## Intent

A spec's `approved` → `implemented` status transition is recorded at the same moment the implementation PR for its `related-issue` merges on `main`, instead of in a separate post-merge metadata-only PR. A contributor no longer opens a dedicated "Record spec X as implemented" pull request after the implementation lands; the transition rides in the implementation PR's own squash commit.

## Requirements

1. The `approved` → `implemented` transition SHALL be recorded on the implementation feature branch, by editing the spec's frontmatter `status: approved` → `status: implemented` before the implementation PR merges, so the implementation PR's squash commit carries the transition.
2. The edit SHALL be metadata-only: it SHALL change the `status` field and touch no body line, no `id`, no `slug`, and no `version`.
3. The authority for the transition SHALL remain the implementation team's `pr-logbook`, as defined in `docs/spec-format.md` → *Lifecycle states*.
4. `docs/spec-format.md` SHALL be amended so the `approved` → `implemented` transition is recorded by the in-commit mechanic (symmetric to the `draft` → `approved` *Merge mechanic*), rather than by a post-merge metadata-only edit.
5. The `pr-logbook` skill SHALL carry explicit handling for the `approved` → `implemented` transition, so the implementation team performs the frontmatter edit before merge.

## Scenarios

**Scenario:** the implementation PR carries the implemented transition

```text
Given a spec on main carrying status: approved, with an implementation PR open for its related-issue
When  the implementation branch edits the spec frontmatter status: approved -> status: implemented before merge
Then  the implementation PR's squash commit carries status: implemented, and no separate status-transition PR is opened
```

**Scenario:** a status-transition edit that alters normative content is rejected

```text
Given an implementation branch about to record the implemented transition
When  the frontmatter edit also changes a body line, id, slug, or version
Then  the edit is a violation and SHALL be rejected, mirroring the existing metadata-only guard
```

## Out of scope

- The `draft` → `approved` transition, already folded into the spec-PR's own commit via the *Merge mechanic*.
- The `→ superseded` and `→ archived` transitions, which remain post-merge metadata-only edits.
- Any change to the spec linter (`scripts/lib/spec-linter.js`) — `implemented` does not violate the no-draft-on-main invariant.
- The `draft` → `approved` carve-out contradiction tracked in issue #849.

## Open questions

- None.
