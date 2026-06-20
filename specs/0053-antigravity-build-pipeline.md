---
id: "0053"
slug: antigravity-build-pipeline
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 423
version: 1.0.0
---

# Spec 0053 — Antigravity CLI build pipeline target

## Intent

The build script gains a first-class Antigravity CLI target so that skills,
agents, commands, and rules compiled from `artifacts/` are deposited into the
`.agents/` directory layout expected by the Antigravity CLI, with the same
provenance-carrier format used by the Claude Code target (YAML frontmatter),
and the Taskfile and assembly-verification test suite are updated to match.

## Requirements

1. `scripts/build-components.sh` SHALL accept `--target antigravity` as a
   valid value for the `--target` flag, alongside the existing `gemini`,
   `claude`, `copilot`, and `all` values.
2. When invoked with `--target antigravity`, the build script SHALL emit
   compiled skill outputs to `<output-root>/.agents/skills/<name>/SKILL.md`
   for every discovered skill source, where `<output-root>` is resolved by the
   existing `output_root_for_tier` function (`$REPO_DIR` for the `core` tier;
   `$REPO_DIR/dist/<tier>` for every non-core tier).
3. When invoked with `--target antigravity`, the build script SHALL emit
   compiled agent outputs to `<output-root>/.agents/agents/<name>/AGENT.md`
   for every discovered agent source, following the same YAML frontmatter shape
   used by the Claude Code target.
4. When invoked with `--target antigravity`, the build script SHALL emit
   compiled command outputs to `<output-root>/.agents/skills/<name>/SKILL.md`
   for every discovered command source (commands compile as skills, matching
   the Claude Code and GitHub Copilot CLI conventions).
5. The Antigravity CLI target SHALL use YAML frontmatter as the provenance
   carrier format — the same format used by the Claude Code target — including
   the `metadata.provenance` block spliced by the existing `inject_provenance`
   function.
6. When `--target all` is specified, the build script SHALL include Antigravity
   CLI output alongside the existing Gemini, Claude Code, and GitHub Copilot
   CLI outputs.
7. `scripts/tests/test-assembly-verification.sh` SHALL be extended with
   assertions that verify the `--target antigravity` build output: at minimum,
   one assertion for a core-tier skill under `$TEMP_REPO/.agents/skills/`,
   one for a core-tier agent under `$TEMP_REPO/.agents/agents/`, and one for
   a community-tier (overlay) skill under
   `$TEMP_REPO/dist/community/.agents/skills/`.
8. `Taskfile.yml` SHALL include a `build-components-antigravity` task that
   invokes `bash scripts/build-components.sh --target antigravity`, following
   the same shape as the existing `build-components-gemini`, `build-components-claude`,
   and `build-components-copilot` tasks.
9. The existing `--target gemini`, `--target claude`, `--target copilot`, and
   `--target all` build paths SHALL remain functionally unchanged — no
   regression in their outputs or behavior.
10. The `propagate_skill_resources` helper (which copies `scripts/`, `references/`,
    and `assets/` subdirectories from source to target) SHALL be called for
    Antigravity CLI skill outputs, matching the behavior of the Claude Code and
    GitHub Copilot CLI paths.

## Scenarios

**Scenario:** Happy path — core skill compiled for Antigravity CLI

Given a clean worktree with `artifacts/core/skills/developer/SKILL.md` present
When `bash scripts/build-components.sh --target antigravity` is executed
Then the file `.agents/skills/developer/SKILL.md` is created at the repository
root, its frontmatter contains `name:` and `description:` fields, and — if the
source carries a `metadata.provenance` block — a `metadata:` key is present in
the output frontmatter.

**Scenario:** Happy path — `--target all` includes Antigravity output

Given a clean worktree with at least one skill source under `artifacts/`
When `bash scripts/build-components.sh --target all` is executed
Then outputs are produced for all four CLI targets: `.gemini/skills/`,
`.claude/skills/`, `.github/skills/`, and `.agents/skills/`.

**Scenario:** Happy path — Taskfile task invokes the correct target

Given a correctly configured environment with `task` available
When `task build-components-antigravity` is run
Then it delegates to `bash scripts/build-components.sh --target antigravity`
and exits zero when the build succeeds.

**Scenario:** Happy path — assembly-verification test covers Antigravity output

Given the assembly-verification test suite is run via `--check` mode
When `scripts/tests/test-assembly-verification.sh` executes
Then it asserts the presence of at least one core skill, one core agent, and
one overlay skill under the `.agents/` path in the temporary repo, and fails
with a descriptive message if any assertion is unmet.

**Scenario:** Failure path — unknown `--target` value

Given `scripts/build-components.sh` is invoked with `--target unknown-cli`
When the argument-parsing block processes the flag
Then the script exits non-zero with an error message naming the unsupported
target value (note: this is the existing behavior the Antigravity addition
must not weaken — if the script currently passes unknown targets silently,
that gap is pre-existing and out of scope for this spec).

**Scenario:** Failure path — Gemini target unaffected after Antigravity addition

Given `scripts/build-components.sh --target gemini` is run after the
Antigravity branch is implemented
When the build completes
Then `.gemini/skills/`, `.gemini/commands/`, and `.gemini/agents/` outputs
are byte-identical to what they were before the Antigravity target was added,
and no `.agents/` directory is created.

## Out of scope

- The `.agents/` workspace directory layout and its relationship to the
  Antigravity CLI plugin manifest — qualified in spec 0052.
- MCP server configuration within `.agents/` — a separate sub-spec of spec 0051.
- The Antigravity CLI setup script (`scripts/setup-antigravity.sh`) that
  installs non-core tier outputs from `dist/<tier>/.agents/` to the user home
  directory — a separate sub-spec of spec 0051.
- The Antigravity CLI plugin manifest file (`agy-plugin.yaml` or equivalent)
  that registers the `.agents/` directory as an Antigravity plugin — a
  separate sub-spec of spec 0051.
- Antigravity-specific hooks and their configuration — a separate sub-spec
  of spec 0051.
- Rules files compilation for Antigravity CLI (context/rules injection
  mechanism) — a separate sub-spec of spec 0051.
- `docs/cli-matrix.md` updates to record the new Antigravity build target
  row — required by the CLI Matrix Maintenance rule in `AGENTS.md` but
  delegated to the implementation PR rather than specified here.
- Any change to the `--check` drift-detection behavior beyond what is
  already implied by extending the assembly-verification assertions (R7).
- Validation that `agy plugin validate` accepts the produced output — the
  brief confirms this empirically for frontmatter; formal validation is
  part of DEV acceptance, not this spec.

## Open questions

- None.
