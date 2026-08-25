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
3. Merge each selected component's JSON fragment into the manifest by
   presence — every component now works this way (spec 0183 R1), not only
   `mcp-server`/`theme`.
4. Replace every `${SKELETON_NAME}` placeholder in every text-carrying
   file (a NUL-byte predicate, not a content-type heuristic — spec 0183 R3)
   and assert, unconditionally, that none survives in the produced tree.
5. Render the scaffolded tree once to derive its `accepted-gaps.json` from
   the render's own observed gap set (spec 0183 R2) — a scaffold whose
   declarations all map on every target gets no gap file at all.

### Skeleton Structure

The `extension-skeleton/` directory contains the template source. No file
here is named for a specific command-line tool (spec 0183 R9 — enforced by
`bash scripts/build-extension.sh --check` over this directory, not only
over extension source trees):

```text
extension-skeleton/
├── base/                                  # Always copied
│   ├── extension.json                     # Unified manifest (all tools; the ONLY manifest — gemini-extension.json is a build output, never committed, spec 0173 delta-01). Declares no subject: a base-only scaffold is a valid extension (spec 0183 R1).
│   ├── CONTEXT.md                         # Agent-facing context source, rendered per target (spec 0181)
│   ├── package.json                       # npm package with MCP SDK dependency
│   ├── tsconfig.json                      # TypeScript ES2022 / Node16
│   ├── README.md                          # Documentation, naming only the files the produced tree actually contains (spec 0183 R5)
│   └── .gitignore                         # node_modules, dist, .env
├── mcp-server/                            # MCP server component
│   ├── src/index.ts                       # Stdio MCP server with sample tool
│   └── mcp-server.json.fragment           # Merged into the manifest's mcpServers field on creation
├── command/
│   ├── commands/sample.md                 # Sample slash command (pivot source; the rendered .toml is a build output, never committed)
│   └── command.json.fragment              # Merged into the manifest's commands field on creation
├── skill/
│   ├── skills/sample-skill/SKILL.md       # Sample agent skill
│   └── skill.json.fragment                # Merged into the manifest's skills field on creation
├── agent/
│   ├── agents/sample-agent/AGENT.md       # Sample sub-agent prompt, Claude Code / Copilot CLI / Antigravity CLI pivot source
│   ├── agents/sample-agent/PROMPT.md      # Same sub-agent, Gemini CLI pivot source (sibling files by design — see EXTENSION-FORMAT.md)
│   └── agent.json.fragment                # Merged into the manifest's agents field on creation
├── hook/
│   ├── hooks/logger.sh                    # Sample PreToolUse hook script (the maps-everywhere event — spec 0179)
│   └── hooks.json.fragment                # Merged into the manifest's hooks field on creation
└── theme/theme.json.fragment              # Merged into the manifest's gemini.themes field on creation
```

Every occurrence of `${SKELETON_NAME}` in these files is replaced with your
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

`build-claude-plugin.sh` propagates `dist/` and `package.json` into the plugin output directory because the declared MCP command typically points inside it (`${extensionRoot}/dist/index.js` — the one neutral path token, spec 0180), and Node requires both to load an ESM MCP server at runtime. The generated `.mcp.json` carries `${CLAUDE_PLUGIN_ROOT}` (the neutral token rewritten to Claude's own spelling), which Claude Code itself resolves when it LOADS the installed plugin — not a render-time (build-time) resolution baked into the file (spec 0180 R8).

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

1. Calls `build-claude-plugin.sh` → produces `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/local-marketplace/<name>/` (a shared home outside the working tree, so multiple extensions coexist and installs survive branch switches)
2. Generates `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/local-marketplace/.claude-plugin/marketplace.json` with a marketplace named `<repo-basename>-local` (e.g. `crewrig-local`). This is a SHARED manifest: each installed extension is upserted by name, so it accumulates every extension installed under that config root
3. Runs `claude plugin marketplace add ${CLAUDE_CONFIG_DIR:-$HOME/.claude}/local-marketplace --scope user`
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
6. `scripts/release-package-extension.sh` renders the extension
   (`--target gemini`), asserts the built manifest's version matches the
   release version, and archives the rendered tree — `package.json` and
   `extension.json` (never `gemini-extension.json`, a build output that is
   never committed) are written to the release version first. A GitHub
   Release is published with that archive as its single asset (spec 0183;
   the published artifact serves the in-place tool, Gemini CLI, alone —
   Claude Code, Copilot CLI and Antigravity CLI reach an adopter through
   their own local render-and-install paths, unaffected by this release).
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

Both delegate to `scripts/release-package-extension.sh`, packaging the
extension's own currently-committed version — the same artifact shape a
real release publishes (a rendered, installable tree, not a source-only
tarball). The archive is written to `dist/release/<name>/`.

## Extension Anatomy

```text
extensions/org/my-extension/
├── extension.json          # The ONLY manifest — renders every CLI's file (spec 0173).
│                           #   gemini-extension.json is a build output; never committed.
├── package.json            # npm package (dependencies, build script)
├── tsconfig.json           # TypeScript configuration
├── CONTEXT.md              # Agent-facing context source, rendered per target (spec 0181) — GEMINI.md/CLAUDE.md/rules/AGENTS.md/the Copilot skill are all build outputs, never committed
├── README.md               # Documentation
├── src/                    # MCP server source (TypeScript)
│   └── index.ts
├── commands/                # Slash command pivot sources (.md); the rendered .toml is a build output
├── skills/                 # Agent skill directories (SKILL.md)
├── agents/                 # Sub-agent prompts — AGENT.md (Claude Code / Copilot CLI / Antigravity CLI pivot) and PROMPT.md (Gemini CLI pivot) as siblings, per component
└── hooks/                  # Lifecycle hooks (handler scripts; the rendered hooks.json is a build output)
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
