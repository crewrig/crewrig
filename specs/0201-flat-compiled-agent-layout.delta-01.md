---
id: "0201"
slug: flat-compiled-agent-layout
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1140
version: 2.0.0
---

# 0201 — flat-compiled-agent-layout (delta-01)

This delta resolves the follow-up named in requirement 26 of spec 0201 and
implements the decision required by issue #1140 (epic #1100, seam g): flattening
extension agents packaged inside Claude Code plugins to `agents/<name>.md`.

Spec 0201 flattened the compiled Claude Code agent tree under `.claude/agents/`
from `.claude/agents/<name>/AGENT.md` to `.claude/agents/<name>.md`, but
deliberately excluded the Claude Code plugin packaging of extension agents
(requirements 23 and 26, *Out of scope*) pending empirical investigation.

**Empirical evidence:** Live testing of Claude Code (version 2.1.267)
demonstrates that the plugin component discovery loader behaves differently
from the project-level `.claude/agents/` loader:

1. **Top-level only:** When a plugin is loaded, Claude Code's plugin component
   loader inspects only top-level regular Markdown files matching `agents/*.md`
   directly under the plugin root's `agents/` directory.
2. **No recursive scan:** Unlike `.claude/agents/` (which recursively searches
   subdirectories), the plugin loader **does not** scan subdirectories. Any
   agent packaged in a nested subdirectory — such as
   `agents/<agent-name>/AGENT.md` or `agents/<category>/<agent-name>.md` — is
   completely ignored by the CLI.
3. **Live reproduction:** A test plugin carrying both flat agent files
   (`agents/flat-agent.md`, `agents/second-flat.md`) and nested agent directories
   (`agents/nested-agent/AGENT.md`, `agents/nested2/nested2.md`,
   `agents/nested3/agent.md`, `agents/sub-nested/sub-agent.md`) was probed via
   `claude --plugin-dir <dir> plugin details <name>`. Claude Code discovered
   exactly the 2 flat agents and 0 of the nested agents.
4. **Real-world verification:** The existing packaged `obsidian` plugin
   (`obsidian@crewrig-hcross-local`) contains `agents/sfeir-121/AGENT.md`.
   Running `claude plugin details obsidian@crewrig-hcross-local` reports
   `Agents (0)`.

Consequently, preserving the directory structure in `scripts/build-claude-plugin.sh`
causes extension agents to be silently invisible in Claude Code plugins.
Flattening packaged agents to `agents/<agent-name>.md` restores agent discovery
and aligns Claude Code plugin packaging with GitHub Copilot plugin packaging
(`scripts/build-copilot-plugin.sh`, spec 0065).

## ADDED

Added to `## Requirements`:

- **32. (Claude Code plugin agent packaging flattening).**
  `scripts/build-claude-plugin.sh` SHALL package each extension agent into the
  plugin output directory as a flat file `agents/<agent-name>.md`. Sibling files
  located inside the source agent directory (such as `PROMPT.md`) SHALL NOT be
  copied into the plugin output. The packaged plugin's `agents/` directory SHALL
  contain no per-agent subdirectories and no file named `AGENT.md`.
- **33. (Plugin agent glob regression test assertion).**
  `scripts/tests/test-build-claude-plugin-agents-glob.sh` SHALL assert that
  building an extension with an agent in `agents/demo-agent/AGENT.md` outputs
  `agents/demo-agent.md` as a regular file and does NOT create a directory
  `agents/demo-agent/`.
- **34. (CLI matrix and documentation alignment).** `docs/cli-matrix.md` row 4,
  row 5c, and row 13 SHALL be updated to document that Claude Code plugin
  packaging outputs flat `agents/<agent-name>.md` files.

Added to `## Scenarios`:

**Scenario:** packaged Claude Code plugin flattens extension agents

```text
Given an extension defining an agent under `agents/demo-agent/AGENT.md`
And   a sibling file `agents/demo-agent/PROMPT.md`
When  `scripts/build-claude-plugin.sh` builds the plugin
Then  the output directory contains `agents/demo-agent.md`
And   the output directory contains no subdirectory `agents/demo-agent/`
And   the output directory contains no file `agents/demo-agent/PROMPT.md`
```

## MODIFIED

Modified in `## Requirements`:

Original:

```markdown
23. The Claude Code plugin packaging of extension agents SHALL be unchanged by
    this specification.
```

Replacement:

```markdown
23. The Claude Code plugin packaging of extension agents SHALL package each
    agent into the plugin archive as a flat file `agents/<agent-name>.md` at the
    top level of the plugin's `agents/` directory. When an extension sources an
    agent from a directory (such as `agents/<agent-name>/AGENT.md`), the build
    script SHALL flatten it to `agents/<agent-name>.md`. When an extension
    sources an agent from an already flat file `agents/<agent-name>.md`, it SHALL
    copy it directly. The packaged plugin's `agents/` directory SHALL NOT
    contain nested per-agent directories under `agents/`.
```

Original:

```markdown
26. Documentation SHALL record that the Claude Code plugin packaging is
    unchanged and SHALL name the follow-up that would change it, so that a reader
    does not take this seam to have settled the plugin layout.
```

Replacement:

```markdown
26. Documentation SHALL record that the Claude Code plugin packaging flattens
    extension agents to `agents/<agent-name>.md`, citing live empirical evidence
    demonstrating that Claude Code's plugin component loader discovers only
    top-level regular files `agents/*.md` and does not scan subdirectories
    recursively.
```

Modified in `## Out of scope`:

Original:

```markdown
- **The Claude Code plugin packaging of extension agents.** The plugin builder
  copies extension **source** files matched by `agents/*/AGENT.md` and preserves
  their relative path; that source shape is the same pivot-authoring shape as
  `artifacts/*/agents/<name>/AGENT.md`, which this seam explicitly does not move.
  The Claude Code documentation, moreover, lists a plugin's `agents/` directory
  as a discovery location distinct from `.claude/agents/`, and scopes its
  recursive-scan sentence to the two `.claude/agents/` scopes — so it settles
  neither the safety nor the necessity of flattening the packaged copy. Deciding
  that without evidence is exactly what this seam is chartered not to do. Named
  follow-up per requirement 26.
```

Replacement:

```markdown
- **The Claude Code plugin packaging of extension agents.** Moved into scope by
  delta-01 under issue #1140, resolving the follow-up named in requirement 26.
```

## REMOVED

(None.)
