---
id: "0014"
slug: artifacts-directory-restructuring
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 228
version: 1.1.0
---

# Artifacts Directory Restructuring

## Intent

The repository source layout is restructured to match the `artifacts/`
namespace defined by spec 0012 (as amended through delta-04) and classified by
spec 0013 (as amended through delta-04). Every component currently in
`community-config/` migrates to its correct zone under `artifacts/`: SDLC
lifecycle tools and operational role skills and agents to `artifacts/core/`
(project-scoped, built into per-repo CLI output directories); the harness
system to `artifacts/library/` (user-home-scoped, globally available across
all projects); and overlay directories to `artifacts/community/`. The build
script and normative documentation are updated to source from the new paths.
The `community-config/` directory is removed once the migration is complete.
After this sub-spec, the repository layout is the canonical, spec-conforming
structure that all downstream sub-specs (C, D, E1, E2) may depend on.

## Requirements

1. The repository SHALL contain an `artifacts/` directory at its root
   containing exactly four sub-directories — `core/`, `library/`, `community/`,
   `organisation/` — and a `FORMAT.md` file. No other top-level entries are
   permitted inside `artifacts/`.

2. `artifacts/FORMAT.md` SHALL be created by moving `community-config/FORMAT.md`
   verbatim; its content SHALL be identical to the pre-migration source.

3. The SDLC lifecycle skill set SHALL be relocated from `community-config/skills/`
   to `artifacts/core/skills/`: `spec-author`, `pr-logbook`, `pr-reviewer`.
   Directory contents (including all sub-files) SHALL be preserved without
   modification.

4. The SDLC lifecycle agent set SHALL be relocated from `community-config/agents/`
   to `artifacts/core/agents/`: `spec-author`, `pr-logbook`, `pr-reviewer`,
   `architect`. Directory contents SHALL be preserved without modification.

5. The harness skill set SHALL be relocated from `community-config/skills/` to
   `artifacts/library/skills/`: `harness-report`, `harness-curator`. Directory
   contents SHALL be preserved without modification.

6. The harness agent set SHALL be relocated from `community-config/agents/` to
   `artifacts/library/agents/`: `harness-curator`. Directory contents SHALL be
   preserved without modification.

7. The operational role skill set SHALL be relocated from `community-config/skills/`
   to `artifacts/core/skills/`: `architect`, `developer`, `tester`, `astro`,
   `frontend`, `doc-writer`, `security`, `web-tester`, `github-actions`,
   `copywriting`. Directory contents SHALL be preserved without modification.

8. The operational role agent set SHALL be relocated from `community-config/agents/`
   to `artifacts/core/agents/`: `accessibility-auditor`, `accessibility-tester`,
   `astro-developer`, `ci-configurator`, `ci-debugger`, `copywriter`, `designer`,
   `developer`, `doc-writer`, `frontend-developer`, `regression-sentinel`,
   `scenario-author`, `security`, `seo-specialist`, `tester`,
   `visual-regression-tester`, `web-conformity-checker`. Directory contents SHALL
   be preserved without modification.

9. The overlay directories currently in `community-config/` SHALL be relocated
   to `artifacts/community/` as follows: `mcp-servers/` → `artifacts/community/mcp-servers/`,
   `hooks/` → `artifacts/community/hooks/`, `policies/` → `artifacts/community/policies/`,
   `themes/` → `artifacts/community/themes/`, `commands/` → `artifacts/community/commands/`.
   Directory contents SHALL be preserved without modification.

10. The empty organization-facing tier directories SHALL be created with a
    `.gitkeep` file so that git tracks them: `artifacts/community/skills/`,
    `artifacts/community/agents/`, `artifacts/organisation/skills/`,
    `artifacts/organisation/agents/`.

11. `scripts/build-components.sh` SHALL be updated to source skill definitions
    from all relevant `artifacts/` skill sub-directories
    (`artifacts/core/skills/`, `artifacts/library/skills/`,
    `artifacts/community/skills/`) and agent definitions from all relevant
    `artifacts/` agent sub-directories (`artifacts/core/agents/`,
    `artifacts/library/agents/`, `artifacts/community/agents/`) instead of the
    former flat `community-config/skills/` and `community-config/agents/`
    directories. The commands source SHALL be updated from
    `community-config/commands/` to `artifacts/community/commands/`. The build
    script SHALL document the installation-location distinction: `core/` and
    `community/` components are built into the per-repo CLI output directories;
    `library/` components are intended for user-home installation.

12. After the migration, `scripts/build-components.sh` SHALL execute without
    error and SHALL produce built outputs in `.claude/`, `.gemini/`, and
    `.github/` that are functionally identical to those produced from
    `community-config/` before the migration. The CI pipeline running
    `bash scripts/build-components.sh --check` SHALL pass on the implementation
    pull request before that PR is eligible for merge.

13. The `community-config/` directory SHALL be removed from the repository in
    the same implementation pull request as the `artifacts/` migration.

14. `docs/layers.md` SHALL be updated to remove all references to
    `community-config/` paths, replacing each with its equivalent `artifacts/`
    path as classified by spec 0013 (as amended by delta-04).

15. `AGENTS.md` SHALL be updated to replace all references to `community-config/`
    with the appropriate `artifacts/` paths reflecting the restructured layout.

## Scenarios

**Scenario:** Developer runs the build script on the migrated repository

Given a clean checkout of the implementation branch after all component sources
have been relocated to `artifacts/`
When a developer runs `bash scripts/build-components.sh`
Then the script exits zero, the directories `.claude/skills/`, `.claude/agents/`,
`.gemini/skills/`, `.gemini/agents/`, `.github/skills/`, `.github/agents/` are
populated with the same files as before the migration, and no reference to
`community-config/` appears in the build output.

**Scenario:** CI drift-check catches a path mismatch after migration

Given an implementation pull request where `scripts/build-components.sh` was
updated with an incorrect source path for one skill directory
When the CI pipeline runs `bash scripts/build-components.sh --check`
Then the check exits non-zero, the pull request status is marked failing, and
the PR cannot be merged until the path is corrected and CI is green.

**Scenario:** Reviewer verifies community-config/ is fully removed

Given the merged implementation pull request
When a reviewer runs `ls community-config/` in a fresh checkout
Then the command fails with "No such file or directory" — the directory does
not exist anywhere in the repository tree.

## Out of scope

- The dirty-core guard (sync mechanism) that enforces core-layer immutability
  at upstream synchronization time — covered by sub-spec D (issue #230).
- Creation of `crewrig.config.toml.template` — covered by spec 0012 R12,
  scheduled as a separate deliverable.
- The adoption guide that describes how an organization populates the overlay
  layer — covered by sub-spec E1 (issue #231).
- Assembly verification tooling that confirms built CLI outputs match sources —
  covered by sub-spec E2 (issue #232).
- Population of `artifacts/organisation/` — this directory is created empty
  (with `.gitkeep` files per R10); filling it with validated org components is
  the responsibility of each adopting organization.
- Migration of the sub-spec C scope (overlay materialisation, `crewrig.config.toml`
  generation) — issue #229 owns that boundary.

## Open questions

(none)
