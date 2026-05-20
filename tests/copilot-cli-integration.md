# Copilot CLI Integration — Test Report

Scope: validate the GitHub Copilot CLI integration added for issue #50.
Worktree: `.worktrees/issue-50/`. Date: 2026-05-20.

## Static validation

| Check | Result | Notes |
|---|---|---|
| JSON well-formedness — `.github/copilot/settings.json` | ✅ | `python3 -m json.tool` parses cleanly |
| JSON well-formedness — `.github/copilot/extension.json` | ✅ | parses cleanly |
| JSON well-formedness — `config/copilot/settings.json.template` | ✅ | parses cleanly |
| JSON well-formedness — `hooks/copilot-transcript-hooks.json` | ✅ | parses cleanly; 5 hook events declared (SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd) using `${COPILOT_PROJECT_DIR:-$PWD}` |
| JSON well-formedness — `extension-skeleton/base/.github/copilot/extension.json` | ✅ | parses cleanly |
| Build target — `bash scripts/build-components.sh --target copilot` | ✅ | exits 0, emits `.github/skills/` and `.github/agents/` |
| Skill parity — count `community-config/skills/` vs `.github/skills/` | ✅ | 14 vs 14 |
| Agent parity — count `community-config/agents/` vs `.github/agents/` | ✅ | 21 vs 21 |
| Build round-trip — wipe `.github/{skills,agents}` and rebuild | ✅ | full target rebuild is clean; `git status --porcelain` shows no drift on previously-tracked files after `scripts/build-components.sh` |
| Script executable — `scripts/setup-copilot-interactive.sh` | ✅ | `+x` present |
| Script executable — `scripts/import-copilot-history.sh` | ✅ | `+x` present |
| Entry point re-export — `.github/copilot-instructions.md` references `AGENTS.md` | ✅ | uses `@AGENTS.md` re-export pattern, mirroring `CLAUDE.md` / `GEMINI.md` |
| `.gitignore` carve-outs | ✅ | `.github/copilot/settings.local.json` is ignored |

## Regression check (project CI scripts)

| Check | Result | Notes |
|---|---|---|
| `scripts/check-skill-versions.sh` (with `BASE_REF=crewrig/main`) | ✅ | "no existing skill/agent sources modified vs crewrig/main" — exemption rule honored (new components stay at 1.0.0) |
| `scripts/check-skill-versions.sh` (default base ref) | ⚠️ | Errors locally because default base `origin/main` is unresolved in this worktree — `origin` is not a configured remote (the project uses `crewrig` / `hcross`). CI runs against the PR base ref via `BASE_REF`, so this is environment-only, not a regression. Worth surfacing to the developer in case the same friction is hit by other reviewers. |
| `bash scripts/build-components.sh` (default, all targets) | ✅ | runs to completion, `Done.` |

## Functional validation — `ollama launch copilot`

**Not executable in this environment. No tests in this section were run; no results are reported.**

The brief asked to invoke each functional test as:

```text
ollama launch copilot --model deepseek-v4-pro:cloud -- -p "<prompt>"
```

Two blockers were observed and verified directly:

1. `ollama` (v present at `/opt/homebrew/bin/ollama`) does not expose a
   `launch` subcommand that accepts `copilot` as an argument. The
   available subcommands are: `serve, create, show, run, stop, pull,
   push, signin, signout, list, ps, cp, rm`. Calling `ollama launch`
   opens an interactive TUI menu and fails immediately under a
   non-TTY harness (`Error: run launcher menu: error running TUI:
   could not open a new TTY`). It cannot drive `gh copilot`.

2. No model named `deepseek-v4-pro:cloud` is registered or resolvable
   on this host, and the form `--model <name>:cloud` is not a documented
   Ollama model reference.

The actual GitHub Copilot CLI on this host is `gh copilot` (preview), which
is interactive and does not expose a `-p "<prompt>"` non-interactive form
in the installed version. A scripted functional sweep against the live
Copilot CLI is therefore not possible from this harness.

Per the brief's fallback instruction — "If `ollama launch copilot` is
not available in the environment, document that fact explicitly and
fall back to static manifest validation only — do NOT fabricate test
results." — the functional matrix below is left **explicitly unrun**.
No actual values are filled in.

| Test case | Expected | Actual | Result |
|---|---|---|---|
| Entry point / AGENTS.md loading | Answer references Gitmoji | — | ⏸ not run (no functional CLI) |
| Skill discoverability | Lists skills present in `.github/skills/` | — | ⏸ not run |
| Hook manifest syntax | No hook parse errors; agent replies | — | ⏸ not run |
| Build round-trip via live CLI | Agent reports correct skill count (14) | — | ⏸ not run |

Static equivalents covering the same surface (and therefore the closest
defensible substitute) ARE green: JSON well-formedness for the hook
manifest, parity counts for the build round-trip, AGENTS.md re-export
check for the entry point, and skill directory listing for
discoverability.

## Summary

- **Static validation:** 13/13 passed.
- **Regression checks:** 2/2 passed (1 environment-only warning on the
  default base ref of `check-skill-versions.sh`).
- **Functional validation against a live Copilot CLI:** 0 run, 0
  fabricated. The command form prescribed in the brief is not
  executable on this host.

**Blockers for the PR:** none from static validation. The integration
ships consistent JSON manifests, parity with Claude/Gemini build outputs
(14 skills, 21 agents), the standard AGENTS.md re-export entry point,
and the standard transcript-hook manifest layout. The hook manifest
contract surface (events, command form, env var) matches the Claude/
Gemini equivalents already on `main`.

**Recommended follow-ups (non-blocking):**

1. Manual smoke-test of the Copilot integration by a maintainer with
   `gh copilot` access in an interactive shell — at minimum: launch a
   session in the worktree root, confirm `.github/copilot-instructions.md`
   is picked up (Gitmoji reference test), and confirm
   `hooks/copilot-transcript-hooks.json` is parsed without warnings.
2. Note in `docs/cli-matrix.md` (or the issue logbook) that the
   functional CLI surface used during validation could not be scripted
   non-interactively — future reviewers should know not to depend on a
   `-p` flag that the upstream CLI does not (currently) expose.
