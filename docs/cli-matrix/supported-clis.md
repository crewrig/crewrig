# Supported CLIs

- **Claude Code**
  - Config root: `.claude/`
  - Entry point file: `CLAUDE.md` (re-exports `AGENTS.md`)
  - Plugin install dir: CLI-managed marketplace
  - Notes: Plugin-based loading. Components must be declared in a marketplace and installed via the CLI.
- **Gemini CLI**
  - Config root: `.gemini/`
  - Entry point file: `.gemini/GEMINI.md` (extension form) / `GEMINI.md`
  - Plugin install dir: `~/.gemini/extensions/`
  - Notes: Extension-based loading. Settings live in `~/.gemini/settings.json`.
- **Copilot CLI**
  - Config root: **Split**: `.github/copilot/` (settings + hooks) + `.github/skills/` (skills) + `.github/agents/`
    (agents)
  - Entry point file: `.github/copilot-instructions.md` (re-exports `AGENTS.md`)
  - Plugin install dir: In-place via `.github/`
  - Notes: Open Agent Skills standard. No single config root by design — Copilot reads each sibling path
    independently. `@copilot` mentions on issues / PRs trigger the coding agent natively.
- **Antigravity CLI**
  - Config root: `~/.gemini/antigravity-cli/`
  - Entry point file: `.agents/ANTIGRAVITY.md`
  - Plugin install dir: `~/.gemini/config/plugins/`
  - Notes: Plugin-based loading via `agy plugin install`. Workspace entry point is `.agents/ANTIGRAVITY.md`; user-level
    config lives under `~/.gemini/antigravity-cli/`. (spec 0052)
