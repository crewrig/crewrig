---
id: "0236"
slug: gitlab-ci-manual-rule-syntax
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 1244
version: 1.0.0
---

# Valid GitLab CI rule syntax for manual capability jobs

## Intent

`scripts/build-ci.sh` generates syntactically valid GitLab CI `rules:` blocks
for manual jobs, emitting `- when: manual` without an empty `if: ''` expression
when no condition predicates are defined, preventing pipeline validation errors
on GitLab CI engines.

## Requirements

1. When a portable capability in `ci/ci-capabilities.yml` specifies a manual trigger
   without condition predicates, `scripts/build-ci.sh` SHALL emit `- when: manual`
   without an empty `if:` expression.
2. `scripts/build-ci.sh` SHALL NOT emit `if: ''` or `if: ""` in any rule item of
   `.gitlab-ci.yml`.
3. The generator test suite SHALL assert that generated manual rules contain valid
   syntax without empty `if` expressions.

## Scenarios

**Scenario:** Manual capability generates rule without empty if

Given a capability with a manual trigger and no branch/path filters
When `scripts/build-ci.sh` derives its GitLab CI job
Then the job rules contain `- when: manual` without any empty `if: ''` line.

**Scenario:** Manual capability with branch filter retains valid if

Given a capability with a manual trigger and a branch filter
When `scripts/build-ci.sh` derives its GitLab CI job
Then the rule contains the branch condition and `when: manual`.

## Out of scope

- Adding new trigger kinds to `ci/ci-capabilities.yml`.
- Changing GitHub Actions workflow trigger definitions.

## Open questions

None.
