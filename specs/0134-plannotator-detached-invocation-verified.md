---
id: "0134"
slug: plannotator-detached-invocation-verified
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 823
version: 1.0.0
---

# 0134 — Plannotator Detached Invocation Verified Across All CLIs

## Intent

Users running Gemini CLI, Copilot CLI, or Antigravity CLI can utilize the rich browser-based `plannotator` validation backend in detached mode exactly as in Claude Code. The parity tables and documentation are updated to mark this capability as fully verified across all supported CLIs, removing the over-cautious "pending-DEV-evidence" warnings.

## Requirements

1. The framework SHALL mark the `plannotator` detached invocation capability as verified (`✅`) across all four supported CLIs: Claude Code, Gemini CLI, Copilot CLI, and Antigravity CLI.
2. The parity posture tables in `docs/cli-matrix.md` (row 27) and `artifacts/library/skills/user-validate/SKILL.md` SHALL be updated to replace the `pending-DEV-evidence` state with `verified` for Gemini CLI, Copilot CLI, and Antigravity CLI.
3. The parity gap section in `docs/cli-matrix.md` SHALL be updated to remove the `plannotator` detached invocation entry (`[GAP-confirmation]`) since the capability has been verified.
4. The dual validation process using the `--result-file` flag SHALL be formally documented as the standard verification method.

## Scenarios

**Scenario:** User runs user-validate with plannotator on Gemini CLI, Copilot CLI, or Antigravity CLI

Given the validation backend is configured to `plannotator`
When the `user-validate` skill executes a gate validation
Then it launches `plannotator annotate <file> --gate --json` in detached mode
And it retrieves the validation decision from the output JSON once the user completes the browser-based review.

**Scenario:** Plannotator binary is missing on Gemini CLI, Copilot CLI, or Antigravity CLI

Given the validation backend is configured to `plannotator`
But the `plannotator` binary is not present in the user's `PATH`
When the `user-validate` skill executes a gate validation
Then it warns the user and falls back to the `internal` backend.

## Out of scope

- Direct implementation changes inside the external `plannotator` binary itself.
- Enabling image display or illustrations for the `internal` validation backend.

## Open questions

- None.
