# Extension authoring

<!-- crewrig-doc: section=authoring nav_order=20 published=true title="Extension authoring" -->

This page is the entry point for authoring a CrewRig extension: what an
extension declares, how that declaration becomes a working extension for
each supported command-line tool, and where to go next for the normative
detail this page does not restate.

## The manifest

Every extension carries exactly one hand-authored manifest, `extension.json`,
at the extension root. Every declaration subject — commands, skills, agents,
hooks, MCP servers, and context — lives inside that single file, in a
generic top-level section, declared exactly once (source:
[`extension-skeleton/EXTENSION-FORMAT.md`](../extension-skeleton/EXTENSION-FORMAT.md),
opening paragraph).

## The render-at-publication model

A file inside an extension's source tree whose name designates a specific
command-line tool — `gemini-extension.json`, `claude-extension.json`,
`copilot-extension.json`, `antigravity-extension.json`,
`.github/copilot/extension.json`, and a per-CLI-designated file rendered
from the `commands/` pivot — is always a build output, produced from the
manifest by `scripts/build-extension.sh`, and never a hand-authored source.
The exact list of generated-output file names and globs is committed data
(`scripts/lib/extension-generated-class.json`). None of these files is
committed on the primary branch, for any command-line tool (source:
[`extension-skeleton/EXTENSION-FORMAT.md`](../extension-skeleton/EXTENSION-FORMAT.md)
→ *The render-at-publication model — read this before the schema*).

## What the manifest declares

Six generic declaration subjects, each its own top-level section of
`extension.json`. Enablement follows presence — there is no separate
`enabled` toggle:

| Subject | What it declares |
|---|---|
| `commands` | Slash commands, rendered for every supported tool from a `commands/` pivot. |
| `skills` | Agent skills (`SKILL.md` files). |
| `agents` | Sub-agent definitions. |
| `hooks` | Lifecycle hooks, declared in a neutral vocabulary and translated per target — see [`docs/extension-hook-events.md`](extension-hook-events.md) for the closed event/matcher correspondence. |
| `mcpServers` | The extension's own MCP server declarations — see [`docs/extension-mcp-servers.md`](extension-mcp-servers.md) for developing one. |
| `context` | A single command-line-tool-neutral agent-facing context source. |

(Sources:
[`extension-skeleton/EXTENSION-FORMAT.md`](../extension-skeleton/EXTENSION-FORMAT.md)
→ *Field Reference* → *Declaration subjects* and *MCP Servers* tables.)

## Delivery paths

The rendered tree for the command-line tool that loads an extension in
place (Gemini CLI) reaches an adopter through exactly one of three
supported paths:

1. **A versioned release artifact** — the default operating mode for that
   tool's install. The archive carries the rendered tree's contents at its
   own root, with no wrapper directory, and serves Gemini CLI alone; see
   [`docs/runbooks/extension-release-install-probe.md`](runbooks/extension-release-install-probe.md)
   for the evidence pinning that form.
2. **`bash scripts/install-extension.sh install <name>`** — this
   repository's own install script.
3. **`task link-gemini-extension-build EXT=<name>`** — a documented
   **debugging** path, not an install path.

A native `gemini extensions install` command pointed directly at this
project's primary branch is **documented as unsupported**: nothing
generated lives there for the tool to find.

Claude Code, GitHub Copilot CLI, and Antigravity CLI each build their own
ephemeral plugin locally on install and are not served by the release
artifact above; they reach an adopter through their own local
render-and-install path.

(Source:
[`extension-skeleton/EXTENSION-FORMAT.md`](../extension-skeleton/EXTENSION-FORMAT.md)
→ *Delivery paths*.)

## Supported command-line tools

The render supports four command-line tools: **Gemini CLI**, **Claude
Code**, **GitHub Copilot CLI**, and **Antigravity CLI**. Gemini CLI loads
the rendered tree in place; the other three build a plugin from it (sources:
[`extension-skeleton/EXTENSION-FORMAT.md`](../extension-skeleton/EXTENSION-FORMAT.md)
→ *Install-Time Transformation*, and `scripts/lib/extension-targets.json`'s
row set).

## Where each detail lives

This page names the pieces; it does not restate their contract. For the
normative detail:

- **The manifest schema and render contract, in full** —
  [`extension-skeleton/EXTENSION-FORMAT.md`](../extension-skeleton/EXTENSION-FORMAT.md).
  Stays where it is; this page does not duplicate it.
- **Developing, testing, and releasing an extension** —
  [`DEVELOPMENT.md`](../DEVELOPMENT.md).
- **The neutral hook event and matcher vocabulary** —
  [`docs/extension-hook-events.md`](extension-hook-events.md).
- **Developing an extension's own MCP server** —
  [`docs/extension-mcp-servers.md`](extension-mcp-servers.md).
