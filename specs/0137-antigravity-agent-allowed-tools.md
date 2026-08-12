---
id: "0137"
slug: antigravity-agent-allowed-tools
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 835
version: 1.0.0
---

## Intent

Ensure that agents compiled for the Antigravity CLI target preserve their tool capabilities so that they do not fail to execute required commands or access necessary capabilities.

## Requirements

1. The compilation pipeline SHALL preserve tool requirements when building agent definitions for the Antigravity CLI.
2. The compilation pipeline SHALL support mapping the `Bash` tool requirement from `claude.allowed-tools` to the `enable_write_tools: true` frontmatter parameter in the compiled Antigravity agent definition.
3. The compilation pipeline SHALL support an explicit `antigravity` configuration block in the agent's source frontmatter to declare boolean tool capabilities.
4. The boolean tool capabilities (`enable_write_tools`, `enable_mcp_tools`, `enable_subagent_tools`) declared in the `antigravity` configuration block SHALL be injected as YAML frontmatter key-value pairs in the compiled Antigravity agent definition.
5. The tool mapping behavior for the Antigravity CLI target SHALL be documented in the CLI integration matrix.

## Scenarios

**Scenario:** Compile agent with Claude allowed-tools containing Bash
Given an agent source frontmatter containing `claude.allowed-tools` with `Bash`
When the compilation pipeline compiles components for the Antigravity CLI target
Then the compiled agent's frontmatter SHALL contain `enable_write_tools: true`

**Scenario:** Compile agent with explicit Antigravity configuration block
Given an agent source frontmatter containing an `antigravity` block with `enable_mcp_tools: true`
When the compilation pipeline compiles components for the Antigravity CLI target
Then the compiled agent's frontmatter SHALL contain `enable_mcp_tools: true`

## Out of scope

- Auto-discovering tool dependencies from the agent's system prompt or body text.
- Validating the boolean tool parameters against a strict Antigravity engine schema during compilation.

## Open questions

*(none)*
