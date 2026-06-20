---
id: "0052"
slug: antigravity-workspace-layout
status: approved
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 422
version: 1.0.0
---

# Spec 0052 — Antigravity workspace layout

## Intent

crewrig ships a `.agents/` workspace-level directory so that the Antigravity
CLI (agy) can locate the project's agent working rules and local configuration
overrides when a developer works inside the repository. A developer who has agy
installed and clones crewrig will, without any manual setup, have a functional
workspace context that re-uses the same `AGENTS.md` source of truth already
consumed by Claude Code and GitHub Copilot CLI.

## Requirements

1. crewrig SHALL contain a `.agents/` directory at the repository root for
   Antigravity CLI workspace-level configuration.
2. `.agents/` SHALL contain an `ANTIGRAVITY.md` file that serves as the agy
   workspace entry point by re-exporting `AGENTS.md` using the `@AGENTS.md`
   import syntax, matching the pattern of `CLAUDE.md`.
3. `.agents/` SHALL contain a `settings.local.json.example` template file that
   documents the supported Antigravity CLI workspace settings keys: `model`,
   `toolPermission`, `enableTelemetry`, and `historySize`.
4. `.gitignore` SHALL be updated to exclude the following Antigravity CLI local
   artifacts from version control: `settings.local.json` (per-user workspace
   settings), `ANTIGRAVITY.local.md` (local content overrides), and any
   directory matching `dist-antigravity-*` (local build outputs).
5. The `.agents/` directory layout SHALL be valid and fully functional as static
   files; no `agy` binary SHALL be required to be present for the files
   themselves to be syntactically correct.
6. The `settings.local.json.example` template SHALL include inline comments
   (using JSON-with-comments syntax, `//`) that describe the purpose and
   accepted values of each documented settings key.

## Scenarios

**Scenario:** Developer with agy installed opens the workspace

Given a developer has agy 1.0.x or later installed and has cloned crewrig
When they open a terminal in the repository root and start agy
Then agy reads `.agents/ANTIGRAVITY.md`, which resolves the `@AGENTS.md`
     import, and the agent working rules defined in `AGENTS.md` are active for
     the session

**Scenario:** Developer copies the local settings template to activate it

Given `.agents/settings.local.json.example` is present in the repository
When the developer copies the file to `.agents/settings.local.json` and edits
     their preferred `model` value
Then agy picks up the workspace-local settings on the next invocation, and the
     file is not tracked by git (`.gitignore` excludes it)

**Scenario:** `.agents/ANTIGRAVITY.md` is absent (incomplete setup)

Given a developer clones the repository but the `.agents/ANTIGRAVITY.md` file
     is missing (e.g., partially applied setup or a manual deletion)
When agy starts in the repository root
Then agy finds no workspace entry point and falls back to its default
     (no workspace context); the absence is a known, documented setup gap and
     does not corrupt any other CLI's configuration

**Scenario:** agy binary is not installed

Given the `.agents/` directory and all its files are present in the repository
When a developer who does not have agy installed reads or inspects the files
Then the files are plain Markdown and JSON text that can be opened, read, and
     committed without the agy binary; no tooling failure occurs

## Out of scope

- Contents of `.agents/` produced by subsequent sub-specs B through G of the
  Antigravity CLI support epic (issue #418): MCP configuration, setup script,
  rules deployment, skills/agents, commands, and parity documentation are each
  owned by their respective sub-specs.
- MCP server configuration inside `.agents/` — that is the subject of a
  dedicated sub-spec.
- Migration of any existing `.gemini/` configuration into `.agents/`.
- Discovery or validation of additional Antigravity CLI settings keys beyond
  the four documented in R3 (`model`, `toolPermission`, `enableTelemetry`,
  `historySize`); further keys may be added by later sub-specs or follow-up
  tickets once the Antigravity CLI reference documentation is more complete.
- Version-pinning or runtime compatibility checks for the agy binary; the setup
  script (sub-spec C) owns those.
- The `.agents/` directory for any adopting organization's fork of crewrig;
  this spec covers only the upstream crewrig repository.

## Open questions

- [AUTO-PARKED] The Antigravity CLI settings key names (`model`,
  `toolPermission`, `enableTelemetry`, `historySize`) are derived from binary
  string inspection of agy 1.0.10. If the public Antigravity CLI reference
  documentation lists a different canonical key set or naming convention (e.g.
  camelCase vs. snake_case), the `settings.local.json.example` template and R3
  must be updated before approval. The implementation PR should verify these
  key names against official documentation if it becomes available before
  merge.
- [AUTO-PARKED] It is unconfirmed whether agy resolves the `@AGENTS.md`
  import syntax inside `.agents/ANTIGRAVITY.md` at runtime (the agy binary
  strings confirm that `AGENTS.md` is read natively, but `@`-import resolution
  inside `.agents/` files has not been end-to-end verified against a running
  agy instance). If `@`-import is not supported, R2 must be modified to embed
  the full `AGENTS.md` content or use a different re-export mechanism.
