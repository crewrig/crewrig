# ADR 0001 — GitHub Copilot CLI Integration Strategy

## Status

Accepted — 2026-05-20.

## Context

CrewRig is a multi-CLI agent framework that ships skills, agent
definitions, slash commands, hook manifests, and CI integrations to two
target CLIs today (Claude Code under `.claude/` and Gemini CLI under
`.gemini/`), built from a single `community-config/` source tree by
`scripts/build-components.sh`. GitHub Copilot CLI reached GA on
2026-02-25 and now supports the open **Agent Skills** standard, MCP,
hooks, and a coding-agent surface triggered by `@copilot` mentions —
enough surface to be a first-class CrewRig target. This ADR records the
mapping decisions used by the implementation team for issue #50.

The defining shape difference vs. the two incumbent CLIs: Copilot has
**no single workspace config root**. Settings and hooks live under
`.github/copilot/`, skills live under `.github/skills/` (or
`.claude/skills/` or `.agents/skills/` — the open standard accepts any
of the three), and the entry-point instructions file lives directly
under `.github/`. We must accept a split root rather than force a
synthetic `.copilot/` directory.

## Discovery findings

| # | Checklist item | Copilot CLI equivalent | Notes / gaps |
|---|---|---|---|
| 1 | Workspace config root | **Split.** `.github/copilot/` (settings + inline hooks) + `.github/skills/` (skills) + `.github/copilot-instructions.md` (entry point). No single root. | Documented divergence — record in matrix as `.github/copilot/` (+ siblings). |
| 2 | Top-level agent-context entry point | `.github/copilot-instructions.md` | Markdown; loaded automatically by every Copilot CLI session in the repo. Must re-export `AGENTS.md` content (link or include). |
| 3 | Skill definitions directory (built output) | `.github/skills/<name>/SKILL.md` | Open Agent Skills standard. YAML frontmatter: `name`, `description`, optional `allowed-tools`, optional `license`. Body is Markdown. Compatible 1:1 with our existing `SKILL.md` shape. |
| 4 | Agent definitions directory (built output) | User-level `~/.copilot/agents/` is documented. Repo-level layout is **not** in the public reference. By parallelism with skills we will adopt `.github/agents/<name>.md`. | `[GAP-confirmation]` — exact repo-level filename/extension is undocumented; verify by inspection during implementation. Treat as best-effort. |
| 5 | Slash-command directory (built output) | **No user-definable slash commands.** Copilot's slash commands are CLI builtins (`/skills`, `/clear`, …). User invocation of a custom skill happens via `/<skill-name>` once the skill is registered. | `[GAP]` for first-class slash commands. Mapping: commands compile **as skills** in `.github/skills/` (same approach Claude already uses). |
| 6 | Settings template in `config/` | `config/copilot/settings.json.template` (new) — schema mirrors `.github/copilot/settings.json` | New directory under `config/`. |
| 7 | Active workspace settings file | `.github/copilot/settings.json` (committed) and `.github/copilot/settings.local.json` (gitignored, user-specific) | Direct analog to `.claude/settings.json` — Copilot supports it natively. |
| 8 | Hook-integration manifest | Two valid forms: **(a)** inline `hooks: { … }` block at top of `.github/copilot/settings.json`; **(b)** standalone `*.json` files in `~/.copilot/hooks/` (user-level only). | **Both forms are used** (revised from initial "form (a) only"): `setup-copilot-interactive.sh` deploys hooks as an opt-in step to **both** `~/.copilot/hooks/copilot-transcript-hooks.json` (form b — user-level, fires for all projects, parity with Claude/Gemini) **and** `.github/copilot/settings.json` (form a — workspace-level, rewritten with absolute path by setup). The committed `settings.json` has `"hooks": []` by design — hooks are never committed with project-relative paths. Event names: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PreCompact`, `Stop`, `SubagentStart`, `SubagentStop`, `ErrorOccurred`, `PermissionRequest`, `Notification`, `SessionEnd`. JSON manifest keys: `version`, `disableAllHooks`, `hooks`. Hook entry types: `command`, `http`, `prompt`. |
| 9 | Project-dir env var consumed by hooks | **None documented.** Hooks receive context as a JSON payload on stdin, not as `$COPILOT_PROJECT_DIR`. | `[GAP]` for env-var parity. Workaround: `hooks/mempalace-transcript.sh` must read project dir from the hook stdin payload (or fall back to `$PWD` since the hook runs in the workspace cwd). |
| 10 | Interactive setup script | `scripts/setup-copilot-interactive.sh` (new) | Standard pattern. |
| 11 | Transcript backfill script | `scripts/import-copilot-history.sh` reading `~/.copilot/session-state/<session-id>/events.jsonl` | Each session is a directory; `events.jsonl` is the transcript. Differs from Claude's `~/.claude/projects` and Gemini's `~/.gemini/tmp`. |
| 12 | Component-management script | Extend `scripts/manage-workspace-component.sh` with a Copilot target (or add `scripts/manage-copilot-component.sh`). | Reuse existing pattern. |
| 13 | Plugin / extension build script | **None required.** Copilot consumes skills + agents from `.github/` in place. Enterprise-managed plugins are an org-admin distribution layer, not a per-repo build step. | `[GAP]` by design — no analog to `scripts/build-claude-plugin.sh`. Same status as Gemini. |
| 14 | Plugin / extension install script | None required (see #13). | `[GAP]` by design — same as Gemini. |
| 15 | Build-components target flag | `scripts/build-components.sh --target copilot` | Add a third branch in the existing dispatch. |
| 16 | Taskfile entries | `setup-copilot-interactive`, `import-copilot-history`, `build-components-copilot` (minimum). Add `install-*` / `link-*` only if a packaging path lands. | Mirror Gemini's slim entry set. |
| 17 | Per-CLI extension manifest | `.github/copilot/extension.json` (proposed) inside `extensions/<name>/` — no public spec for a repo-level Copilot extension manifest. | `[GAP-soft]` — Copilot lacks a documented per-extension manifest. Defer to a follow-up issue; implementers may ship without one in v1. |
| 18 | CI workflow targeting the CLI | **Native.** `@copilot` mentions on issues/PRs auto-trigger the coding agent in a GitHub-Actions-backed ephemeral env. No `.github/workflows/copilot.yml` is required to enable this. **Optional** workflows can drive `copilot` CLI commands for non-interactive automation (e.g. `gh copilot suggest` in CI). | We add a minimal `.github/workflows/copilot.yml` that documents the `@copilot` trigger and (optionally) runs `copilot` CLI in CI. Parity with `claude.yml`. |
| 19 | Documentation prose references | Update `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `DEVELOPMENT.md` | Standard. |
| 20 | `.gitignore` carve-outs | `.github/copilot/settings.local.json`, `copilot-instructions.local.md` (if used) | Mirror Claude's `.local` carve-outs. |
| — | New matrix column | Add a `Copilot CLI` column to `docs/cli-matrix.md` and re-check every row | Standard. |

## Mapping decisions

For every checklist item that has no native Copilot equivalent, we
record the substitute and whether it produces a residual `[GAP]` in the
matrix.

1. **Split config root (#1).** No synthetic `.copilot/` directory. The
   matrix's *Config root* cell becomes `.github/copilot/`
   (+ `.github/skills/`, + `.github/copilot-instructions.md`).
   **Not a gap** — documented divergence.

2. **Repo-level agent definitions (#4).** Public reference documents
   only `~/.copilot/agents/`. We adopt `.github/agents/<name>.md` by
   parallelism. **`[GAP-confirmation]`** — implementer must verify
   loading behavior and downgrade to a gap if the path is rejected.

3. **Slash commands (#5).** Copilot does not expose a user-definable
   slash-command file format. Every CrewRig command compiles **as a
   skill** in `.github/skills/`, invoked via `/<skill-name>`. This
   mirrors the approach already used for Claude (where commands are
   wrapped as skills) — so it is the consistent choice. **`[GAP]`** for
   first-class slash-command files; mapping documented.

4. **Project-dir env var (#9).** Copilot hooks receive context via JSON
   stdin, not via a `$*_PROJECT_DIR` env var. `mempalace-transcript.sh`
   reads the workspace path from the JSON payload (preferred) and falls
   back to `$PWD`. **`[GAP]`** for env-var parity.

5. **Plugin build/install (#13, #14).** No analog exists by design.
   **`[GAP]`** — same status as Gemini, same justification.

6. **Per-extension manifest (#17).** No public spec for a repo-level
   per-extension Copilot manifest. We propose `.github/copilot/extension.json`
   as a placeholder convention; the implementer may ship v1 without one.
   **`[GAP-soft]`** — track as a follow-up.

7. **CI workflow (#18).** The `@copilot` mention trigger is built in;
   no `.github/workflows/copilot.yml` is *required*. We still ship a
   minimal file documenting the trigger and optionally invoking the CLI
   for completeness and parity with `claude.yml`. **Not a gap.**

## Consequences

**For the developer implementing #50:**

- Create the split root: `.github/copilot/{settings.json,
  settings.local.json (gitignored), extension.json (placeholder)}`,
  `.github/skills/`, `.github/agents/`, `.github/copilot-instructions.md`.
- Re-export `AGENTS.md` from `copilot-instructions.md` (include or
  reference; no symlink — Copilot reads the file as-is).
- Extend `scripts/build-components.sh` with `--target copilot`. Emit
  skills under `.github/skills/<name>/SKILL.md` (1:1 with current
  shape). Emit agents under `.github/agents/<name>.md`. Compile
  commands **as skills** (same path as Claude).
- Author `hooks/copilot-transcript-hooks.json` covering at minimum
  `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Stop`,
  `SessionEnd`. Use the documented top-level schema
  (`version`, `disableAllHooks`, `hooks`).
  `setup-copilot-interactive.sh` deploys hooks as opt-in to **both**
  `~/.copilot/hooks/copilot-transcript-hooks.json` (form b — user-level,
  all projects) and `.github/copilot/settings.json` (form a — workspace,
  absolute path rewritten by setup). The committed `settings.json` ships
  with `"hooks": []` — project-relative hook paths must never be committed.
- Update `hooks/mempalace-transcript.sh` to parse the project dir from
  Copilot's hook stdin JSON; fall back to `$PWD`. Document the absence
  of `$COPILOT_PROJECT_DIR`.
- Add `scripts/setup-copilot-interactive.sh`,
  `scripts/import-copilot-history.sh` (reads
  `~/.copilot/session-state/*/events.jsonl`), and the Taskfile entries
  `setup-copilot-interactive`, `import-copilot-history`,
  `build-components-copilot`.
- Add `.github/workflows/copilot.yml` documenting the `@copilot`
  trigger. Optionally include a job invoking the `copilot` CLI for
  automation parity with `claude.yml`.
- Append a `Copilot CLI` column to `docs/cli-matrix.md`. Record every
  `[GAP]` above under *Parity gaps*. Open follow-up issues for each.
- Update prose references in `README.md`, `AGENTS.md`,
  `CONTRIBUTING.md`, `DEVELOPMENT.md`.
- `.gitignore`: add `.github/copilot/settings.local.json` and any
  `copilot-instructions.local.md`.

**Limitations the user must accept:**

- The "config root" cell is plural — three sibling paths under
  `.github/` rather than a single `./.copilot/`. This is a Copilot
  product decision, not a CrewRig limitation.
- Slash commands are not first-class — every command must be modeled
  as a skill. Same trade-off Claude already lives with.
- No `$COPILOT_PROJECT_DIR`. Hooks must extract workspace path from
  stdin or rely on cwd.
- Repo-level agent file convention is unverified; treat the first
  implementation as a probe.
- No plugin packaging story. Distribution flows through enterprise
  plugin management (org-admin) or direct repo cloning.

**Blast radius of this ADR:**

- New files: ~10 (entry point, settings, hooks manifest, two scripts,
  workflow, ADR, extension manifest placeholder, gitignore lines).
- Modified: `scripts/build-components.sh`, `Taskfile.yml`,
  `hooks/mempalace-transcript.sh`, `docs/cli-matrix.md`, four prose
  documents.
- No changes to `community-config/` source tree — Copilot consumes the
  same SKILL.md / AGENT.md shape we already produce.

## Addendum — 2026-05-20: User-level layered context

The original discovery phase missed `~/.copilot/instructions/*.instructions.md`,
which is the user-level context loading path documented at
https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference.
Files placed there are loaded automatically at every Copilot CLI session,
making them the direct equivalent of `~/.claude/rules/` and `~/.gemini/`.

`setup-copilot-interactive.sh` was updated to deploy the 00–60 priority
files from `config/` to `~/.copilot/instructions/` using the naming
convention `<priority>-<slug>.instructions.md`. The `[GAP]` for user-level
layered context recorded in checklist item #7 is hereby resolved.
