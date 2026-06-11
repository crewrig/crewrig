---
id: "0018"
slug: assembly-verification
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 232
version: 1.0.0
---

# Integrated Assembly Verification

## Intent

A test fixture containing a minimal overlay and an automated assertion suite
(Bash or Bats) verify that `bash scripts/build-components.sh` produces outputs
integrating both core-layer and overlay-layer components — and that deploying
those outputs to an isolated test environment (Docker container or sandboxed
home directory) correctly activates both kinds of components in the target CLI
rules directories. This is the executable acceptance proof for spec 0012 R9:
an adopting organization's installed CLI tools receive both framework-provided
and organization-specific components. The test suite runs in CI and passes
before the implementation pull request is eligible for merge.

## Requirements

1. The repository SHALL contain a test fixture directory at
   `tests/fixtures/overlay/` that provides a minimal, self-contained overlay
   suitable for driving assembly verification. The fixture SHALL include, at
   minimum, one skill directory and one agent directory under
   `tests/fixtures/overlay/artifacts/community/`, following the same structure
   as a real organization's `artifacts/community/` layer (as defined by spec
   0014).

2. The fixture overlay SHALL NOT reuse any existing core-layer component as
   its overlay content. Its skill and agent definitions must be distinct from
   those provided by `artifacts/core/` and `artifacts/library/`, so that the
   assertion can unambiguously determine which components originated in which
   layer.

3. The test suite SHALL contain automated assertions (Bash or Bats) in
   `tests/` that invoke `bash scripts/build-components.sh` with the fixture
   overlay as the community source. After the build, the assertions SHALL
   verify that every supported CLI's output directory contains both:
   - At least one known core-layer component (from `artifacts/core/` or
     `artifacts/library/`).
   - At least one component originating from the fixture overlay
     (`tests/fixtures/overlay/artifacts/community/`).

   Currently supported CLIs and their output directories: Claude Code
   (`.claude/`), Gemini CLI (`.gemini/`), GitHub Copilot (`.github/`).

4. The test suite SHALL additionally verify post-deployment integration: using
   an isolated test environment — a Docker container using the existing
   infrastructure in `docker/`, or a sandboxed temporary home directory — the
   test SHALL run the deployment step that copies built outputs into each
   supported CLI's rules directory and assert that both core-layer and
   overlay-layer components are present in the deployed destination. Currently
   supported CLI rules directories: `~/.claude/rules/` (Claude Code),
   `~/.gemini/rules/` (Gemini CLI), and the equivalent path for GitHub Copilot
   CLI. The isolated environment SHALL NOT modify the operator's actual home
   directory.

5. When an expected component is absent from the build outputs or the deployed
   destination, the test SHALL exit non-zero and print a human-readable list
   of the missing components — identifying each by name and the directory where
   it was expected — so that the operator can diagnose the failure without
   manually inspecting the output directories.

6. The assertions SHALL cover every supported CLI and SHALL treat them
   symmetrically. Currently supported CLIs: Claude Code (`.claude/skills/`,
   `.claude/agents/`), Gemini CLI (`.gemini/skills/`, `.gemini/agents/`),
   GitHub Copilot (`.github/skills/`, `.github/agents/`). As new CLIs are
   added to CrewRig, the assertion suite SHALL be extended to cover them in the
   same implementation pull request that introduces their support. A CLI may be
   excluded only if documented evidence confirms the component mechanism does
   not exist for that CLI.

7. `bash scripts/build-components.sh --check` (or the equivalent CI entry
   point) SHALL execute the assembly verification assertions as part of the
   check mode. The CI pipeline MUST pass on the implementation pull request
   before that PR is eligible for merge.

8. The fixture directory and its contents SHALL be classified as `core` layer
   and maintained by the upstream CrewRig project alongside the assertion
   suite. Adopting organizations MUST NOT modify the fixture; their own
   overlay validation is a separate concern.

## Scenarios

**Scenario:** CI confirms core and overlay components are both present

Given a clean checkout of the implementation branch with the fixture overlay
in place
When the CI pipeline runs `bash scripts/build-components.sh --check`
Then the assertion suite exits zero, having confirmed that both core-layer
components and fixture-overlay components are present in every supported CLI's
output directory.

**Scenario:** Missing overlay component detected and reported

Given a build run where the fixture overlay component was not copied into the
CLI output directory (for example, due to a path mismatch in
`scripts/build-components.sh`)
When the assertion suite runs
Then it exits non-zero and prints a list naming the missing component and the
directory where it was expected, without requiring the operator to inspect the
output directories manually.

**Scenario:** Post-deployment isolation confirmed

Given an isolated test environment (Docker or sandboxed home directory)
When the test suite runs the deployment step and then asserts on the deployed
CLI rules directories
Then the assertions confirm both core-layer and overlay-layer components are
active in the isolated environment, and the operator's actual home directory
is unmodified.

**Scenario:** Symmetric CLI coverage catches a missing output for one supported CLI

Given a `scripts/build-components.sh` update that correctly populates
`.claude/skills/` and `.github/skills/` but misses `.gemini/skills/` for
overlay components (illustrating the general case where one supported CLI is
not covered)
When the assertion suite runs
Then the assertion for that CLI exits non-zero and names the missing component
and its expected directory, surfacing the asymmetry before the PR is merged.

## Out of scope

- Verification that `scripts/sync-from-upstream.sh` functions correctly —
  covered by the tests mandated in spec 0016.
- Testing deployment to the operator's real home directory (e.g.
  `~/.claude/rules/`, `~/.gemini/rules/`) — the isolation requirement (R4)
  explicitly prohibits modifying the actual home directory.
- Semantic quality verification of component content — the assertions check
  file presence, not correctness of the skill or agent definitions.
- The adoption guide that narrates the process — covered by spec 0017.
- Population of `artifacts/community/` with production organization content —
  the fixture is a test-only artifact; real org components are the
  organization's responsibility.

## Open questions

(none)
