---
id: "0175"
slug: antigravity-extension-agents-glob
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 643
version: 1.0.0
---

# Honor the agents glob when copying agents into an Antigravity extension

## Intent

Prevent `scripts/build-antigravity-extension.sh` from copying non-agent sibling files (such as Gemini's `PROMPT.md` pivot source) into the generated Antigravity plugin output by replacing recursive agent directory copying with file-level copying governed by the manifest's declared agents glob array.

## Requirements

1. `scripts/build-antigravity-extension.sh` SHALL copy agent files on a per-file basis rather than recursively copying entire agent directories.
2. `scripts/build-antigravity-extension.sh` SHALL read agent source glob patterns from `.antigravity.agents` in `extension.json`, falling back to `.claude.agents` if `.antigravity.agents` is empty or unset, and defaulting to `${AGENTS_LOCATION}*/AGENT.md` when both are empty or unset.
3. For each matched agent file, `scripts/build-antigravity-extension.sh` SHALL preserve the file's relative path inside the plugin output directory.
4. Non-matching sibling files in the agent directory (such as `PROMPT.md`) SHALL NOT be copied into the Antigravity plugin output directory.
5. A regression test `scripts/tests/test-build-antigravity-extension-agents-glob.sh` SHALL verify that sibling files are excluded by default and that custom agent globs in `extension.json` are honored.
6. The regression test SHALL be wired into both CI test surfaces (`ci/ci-capabilities.yml` and `.github/workflows/build.yml`) per spec 0076.

## Scenarios

**Scenario:** Default agent glob copies AGENT.md and excludes sibling PROMPT.md
Given an extension with `components.agents.enabled: true` containing `agents/sample-agent/AGENT.md` and `agents/sample-agent/PROMPT.md`
And `extension.json` contains no explicit agent glob overrides
When `scripts/build-antigravity-extension.sh` builds the extension
Then `agents/sample-agent/AGENT.md` SHALL be present in the output directory
And `agents/sample-agent/PROMPT.md` SHALL NOT be present in the output directory

**Scenario:** Custom agents glob matches additional files
Given an extension with `components.agents.enabled: true` containing `agents/sample-agent/AGENT.md`, `agents/sample-agent/README.md`, and `agents/sample-agent/PROMPT.md`
And `extension.json` explicitly defines `antigravity.agents` containing `["agents/*/AGENT.md", "agents/*/README.md"]`
When `scripts/build-antigravity-extension.sh` builds the extension
Then both `agents/sample-agent/AGENT.md` and `agents/sample-agent/README.md` SHALL be present in the output directory
And `agents/sample-agent/PROMPT.md` SHALL NOT be present in the output directory

## Out of scope

- Changing how `scripts/build-gemini-extension.sh` or `scripts/build-copilot-plugin.sh` handle agent packaging.
- Applying glob filtering to skill directories.

## Open questions

- None.
