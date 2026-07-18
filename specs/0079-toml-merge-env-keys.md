---
id: "0079"
slug: toml-merge-env-keys
status: draft
complexity: small
interaction-mode: AUTO
related-issue: 544
version: 1.0.0
---

# TOML merge — no phantom `env_keys` on pass-through

## Intent

When the end-to-end configuration merge combines a local override with the
committed defaults, the effective configuration honors the append-and-override
contract without inventing structure that neither side declared. In particular,
a local override that is empty, or that changes nothing about a CLI table's
environment-variable keys, leaves that table exactly as the defaults define it:
no empty environment-key list is grafted onto a table that never listed one.
The regression test that locks this pass-through behavior passes again and is
executed by continuous integration rather than sitting on the wiring-exemption
allowlist.

## Requirements

1. When the configuration merge applies a local override that declares no
   `env_keys` for a given CLI table — including the case of an empty local
   override and the case of an absent local override — over defaults that
   likewise declare no `env_keys` for that table, the merged result SHALL NOT
   introduce an `env_keys` key for that table, and the merged effective
   configuration SHALL equal the defaults' effective configuration exactly,
   honoring the ADR-0003 Decision 2 pass-through guarantee.
2. Where a CLI table's `env_keys` is present after the configuration merge —
   declared in the defaults, contributed by the local override, or both — the
   merged result SHALL expose a single `env_keys` list that is deduplicated and
   preserves the original declaration order.
3. The regression test `scripts/tests/test-e2e-toml-merge.sh` SHALL pass, its
   entry SHALL be removed from `ci/test-wiring-exemptions.txt`, and the test
   SHALL be executed by at least one continuous-integration workflow.
4. The wiring of `scripts/tests/test-e2e-toml-merge.sh` into continuous
   integration SHALL preserve the ordered command-parity guarantee between the
   GitHub Actions workflow and the GitLab CI pipeline, such that both engines
   execute the shared test-command set in a mutually consistent order.

## Scenarios

**Scenario:** empty local override reproduces the defaults verbatim (happy path)

Given a defaults document whose `cli.claude` table declares an image and a
      mounts list but no `env_keys`, and an empty local override,
When  the configuration merge combines the local override over the defaults,
Then  the merged effective configuration equals the defaults exactly, and the
      `cli.claude` table carries no `env_keys` key — no empty list is grafted
      onto it.

**Scenario:** deduplication is retained where `env_keys` is present (happy path)

Given a defaults document whose `cli.claude` table declares
      `env_keys = ["A", "B"]` and a local override whose `cli.claude` table
      appends `env_keys = ["B", "C"]`,
When  the configuration merge combines the local override over the defaults,
Then  the merged `cli.claude.env_keys` is the single list `["A", "B", "C"]`,
      deduplicated and preserving declaration order.

**Scenario:** de-quarantined test runs green in continuous integration (happy path)

Given the pass-through fix is realized, the entry for
      `scripts/tests/test-e2e-toml-merge.sh` is removed from
      `ci/test-wiring-exemptions.txt`, and a workflow step executes the test,
When  the test-wiring guard and the affected CI workflow run,
Then  `scripts/tests/test-e2e-toml-merge.sh` passes, and the guard reports
      neither an unwired-and-unexempted test nor a wired-yet-still-exempted
      redundancy.

**Scenario:** CI wiring keeps the two engines in ordered parity (happy path)

Given `scripts/tests/test-e2e-toml-merge.sh` is added to both the GitHub
      Actions workflow and the GitLab CI pipeline as a test-execution command,
When  the CI-parity guard runs across both engines,
Then  the guard passes, because the shared test-command set is exhibited by
      both engines in a mutually consistent order.

**Scenario:** pre-fix merge injects a phantom empty list (failure path — the resolved floor)

Given the merge behavior before this specification is realized, a defaults
      document whose `cli.claude` table declares no `env_keys`, and an empty
      local override,
When  the configuration merge combines the local override over the defaults,
Then  the merged output introduces `env_keys = []` on the `cli.claude` table,
      so the merged configuration differs from the defaults and the regression
      test's empty-local case fails — the exact state this specification
      resolves.

## Out of scope

- Changing how downstream consumers read `env_keys`. The runner
  (`tests/e2e/run.sh`) and the defaults test
  (`scripts/tests/test-e2e-defaults-toml.sh`) already tolerate an absent key
  and SHALL remain unchanged.
- Any other ADR-0003 Decision 2 merge semantic — recursive table merge,
  array-append for `mounts`, scalar override, full replacement of `command`,
  and missing-local pass-through — beyond the `env_keys` injection fix.
- The sibling quarantined tests resolved under issues #542 and #543, and every
  other entry in `ci/test-wiring-exemptions.txt`.

## Open questions
