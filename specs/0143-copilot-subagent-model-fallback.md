---
id: "0143"
slug: copilot-subagent-model-fallback
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 892
version: 1.0.0
---

# Copilot subagent model fallback

## Intent

Subagents spawned under GitHub Copilot CLI on BYOK/Ollama providers fail silently when repository agent definitions in `.claude/agents/*/AGENT.md` carry hardcoded `model: sonnet` hints. Copilot CLI inspects `.claude/agents` and attempts to route subagents to `sonnet`, which BYOK/Ollama providers do not serve. Omitting `model:` frontmatter from compiled agent files allows subagents to inherit the active session model seamlessly on both Claude Code and Copilot CLI without breaking multi-provider execution.

## Requirements

1. `scripts/build-components.sh` SHALL NOT emit hardcoded `model:` frontmatter fields into compiled `.claude/agents/*/AGENT.md` output files.
2. Compiled agent outputs across `.claude/agents/`, `.github/agents/`, `.gemini/agents/`, and `.agents/agents/` SHALL allow subagents to inherit the active session model dynamically.
3. `scripts/build-components.sh` SHALL regenerate all committed `.claude/agents/*/AGENT.md` files in the repository tree without `model:` fields.
4. `scripts/check-components.sh` and CI validation checks SHALL verify that compiled agent outputs match sources and carry no hardcoded `model:` fields.
5. `docs/cli-matrix.md` SHALL be updated to reflect that agent outputs omit model hints to enable BYOK/Ollama model fallback for Copilot CLI subagents while preserving Claude Code parity.

## Scenarios

**Scenario:** compiled agent files carry no hardcoded model field

Given agent sources in `artifacts/core/agents/`
When `bash scripts/build-components.sh` runs
Then no generated `.claude/agents/*/AGENT.md` file contains a `model:` frontmatter field
And subagent spawns under Copilot CLI on BYOK/Ollama inherit the session model without error

**Scenario:** drift check passes on regenerated agent outputs

Given all committed `.claude/agents/*/AGENT.md` files have been regenerated without `model:` fields
When `bash scripts/build-components.sh --check` runs
Then the check exits with status 0 indicating zero drift

## Out of scope

- Modifying upstream `github/copilot-cli` CLI binary behavior (tracked in `github/copilot-cli#4437`).
- Disabling subagent delegation entirely.

## Open questions

(None.)
