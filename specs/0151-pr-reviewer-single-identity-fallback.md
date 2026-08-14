---
id: "0151"
slug: pr-reviewer-single-identity-fallback
status: draft
complexity: small
interaction-mode: AUTO
related-issue: 692
version: 1.0.0
---

# PR Reviewer Single-Identity Fallback Protocol

## Intent

Formalize the up-front detection and plain-comment fallback for PR reviewers operating under single-identity GitHub setups to prevent failed self-approval API calls.

## Requirements

1. **Up-front identity detection.** `artifacts/core/skills/pr-reviewer/SKILL.md` SHALL require checking the authenticated `gh` user against the PR author before attempting to post a verdict event.
2. **Plain-comment fallback ladder.** When the authenticated user matches the PR author, `pr-reviewer` SHALL post its verdict as a plain PR comment via `gh pr comment` starting with a `## Verdict: …` header rather than attempting a `gh pr review` event.
3. **Version bump.** Modifying `artifacts/core/skills/pr-reviewer/SKILL.md` SHALL bump `metadata.provenance.version`.
4. **Build compilation.** `scripts/build-components.sh` SHALL be run to regenerate compiled skill outputs across all supported CLIs.

## Scenarios

### Scenario 1: Single-identity setup review

- **GIVEN** a `pr-reviewer` instance where `gh api user` equals `gh pr view <number> --json author`
- **WHEN** the review verdict is posted
- **THEN** the reviewer issues `gh pr comment <number> --body "## Verdict: APPROVE ..."` instead of `gh pr review --approve`.

### Scenario 2: Distinct identity review

- **GIVEN** a `pr-reviewer` instance where the reviewer account differs from the PR author
- **WHEN** the review verdict is posted
- **THEN** the reviewer issues `gh pr review <number> --approve` (or `--request-changes`).

## Out of scope

- Registering secondary GitHub bot tokens or modifying forge API rules.

## Open questions

- None.
