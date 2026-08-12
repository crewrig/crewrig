---
id: "0134"
slug: plannotator-detached-invocation-verified
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 823
version: 1.1.0
---

# Delta-01 — Verify CLI-specific internal interactive prompt tools (spec 27b)

## ADDED

1. The framework SHALL identify and document the specific internal structured interactive prompt tool used by each CLI in case `plannotator` is absent:
   - Claude Code: `AskUserQuestion` (verified)
   - Gemini CLI: `ask_user` (verified)
   - Copilot CLI: `ask_user` (verified)
   - Antigravity CLI: `ask_question` (verified)
2. The posture tables in `docs/cli-matrix.md` (row 27b) and `artifacts/library/skills/user-validate/SKILL.md` SHALL be updated to mark the internal backend prompt tool as verified (`✅`) across all four CLIs.

## MODIFIED

- None.

## REMOVED

- None.
