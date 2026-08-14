---
id: "0153"
slug: tool-boundary-git-worktree-guard
status: draft
complexity: small
interaction-mode: AUTO
related-issue: 771
version: 1.0.0
---

# Tool-Boundary Git Worktree Guard Protocol

## Intent

Intercept and refuse prohibited whole-tree git operations at the AI assistant tool boundary inside shared ticket worktrees when an exclusive claim is not held.

## Requirements

1. **Pre-tool command interception.** A pre-tool-use hook script (`hooks/worktree-git-guard.sh`) SHALL inspect tool commands prior to execution when operating inside a `.worktrees/` directory.
2. **Prohibited whole-tree operation refusal.** The guard SHALL refuse execution of `git reset --hard`, `git checkout -- .`, `git stash`, `git clean`, or `git worktree remove --force` unless `scripts/worktree-claim.sh status` confirms the acting agent holds an active claim over a clean working tree.
3. **Delegation to worktree-claim.sh.** The guard hook SHALL delegate status and claim validation directly to `scripts/worktree-claim.sh` without reimplementing git status parsing.
4. **Multi-CLI hook registration & parity.** The hook SHALL be registered in hook manifests for all supported CLIs (`hooks/claude-transcript-hooks.json`, `hooks/gemini-transcript-hooks.json`, `hooks/copilot-transcript-hooks.json`, `hooks/antigravity-transcript-hooks.json`) and documented in `docs/cli-matrix.md`.

## Scenarios

### Scenario 1: Prohibited whole-tree operation without claim refused

- **GIVEN** an AI agent session inside `.worktrees/811` without an active worktree claim
- **WHEN** the agent attempts to run `git reset --hard` or `git clean -fd`
- **THEN** `hooks/worktree-git-guard.sh` intercepts the command and exits non-zero with a refusal message citing Spec 0114 claim requirements.

### Scenario 2: Prohibited operation with active claim allowed

- **GIVEN** an AI agent holding an active claim via `scripts/worktree-claim.sh run` or `take`
- **WHEN** the agent attempts a whole-tree git operation
- **THEN** `hooks/worktree-git-guard.sh` verifies the claim via `scripts/worktree-claim.sh` and permits the command to proceed.

### Scenario 3: Non-whole-tree operation allowed

- **GIVEN** an AI agent session inside `.worktrees/811`
- **WHEN** the agent runs `git status`, `git add file.txt`, or `git commit`
- **THEN** `hooks/worktree-git-guard.sh` passes the command cleanly without intervention.

## Out of scope

- Intercepting terminal commands typed manually by human operators in a standalone shell.

## Open questions

- None.
