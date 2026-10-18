---
id: "0262"
slug: model-ci-tooling-typescript
status: implemented
complexity: standard
interaction-mode: MINIMAL
related-issue: 1339
version: 1.5.0
---

# Model, CI and spec-workflow tooling in TypeScript

*Delta 05 of `specs/0262-model-ci-tooling-typescript.md`, on top of deltas 01 to 04. Source: the
run of the unchanged oracle suite `scripts/tests/test-check-ci-parity.sh` (200 cases, all
pass) and of the differential test against the TypeScript twin of `check-ci-parity` (PR 7a
of ticket #1339), which measured the shell on workflow and CI files that the shared reader
cannot represent. It runs under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`. This delta modifies requirement 24 as replaced by delta 03 (one
item added). The version is a MINOR bump: one case is added to a closed list. This delta opens
no question.*

<!-- markdownlint-disable MD029 -->

## ADDED

**Scenario:** A workflow file with several documents

Given a `.github/workflows/<name>.yml` that holds two YAML documents
When  `check-ci-parity` runs as the TypeScript entry
Then  it prints one `Error: <path>: <reason>` line on standard error and exits 1, where the
      shell joins the per-document results.

**Scenario:** A scalar `jobs` key

Given a workflow whose `jobs` key is a scalar
When  `check-ci-parity` runs as the TypeScript entry
Then  it prints one `Error: <path>: <reason>` line and exits 1, where the shell prints the
      error of `yq keys` and skips the file.

**Scenario:** A workflow that fails to parse

Given a workflow file that is not valid YAML
When  `check-ci-parity` runs as the TypeScript entry
Then  it prints one `Error: <path>: <reason>` line and exits 1, where the shell skips the file
      silently.

**Scenario:** A multi-document reference

Given a `ci/ci-capabilities.yml` that holds two YAML documents, none of which declares a
      capability
When  `check-ci-parity` runs as the TypeScript entry
Then  it prints the stable validity line of the shell, byte for byte, with the same exit
      status.

## MODIFIED

24. **Deviations (closed list).** Requirement 24 of the base spec, as replaced by delta 03, is
    replaced again by items (a) to (i) of deltas 01 to 03, unchanged, followed by one item.
    (j) For `check-ci-parity`, a workflow file or `.gitlab-ci.yml` that the shared reader of
    requirement 5 cannot represent and on which the shell carries on instead of aborting:
    a file with several YAML documents (the shell joins the per-document results), a
    workflow that fails to parse (the shell skips it silently), a `.gitlab-ci.yml` that fails
    to parse (the shell prints the message of `yq` and continues with no keys), a scalar
    `jobs` key in a workflow (the shell prints the error of `yq keys` and skips the file),
    and an explicit `? key` entry or a multi-line key among the job keys of a workflow or the
    top-level keys of `.gitlab-ci.yml`, which are the keys whose trailing comment the entry
    reads. The entry SHALL print one `Error: <path>: <reason>` line on standard error and
    exit 1; such inputs are excluded from the byte comparison and a test asserts that line and
    that status directly. For these inputs item (j) takes precedence over item (g) of delta 02,
    including its multi-document clause. A multi-document REFERENCE
    (`ci/ci-capabilities.yml`) that declares no capability is governed by neither (j) nor
    (g): the shell prints a stable validity line and the entry SHALL reproduce it byte for
    byte, with the same exit status. A multi-document reference that declares capabilities
    falls under this item (j), because the shell then mixes per-call results of `yq` with
    Bash diagnostics that carry script paths and line numbers: one `Error: <path>: <reason>`
    line and exit 1. No other deviation is permitted.

## REMOVED

None.
