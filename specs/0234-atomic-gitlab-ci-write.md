---
id: "0234"
slug: atomic-gitlab-ci-write
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 1228
version: 1.0.0
---

# Atomic generation of .gitlab-ci.yml in build-ci.sh

## Intent

When `scripts/build-ci.sh` derives `.gitlab-ci.yml`, any generation failure
(such as an unknown tool requirement) leaves the pre-existing `.gitlab-ci.yml`
untouched and byte-identical, writing the target file atomically only upon
complete generator success.

## Requirements

1. `scripts/build-ci.sh` SHALL render the generated pipeline content to a
   temporary file before replacing `.gitlab-ci.yml`.
2. `scripts/build-ci.sh` SHALL replace `.gitlab-ci.yml` with the generated
   file atomically only when the generation completes with exit code 0.
3. If pipeline generation fails or is aborted, the original `.gitlab-ci.yml`
   SHALL remain unchanged.
4. The CI test suite SHALL include an automated test asserting that a rejected
   capability leaves an existing `.gitlab-ci.yml` byte-identical.

## Scenarios

**Scenario:** Capability rejection preserves existing .gitlab-ci.yml

Given an existing `.gitlab-ci.yml` file and a CI reference containing an invalid capability
When `scripts/build-ci.sh` fails on the invalid capability
Then the process exits non-zero and the existing `.gitlab-ci.yml` remains byte-identical.

**Scenario:** Successful generation updates .gitlab-ci.yml

Given a valid `ci/ci-capabilities.yml` reference
When `scripts/build-ci.sh` runs successfully
Then `.gitlab-ci.yml` is updated with the freshly derived content.

## Out of scope

- Modifying the schema of `ci/ci-capabilities.yml`.
- Adding new CI capability providers or generators.

## Open questions

None.
