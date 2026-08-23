# Unified Extension Manifest — `extension.json`

This document specifies the unified manifest format for extensions in this
monorepo. A single `extension.json` per extension serves as the source of
truth, from which install scripts generate tool-native packages:

- **Gemini CLI**: a Gemini extension (directory with `gemini-extension.json`)
- **Claude Code**: a Claude Code plugin (directory with `.claude-plugin/plugin.json`)

## Format

`extension.json` files are **standard JSON** (not JSONC). Comments appear
only in this specification document for clarity. Actual files must be
valid JSON compatible with `jq`.

## Complete Schema

```jsonc
{
  // ============================================================
  // UNIVERSAL METADATA (required)
  // Used by all tools. These fields are mandatory.
  // ============================================================

  // Unique identifier for the extension. Must be kebab-case.
  // Used in file paths, npm package name, and tool registrations.
  // For Claude Code: also the plugin namespace (skills become /name:skill).
  "name": "hello-world",

  // Semantic version (X.Y.Z). Drives monorepo releases via Gitmoji.
  "version": "0.1.0",

  // Human-readable summary. Displayed in extension listings and help.
  "description": "Demonstration extension showcasing MCP tools, commands, skills, and context.",

  // ============================================================
  // MCP SERVERS (optional)
  // Shared MCP server definitions. Both tools use the same MCP SDK
  // and stdio transport, so this section is 100% universal.
  //
  // Each key is a server name (convention: "default" for single-server
  // extensions). Values define how to launch the server process.
  //
  // Variable substitution:
  //   ${extensionPath} — resolved at install time to the absolute path
  //                      of the installed extension/plugin directory.
  // ============================================================
  "mcpServers": {
    "default": {
      // Executable to run. Typically "node" for TypeScript MCP servers,
      // "python3" for Python-based servers.
      "command": "node",

      // Arguments passed to the command. The first argument is usually
      // the compiled entry point.
      "args": ["${extensionPath}/dist/index.js"],

      // Environment variables injected when spawning the server process.
      // Supports ${VAR} interpolation from the user's shell environment.
      // Optional — omit if the server needs no extra env.
      "env": {
        "NODE_ENV": "production"
      }
    }
  },

  // ============================================================
  // COMPONENTS (optional)
  // Declares which component types this extension provides.
  // Install scripts use these to know what to deploy.
  //
  // If a section is omitted or "enabled" is false, that component
  // type is ignored during installation.
  // ============================================================
  "components": {

    // Slash commands.
    // Gemini: .toml files deployed with the extension.
    // Claude Code: if convertToSkills is true, .toml commands are
    //   converted to SKILL.md files in the generated plugin.
    "commands": {
      "enabled": true,
      "location": "commands/",
      "convertToSkills": true
    },

    // Agent skills. SKILL.md files with YAML frontmatter.
    // Gemini: deployed as-is in the extension.
    // Claude Code: deployed in the plugin's skills/ directory.
    //   Namespaced as /plugin-name:skill-name.
    "skills": {
      "enabled": true,
      "location": "skills/"
    },

    // Sub-agent definitions. Markdown prompt files.
    // Gemini: PROMPT.md files (no frontmatter).
    // Claude Code: AGENT.md files (with frontmatter) in the plugin.
    "agents": {
      "enabled": false,
      "location": "agents/"
    },

    // Lifecycle hooks. Shell scripts triggered by tool events.
    // Gemini: hooks.json defining events (BeforeTool, AfterTool, etc.)
    // Claude Code: hooks.json with Claude events (PreToolUse, PostToolUse, etc.)
    // Hook systems are fundamentally different — see section below.
    "hooks": {
      "enabled": false,
      "location": "hooks/"
    }
  },

  // ============================================================
  // GEMINI CLI (optional)
  // Configuration specific to Gemini CLI. Ignored by Claude Code.
  // These fields map to the generated gemini-extension.json.
  // ============================================================
  "gemini": {

    // Context file loaded by Gemini CLI when this extension is active.
    // Must be a file at the extension root.
    "contextFileName": "GEMINI.md",

    // UI themes for Gemini CLI. Claude Code does not support themes.
    "themes": [
      {
        // Theme identifier. Convention: <extension-name>-<variant>.
        "name": "hello-world-dark",

        // Color palette. Minimum: primary, secondary, background, foreground.
        "colors": {
          "primary": "#00adb5",
          "secondary": "#ff2e63",
          "background": "#222831",
          "foreground": "#eeeeee"
        }
      }
    ],

    // Inline Gemini hook definitions.
    // Format: array of { event, matcher, name, type, command, timeout }.
    // If components.hooks is enabled, hooks/ directory takes precedence.
    "hooks": []
  },

  // ============================================================
  // CLAUDE CODE (optional)
  // Configuration specific to Claude Code. Ignored by Gemini CLI.
  // These fields shape the generated Claude Code plugin.
  // ============================================================
  "claude": {

    // Author metadata for the generated plugin manifest.
    "author": {
      "name": "Your Name"
    },

    // Context file loaded when plugin is active.
    // Deployed at the plugin root alongside skills/ and agents/.
    "contextFileName": "CLAUDE.md",

    // Glob patterns for skill directories to include in the plugin.
    // Each matched directory must contain a SKILL.md file.
    "skills": ["skills/*/SKILL.md"],

    // Glob patterns for agent definitions to include.
    "agents": [],

    // Additional rule files to include with the plugin.
    "rules": [],

    // Plugin-level hooks in Claude Code format.
    // Written to hooks/hooks.json in the generated plugin.
    // Format: { "EventName": [{ "matcher": "...", "hooks": [...] }] }
    "hooks": {},

    // Default allowed-tools applied to skills from this extension
    // when they don't define their own.
    "defaultAllowedTools": ["Read", "Write", "Edit", "Bash"],

    // Plugin-level settings applied when plugin is enabled.
    // Currently only "agent" key is supported by Claude Code.
    "settings": {},

    // LSP server configurations for code intelligence.
    // Written to .lsp.json in the plugin root.
    "lsp": {},

    // Directory of executables to add to the Bash tool's PATH.
    "bin": null
  }

  // ============================================================
  // FUTURE TOOLS (extensible)
  // Additional tool sections follow the same pattern:
  //   "codex": { ... }, "cursor": { ... }
  // Install scripts for each tool read only their own section +
  // the universal fields, ignoring everything else.
  // ============================================================
}
```

## Field Reference

### Universal (required)

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Extension ID (kebab-case). Plugin namespace for Claude Code. |
| `version` | string | Semantic version (X.Y.Z) |
| `description` | string | Human-readable summary |

### MCP Servers (optional)

| Field | Type | Description |
|-------|------|-------------|
| `mcpServers` | object | MCP server definitions (shared across tools) |
| `mcpServers[name].command` | string | Executable name |
| `mcpServers[name].args` | string[] | Arguments. Supports `${extensionPath}` |
| `mcpServers[name].env` | object | Env vars. Supports `${VAR}` interpolation |

### Components (optional)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `components.commands.enabled` | boolean | `false` | Commands provided? |
| `components.commands.location` | string | `commands/` | Directory path |
| `components.commands.convertToSkills` | boolean | `false` | Auto-convert .toml to SKILL.md for Claude |
| `components.skills.enabled` | boolean | `false` | Skills provided? |
| `components.skills.location` | string | `skills/` | Directory path |
| `components.agents.enabled` | boolean | `false` | Agents provided? |
| `components.agents.location` | string | `agents/` | Directory path |
| `components.hooks.enabled` | boolean | `false` | Hooks provided? |
| `components.hooks.location` | string | `hooks/` | Directory path |

### Gemini CLI (optional)

| Field | Type | Description |
|-------|------|-------------|
| `gemini.contextFileName` | string | Context file loaded when extension is active |
| `gemini.themes` | array | UI theme definitions |
| `gemini.themes[].name` | string | Theme identifier |
| `gemini.themes[].colors` | object | Color palette |
| `gemini.hooks` | array | Inline hook definitions |

### Claude Code (optional)

| Field | Type | Description |
|-------|------|-------------|
| `claude.author` | object | Plugin author → `plugin.json` |
| `claude.contextFileName` | string | Context file for the plugin |
| `claude.skills` | string[] | Glob patterns for skill directories |
| `claude.agents` | string[] | Glob patterns for agent directories |
| `claude.rules` | string[] | Rule files for the plugin |
| `claude.hooks` | object | Claude Code hook definitions → `hooks/hooks.json` |
| `claude.defaultAllowedTools` | string[] | Default tool permissions for skills |
| `claude.settings` | object | Plugin settings → `settings.json` |
| `claude.lsp` | object | LSP server config → `.lsp.json` |
| `claude.bin` | string | Executables directory → `bin/` |

## Install-Time Transformation

### Gemini CLI: extension generation

```
extension.json ──build──> Gemini extension directory
                          ├── gemini-extension.json   # Generated
                          ├── GEMINI.md               # Context file
                          ├── dist/                   # MCP server (shared)
                          ├── commands/               # .toml files
                          ├── skills/                 # SKILL.md files
                          ├── agents/                 # PROMPT.md files
                          └── hooks/hooks.json        # Gemini hook config
```

Generated `gemini-extension.json` contains: `name`, `version`, `description`,
`contextFileName` (from `gemini.contextFileName`), `mcpServers`, `themes`
(from `gemini.themes`).

No script implements this generation today: `gemini-extension.json` is
currently hand-maintained and version-locked to `package.json` by spec 0044,
with generation tracked by #725.

### Claude Code: plugin generation

```
extension.json ──build──> Claude Code plugin directory
                          ├── .claude-plugin/
                          │   └── plugin.json         # Generated
                          ├── .mcp.json               # Generated
                          ├── CLAUDE.md               # Context file
                          ├── skills/                 # SKILL.md files
                          ├── agents/                 # AGENT.md files
                          ├── hooks/hooks.json        # Claude hook config
                          ├── settings.json           # Plugin settings
                          ├── .lsp.json               # LSP config
                          └── bin/                    # Executables
```

Generated `.claude-plugin/plugin.json` contains: `name`, `version`,
`description`, `author` (from `claude.author`).

Generated `.mcp.json` contains: `mcpServers` with `${extensionPath}`
resolved to absolute path.

## Hook Systems

Gemini CLI and Claude Code have fundamentally different hook architectures.
See the migration plan (issue #30, section 5.4) for the complete comparison.

**Key rule**: `extension.json` does NOT provide a unified hook format.
Shell scripts in `hooks/` are reusable across tools, but hook registration
(event binding, matchers) is tool-specific:

- `gemini.hooks`: Gemini CLI format
- `claude.hooks`: Claude Code format → written to `hooks/hooks.json` in plugin

## Backward Compatibility

Install scripts support both formats:
1. If `extension.json` exists → use it (new unified format)
2. Else if `gemini-extension.json` exists → use it (legacy Gemini-only)
3. `create-extension.sh` generates `extension.json` for new extensions

## Fragment Merging

The scaffolding system (`create-extension.sh`) merges JSON fragments into
both manifests (`extension.json` and `gemini-extension.json`) during
extension creation, keeping the two in agreement (spec 0044):

- `mcp-server.json.fragment` → `mcpServers` field
- `theme.json.fragment` → `gemini.themes` field
- Merge tool: `jq -s '.[0] * .[1]'`, applied to each manifest
- Fragments are deleted only after both merges.
