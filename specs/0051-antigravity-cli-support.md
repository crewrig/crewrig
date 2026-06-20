---
id: "0051"
slug: antigravity-cli-support
status: draft
complexity: large
interaction-mode: INTERMEDIATE
related-issue: 418
version: 1.0.0
---

# Antigravity CLI support (4th CLI)

## Intent

Crewrig gains a fourth supported CLI — Antigravity CLI — allowing users to
deploy crewrig's layered configuration (rules, skills, agents, commands) into
Antigravity CLI workspaces, backed by the same symmetric script suite, build
pipeline, hook system, and extension-plugin surface that exists for Claude
Code, Gemini CLI, and GitHub Copilot CLI. Existing Gemini CLI support is
preserved intact.

## Requirements

1. The crewrig build pipeline SHALL support Antigravity CLI as a build target,
   producing compiled skills, agents, commands, and rules in the Antigravity
   CLI workspace layout (`.agents/` at workspace scope;
   `~/.gemini/antigravity-cli/` at user scope).

2. A `scripts/setup-antigravity-interactive.sh` script SHALL exist that
   deploys crewrig's layered configuration to a user's Antigravity CLI
   environment, registers MCP (Model Context Protocol) servers (MemPalace,
   Sequential Thinking), and installs non-core artifacts from `dist/`.

3. `scripts/setup-antigravity-interactive.sh` SHALL verify that the `agy`
   binary is present in `$PATH` and meets the minimum required version before
   modifying any file, and SHALL exit with a non-zero status code and a
   human-readable diagnostic message if the check fails.

4. A `scripts/import-antigravity-history.sh` script SHALL exist that
   backfills MemPalace with historical Antigravity CLI session transcripts
   from the user's local session store.

5. A `hooks/antigravity-transcript-hooks.json` hook definition file SHALL
   exist, implementing the transcript recording lifecycle for Antigravity CLI
   sessions using the same `hooks/mempalace-transcript.sh` shared script as
   the other three CLIs.

6. An Antigravity CLI plugin manifest and its companion build script SHALL
   exist so that crewrig can be packaged and distributed as an Antigravity CLI
   plugin.

7. `docs/cli-matrix.md` SHALL include an Antigravity CLI column covering every
   existing row, with gap-acceptance evidence — citing official documentation
   or empirical reproduction — for any row where a mechanism is absent from
   Antigravity CLI.

8. All Antigravity CLI entries in `Taskfile.yml` SHALL follow the
   `<cli>-`-prefixed naming convention established by the three existing CLIs
   (e.g. `setup-antigravity-interactive`, `import-antigravity-history`,
   `build-components-antigravity`).

9. Existing Gemini CLI configuration files, scripts, and build-pipeline output
   SHALL remain unchanged by this implementation.

10. This feature SHALL be realized through the following seven sub-specs,
    each shipped as its own spec-PR before its implementation PR:
    - **Sub-spec A** — Core workspace layout and entry point: `.agents/`
      directory structure, `ANTIGRAVITY.md` (or AGENTS.md re-export), and
      `.gitignore` carve-outs.
    - **Sub-spec B** — Build pipeline: `scripts/build-components.sh
      --target antigravity` branch, provenance carrier format, and
      `scripts/tests/test-assembly-verification.sh` coverage.
    - **Sub-spec C** — Setup script: `scripts/setup-antigravity-interactive.sh`
      (deploy rules, skills, agents, MCP registration, binary version guard).
    - **Sub-spec D** — Import history: `scripts/import-antigravity-history.sh`
      (transcript backfill path, session-store location).
    - **Sub-spec E** — Hooks: `hooks/antigravity-transcript-hooks.json`
      (lifecycle events, shared transcript script wiring).
    - **Sub-spec F** — Extension/plugin manifest and build script:
      `scripts/build-antigravity-plugin.sh`, plugin manifest schema, and
      `scripts/install-antigravity-plugin.sh` (if applicable).
    - **Sub-spec G** — CI matrix and GitHub Actions workflow:
      `docs/cli-matrix.md` Antigravity CLI column and
      `.github/workflows/antigravity.yml`.

## Scenarios

**Scenario:** Successful setup on a machine with agy installed

Given a user has `agy` (Antigravity CLI) installed and in `$PATH`, and has
cloned a crewrig-configured repository
When they run `bash scripts/setup-antigravity-interactive.sh`
Then the script deploys crewrig's layered rules to `~/.gemini/antigravity-cli/`,
compiled skills and agents are available under the workspace `.agents/`
directory, MemPalace and Sequential Thinking MCP servers are registered, and
an `agy` session launched in the workspace can read the deployed rules and
list the available skills.

**Scenario:** Setup aborts when agy binary is absent

Given a user's machine does not have `agy` installed (the binary is absent
from `$PATH`)
When they run `bash scripts/setup-antigravity-interactive.sh`
Then the script detects the missing binary at startup, prints a human-readable
message naming the missing binary and pointing to installation instructions,
exits with a non-zero status code, and leaves no files modified on the
filesystem.

**Scenario:** Gemini CLI setup unaffected after Antigravity integration

Given a repository with Antigravity CLI support merged on `main`
When a user runs `bash scripts/setup-gemini-interactive.sh`
Then the script completes without error, producing the same Gemini CLI
deployment it produced before the Antigravity integration landed.

## Out of scope

- Automatic migration of existing `.gemini/` Gemini CLI configuration to the
  `.agents/` Antigravity CLI layout.
- The Antigravity 2.0 desktop application; this spec covers the `agy` terminal
  CLI only.
- Removal or deprecation of existing Gemini CLI support in crewrig.
- Extension of the end-to-end test suite (issue #159) to cover Antigravity CLI
  scenarios.
- Per-sub-spec Taskfile entries, detailed test coverage, and command-format
  gap-acceptance evidence — each delegated to the relevant sub-spec.

## Open questions

- [USER-PARKED] **Plugin manifest format.** The exact schema of the Antigravity
  CLI plugin manifest (antigravity-plugin.json or equivalent) is not confirmed
  in accessible public documentation. Sub-spec F SHALL investigate and document
  the authoritative schema before authoring its requirements.

- [USER-PARKED] **Provenance carrier in `.agents/` skills.** Whether the
  crewrig provenance block in `.agents/skills/*/SKILL.md` should be embedded
  as an HTML comment (like Gemini CLI) or as YAML frontmatter (like Claude
  Code) is unconfirmed — it depends on how Antigravity CLI handles non-standard
  frontmatter keys. Sub-spec B SHALL determine the appropriate carrier.

- [USER-PARKED] **Hooks JSON syntax.** The hooks JSON schema for Antigravity
  CLI is described in secondary sources as identical to Gemini CLI's format,
  but this is unconfirmed by official documentation. Sub-spec E SHALL verify
  the authoritative schema before implementing
  `hooks/antigravity-transcript-hooks.json`.

- [USER-PARKED] **Commands format (TOML vs skills).** Antigravity CLI may not
  support a native slash-command format analogous to Gemini CLI's
  `.gemini/commands/*.toml`. If confirmed, sub-spec G SHALL record
  gap-acceptance evidence per `docs/cli-matrix-maintenance.md` §
  Gap-Acceptance Evidence Rule before the Antigravity CLI column is accepted
  with a parity gap on row 5 (command definitions).
