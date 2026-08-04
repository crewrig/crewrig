---
id: "0089"
slug: merge-mcp-declarations
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 616
version: 1.0.0
---

# Merge pre-existing MCP server declarations on setup

## Intent

When an operator runs any of the interactive setup scripts, the MCP server
declarations already present in the target CLI's configuration — whether the
operator added them by hand or inherited them from their organization — remain
present after the run. Today only the Claude setup keeps them; the Gemini,
Copilot, and Antigravity setups replace the whole declaration block with the
framework's own servers, so any custom server the operator relied on silently
disappears, recoverable only from a timestamped backup. After this change an
operator notices that their own MCP servers survive a setup run and keep
working, exactly as they already do on Claude.

## Requirements

1. The names `mempalace` and `sequentialthinking` SHALL be reserved,
   framework-managed MCP server names. Any declaration found under a reserved
   name SHALL be treated as framework-managed, not as an operator declaration.
2. Each interactive setup script that writes a CLI's on-disk MCP server
   configuration — Gemini, Copilot, and Antigravity — SHALL preserve every
   pre-existing MCP server declaration whose name is not reserved.
3. A preserved declaration SHALL be retained verbatim — its command,
   arguments, environment, and any other fields SHALL NOT be reordered,
   rewritten, or dropped by the setup run.
4. After a setup run, the target configuration SHALL contain both the
   framework-managed servers selected during that run AND every preserved
   declaration, with the preserved declarations' settings unchanged.
5. The preservation behavior SHALL be symmetric across the three setup scripts
   that overwrite an on-disk MCP configuration; the Claude setup, which already
   preserves pre-existing declarations through its idempotent server-add path,
   SHALL remain the reference behavior against which the other three are
   verified.
6. The framework SHALL continue to route its own MCP server commands through
   the custom-CA / native-TLS delegation wrapper (spec 0084) when the operator
   has consented to it; preserving pre-existing declarations SHALL NOT alter or
   remove that wrapping on the framework's own servers.
7. When the operator selects a framework-managed server and a declaration
   already exists under that reserved name, the setup SHALL write the
   framework's configuration under that name, replacing the prior entry
   (framework wins).
8. When the operator declines a framework-managed server, the resulting
   configuration SHALL NOT contain any entry under that reserved name — even
   if one pre-existed — and SHALL still retain every preserved declaration
   (the decline toggle-off is preserved).
9. When a pre-existing entry under a reserved name is replaced (R7) or removed
   (R8), the setup SHALL emit a non-silent warning that names the affected
   server and states that the prior entry is preserved in the timestamped
   backup.
10. Each affected setup script SHALL record a timestamped backup of the prior
    configuration before writing, so the operation remains recoverable
    independently of the preservation behavior.
11. A regression test SHALL assert, for each of the three affected setup
    scripts, that (a) a pre-existing non-reserved declaration is still present
    with unchanged settings after the run, and (b) a pre-existing entry under a
    reserved name triggers the framework-wins replacement on selection and the
    removal on decline, each with the warning required by R9.

## Scenarios

**Scenario:** Gemini setup keeps a hand-added MCP server

Given a `~/.gemini/settings.json` whose `mcpServers` already contains an
operator-added server `acme-tools` under a non-reserved name
When the operator runs `scripts/setup-gemini-interactive.sh` and selects the
MemPalace MCP server
Then the resulting `settings.json` contains both `acme-tools` — with its
command, arguments, and environment unchanged — and the framework-patched
`mempalace` server

**Scenario:** Antigravity setup preserves declarations despite its empty base

Given an existing Antigravity `mcp_config.json` whose `mcpServers` contains an
operator-added server `acme-tools`
When the operator runs `scripts/setup-antigravity-interactive.sh`
Then the resulting `mcp_config.json` still contains `acme-tools` with unchanged
settings, rather than being rebuilt from an empty server set

**Scenario:** Declining a framework server does not delete a custom one

Given a target configuration whose `mcpServers` contains a non-reserved server
`acme-tools` and no framework-managed servers
When the operator runs the setup script and declines both the MemPalace and the
SequentialThinking MCP servers
Then the resulting configuration still contains `acme-tools` with unchanged
settings
And contains no entry under the `mempalace` or `sequentialthinking` reserved
names

**Scenario:** Install-time collision on a reserved name — framework wins

Given a target configuration that already contains an entry under the reserved
name `mempalace` plus a non-reserved server `acme-tools`
When the operator runs the setup script and selects the MemPalace MCP server
Then the resulting configuration contains the framework-patched `mempalace`
server in place of the prior `mempalace` entry
And retains `acme-tools` unchanged
And the setup emits a warning naming `mempalace` and pointing to the timestamped
backup that holds the prior entry

**Scenario:** Decline-time collision on a reserved name — removed with warning

Given a target configuration that already contains an entry under the reserved
name `sequentialthinking`
When the operator runs the setup script and declines the SequentialThinking MCP
server
Then the resulting configuration contains no entry under the
`sequentialthinking` reserved name
And the setup emits a warning naming `sequentialthinking` and pointing to the
timestamped backup that holds the prior entry

## Out of scope

- The durable org-level MCP declaration source or mechanism — tracked in issue
  #617. This spec only guarantees that pre-existing on-disk declarations
  survive a setup run; it does not define where org-level declarations
  originate or how they are distributed.
- Any change to the Claude setup script, which already preserves declarations
  through its idempotent server-add path and serves only as the reference
  behavior.
- Introducing new framework-managed MCP servers, changing the set of reserved
  names, or changing which servers the setup scripts offer.
- Deduplicating, validating, or health-checking pre-existing declarations —
  they are retained as-is, never audited or normalized.
- Changing the timestamped-backup mechanism itself (its retention count,
  location, or naming format).
- Reconciling or propagating declarations across CLIs — a server present in the
  Gemini configuration is not copied into the Copilot or Antigravity one.
- Recording an ownership marker inside the configuration JSON to distinguish
  framework-managed from operator declarations; reserved-name semantics make
  such a marker unnecessary.

## Open questions

- None — resolved 2026-07-21. The reserved-name collision policy (framework
  wins on selection, toggle-off removal on decline, non-silent warning plus
  backup in both cases) is captured in R1 and R7-R9.

## Implementation notes (non-normative, for the PLAN stage)

These notes are design input for the PLAN stage, not normative requirements.

- The Antigravity setup differs structurally from the other two: it does not
  copy and patch a committed template, it hardcodes an empty base
  (`MCP_BASE='{"mcpServers":{}}'`) and rebuilds the server set inline. To
  satisfy R2/R4, the PLAN must seed that base from the existing on-disk
  `mcp_config.json` when one is present, rather than from the empty literal.
  This is a different code shape from the Gemini/Copilot template-copy path and
  should be planned explicitly.
- Prior art for the merge idiom already exists in the repository:
  `scripts/manage-copilot-component.sh` and
  `scripts/manage-antigravity-component.sh` both use
  `.mcpServers = ((.mcpServers // {}) + {($name): $val})`. The PLAN should
  reuse this established idiom rather than inventing a new one.
