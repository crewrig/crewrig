---
id: "0017"
slug: adoption-guide
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 231
version: 1.0.0
---

# Adoption Guide

## Intent

A step-by-step guide, `docs/adoption-guide.md`, describes how a new
organisation forks CrewRig, initialises its overlay layer using the starter
templates (introduced by spec 0015), runs the build pipeline to produce
compiled CLI outputs, and uses `scripts/sync-from-upstream.sh` (introduced
by spec 0016) to pull future core-layer updates from upstream. The guide
covers all three supported CLIs — Claude Code, Gemini CLI, and GitHub Copilot
— and is the primary onboarding surface for any organisation that wishes to
adopt CrewRig without contributing upstream.

## Requirements

1. The repository SHALL contain a `docs/adoption-guide.md` file, classified
   as `core` layer, providing a linear, step-by-step walkthrough of the full
   fork initialisation sequence.

2. `docs/adoption-guide.md` SHALL open with a `## Prerequisites` section
   that lists every tool and credential the operator must have in place before
   following the guide. At minimum: `git`, `bash`, a TOML-capable editor or
   parser (for editing `crewrig.config.toml`), and write access to a GitHub
   repository that will serve as the organisation's fork.

3. The guide SHALL contain the following steps, in order, each as a distinct
   `##`-level section:
   - **Fork the repository** — create the organisation's own GitHub repository
     from the upstream CrewRig repository.
   - **Initialise the overlay configuration** — copy
     `crewrig.config.toml.template` to `crewrig.config.toml` and replace the
     `canonical_repo` and `feedback_repo` placeholder values with the
     organisation's own repository URLs.
   - **Initialise the organisation identity** — copy
     `config/ORGANIZATION.md.template` to `config/ORGANIZATION.md` and
     populate the identity sections (organisation name, values, objectives,
     assets, governance, general rules, regulatory context).
   - **Initialise the tool configuration** — copy `config/TOOLS.md.template`
     to `config/TOOLS.md` and fill in the organisation-specific sections
     (tooling preferences, MCP server declarations, workflow preferences).
   - **Run the build pipeline** — execute `bash scripts/build-components.sh`
     and verify that the CLI output directories (`.claude/`, `.gemini/`,
     `.github/`) are populated.
   - **Deploy to CLI rules directories** — copy or symlink the built outputs
     to the user-home CLI rules directories for each active CLI: `~/.claude/rules/`
     for Claude Code, `~/.gemini/rules/` for Gemini CLI, and the equivalent
     path for GitHub Copilot CLI.
   - **Sync from upstream** — document how to run
     `bash scripts/sync-from-upstream.sh` to pull future upstream core-layer
     changes into the fork without touching overlay content.

4. For each step that invokes a script (`scripts/build-components.sh`,
   `scripts/sync-from-upstream.sh`), the guide SHALL state: the exact command
   to run, the expected success indicator (exit zero, directory populated,
   etc.), and the error message the script emits for the most likely failure
   condition — pointing the operator to the corrective action without
   requiring them to read the script source.

5. `docs/adoption-guide.md` SHALL contain a `## Troubleshooting` section
   that lists, at minimum, the following failure cases with their cause and
   resolution:
   - `crewrig.config.toml` is absent or has empty `canonical_repo` /
     `feedback_repo` values when `scripts/build-components.sh` or
     `scripts/sync-from-upstream.sh` is run.
   - `bash scripts/build-components.sh` exits non-zero due to a missing
     source directory (e.g., caused by an incomplete migration or a branch
     that predates spec 0014).
   - `scripts/sync-from-upstream.sh` refuses to proceed because at least one
     core-layer path has been locally modified (the dirty-core guard defined
     in spec 0016).

6. The guide SHALL cover all three CLIs — Claude Code (`~/.claude/rules/`),
   Gemini CLI (`~/.gemini/rules/`), and GitHub Copilot CLI (its equivalent
   instructions path) — treating them symmetrically. Where a CLI-specific
   detail differs, the guide SHALL call it out explicitly rather than
   defaulting silently to Claude Code behaviour.

7. `README.md` SHALL be updated to reference `docs/adoption-guide.md` as the
   primary starting point for adopting organisations, in the same implementation
   pull request that introduces the guide.

8. The guide SHALL NOT contain instructions for: installing or configuring the
   CLI tools themselves (treated as a prerequisite), creating organisation-specific
   skills or agents in `artifacts/community/` or `artifacts/organisation/`
   (a brief mention that these directories exist for that purpose is
   sufficient), running the SPECS → PLAN → DEV → REVIEW lifecycle (this
   applies to upstream contributors, not adopting organisations), or operating
   the assembly verification tooling introduced by sub-spec E2 (issue #232).

## Scenarios

**Scenario:** Developer follows the guide from a clean fork

Given a developer at an adopting organisation who has just forked CrewRig
on GitHub and has all prerequisites satisfied
When they follow `docs/adoption-guide.md` from beginning to end, copying
the three templates, filling in the required values, running
`bash scripts/build-components.sh`, and deploying the outputs to their
CLI rules directories
Then the CLI output directories are populated correctly, the developer's
CLI tools load the built skills and agents, and no step required consulting
documentation outside the guide.

**Scenario:** Reviewer catches a stale file reference at review time

Given an implementation pull request introducing `docs/adoption-guide.md`
When a reviewer cross-checks every file path and command in the guide against
the actual repository tree
Then any stale reference (wrong path, renamed template, removed script flag)
is visible as a gap and the PR fails the review until corrected.

**Scenario:** Operator encounters a dirty-core refusal during sync

Given an operator who has locally modified a file listed in
`.crewrig/core-paths.txt` and now runs `bash scripts/sync-from-upstream.sh`
When the sync is refused with a list of offending paths
Then the operator can locate the `## Troubleshooting` section in
`docs/adoption-guide.md`, read the cause (local modification to a core-layer
path) and the resolution (revert or remove the modification, or explicitly
promote it to an overlay override), and proceed without needing to read the
script source.

## Out of scope

- Installation and configuration of Claude Code, Gemini CLI, and GitHub
  Copilot CLI — these are prerequisites; the guide asserts them, it does not
  explain them.
- Creating organisation-specific skills and agents in `artifacts/community/`
  or `artifacts/organisation/` — the guide acknowledges these directories
  exist but does not explain how to author their contents.
- The SPECS → PLAN → DEV → REVIEW lifecycle and the `harness-report` skill —
  these govern how upstream CrewRig evolves, not how an organisation adopts it.
- Assembly verification tooling — covered by sub-spec E2 (issue #232). The
  guide may reference the tooling once it exists; this spec does not mandate it.
- Automated end-to-end tests of the adoption sequence — acceptance is
  documentation review only, as declared during qualification.

## Open questions

(none)
