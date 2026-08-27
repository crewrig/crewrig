# Extension MCP servers

<!-- crewrig-doc: section=authoring nav_order=30 published=true title="Extension MCP servers" -->

This page covers developing an extension's own MCP server: where its code
lives, which transports it may declare, how a server-relative path resolves
on each supported command-line tool, and the one extra step one of those
tools needs. It is reached from [`docs/extension-authoring.md`](extension-authoring.md);
the manifest field reference it draws on stays at
[`extension-skeleton/EXTENSION-FORMAT.md`](../extension-skeleton/EXTENSION-FORMAT.md).

## Source and build-output layout

An extension that ships its own MCP server implementation keeps its
**source** under one source directory (`src/` in the reference extension)
and its **executable output** under one build-output directory (`dist/` in
the reference extension), both at the extension root. A declared
`mcpServers[name].command`/`args` names the **build output**, never a
source file — compiling the source is the extension's own build step,
outside this render. An extension that declares only servers it does not
itself implement — for example, a server it merely points at an
already-installed binary — carries **neither** directory (source:
[`extension-skeleton/EXTENSION-FORMAT.md`](../extension-skeleton/EXTENSION-FORMAT.md)
→ *Complete Schema*, the `mcpServers` comment block).

## Transports

Each declared server names a `transport`: `stdio`, `http`, or `sse`. An
**omitted** transport selector means `stdio`. A `stdio` server declares
`command` (required) and optional `args`/`env`; an `http`/`sse` server
declares `url` (required) and optional `headers` (source:
[`extension-skeleton/EXTENSION-FORMAT.md`](../extension-skeleton/EXTENSION-FORMAT.md)
→ *Field Reference* → *MCP Servers*).

## The one neutral path token

A `stdio` server's `command`/`args` may point inside the extension's own
installed directory through exactly one neutral token, `${extensionRoot}`
— never a target-specific one. Each of the four supported command-line
tools resolves that token through its own party and its own moment, pinned
live against the installed tools
([`docs/runbooks/extension-mcp-token-probe.md`](runbooks/extension-mcp-token-probe.md)):

| Tool | Resolved to | Resolving party | Moment |
|---|---|---|---|
| Gemini CLI | `${extensionPath}` | Gemini CLI itself | At **load** time, when it loads the extension from the installed tree. |
| Claude Code | `${CLAUDE_PLUGIN_ROOT}` | Claude Code itself | At **load** time, when it loads the installed plugin. |
| GitHub Copilot CLI | `${COPILOT_PLUGIN_ROOT}` | Copilot CLI itself | At **spawn** time — Copilot also defaults a plugin server's `cwd` to its own plugin root, confirmed live: all three candidate forms (the neutral token, the native token, and a bare relative path) spawn correctly. |
| Antigravity CLI | left **unresolved** at render time | `scripts/install-antigravity-extension.sh`, a **post-install** step | After `agy plugin install` places the plugin — a relative `command`/`args` does not resolve against the plugin directory when Antigravity spawns a plugin's MCP server (confirmed live: it fails silently, with no error surfaced). |

For Gemini CLI, Claude Code, and Copilot CLI the rewrite happens at
**render** time, before the token ever needs a party to resolve it further.
Antigravity is the one tool that resolves nothing at render time: its
render leaves `${extensionRoot}` unresolved on purpose, and
`scripts/install-antigravity-extension.sh` rewrites it to the real
installed absolute path once that path is knowable — never a render-time
absolute path (source:
[`extension-skeleton/EXTENSION-FORMAT.md`](../extension-skeleton/EXTENSION-FORMAT.md)
→ *Complete Schema*, the `mcpServers` comment block, and
[`docs/runbooks/extension-mcp-token-probe.md`](runbooks/extension-mcp-token-probe.md)
→ *Q2*, *Q3*).

## Attributions

The declaration vocabulary, the transport set, the neutral path token, and
the per-tool resolution facts above all come from spec 0180 (issue #1006)
and its probe runbook; nothing on this page introduces a rule those sources
do not already carry.
