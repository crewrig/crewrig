# CLI Support Matrix

Reference of every CLI-specific integration point in CrewRig. Update this
file in the same PR as any change that adds, removes, or modifies a
CLI-specific feature — drift here is a parity bug.

## Supported CLIs

| CLI         | Config root  | Entry point file              | Notes |
|-------------|--------------|-------------------------------|-------|
| Claude Code | `.claude/`   | `CLAUDE.md` (re-exports `AGENTS.md`) | Plugin-based loading. Components must be declared in a marketplace and installed via the CLI. |
| Gemini CLI  | `.gemini/`   | `.gemini/GEMINI.md` (extension form) / `GEMINI.md` | Extension-based loading. Settings live in `~/.gemini/settings.json`. |

## Feature matrix

One row per integration point. ✅ = present, ❌ = absent, note when relevant.

| # | Feature / integration point                                | Source of truth                                  | Claude Code                                         | Gemini CLI                                          |
|---|------------------------------------------------------------|--------------------------------------------------|-----------------------------------------------------|-----------------------------------------------------|
| 1 | Workspace config root directory                            | repo layout                                      | ✅ `.claude/`                                       | ✅ `.gemini/`                                       |
| 2 | Top-level agent-context entry point                        | repo layout                                      | ✅ `CLAUDE.md`                                      | ✅ `GEMINI.md` (in extensions; absent at repo root) |
| 3 | Skill definitions directory (built output)                 | `scripts/build-components.sh` `build_skills`     | ✅ `.claude/skills/<name>/SKILL.md`                 | ✅ `.gemini/skills/<name>/SKILL.md`                 |
| 4 | Agent definitions directory (built output)                 | `scripts/build-components.sh` `build_agents`     | ✅ `.claude/agents/<name>/AGENT.md` (directory)     | ✅ `.gemini/agents/<name>.md` (flat file)           |
| 5 | Slash-command directory (built output)                     | `scripts/build-components.sh` `build_commands`   | ✅ Compiled into `.claude/skills/<name>/SKILL.md` (commands are wrapped as user-invocable skills) | ✅ `.gemini/commands/<name>.toml` (native TOML)     |
| 6 | Settings file in `config/`                                 | `config/`                                        | ✅ `config/claude/settings.json.template`           | ✅ `config/gemini/settings.json`                    |
| 7 | Active workspace settings file                             | `.claude/`, `.gemini/`                           | ✅ `.claude/settings.json`                          | ❌ (loaded from `~/.gemini/settings.json` by the CLI; no in-repo workspace file) |
| 8 | Hook-integration manifest                                  | `hooks/`                                         | ✅ `hooks/claude-transcript-hooks.json` (UserPromptSubmit, PostToolUse, Stop, SessionEnd) | ✅ `hooks/gemini-transcript-hooks.json` (BeforeAgent, AfterTool, AfterModel, SessionEnd) |
| 9 | Project-dir env var consumed by hooks                      | `hooks/*-transcript-hooks.json`                  | ✅ `$CLAUDE_PROJECT_DIR`                            | ✅ `${GEMINI_PROJECT_DIR}`                          |
| 10 | Interactive setup script                                  | `scripts/`                                       | ✅ `scripts/setup-claude-interactive.sh`            | ✅ `scripts/setup-gemini-interactive.sh`            |
| 11 | Transcript backfill script                                | `scripts/`                                       | ✅ `scripts/import-claude-history.sh` (reads `~/.claude/projects`) | ✅ `scripts/import-gemini-history.sh` (reads `~/.gemini/tmp`) |
| 12 | Component-management script                               | `scripts/`                                       | ✅ `scripts/manage-claude-component.sh`             | ✅ `scripts/manage-workspace-component.sh` (Gemini target) |
| 13 | Plugin / extension build script                           | `scripts/`                                       | ✅ `scripts/build-claude-plugin.sh` → `dist-claude-plugin/.claude-plugin/marketplace.json` | ❌ Gemini consumes extensions in-place; no separate build script |
| 14 | Plugin / extension install script                         | `scripts/`                                       | ✅ `scripts/install-claude-plugin.sh`               | ❌ (not yet implemented; Gemini auto-discovers extensions) |
| 15 | Build-components target flag                              | `scripts/build-components.sh`                    | ✅ `--target claude`                                | ✅ `--target gemini`                                |
| 16 | Taskfile entries                                          | `Taskfile.yml`                                   | ✅ `setup-claude-interactive`, `install-claude-workspace`, `link-claude-workspace`, `install-claude-component`, `link-claude-component`, `build-claude-plugin`, `install-claude-plugin`, `import-claude-history`, `build-components-claude` | ✅ `setup-gemini-interactive`, `import-gemini-history`, `build-components-gemini` |
| 17 | Per-CLI extension manifest                                | `extensions/<name>/`                             | ✅ `extension.json` (+ `CLAUDE.md`)                 | ✅ `gemini-extension.json` (+ `GEMINI.md`)          |
| 18 | CI workflow targeting the CLI                             | `.github/workflows/`                             | ✅ `claude.yml` (anthropics/claude-code-action on `@claude` mentions) | ❌ No `gemini.yml` equivalent                       |
| 19 | Documentation prose references                            | `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `DEVELOPMENT.md` | ✅ Documented throughout                       | ✅ Documented throughout                            |
| 20 | `.gitignore` carve-outs                                   | `.gitignore`                                     | ✅ `dist-claude-plugin/`, `.claude/settings.local.json`, `CLAUDE.local.md` | ❌ No Gemini-specific entries                       |

## Parity gaps

The following features exist for one CLI but not the other. Each gap is a
candidate follow-up issue. **Do not fix them in this ticket.**

- [GAP] CI workflow — present for Claude Code (`.github/workflows/claude.yml`), missing for Gemini CLI.
- [GAP] Plugin/extension build script — present for Claude Code (`scripts/build-claude-plugin.sh`), missing for Gemini CLI (extensions are consumed in place, but no symmetric packaging path exists).
- [GAP] Plugin/extension install script — present for Claude Code (`scripts/install-claude-plugin.sh`), missing for Gemini CLI.
- [GAP] In-repo workspace settings file — present for Claude Code (`.claude/settings.json`), missing for Gemini CLI (settings live only in `~/.gemini/settings.json`).
- [GAP] `.gitignore` carve-outs — Claude-specific entries (`dist-claude-plugin/`, `.claude/settings.local.json`, `CLAUDE.local.md`) have no Gemini equivalents (e.g., a `.gemini/settings.local.json` analogue).
- [GAP] Top-level entry point file — `CLAUDE.md` lives at the repo root; `GEMINI.md` only appears inside extensions (no repo-root `GEMINI.md`).

## Adding a new CLI

Use this checklist when onboarding a new CLI. Each item maps to a row in
the feature matrix above — leaving one unchecked produces a parity gap.

1. [ ] Create the workspace config root (`./.<cli>/`).
2. [ ] Add a top-level agent-context entry point that re-exports `AGENTS.md` (analogous to `CLAUDE.md`).
3. [ ] Extend `scripts/build-components.sh` with a `--target <cli>` branch and emit skills under `.<cli>/skills/<name>/SKILL.md` (or the native form).
4. [ ] Extend `build_agents` in the same script to emit agents in the CLI's native layout.
5. [ ] Extend `build_commands` in the same script to emit commands in the CLI's native form.
6. [ ] Add a per-CLI settings template under `config/<cli>/`.
7. [ ] Decide whether a checked-in workspace settings file at `.<cli>/settings.json` is required, and add it if so.
8. [ ] Provide a hook-integration manifest under `hooks/<cli>-transcript-hooks.json` covering the CLI's lifecycle events.
9. [ ] Document the CLI's project-dir env var convention and wire `hooks/mempalace-transcript.sh` to read it.
10. [ ] Add an interactive setup script `scripts/setup-<cli>-interactive.sh`.
11. [ ] Add a transcript backfill script `scripts/import-<cli>-history.sh`.
12. [ ] Add or extend a component-management script for the CLI.
13. [ ] If the CLI requires a build step before install, add `scripts/build-<cli>-plugin.sh` (or equivalent).
14. [ ] If a separate install step is required, add `scripts/install-<cli>-plugin.sh`.
15. [ ] Register `--target <cli>` invocations in `Taskfile.yml`, plus `setup-`, `import-`, `install-`, `link-`, and `build-components-` task entries.
16. [ ] Add a per-CLI extension manifest convention to `extension-skeleton/` and update `extensions/hello-world/` with an example.
17. [ ] Add a CI workflow `.github/workflows/<cli>.yml` if the CLI offers an automation entry point.
18. [ ] Update prose references in `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, and `DEVELOPMENT.md`.
19. [ ] Add `.gitignore` carve-outs for the CLI's local settings and any generated `dist-<cli>-*` directories.
20. [ ] Append a new column to this matrix and re-check every row.
