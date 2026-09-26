---
id: "0218"
slug: usage-suite-dirty-tree-trap
status: draft
complexity: small
interaction-mode: AUTO
related-issue: 1260
version: 1.0.0
---

# Usage test suites never revert an operator's uncommitted edit on their dirty-tree refusal

## Intent

A contributor who runs one of the usage test suites (`test-usage-attribution.sh`,
`test-usage-pricing.sh`, `test-usage-storage.sh`) while any of that suite's
mutation-discipline files already carries uncommitted edits sees only the
suite's own dirty-tree refusal message — never a silent loss of that
uncommitted work.

## Requirements

1. Each affected usage test suite SHALL install its `EXIT` cleanup trap's
   tracked-file restore step only for the portion of the run that starts
   after the suite's own dirty-tree guard has confirmed every
   mutation-discipline file clean at entry.
2. When the dirty-tree guard refuses to run (because a mutation-discipline
   file already carries an uncommitted diff), the suite SHALL exit without
   invoking `git checkout --` on any tracked file.
3. When the dirty-tree guard confirms a clean tree and the suite proceeds,
   an interrupted or completed run SHALL still restore every
   mutation-discipline file left dirty by an in-progress mutation case, as
   before this fix.

## Scenarios

**Scenario:** dirty-tree refusal preserves the operator's uncommitted edit

Given a mutation-discipline file already has an uncommitted diff
When the operator runs the affected usage test suite
Then the suite prints the dirty-tree FATAL refusal and exits non-zero
And the file's uncommitted diff is unchanged after the suite exits

**Scenario:** a clean tree still restores an interrupted mutation

Given every mutation-discipline file is clean at entry
When a mutation case mutates a tracked file in place and the run is
interrupted before that case's own restore step runs
Then the suite's `EXIT` trap runs `git checkout --` on the mutated file
And the file matches its committed content once the suite exits

## Out of scope

- `test-usage-storage-mirror.sh`, which already gates its trap's checkout
  loop on a confirmed-clean flag (#1250) and needs no change.
- `test-usage-dashboard.sh`, `test-usage-capture.sh`, and
  `test-usage-record-schema.sh`, which either apply mutations only to a
  throwaway copy or declare no mutation-discipline files at all.
- Any change to the mutation-discipline convention itself (which tracked
  files are guarded, how a mutation case proves itself red).

## Open questions

- None.
