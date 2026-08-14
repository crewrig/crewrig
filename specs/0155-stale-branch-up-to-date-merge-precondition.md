---
id: "0155"
slug: stale-branch-up-to-date-merge-precondition
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 934
version: 1.0.0
---

# Stale Branch Up-to-Date Merge Precondition Protocol

## Intent

Eliminate post-merge contract drift and broken `main` builds by mandating that every feature branch be rebased/updated onto current `main` and verified clean before merging.

## Requirements

1. **Up-to-date merge precondition.** `AGENTS.md` → `## Branching Strategy` and `docs/post-merge-flow.md` SHALL state that an agent MUST verify a feature branch is up-to-date with current `main` (`git fetch crewrig main`, `git rebase crewrig/main` or `gh pr update-branch`) before executing `gh pr merge`.
2. **Re-validation after rebase.** If `main` has advanced since the feature branch's base commit, the agent SHALL update the branch, re-run test suites (`scripts/tests/test-*.sh` and linters), and confirm all checks pass on the updated state prior to merging.
3. **AGENTS.md budget constraint.** Updating `AGENTS.md` summary clauses SHALL maintain file size strictly under 22,000 bytes.

## Scenarios

### Scenario 1: Feature branch is up-to-date at merge time

- **GIVEN** a feature branch whose base commit equals current `crewrig/main`
- **WHEN** the agent prepares to execute `gh pr merge`
- **THEN** the precondition check passes and the merge proceeds without requiring a rebase.

### Scenario 2: `main` has advanced during feature branch execution

- **GIVEN** a feature branch created before new commits landed on `crewrig/main`
- **WHEN** the agent prepares to execute `gh pr merge`
- **THEN** the agent fetches `crewrig/main`, rebases the branch onto updated `main`, executes test suites on the rebased tree, and proceeds to merge only after all checks pass.

## Out of scope

- Modifying remote GitHub repository rulesets or requiring GitHub admin API write permissions.

## Open questions

- None.
