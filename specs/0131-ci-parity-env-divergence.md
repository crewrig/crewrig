---
id: "0131"
slug: ci-parity-env-divergence
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 709
version: 1.0.0
---

# Spec 0131 — CI parity verification for job-scoped environment variables

## Intent

Ensure job-scoped environment variables are expressible in the platform-neutral CI capability reference (`ci/ci-capabilities.yml`), generated into derived GitLab pipelines, and parity-checked across all supported engines so env-block divergences do not pass green undetected.

## Requirements

1. `ci/ci-capabilities.yml` SHALL support an optional `env` mapping on capability entries, defining job-scoped environment variable keys and string values.
2. `scripts/build-ci.sh` SHALL render declared `env` mappings for portable capabilities into the `variables:` block of generated `.gitlab-ci.yml` pipeline jobs.
3. `scripts/check-ci-parity.sh` SHALL validate reference conformance of `env` blocks, requiring `env` entries to be string key-value mappings.
4. `scripts/check-ci-parity.sh` SHALL verify that every environment variable declared under a portable capability's `env` block is exhibited by its attributed GitHub Actions job (in job-level or step-level `env`), and that any unexpressed or diverging environment variable triggers a parity check failure.
5. The `lint-specs` capability in `ci/ci-capabilities.yml` SHALL declare the job-scoped `env` mapping `BASE_REF: "$CI_MERGE_REQUEST_TARGET_BRANCH_NAME"`.
6. `docs/ci-reference-format.md` SHALL be updated to normatively document the capability schema `env` field.

## Scenarios

**Scenario:** Generated GitLab pipeline contains capability env block

Given a portable capability declaring an `env` mapping in `ci/ci-capabilities.yml`
When `scripts/build-ci.sh` generates `.gitlab-ci.yml`
Then the generated GitLab job contains a `variables:` entry matching each key-value pair in `env`.

**Scenario:** Parity check passes when reference, GHA, and GitLab agree on env block

Given a portable capability declaring an `env` mapping matching GHA and GitLab pipelines
When `scripts/check-ci-parity.sh` runs
Then the parity check exits 0 with an OK verdict.

**Scenario:** Parity check flags env block divergence

Given a GitHub Actions job with an environment variable not declared in `ci/ci-capabilities.yml`
When `scripts/check-ci-parity.sh` runs
Then the check fails closed with exit 1 naming the offending capability and platform.

**Scenario:** Invalid env schema in capability reference fails validity check

Given a capability in `ci/ci-capabilities.yml` with a non-mapping `env` entry
When `scripts/check-ci-parity.sh` runs
Then the reference validity check fails closed with exit 1 naming the invalid schema.

## Out of scope

- Automatic translation of complex GitHub Actions template expressions into GitLab CI syntax beyond direct variable mappings.
- Global pipeline-wide environment variables outside of job-scoped capability definitions.

## Open questions

(None)
