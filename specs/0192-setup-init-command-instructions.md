---
id: "0192"
slug: setup-init-command-instructions
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 1071
version: 1.0.0
---

# Correct setup interactive scripts instructions for missing identity bootstrap commands

## Intent

When a newcomer runs any of the four interactive setup scripts on a fresh repository before generating their personal identity files (`config/SOUL.md`, `config/PROFILE.md`), the script halts with actionable prerequisite guidance whose printed command lines execute immediately and validly on that specific CLI, matching the documented invocation syntax in `README.md`.

## Requirements

1. `scripts/setup-antigravity-interactive.sh` SHALL instruct `agy -i "<skill>" --new-project` when reporting missing identity prerequisites (`check_finalized`), conforming to Antigravity CLI's native prompt-interactive flag and project-anchoring flag.
2. `scripts/setup-copilot-interactive.sh` SHALL instruct `copilot -i "<skill>"` when reporting missing identity prerequisites (`check_finalized`), conforming to Copilot CLI's interactive invocation format.
3. `scripts/setup-gemini-interactive.sh` and `scripts/setup-claude-interactive.sh` SHALL retain their valid native CLI invocation commands (`gemini "<skill>"` and `claude <skill>` respectively).
4. Automated regression tests in `scripts/tests/` SHALL assert that all four interactive setup scripts format their prerequisite guidance with the exact CLI-specific command syntax matching `README.md`.

## Scenarios

**Scenario:** Antigravity interactive setup prerequisite error guidance

Given a repository checkout where `config/SOUL.md` or `config/PROFILE.md` is absent
When `scripts/setup-antigravity-interactive.sh` checks identity prerequisites
Then the failure output instructs `run: agy -i "/init-soul" --new-project` and `run: agy -i "/init-personal-profile" --new-project`

**Scenario:** Copilot interactive setup prerequisite error guidance

Given a repository checkout where `config/SOUL.md` or `config/PROFILE.md` is absent
When `scripts/setup-copilot-interactive.sh` checks identity prerequisites
Then the failure output instructs `run: copilot -i "/init-soul"` and `run: copilot -i "/init-personal-profile"`

**Scenario:** Symmetrical prerequisite instruction parity across all four CLIs

Given the four interactive setup scripts (`setup-claude-interactive.sh`, `setup-gemini-interactive.sh`, `setup-copilot-interactive.sh`, `setup-antigravity-interactive.sh`)
When automated test assertions verify the `check_finalized` guidance format in each script
Then each script instructs its documented executable command line matching `README.md` (`claude <skill>`, `gemini "<skill>"`, `copilot -i "<skill>"`, `agy -i "<skill>" --new-project`)

## Out of scope

- Modifying the interview logic inside `artifacts/core/commands/init-soul.md` or `init-personal-profile.md`.
- Changing the prerequisite existence check contract itself (presence of `config/SOUL.md` and `config/PROFILE.md`).

## Open questions

(None.)
