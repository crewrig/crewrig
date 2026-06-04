---
id: "0012"
slug: core-framework-separation
status: draft
complexity: large
interaction-mode: INTERMEDIATE
related-issue: 224
version: 1.0.0
---

# Core Framework Separation

## Intent

CrewRig exposes a formal two-layer adoption model that makes it consumable
by any organisation without the risk of merge conflicts on organisation-owned
files. A **core layer** — bounded and exclusively owned by the upstream
CrewRig project — encompasses the lifecycle machinery, harness skills, and
build tooling that every adopter receives unchanged. An **overlay layer**
encompasses each adopting organisation's identity, server integrations, and
internal components, and is never touched by upstream updates. Illustrative
role skills currently collocated with core harness skills move to a dedicated
examples area so their demonstrative nature is immediately legible to
newcomers. Organisations that consume CrewRig receive upstream updates that
land cleanly on the core layer without touching their overlay.

## Requirements

1. The repository SHALL distinguish a formal **core layer** — a documented,
   bounded set of paths whose content is controlled exclusively by the upstream
   CrewRig project and that adopting organisations SHALL NOT modify.
2. The repository SHALL distinguish a formal **overlay layer** — a documented,
   bounded set of paths reserved for adopting organisations' identity,
   integrations, and internal components.
3. The repository SHALL provide a dedicated **examples directory** containing
   illustrative role skills and configuration templates that currently reside
   alongside core harness skills.
4. A synchronisation mechanism SHALL allow an adopting organisation's
   repository to receive upstream core-layer updates without modifying any
   overlay-layer path.
5. The synchronisation mechanism SHALL refuse to proceed and SHALL report the
   offending paths when any core-layer path has been locally modified in the
   adopting organisation's repository, before applying any upstream change.
6. The core layer SHALL include, at minimum: the lifecycle governance files
   (`AGENTS.md`, `docs/`), the harness skill set (`spec-author`,
   `harness-curator`, `harness-report`, `pr-logbook`, `pr-reviewer`), the
   build and install scripts (`scripts/`), and the specification history
   (`specs/`).
7. The overlay layer SHALL provide designated locations for: organisation
   identity, agent personality configuration, user profiles, team
   configurations, MCP server declarations, and organisation-specific skills
   and agents.
8. The examples directory SHALL include, at minimum: the illustrative role
   skills currently in `community-config/skills/` that are not part of the
   harness skill set (`architect`, `developer`, `tester`, `astro`, `frontend`,
   `doc-writer`, `security`, `web-tester`, `github-actions`, `copywriting`)
   and the illustrative agent definitions not belonging to the harness agent
   set.
9. The assembled deployed configuration SHALL integrate content from both the
   core layer and the overlay layer, such that an adopting organisation's
   installed CLI tools receive both framework-provided and
   organisation-specific components.
10. An adoption guide SHALL describe how a new organisation creates its own
    repository that consumes CrewRig's core layer and populates the overlay
    layer without modifying the core.
11. The examples directory SHALL be named `examples/` and SHALL reside at the
    root of the core layer.
12. `crewrig.config.toml` SHALL be part of the overlay layer; the core layer
    SHALL provide a versioned template file from which adopting organisations
    initialise their own configuration.

## Scenarios

**Scenario:** Adopter synchronises with upstream without conflicts

Given an organisation repository that has placed all its customisations in the
overlay layer and has never modified a core-layer path
When the organisation runs the synchronisation mechanism against the latest
upstream core
Then all core-layer paths are updated to the upstream version, all overlay-layer
paths are untouched, and the mechanism exits with a zero status code.

**Scenario:** New developer finds an example skill to copy

Given a developer new to CrewRig browsing the repository to build a
team-specific `developer` skill
When they look for a starting point in the repository
Then they find an illustrative `developer` skill in the examples directory,
visually distinct from the core harness skills, with a notice indicating it
is a template to adapt rather than a component to extend in place.

**Scenario:** Synchronisation blocked on modified core file

Given an organisation repository where a contributor has edited a core-layer
file (e.g. `scripts/build-components.sh`)
When the organisation runs the synchronisation mechanism
Then the mechanism halts before applying any upstream change, lists the
modified core-layer paths, and emits guidance on how to migrate the
modification into the overlay layer instead.

## Out of scope

- Automated migration of existing CrewRig forks to the new two-layer
  structure; migration is each adopting organisation's responsibility.
- The extension mechanism (`extension-skeleton/`, `scripts/install-extension.sh`)
  — a distribution channel that remains unchanged by this spec.
- Publishing the CrewRig core as a versioned installable package (npm, pip,
  or equivalent).
- The concrete upstream-tracking mechanism (git subtree, sparse checkout, or a
  bespoke sync script) — delegated to the PLAN stage and its sub-specifications.
- Detailed sub-specifications for each implementation area — produced by the
  PLAN stage's architect-led decomposition, per the `large` complexity tier.

## Open questions
