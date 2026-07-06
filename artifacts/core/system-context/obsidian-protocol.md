# Second Brain — Obsidian Protocol

If an MCP server providing access to an Obsidian vault is available
(e.g., `obsidian-mcp-server`), the following protocol applies.

## Availability Check

Before using Obsidian tools, verify the MCP server is present. If absent,
Tier 3 is simply unavailable — Tier 1 (Sequential Thinking) and Tier 2
(MemPalace) work independently. All memory protocols function without
Obsidian.

## Access Model

- **Read**: Free. Browse and search the vault to find relevant context,
  references, and domain knowledge that help achieve objectives.
- **Write**: User-controlled only. The agent may **suggest** notes to
  create or update, but MUST NOT write without the user's explicit
  consent for each operation.

## Vault Governance

If an `AGENTS.md` file exists at the root of the Obsidian vault, the
agent MUST conform to its rules. This file governs:

- Note naming conventions.
- Folder structure expectations.
- Tag and frontmatter conventions.
- Any vault-specific rules the user has established.

## Cross-Referencing

When the agent discovers a relevant Obsidian note, it may record a
reference in MemPalace (e.g., a drawer noting the Obsidian path and a
brief summary). This creates a bridge between tiers without duplicating
content.
