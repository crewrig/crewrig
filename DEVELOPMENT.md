# Extension Development Guide

This document covers the full lifecycle of creating, developing, testing,
and releasing extensions in this monorepo. Extensions work with both
**Gemini CLI** (as extensions), **Claude Code** (as plugins), and
**GitHub Copilot CLI** (consumed in place from `.github/`) from a single
`extension.json` manifest. See
[`extension-skeleton/EXTENSION-FORMAT.md`](extension-skeleton/EXTENSION-FORMAT.md)
for the complete manifest specification.

## Creating a New Extension

Always use the interactive scaffolding task:

```bash
task create-extension NAME=my-extension
```

An fzf menu lets you select which components to include (use TAB to
toggle, ENTER to confirm):

- **mcp-server** — TypeScript MCP server with stdio transport
- **command** — Sample `.toml` slash command
- **skill** — Sample `SKILL.md` agent skill
- **agent** — Sub-agent prompt definition
- **hook** — Lifecycle hook (BeforeTool/AfterTool)
- **theme** — UI theme JSON fragment

The script will:

1. Copy the base skeleton into `extensions/org/my-extension/`.
2. Inject selected component directories.
3. Replace every `SKELETON_NAME` placeholder with your extension name.
4. Merge JSON fragments (MCP server, theme) into the manifest.

### Skeleton Structure

The `extension-skeleton/` directory contains the template source:

```text
extension-skeleton/
├── .geminiignore                          # Prevents Gemini from loading templates
├── base/                                  # Always copied
│   ├── extension.json                     # Unified manifest (all tools)
│   ├── gemini-extension.json              # Legacy Gemini-only manifest
│   ├── CLAUDE.md                          # Claude Code context placeholder
│   ├── package.json                       # npm package with MCP SDK dependency
│   ├── tsconfig.json                      # TypeScript ES2022 / Node16
│   ├── GEMINI.md                          # Agent context placeholder
│   ├── README.md                          # Documentation placeholder
│   └── .gitignore                         # node_modules, dist, .env
├── mcp-server/                            # MCP server component
│   ├── src/index.ts                       # Stdio MCP server with sample tool
│   └── mcp-server.json.fragment           # Merged into manifest on creation
├── command/commands/sample.toml           # Sample slash command
├── skill/skills/sample-skill/SKILL.md     # Sample agent skill
├── agent/agents/sample-agent/PROMPT.md    # Sample sub-agent prompt
├── hook/hooks/                            # Lifecycle hook
│   ├── hooks.json                         # Hook event configuration
│   └── logger.sh                          # Sample BeforeTool hook script
└── theme/theme.json.fragment              # Merged into manifest on creation
```

Every occurrence of `SKELETON_NAME` in these files is replaced with your
extension name during scaffolding.

### After Scaffolding

```bash
cd extensions/org/my-extension
npm install
```

## Development Workflow

### Link Mode

During development, use symlinks so changes take effect immediately
without reinstalling:

**Gemini CLI:**

```bash
task link-extensions
```

Start a Gemini session and your extension is loaded. Edit source files,
rebuild with `npm run build`, and restart Gemini to pick up changes.

**Claude Code:**

```bash
task build-claude-plugin EXT=my-extension
claude --plugin-dir extensions/org/my-extension/dist-claude-plugin/my-extension
```

The `--plugin-dir` flag loads the plugin directly for development.
Run `/reload-plugins` after changes to pick up updates without
restarting.

### Testing Locally

```bash
# Build the extension
cd extensions/org/my-extension
npm run build

# Verify the MCP server starts
node dist/index.js
# (Ctrl+C to stop — it runs on stdio)
```

### Plugin Build Contract

`build-claude-plugin.sh` propagates `dist/` and `package.json` into the plugin output directory because the generated `.mcp.json` resolves `${extensionPath}` to that directory at build time, and Node requires both to load an ESM MCP server at runtime.

Implications for contributors:

- `dist/` must be rebuildable from source via `npm run build` (`tsconfig.json` and `src/` must be committed; `dist/` is in `.gitignore`)
- `package.json` must declare `"type": "module"` for ESM resolution (confirmed: this is the value in `extension-skeleton/base/package.json`)
- Do not commit `dist/` inside the extension directory; the build script regenerates it

Rebuild reminder:

```bash
cd extensions/org/my-extension
npm run build
task build-claude-plugin EXT=my-extension
```

## Installing a Claude Code Plugin

Claude Code does not auto-discover plugins placed under `~/.claude/plugins/`. Plugins must be declared in a marketplace and installed via the CLI before Claude Code can load them.

`scripts/install-claude-plugin.sh` handles this in four steps:

1. Calls `build-claude-plugin.sh` → produces `dist-claude-plugin/<name>/`
2. Generates `dist-claude-plugin/.claude-plugin/marketplace.json` with a marketplace named `<repo-basename>-local` (e.g. `crewrig-local`)
3. Runs `claude plugin marketplace add <dist-claude-plugin-dir> --scope user`
4. Runs `claude plugin install <name>@<marketplace-name> --scope user`

Install via the task wrapper:

```bash
task install-claude-plugin EXT=my-extension
```

Verify the installation:

```bash
claude plugin list
```

Running `/<skill-name>` inside a Claude Code session also confirms that a skill from the plugin is accessible.

For iterative development, prefer the `--plugin-dir` flag documented in the [Link Mode](#link-mode) section — it skips the marketplace step.

## Branching Strategy

- Create a feature branch from `main`: `feat/my-extension`
- Open a Pull Request targeting `main`.
- Merging into `main` triggers the automated release pipeline.

## Versioning with Gitmoji

Semantic Release analyzes commit messages using Gitmoji to determine
version bumps automatically:

| Gitmoji | Meaning | Release |
|---------|---------|---------|
| `:boom:` | Breaking change | **MAJOR** |
| `:sparkles:` | New feature | **MINOR** |
| `:bug:` | Bug fix | **PATCH** |
| `:ambulance:` | Critical hotfix | **PATCH** |
| `:lock:` | Security fix | **PATCH** |
| `:zap:` | Performance improvement | **PATCH** |

Commits that do not match any rule (e.g., `:memo:`, `:wrench:`) do not
trigger a release.

### How It Works

1. A commit lands on `main` touching files in `extensions/org/my-extension/`.
2. The `release-monorepo` workflow detects the change.
3. `semantic-release-monorepo` scopes the analysis to that extension only.
4. `semantic-release-gitmoji` determines the version bump from the emoji.
5. A tag `my-extension-vX.Y.Z` is created.
6. A GitHub Release is published with the packaged `.tgz` as an asset.
7. A CHANGELOG.md is committed back into the extension directory.

Other extensions in the monorepo are not affected.

## Packaging

To manually package an extension without releasing:

```bash
# Single extension
task package-extension EXT=my-extension

# All extensions
task package
```

The `.tgz` files are written to `dist/`.

## Extension Anatomy

```text
extensions/org/my-extension/
├── extension.json          # Unified manifest (generates Gemini ext + Claude plugin)
├── gemini-extension.json   # Legacy Gemini-only manifest (optional)
├── package.json            # npm package (dependencies, build script)
├── tsconfig.json           # TypeScript configuration
├── GEMINI.md               # Agent context for Gemini CLI
├── CLAUDE.md               # Agent context for Claude Code
├── README.md               # Documentation
├── src/                    # MCP server source (TypeScript)
│   └── index.ts
├── commands/               # Slash command .toml files
├── skills/                 # Agent skill directories (SKILL.md)
├── agents/                 # Sub-agent prompts (PROMPT.md)
└── hooks/                  # Lifecycle hooks (hooks.json + scripts)
```

Not all directories are required — include only what your extension needs.

## Session Transcript Activation

Transcripts are disabled by default. To enable them, set the environment variable before starting Claude Code:

```bash
export MEMPALACE_TRANSCRIPT_ENABLED=1
```

Once enabled, the hook `hooks/mempalace-transcript.sh` is triggered on every matching event via `hooks/claude-transcript-hooks.json` (events: `UserPromptSubmit`, `PostToolUse`, `Stop`, `SessionEnd`).

What is recorded:

- `UserPromptSubmit` → `[USER] <raw prompt text>`
- `PostToolUse` → `[TOOL] <tool-name>: <command/path/pattern>`
- `Stop` → `[AGENT] Session turn completed`
- `SessionEnd` → `[SESSION] SessionEnd: <source>`

Each entry is stored as a drawer in `wing="transcripts"`, `room="<project-name>-<YYYY-MM-DD>-<session-id[:8]>"`. Content is capped at 4,000 characters per drawer. The `transcripts` wing is excluded from default MemPalace semantic searches — see [`config/TOOLS.md`](config/TOOLS.md) (Memory Activation Protocol section) for the rationale.

Every tool call and every prompt generates a drawer. Long sessions accumulate hundreds of drawers. Use the prune task to manage retention:

```bash
# Dry-run: shows what would be deleted (default retention: 30 days)
task prune-transcripts

# Apply deletion
task prune-transcripts -- --apply

# Filter by project, custom retention
task prune-transcripts -- --project my-extension --days 14 --apply
```

**Privacy:** Transcripts contain raw user prompts. Do not enable `MEMPALACE_TRANSCRIPT_ENABLED=1` on a shared MemPalace instance without evaluating data exposure for all users sharing that instance.
