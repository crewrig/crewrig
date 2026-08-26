# ${SKELETON_NAME} Extension

Brief description of what this extension does.

## Installation

```bash
task install-gemini-extension EXT=${SKELETON_NAME}
```

(or `task install-extension-all EXT=${SKELETON_NAME}` to install across
every present command-line tool.)

## Structure

Every extension carries these unconditionally:

- `extension.json` — the single generic root manifest (spec 0173). Every
  tool-native manifest (`gemini-extension.json`, `plugin.json`, ...) is a
  BUILD OUTPUT rendered from this file — never committed.
- `CONTEXT.md` — agent-facing context, rendered per target at build time.
- `package.json`, `tsconfig.json`, `.gitignore` — npm/TypeScript scaffolding.

The following appear only if the corresponding component was selected when
this extension was scaffolded (`task create-extension`) — a directory
listed here that this tree does not contain was simply never selected:

- `src/` — MCP server source (TypeScript), if `mcp-server` was selected.
- `commands/` — slash command definitions, if `command` was selected.
- `skills/` — agent skill instructions, if `skill` was selected.
- `agents/` — sub-agent prompts, if `agent` was selected.
- `hooks/` — lifecycle hook scripts, if `hook` was selected.

A `theme` selection adds no directory: it merges directly into this
manifest's `gemini.themes` array.
