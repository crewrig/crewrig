---
id: "0190"
slug: pr-logbook-label-scope
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1063
version: 1.0.0
---

# Scope logbook label to dedicated logbook issues in pr-logbook skill

## Intent

When an agent creates or updates logbook entries for a pull request that closes an existing feature issue, the logbook guidance no longer commands the agent to attach the `logbook` label to that feature issue; the `logbook` label remains scoped to dedicated standalone logbook issues as mandated by the repository's logbook convention, avoiding label collisions and unnecessary manual adjudications.

## Requirements

1. `artifacts/core/skills/pr-logbook/SKILL.md` Section 4 ("Logbook entries") SHALL distinguish between a pull request linked to a pre-existing feature issue and a pull request without an upstream issue requiring a dedicated logbook issue.
2. For a pull request linked to a pre-existing feature issue, `pr-logbook` SHALL instruct appending logbook content as comments directly to the feature issue without demanding the addition of a `logbook` label to that issue.
3. For a pull request without an upstream feature ticket, `pr-logbook` SHALL instruct creating a dedicated logbook issue and ensuring that dedicated issue carries the `logbook` label.
4. The instructions in `pr-logbook` SHALL align with the logbook rules in `AGENTS.md` → *Logbook Issues* (Rule A) and `docs/logbook-issues.md`.
5. Modifying `artifacts/core/skills/pr-logbook/SKILL.md` SHALL bump its `metadata.provenance.version` field from `1.3.0` to `1.3.1` per the Version Bump Convention.
6. Regenerated skill outputs across `.claude/skills/pr-logbook/SKILL.md`, `.gemini/skills/pr-logbook/SKILL.md`, `.github/skills/pr-logbook/SKILL.md`, and `.agents/skills/pr-logbook/SKILL.md` SHALL match the updated source with zero drift.

## Scenarios

**Scenario:** PR linked to an existing feature issue

Given a PR that closes an existing feature issue
When the pr-logbook skill prepares the logbook entry
Then it appends the logbook entry comment to that feature issue and does not demand adding the `logbook` label to the feature issue

**Scenario:** PR without an existing upstream issue

Given a standalone PR with no linked feature issue
When the pr-logbook skill prepares the logbook entry
Then it instructs creating a dedicated logbook issue carrying the `logbook` label

**Scenario:** Skill instructions align across all CLI targets

Given the compiled pr-logbook skill instructions across all supported CLIs
When checking the feature-issue logbook instructions against Rule A
Then no step commands adding a `logbook` label to pre-existing feature issues

## Out of scope

- Changing the definition or requirements of Rule A, Rule B, or Rule C in `AGENTS.md` or `docs/logbook-issues.md`.
- Altering the logbook comment markdown template format or required fields.
- Re-labeling closed historic issues in the repository.

## Open questions

(None.)
