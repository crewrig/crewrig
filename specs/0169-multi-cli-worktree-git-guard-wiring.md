---
id: "0169"
slug: multi-cli-worktree-git-guard-wiring
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 990
version: 1.0.0
---

# Multi-CLI Worktree Git Guard Installer Wiring and Manifest Validation

## Intent

When operators configured transcript hooks across Claude Code, Gemini CLI, or
GitHub Copilot CLI, the interactive setup installers failed to correctly rewrite
the `worktree-git-guard.sh` hook path declared in the hook manifests. In Claude
Code, the un-rewritten project-directory token caused errors on every command
executed in projects outside the repository. In Gemini CLI and Copilot CLI,
the guard was either left pointing to unresolved project paths or completely
overwritten by the transcript hook, silently disabling the whole-tree git
guard outside this repository.

This specification establishes symmetric, verified hook deployment across all
supported CLIs. The installer rewrites `mempalace-transcript.sh` to the
project-independent installed hook path and `worktree-git-guard.sh` to the
in-repo absolute path, and asserts that no unresolved project-directory tokens
survive in the deployed configuration.

## Requirements

1. Every CLI setup installer (`setup-claude-interactive.sh`,
   `setup-gemini-interactive.sh`, `setup-copilot-interactive.sh`,
   `setup-antigravity-interactive.sh`) deploying hooks SHALL rewrite
   `mempalace-transcript.sh` references to the installed, project-independent
   hook destination under the assistant's configuration directory.
2. Every CLI setup installer deploying hooks SHALL rewrite
   `worktree-git-guard.sh` references to the in-repo absolute path of the script
   within this repository, and SHALL NOT install a detached copy of the guard
   under the assistant's configuration directory.
3. Every CLI setup installer SHALL preserve the distinct handler assignment for
   both `worktree-git-guard.sh` and `mempalace-transcript.sh` without
   overwriting tool-boundary guard hooks with transcript recording hooks.
4. Hook deployment for each CLI SHALL assert post-rewrite that zero
   project-directory placeholder tokens (`$CLAUDE_PROJECT_DIR`,
   `${GEMINI_PROJECT_DIR}`, `${COPILOT_PROJECT_DIR:-$PWD}`) survive in the
   deployed hook configuration.
5. Automated test suites SHALL verify hook manifest transformations for all
   supported CLIs, asserting that both hook scripts resolve to their respective
   destinations and that no placeholder tokens remain.

## Scenarios

### Scenario 1: Claude Code setup rewrites both hooks and leaves no project tokens

Given a user runs the Claude Code interactive setup with transcript hooks enabled
When the installer processes `hooks/claude-transcript-hooks.json`
Then `mempalace-transcript.sh` is rewritten to the installed path in `~/.claude/hooks/`
And `worktree-git-guard.sh` is rewritten to the in-repo absolute path
And no `$CLAUDE_PROJECT_DIR` token remains in `~/.claude/settings.json`.

### Scenario 2: Gemini CLI setup rewrites both hooks correctly

Given a user runs the Gemini CLI interactive setup with transcript hooks enabled
When the installer processes `hooks/gemini-transcript-hooks.json`
Then `mempalace-transcript.sh` is rewritten to the installed path in `~/.gemini/hooks/`
And `worktree-git-guard.sh` is rewritten to the in-repo absolute path
And no `${GEMINI_PROJECT_DIR}` token remains in `~/.gemini/settings.json`.

### Scenario 3: Copilot CLI setup preserves both preToolUse guard and transcript hooks

Given a user runs the Copilot CLI interactive setup with transcript hooks enabled
When the installer processes `hooks/copilot-transcript-hooks.json`
Then `preToolUse` retains execution of `worktree-git-guard.sh` pointing to the in-repo absolute path
And lifecycle events execute `mempalace-transcript.sh` pointing to `~/.copilot/hooks/`
And no `${COPILOT_PROJECT_DIR:-$PWD}` token remains in `~/.copilot/hooks/copilot-transcript-hooks.json`.

### Scenario 4: Tool boundary execution in external projects does not error

Given an assistant configured by the setup script executes a command in a project outside the framework repository
When a tool invocation occurs
Then the pre-tool worktree git guard runs without missing-file errors.

## Out of scope

- Installing `worktree-git-guard.sh` into global user directories (the guard requires in-repo access to `scripts/worktree-claim.sh`).
- Modifying the runtime logic inside `hooks/worktree-git-guard.sh` or `hooks/mempalace-transcript.sh`.
- Adding new hook events beyond those currently declared in the hook manifests.

## Open questions

- None.
