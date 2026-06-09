---
id: "0017"
slug: adoption-guide
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 231
version: 1.0.1
---

# Adoption Guide

## ADDED

(none)

## MODIFIED

**R3 — "Deploy to CLI rules directories" step** — correct Gemini target path and reference setup scripts.

Original:

> - **Deploy to CLI rules directories** — copy or symlink the built outputs
>   to the user-home CLI rules directories for each active CLI: `~/.claude/rules/`
>   for Claude Code, `~/.gemini/rules/` for Gemini CLI, and the equivalent
>   path for GitHub Copilot CLI.

Replacement:

> - **Deploy to CLI rules directories** — run the deploy scripts for each
>   active CLI: `bash scripts/setup-claude-interactive.sh` (deploys to
>   `~/.claude/rules/`), `bash scripts/setup-gemini-interactive.sh` (deploys
>   to `~/.gemini/` — Gemini has no `rules/` subdirectory; files land directly
>   in `~/.gemini/` with numeric prefixes), `bash scripts/setup-copilot-interactive.sh`
>   (deploys to `~/.copilot/instructions/`).

**Rationale:** `scripts/setup-gemini-interactive.sh` sets `GEMINI_HOME="${HOME}/.gemini"` and deploys files directly under `~/.gemini/` with no `rules/` subdirectory. The original R3 incorrectly stated `~/.gemini/rules/`. The step now references the three `setup-*-interactive.sh` scripts explicitly rather than describing a manual copy/symlink, since those scripts handle priority-prefix renaming, settings.json wiring, and hook deployment.

**R6** — correct Gemini target path and name Copilot path explicitly.

Original:

> 1. The guide SHALL cover all three CLIs — Claude Code (`~/.claude/rules/`),
>    Gemini CLI (`~/.gemini/rules/`), and GitHub Copilot CLI (its equivalent
>    instructions path) — treating them symmetrically. Where a CLI-specific
>    detail differs, the guide SHALL call it out explicitly rather than
>    defaulting silently to Claude Code behaviour.

Replacement:

> 1. The guide SHALL cover all three CLIs — Claude Code (`~/.claude/rules/`),
>    Gemini CLI (`~/.gemini/`), and GitHub Copilot CLI (`~/.copilot/instructions/`)
>    — treating them symmetrically. Where CLI-specific details differ (Gemini
>    deploys directly to `~/.gemini/` with no `rules/` subdirectory; Copilot
>    uses `*.instructions.md` file naming), the guide SHALL call them out
>    explicitly.

**Rationale:** Same correction as R3 above. Additionally, R6 previously left the Copilot path as "its equivalent instructions path" without naming it; now made explicit as `~/.copilot/instructions/` per `scripts/setup-copilot-interactive.sh` line 17 (`COPILOT_INSTRUCTIONS="${COPILOT_HOME}/instructions"`).

## REMOVED

(none)
