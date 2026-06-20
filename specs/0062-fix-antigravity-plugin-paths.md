---
id: "0062"
slug: fix-antigravity-plugin-paths
status: implemented
complexity: small
interaction-mode: AUTO
related-issue: 466
version: 1.0.0
---

# Fix build-antigravity-plugin.sh source paths

## Intent

Running `scripts/install-antigravity-plugin.sh` produces a plugin bundle that
contains skills and agents, not just hooks. The Antigravity CLI plugin
installation path becomes a fully functional alternative to the setup-script
deployment path.

## Requirements

1. `scripts/build-antigravity-plugin.sh` SHALL read core-tier Antigravity
   artifacts from `<repo>/.agents/skills/` and `<repo>/.agents/agents/` (the
   in-tree paths produced by `build-components.sh --target antigravity` for
   `tier=core`).

2. `scripts/build-antigravity-plugin.sh` SHALL read non-core-tier Antigravity
   artifacts from `dist/<tier>/.agents/skills/` and
   `dist/<tier>/.agents/agents/` for every tier directory found under `dist/`
   that contains a `.agents/` subtree.

3. Skills from all tiers SHALL be merged into a single `skills/` directory in
   the plugin output. Agents from all tiers SHALL be merged into a single
   `agents/` directory. Later tiers (alphabetical) overwrite earlier ones on
   name collision; no collision is expected across the current tier set.

4. The `commands/` directory SHALL be read from `dist/<tier>/.agents/skills/`
   entries whose source component is a command (wrapped as a skill in the
   Antigravity build); no separate `dist/commands/` path is required.
   Concretely: `build-antigravity-plugin.sh` SHALL omit the `dist/commands`
   copy block entirely — commands are already bundled inside `skills/`.

5. The guard that checks for `dist/` SHALL remain and continue to fail fast
   when `build-components.sh` has not been run.

6. The `agy plugin validate` step shown in the build script footer SHALL
   remain as an informational hint (non-blocking).

7. A rebuilt and reinstalled crewrig plugin MUST list `skills` and `agents`
   (in addition to `hooks`) in `agy plugin list`.

## Scenarios

**Scenario:** clean build from scratch

Given a repo where `build-components.sh --target antigravity` has been run,
when `bash scripts/install-antigravity-plugin.sh` is executed,
then `agy plugin list` shows `crewrig` with `components` containing at least
`skills`, `agents`, and `hooks`.

**Scenario:** dist/ absent

Given a repo where `build-components.sh` has never been run,
when `bash scripts/build-antigravity-plugin.sh` is executed,
then the script exits non-zero with a clear error message referencing
`build-components.sh`.

**Scenario:** only hooks present (no dist/.agents)

Given a repo where `build-components.sh --target antigravity` has been run
but produced no `.agents/skills/` output (e.g., all tiers are empty),
when `bash scripts/build-antigravity-plugin.sh` is executed,
then the script completes with exit 0, writes `plugin.json` and `hooks.json`,
and does not fail on the absent `skills/` or `agents/` source paths.

**Scenario:** install idempotency

Given a crewrig plugin already installed via `agy plugin install`,
when `bash scripts/install-antigravity-plugin.sh` is run a second time,
then `agy plugin list` still shows exactly one `crewrig` entry with the
updated component set.

## Out of scope

- Adding a `dist/commands` top-level path to `build-components.sh` — commands
  are already bundled inside the `skills/` output and no separate path is
  needed.
- Changing `build-components.sh` output layout — the fix lives entirely in
  `build-antigravity-plugin.sh`.
- e2e test coverage for the plugin install path (documented gap, spec 0058).

## Open questions

_None._
