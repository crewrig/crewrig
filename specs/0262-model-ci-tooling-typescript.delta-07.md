---
id: "0262"
slug: model-ci-tooling-typescript
status: implemented
complexity: standard
interaction-mode: MINIMAL
related-issue: 1339
version: 1.7.0
---

# Model, CI and spec-workflow tooling in TypeScript

*Delta 07 of `specs/0262-model-ci-tooling-typescript.md`, on top of deltas 01 to 06. Source: the
switch pull request of ticket #1339, which runs the six unchanged Bash suites through the
forwarding shims. Two of them carry a case that only probes the absence of `yq`, a tool the
TypeScript entries no longer need, as the delta-specs of rows I1 already settled for the same
class of case (`specs/0259-governance-checks-typescript.md` requirement 23). It runs under the
release-branch regime of `specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR
targets `release/1231-ts-migration`. This delta modifies requirement 26 of the base spec. The
version is a MINOR bump: one class of assertion is removed from the "unchanged assertions"
rule, and the list is closed. This delta opens no question.*

<!-- markdownlint-disable MD029 -->

## ADDED

**Scenario:** A suite case that probes a missing yq

Given the case `exit 2 — yq absent from PATH` of `scripts/tests/test-check-model-mappings.sh`
When  the checker is a shim over a TypeScript entry that reads YAML itself
Then  the case has no counterpart and is removed in the switch pull request, and a TypeScript
      test asserts that the entry runs with a `PATH` that holds no `yq`.

## MODIFIED

26. **Oracle suites.** Requirement 26 of the base spec is replaced by: the Bash suites
    `scripts/tests/test-check-{model-mappings,agent-profiles,ci-parity,spec-id-reserved}.sh`,
    `test-build-ci.sh` and `test-reserve-spec-id.sh` SHALL NOT migrate in this row (row J2,
    #1343) and SHALL pass, unchanged in their assertions, against the TypeScript entries through
    the shims on Linux CI after the switch, with two exceptions that form a closed list: (a) the
    case `exit 2 — yq absent from PATH` of `test-check-model-mappings.sh` and the case of the
    same name of `test-check-agent-profiles.sh`, each of which only probes the absence of a tool
    the entry no longer needs, are removed in the switch pull request (the absence of `yq` is
    asserted on the entries by `scripts/tests/model-ci-tooling-model-mappings-d.test.ts`);
    (b) the set-up lines that copy a script into a sandbox (`test-build-ci.sh`) or the retired
    `model-resolve.sh` into a hermetic root (`test-check-model-mappings.sh`) change so that the
    sandbox carries what the shim needs, which is not an assertion. A sandbox that mutates the
    shell implementation SHALL also mutate its TypeScript twin.

## REMOVED

None.
