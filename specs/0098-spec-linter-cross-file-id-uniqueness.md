---
id: "0098"
slug: spec-linter-cross-file-id-uniqueness
status: draft
complexity: small
related-issue: 606
version: 1.0.0
---

# Detect duplicate spec identifiers across the whole `/specs/` directory

## Intent

A contributor opening a spec pull request that declares a numeric spec
identifier already claimed by another, unrelated spec file needs to be
told about that collision before the pull request merges — not discover
it afterward, once two live specs silently share the same identifier and
downstream tooling and readers can no longer tell them apart. Today,
nothing checks a spec's identifier against the identifiers already
claimed by every other spec in the repository; only that one file's own
identifier matches its own filename is confirmed. This spec closes that
gap: every original spec file's identifier is checked for uniqueness
against every other original spec file's identifier, and a collision is
surfaced as a clear, actionable failure naming the colliding files.

## Requirements

1. The project's spec-validation tooling SHALL compare the frontmatter
   `id` field of every original spec file under `/specs/` against every
   other original spec file's `id`, and SHALL report a failure when two
   or more original spec files declare the same `id` value.
2. A duplicate-`id` failure SHALL name every colliding file's path and
   the shared `id` value, so a reader can identify and resolve the
   collision without re-running the tooling in a different mode.
3. When three or more original spec files share the same `id`, the
   failure SHALL name every file in the colliding group, not only the
   first two encountered.
4. A delta-spec file (a file whose name matches the
   `<NNNN>-<kebab-slug>.delta-<NN>.md` pattern) SHALL be excluded from
   the duplicate-`id` comparison entirely — a delta-spec intentionally
   carries its parent's `id`, and comparing it against its own parent,
   or against a sibling delta of the same parent, SHALL NOT be reported
   as a duplicate.
5. A spec file already excluded from linting by the project's core-paths
   manifest (the existing exclusion mechanism that skips paths such as
   `specs/org/`) SHALL also be excluded from the duplicate-`id`
   comparison, so an intentionally out-of-tree spec cannot trigger, and
   cannot itself be flagged by, a false collision.
6. The duplicate-`id` check SHALL run within the same command invocation
   that already performs per-file frontmatter validation, so a single
   run surfaces both per-file and cross-file findings together.
7. When every original spec file under `/specs/` declares a distinct
   `id`, the duplicate-`id` check SHALL report no finding and SHALL NOT
   cause the spec-validation tooling to fail on that account.
8. The spec-validation tooling SHALL exit with a non-zero status when
   at least one duplicate-`id` collision is reported, so a continuous
   integration check built on that tooling fails rather than passing
   silently.
9. A regression check SHALL assert that two original spec files
   declaring the same `id` cause the spec-validation tooling to report
   a failure naming both files.
10. A regression check SHALL assert that a delta-spec file sharing its
    parent's `id` does NOT cause the spec-validation tooling to report a
    duplicate-`id` failure on account of that shared `id`.
11. A regression check SHALL assert that a repository state in which
    every original spec file's `id` is distinct continues to pass the
    duplicate-`id` check.

## Scenarios

**Scenario:** Two independent spec files collide on the same identifier

```text
Given `/specs/` contains two original spec files, each with a distinct
      filename and a distinct slug, whose frontmatter `id` field both
      read the same value
When  the spec-validation tooling runs
Then  it reports a failure naming both colliding file paths and the
      shared `id` value
And   it exits with a non-zero status
```

**Scenario:** A delta-spec sharing its parent's identifier is not a collision

```text
Given `/specs/` contains an original spec file with `id: "0042"` and a
      delta-spec file named `0042-some-slug.delta-01.md` that also
      declares `id: "0042"`
When  the spec-validation tooling runs
Then  it reports no duplicate-`id` finding for that pair
And   it exits zero with respect to the duplicate-`id` check
```

**Scenario:** No collision present

```text
Given every original spec file under `/specs/` declares a distinct `id`
When  the spec-validation tooling runs
Then  it reports no duplicate-`id` finding
And   it exits zero with respect to the duplicate-`id` check
```

## Out of scope

- Enforcing the duplicate-`id` check against the merge-time state of a
  stale spec-PR branch (the "CI-diff" half of the originating friction
  report's suggested resolution). The CI job that lints specs already
  checks out the pull request's merge commit for `pull_request` events,
  so it already lints the full `/specs/` tree as it would look
  post-merge — a spec-PR branch that has gone stale relative to `main`
  by the time it merges is a branch-protection concern ("require
  branches to be up to date before merging"), not something the linter
  script can detect in-process from a single invocation. That setting
  lives in the repository's GitHub branch-protection configuration, not
  in `scripts/lib/spec-linter.js`, and is out of scope for this spec.
- Detecting duplicate `slug` values across original spec files. The
  originating friction report (issue #606) concerns only the `id`
  field; a duplicate-slug check is a plausible adjacent improvement but
  was not requested and is not qualified here.
- Detecting duplicate `related-issue` values across specs (two specs
  legitimately qualifying the same ticket through separate delta-spec
  iterations is an expected, not an erroneous, state).
- Enforcing that `id` values are allocated without gaps or in strictly
  increasing order across the repository's history. This spec only
  detects two-or-more files sharing one value; it does not audit the
  overall numbering sequence.
- Remediating any duplicate-`id` collision that may already exist in
  the repository's history. The specific collision that originated
  issue #606 (two spec files both declaring `id: "0051"`) was already
  resolved by renumbering one of the two files before this spec was
  authored; no outstanding historical collision is known to exist under
  `/specs/` today.
- Any change to the per-file validation `scripts/lib/spec-linter.js`
  already performs today (filename/id/slug match, heading order and
  text, enum-valued fields, and so on). This spec adds a new, additional
  cross-file check; it does not alter any existing per-file check.

## Open questions

None outstanding. The scope boundaries above (CI-diff/branch-protection,
duplicate-slug detection, historical-collision remediation) were each
resolved by explicit exclusion during authoring rather than left open.
