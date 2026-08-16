---
id: "0163"
slug: copilot-settings-machine-paths-exemption
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 959
version: 1.0.0
---

# Exemption for Copilot workspace settings from machine-specific home path guard

## Intent

When an operator runs `scripts/setup-copilot-interactive.sh` and opts into
transcript recording, the setup script merges hook commands into the tracked
`.github/copilot/settings.json` file. These commands deliberately embed
operator-specific absolute filesystem paths pointing to the local Python virtual
environment and hook wrapper under the operator's home directory
(`/Users/<user>/…` or `/home/<user>/…`). This design is documented in
`docs/adr/0001-copilot-cli-integration-strategy.md` (Discovery finding #8) and
was previously carved out of the strict upstream sync guard in spec 0097.

However, `scripts/check-no-machine-paths.sh` (enforcing spec 0081) scans all
tracked files indiscriminately and fails whenever a machine-specific home path
is detected. Because `.github/copilot/settings.json` is a git-tracked file, any
working tree with Copilot transcript hooks enabled produces an immediate failure
under `scripts/check-no-machine-paths.sh`, preventing local clean runs and
risking continuous-integration failures.

This specification reconciles spec 0081 and spec 0097 by establishing an explicit
exemption for `.github/copilot/settings.json` in the machine-paths check,
documenting the cross-reference between the two specifications and in the
governing architecture decision record.

## Requirements

1. `scripts/check-no-machine-paths.sh` SHALL exclude `.github/copilot/settings.json`
   from its repository-wide search for machine-specific home-directory paths using
   a git pathspec exclusion `':(exclude).github/copilot/settings.json'`.
2. The exclusion in Requirement 1 SHALL apply strictly to
   `.github/copilot/settings.json` and SHALL NOT exclude any other file under
   `.github/copilot/` or elsewhere in the tracked repository tree.
3. `scripts/tests/test-check-no-machine-paths.sh` SHALL include a dedicated test
   case asserting that a machine-specific home path present in
   `.github/copilot/settings.json` does not cause `scripts/check-no-machine-paths.sh`
   to fail.
4. `scripts/tests/test-check-no-machine-paths.sh` SHALL assert that a
   machine-specific home path in a sibling Copilot file (such as
   `.github/copilot/extension.json`) still causes
   `scripts/check-no-machine-paths.sh` to fail with a non-zero exit code,
   confirming the narrow scope of the exemption.
5. `specs/0081-purge-machine-specific-paths.md` SHALL be amended via a delta-spec
   file `specs/0081-purge-machine-specific-paths.delta-01.md` to record the
   normative exception for `.github/copilot/settings.json` necessitated by the
   Copilot CLI hook integration design.
6. `docs/adr/0001-copilot-cli-integration-strategy.md` SHALL receive an
   informational addendum noting that `.github/copilot/settings.json` is
   explicitly exempted from the machine-paths guard check (spec 0081 /
   `scripts/check-no-machine-paths.sh`).
7. This specification SHALL NOT alter `scripts/setup-copilot-interactive.sh` or
   its hook merging behavior.

## Scenarios

### Happy path — Copilot settings with machine path passes check

Given a repository checkout where `scripts/setup-copilot-interactive.sh` has run  
And `.github/copilot/settings.json` contains an operator-specific `/Users/alice/` path  
When `scripts/check-no-machine-paths.sh` is executed  
Then the check completes with exit code 0  
And prints `OK: no machine-specific home-directory paths in tracked files.`

### Failure path — Sibling Copilot file with machine path fails check

Given a repository checkout where `.github/copilot/extension.json` contains a `/Users/alice/` path  
When `scripts/check-no-machine-paths.sh` is executed  
Then the check fails with exit code 1  
And names `.github/copilot/extension.json` in the error output on stderr.

### Failure path — Unrelated tracked file with machine path fails check

Given a repository checkout where `docs/guide.md` contains a `/Users/bob/` path  
When `scripts/check-no-machine-paths.sh` is executed  
Then the check fails with exit code 1  
And names `docs/guide.md` in the error output on stderr.

## Out of scope

- Changing how `setup-copilot-interactive.sh` writes hook commands or moving hooks to a separate file.
- Untracking or gitignoring `.github/copilot/settings.json`.
- Exempting any file other than `.github/copilot/settings.json` from the machine-paths check.
- Altering the behavior of `scripts/sync-from-upstream.sh` (already covered by spec 0097).

## Open questions

- (none — all questions resolved during SPECS)
