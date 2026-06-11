---
id: "0018"
slug: assembly-verification
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 232
version: 2.0.0
---

# Integrated Assembly Verification

## ADDED

(none)

## MODIFIED

**Out-of-scope bullet referencing R4** — remove dangling `(R4)` citation and correct Gemini path.

Original:

> - Testing deployment to the operator's real home directory (e.g.
>   `~/.claude/rules/`, `~/.gemini/rules/`) — the isolation requirement (R4)
>   explicitly prohibits modifying the actual home directory.

Replacement:

> - Testing deployment to the operator's real home directory — modifying the
>   operator's actual home directory is out of scope for this test suite.

**Rationale:** With R4 removed, the `(R4)` citation is a dangling reference. The underlying constraint (don't touch the real home directory) remains valid, so the bullet is retained but rewritten to stand on its own. The path examples (`~/.claude/rules/`, `~/.gemini/rules/`) are also removed to avoid propagating the incorrect Gemini path.

## REMOVED

**R4** (post-deployment integration requirement) — removed.

Original text:

> 4\. The test suite SHALL additionally verify post-deployment integration: using
> an isolated test environment — a Docker container using the existing
> infrastructure in `docker/`, or a sandboxed temporary home directory — the
> test SHALL run the deployment step that copies built outputs into each
> supported CLI's rules directory and assert that both core-layer and
> overlay-layer components are present in the deployed destination. Currently
> supported CLI rules directories: `~/.claude/rules/` (Claude Code),
> `~/.gemini/rules/` (Gemini CLI), and the equivalent path for GitHub Copilot
> CLI. The isolated environment SHALL NOT modify the operator's actual home
> directory.

**Rationale for removal.** R4 conflates two distinct deployment surfaces. The
outputs produced by `scripts/build-components.sh` are project-scoped: they land
in `.claude/skills/`, `.claude/agents/`, `.gemini/skills/`, `.gemini/agents/`,
`.github/skills/`, `.github/agents/` within the repository. The user-home CLI
rules directories (`~/.claude/rules/`, `~/.gemini/`, `~/.copilot/instructions/`)
are populated by the separate interactive `scripts/setup-*-interactive.sh`
scripts, which handle priority-prefix renaming, settings.json wiring, and hook
deployment — steps that cannot be exercised by simply copying the build outputs.
R3's assertion that both core-layer and overlay-layer components are present in
the project-scoped output directories is already the executable acceptance proof
for spec 0012 R9 ("an adopting organization's installed CLI tools receive both
framework-provided and organization-specific components"). Adding R4 would
require either running interactive scripts in CI (not feasible) or re-implementing
their logic in the test harness (duplication and drift risk). The finding was
raised during PLAN review (issue #232, `class: spec`).

**Scenario: "Post-deployment isolation confirmed"** — removed, as it was
driven exclusively by R4.

Original text:

> **Scenario:** Post-deployment isolation confirmed
>
> Given an isolated test environment (Docker or sandboxed home directory)
> When the test suite runs the deployment step and then asserts on the deployed
> CLI rules directories
> Then the assertions confirm both core-layer and overlay-layer components are
> active in the isolated environment, and the operator's actual home directory
> is unmodified.
