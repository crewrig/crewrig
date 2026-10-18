---
id: "0262"
slug: model-ci-tooling-typescript
status: implemented
complexity: standard
interaction-mode: MINIMAL
related-issue: 1339
version: 1.3.0
---

# Model, CI and spec-workflow tooling in TypeScript

*Delta 03 of `specs/0262-model-ci-tooling-typescript.md`, on top of deltas 01 and 02. Source:
the run of the unchanged Bash suite `scripts/tests/test-check-model-mappings.sh` through the
differential wrapper (PR 4 of ticket #1339), which showed that the diagnostic of its case A0
(a mapping file that is not valid YAML) carries the text of the YAML parser: the shell prints
the message of `yq` (go-yaml), the twin cannot print it and prints the message of `js-yaml`.
The other scripts of the row do not print a parser message after a finding.
It runs under the release-branch regime of
`specs/0215-shell-to-typescript-migration.delta-04.md`: its spec-PR targets
`release/1231-ts-migration`. This delta modifies requirement 24 as replaced by delta 02 (one
item added). The version is a MINOR bump: one case is added to a closed list. This delta opens
no question.*

<!-- markdownlint-disable MD029 -->

## ADDED

**Scenario:** A mapping file that is not valid YAML

Given a `model-mappings/claude.yml` with an unterminated flow collection
When  `check-model-mappings` runs as the TypeScript entry
Then  it prints the same `A0` finding line up to and including `does not parse as YAML:` and one space,
      with the same label, and exits with the same status as the shell, and the text of the
      parser message that follows may differ.

## MODIFIED

24. **Deviations (closed list).** Requirement 24 of the base spec, as replaced by delta 02, is
    replaced again by items (a) to (h) of deltas 01 and 02, unchanged, followed by one item.
    (i) The `A0` finding of `check-model-mappings`, which the shell prints on standard error
    as `<label>: A0 does not parse as YAML: <message of yq>` (the label is the one of the
    pass, for example `model-mappings/<t> (mapping in force)`): the entry SHALL print the same
    `A0` finding, with the same label, with the same literal prefix
    `does not parse as YAML:` and one space and the same exit status, followed by the message of the
    YAML parser it uses (`js-yaml`), which MAY span several lines. Where an input is
    malformed YAML that reaches `A0`, this item applies and item (g) does not; item (g)
    keeps governing malformed YAML in every other script. The differential proof masks only
    the text after that prefix, up to the end of the finding record, and compares
    everything else byte for byte. No other deviation is permitted.

## REMOVED

None.
