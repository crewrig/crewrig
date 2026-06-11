---
id: "0013"
slug: layer-taxonomy-boundary-contract
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 227
version: 1.0.0
---

# Layer Taxonomy and Boundary Contract

## Intent

CrewRig gains a normative document — `docs/layers.md` — that classifies every
top-level repository path as belonging to the `core`, `overlay`, or `examples`
layer. This document is the single authoritative boundary contract that makes the
two-layer adoption model legible: any developer, any adopting organization, and
any downstream sub-specification implementation can consult it to know, without
ambiguity, which paths are frozen upstream territory and which paths belong to
the organization.

## Requirements

1. The repository SHALL contain a normative document at `docs/layers.md` that
   serves as the authoritative boundary contract for the three-layer adoption
   model.
2. `docs/layers.md` SHALL classify every top-level path in the repository, and
   every critical sub-path where top-level classification alone is insufficient
   to resolve the layer, into exactly one of three layers: `core`, `overlay`, or
   `examples`.
3. `docs/layers.md` SHALL define the `core` layer as the bounded set of paths
   controlled exclusively by the upstream CrewRig project, which adopting
   organizations SHALL NOT modify.
4. `docs/layers.md` SHALL define the `overlay` layer as the bounded set of paths
   reserved for adopting organizations' identity, server integrations, and
   internal components, which upstream updates SHALL NOT touch.
5. `docs/layers.md` SHALL define the `examples` layer as the set of
   illustrative, template-intended paths that adopting organizations may copy and
   adapt, but that are not part of the upstream contract and are not intended to
   be extended in place.
6. `docs/layers.md` SHALL classify as `core`, at minimum, the paths enumerated
   in spec 0012 R6 (as amended by delta-01): `AGENTS.md`, `CLAUDE.md`, `docs/`,
   `scripts/`, `specs/`, the five harness skill directories under
   `community-config/skills/` (`spec-author`, `harness-curator`, `harness-report`,
   `pr-logbook`, `pr-reviewer`), and the five harness agent directories under
   `community-config/agents/` (`spec-author`, `harness-curator`, `pr-logbook`,
   `pr-reviewer`, `architect`).
7. `docs/layers.md` SHALL classify as `overlay`, at minimum, paths covering the
   categories named in spec 0012 R7: `crewrig.config.toml`, `config/SOUL.md`,
   `config/PROFILE.md`, `config/ORGANIZATION.md`, `config/TOOLS.md`,
   `config/teams/`, `config/expertise/`, `config/level/`, `config/claude/`,
   `config/gemini/`, `config/copilot/`, `community-config/mcp-servers/`,
   `community-config/hooks/`, `community-config/themes/`, and the designated
   areas for organization-specific skills and agents.
8. `docs/layers.md` SHALL classify as `examples`, at minimum, the illustrative
   role skill directories under `community-config/skills/` that are not part of
   the harness skill set (as enumerated in spec 0012 R8, amended by delta-01)
   and the illustrative agent directories under `community-config/agents/` that
   are not part of the harness agent set.
9. For paths not yet present in the repository at authoring time — notably
   `examples/`, planned by spec 0012 R11 — `docs/layers.md` SHALL note that the
   path is forthcoming and reference the sub-specification that introduces it.
10. `docs/layers.md` SHALL provide a classification structure (table, enumerated
    list, or equivalent) that allows a reader to determine the layer of any given
    repository path without requiring prior knowledge of the adoption model beyond
    what the document itself states.
11. Any path in the repository that `docs/layers.md` does not classify SHALL be
    treated as a documentation gap, not as implicitly `core` or implicitly
    `overlay` — the document SHALL be complete at the time it is introduced.

## Scenarios

**Scenario:** Developer identifies the layer of an org-specific config path

Given a developer at an adopting organization who wants to know whether they may
customize `config/SOUL.md`
When they consult `docs/layers.md`
Then they find `config/SOUL.md` listed under the `overlay` layer with a
description confirming it is reserved for the organization's identity.

**Scenario:** Contributor verifies that `docs/` is frozen upstream territory

Given a contributor considering whether to add a documentation file directly to
`docs/` in their organization's repository
When they consult `docs/layers.md`
Then they find `docs/` listed under the `core` layer, understanding that any
addition there must originate from an upstream CrewRig pull request, not a local
org-side edit.

**Scenario:** Reviewer detects a path missing from the classification

Given `docs/layers.md` has been written but a top-level path (e.g., `tests/`)
was omitted from the classification
When a reviewer cross-references the document against the repository tree
Then the gap is immediately visible — the path appears in the tree but is absent
from the document's enumeration — and no ambiguity remains about whether the
omission is intentional.

## Out of scope

- Restructuring or moving existing paths to match the taxonomy — covered by
  sub-specs B, C, and D of spec 0012.
- Creating the `examples/` directory and populating it — covered by the
  directory-restructuring sub-spec.
- Implementing the synchronization mechanism that enforces core-layer immutability
  at sync time — covered by sub-spec D.
- Authoring the adoption guide that describes how an organization populates the
  overlay layer — covered by sub-spec E1.
- Updating `AGENTS.md` to cross-reference `docs/layers.md` — the implementation
  PR for this sub-spec MAY include it, but it is not normatively required here.

## Open questions

(none)
