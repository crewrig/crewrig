---
id: "0163"
slug: drop-copilot-workspace-hook-merge
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 959
version: 1.0.0
---

# Drop workspace-level Copilot hook merge in favor of user-level transcript hooks

## Intent

When an operator ran `scripts/setup-copilot-interactive.sh` with transcript
recording enabled, the script deployed user-level hooks to
`~/.copilot/hooks/copilot-transcript-hooks.json` and additionally performed a
duplicate merge of the hook configuration into the repository workspace file
`.github/copilot/settings.json`. This duplicate merge embedded operator-specific
absolute filesystem paths (`/Users/<user>/…` or `/home/<user>/…`) into a
git-tracked file, causing `scripts/check-no-machine-paths.sh` (enforcing spec
0081) to fail and leaving working trees permanently dirty.

Mutating the workspace settings file was an architectural anomaly. Claude
(`setup-claude-interactive.sh`) and Gemini (`setup-gemini-interactive.sh`) deploy
transcript hooks strictly to user-level configuration directories, never touching
the repository tree. Furthermore, GitHub Copilot CLI automatically loads
`~/.copilot/hooks/copilot-transcript-hooks.json` across all workspaces, making
the workspace-level copy entirely redundant.

This specification eliminates the workspace-level hook merge from
`scripts/setup-copilot-interactive.sh`. Copilot CLI transcript hooks are deployed
exclusively to user configuration, the tracked `.github/copilot/settings.json`
file remains clean and immutable, and `scripts/check-no-machine-paths.sh`
continues to enforce zero machine paths across all tracked files without any
carve-out.

## Requirements

1. `scripts/setup-copilot-interactive.sh` SHALL deploy Copilot transcript hooks
   exclusively to the user-level hook configuration file
   (`$USER_HOOKS_JSON` / `~/.copilot/hooks/copilot-transcript-hooks.json`).
2. `scripts/setup-copilot-interactive.sh` SHALL NOT modify, backup, or merge hooks
   into `.github/copilot/settings.json` or any other file within the repository
   working tree.
3. The tracked repository file `.github/copilot/settings.json` SHALL retain an
   empty `"hooks": {}` object and SHALL NOT contain machine-specific paths.
4. `scripts/check-no-machine-paths.sh` SHALL continue to scan all tracked files
   strictly and SHALL NOT define any carve-out or exemption for
   `.github/copilot/settings.json`.
5. `docs/adr/0001-copilot-cli-integration-strategy.md` SHALL receive an
   addendum recording that Discovery finding #8's workspace-level hook merge is
   superseded, establishing parity across Claude, Gemini, and Copilot setup
   scripts where transcript hooks are installed solely at the user level.
6. A regression check in the test suite SHALL assert that running
   `setup-copilot-interactive.sh` with transcript hooks enabled creates the
   user-level hook configuration and leaves the repository's
   `.github/copilot/settings.json` untouched and git status clean.

## Scenarios

### Happy path — Copilot setup leaves workspace settings clean

Given an operator runs `scripts/setup-copilot-interactive.sh` with transcript recording enabled  
When the setup script execution completes  
Then `~/.copilot/hooks/copilot-transcript-hooks.json` is populated with the active transcript hooks  
And `.github/copilot/settings.json` in the repository remains unmodified  
And `git status --porcelain .github/copilot/` outputs nothing  
And `scripts/check-no-machine-paths.sh` passes with exit code 0.

### Happy path — User-level transcript hooks fire across sessions

Given an operator has completed `setup-copilot-interactive.sh`  
When Copilot CLI launches in any repository workspace  
Then Copilot CLI loads transcript hooks from `~/.copilot/hooks/copilot-transcript-hooks.json`  
And transcript events are recorded without requiring repository-level hooks.

### Invariant check — Tracked settings file contains no machine paths

Given a clean checkout of `main`  
When `scripts/check-no-machine-paths.sh` executes  
Then all tracked files including `.github/copilot/settings.json` are scanned  
And the check completes with exit code 0.

## Out of scope

- Modifying the user-level hook script `artifacts/core/copilot/hooks/mempalace-transcript.sh`.
- Changing how Claude or Gemini setup scripts deploy transcript hooks (already strictly user-level).
- Altering the command permissions or version schema inside `.github/copilot/settings.json`.

## Open questions

- (none — all questions resolved during SPECS)
