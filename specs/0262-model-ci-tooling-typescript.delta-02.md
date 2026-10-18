---
id: "0262"
slug: model-ci-tooling-typescript
status: implemented
complexity: standard
interaction-mode: MINIMAL
related-issue: 1339
version: 1.2.0
---

# Model, CI and spec-workflow tooling in TypeScript

*Delta 02 of `specs/0262-model-ci-tooling-typescript.md`, on top of
`specs/0262-model-ci-tooling-typescript.delta-01.md`. Source: the development of the
`build-ci`, `check-model-mappings` and `check-agent-profiles` twins of ticket #1339, which
measured the observable behaviour of the shell scripts on inputs that the shared `yq` reader
cannot represent and on the `--check` diff body. It runs under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`. This delta modifies requirement 24 as replaced by delta 01 (two
items added). The version is a MINOR bump: two cases are added to a closed list, nothing
else is relaxed. This delta opens no question.*

<!-- markdownlint-disable MD029 -->

## ADDED

**Scenario:** A malformed capability reference

Given a `ci/ci-capabilities.yml` that is not valid YAML
When  `build-ci` runs as the TypeScript entry
Then  it prints one `Error:` line on standard error and exits 1, where the shell exits 0 with a
      header-only file after `yq`'s own message.

**Scenario:** A drift whose hunk layout depends on the `diff` implementation

Given a committed `.gitlab-ci.yml` that differs from the generated file by two swapped
      neighbouring lines
When  `build-ci --check` runs as the TypeScript entry
Then  it exits 1 and prints a normal-format diff whose hunks, applied to the committed file,
      yield the generated file; the hunk layout is not compared with the system `diff`.

## MODIFIED

24. **Deviations (closed list).** Requirement 24 of the base spec, as replaced by delta 01, is
    replaced again by items (a) to (f) of delta 01, unchanged, followed by two items.
    (g) Where the shell exits 0 or prints an accidental result (a case that item (c) of
    delta 01 does not cover, because the shell does not abort), a YAML input that the shared
    reader of requirement 5 cannot represent: malformed YAML, multi-document input outside
    `check-model-mappings` (for which (d) already applies), and a mapping or sequence where the
    script expects a scalar (the shell prints the block rendering of `yq -r` into its message
    or silently emits a header-only output). The entry SHALL print one
    `Error: <path>: <reason>` line on standard error and exit 1; such inputs are excluded from
    the byte comparison and a test asserts that line and that status directly.
    (h) The hunk layout of the normal-format diff that `build-ci --check` prints after a
    drift: the entry SHALL print a normal-format diff of the same two files, with the same
    `--check` verdict, exit status and first line as the shell, and the differential proof
    SHALL NOT compare the hunk layout (the shell runs plain `diff`, whose edit script is not
    guaranteed minimal and differs between `diff` implementations); it SHALL instead assert
    that applying the printed hunks to the committed file yields the generated file.
    Requirement 31 and its twenty-five-class corpus are unchanged by this delta. No other
    deviation is permitted.

## REMOVED

None.
