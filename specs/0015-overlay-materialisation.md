---
id: "0015"
slug: overlay-materialisation
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 229
version: 1.0.0
---

# Overlay Materialisation and crewrig.config.toml Template

## Intent

The overlay layer gains its canonical starting point: a versioned
`crewrig.config.toml.template` in the core layer from which every adopting
organisation initialises its own `crewrig.config.toml`. The template declares
the minimum required fields that identify the adopting organisation's fork,
point to the upstream canonical repository, and enumerate the overlay paths
the sync mechanism must not touch. Adopting organisations no longer need to
author the config from scratch — they copy the template, fill in their values,
and commit the result.

## Requirements

1. The core layer SHALL contain a versioned template file named
   `crewrig.config.toml.template` at the repository root.
2. `crewrig.config.toml.template` SHALL declare, at minimum, the following
   fields: `canonical_repo` (the upstream CrewRig repository URL),
   `feedback_repo` (the repository where friction issues are filed), and
   `overlay_paths` (the list of paths the sync mechanism SHALL NOT overwrite).
3. `crewrig.config.toml.template` SHALL document each field inline with a
   comment explaining its purpose and accepted values.
4. `crewrig.config.toml.template` SHALL be a valid TOML file that can be
   parsed without error by a standard TOML parser.
5. The existing `crewrig.config.toml` at the repository root SHALL be updated
   to align with the structure declared in `crewrig.config.toml.template`,
   serving as the reference instantiation of the template for the upstream
   CrewRig project itself.
6. `docs/layers.md` SHALL be updated to remove the "forthcoming" qualifier
   from the `crewrig.config.toml.template` entry in the examples layer,
   confirming its physical presence.
7. The `.gitignore` SHALL NOT list `crewrig.config.toml`; an adopting
   organisation's `crewrig.config.toml` is an overlay file that is committed
   to their repository.
8. `AGENTS.md` or `docs/` SHALL provide a brief description of
   `crewrig.config.toml`'s role so that an adopting organisation can
   understand it without reading the full spec.

## Scenarios

**Scenario:** New adopter initialises their fork configuration

Given a developer at a new adopting organisation who has cloned the CrewRig
core
When they copy `crewrig.config.toml.template` to `crewrig.config.toml` and
fill in their `canonical_repo` and `feedback_repo` values
Then the resulting file is a valid TOML file, the `overlay_paths` field is
pre-populated with the standard overlay path list, and no further manual
investigation is needed to produce a functional fork configuration.

**Scenario:** Template is syntactically valid

Given `crewrig.config.toml.template` at the repository root
When a TOML parser reads the file
Then it parses without error.

**Scenario:** Upstream crewrig.config.toml aligns with template

Given the upstream `crewrig.config.toml` and `crewrig.config.toml.template`
both present at the repository root
When a reviewer compares the two files
Then every field declared in the template is present in
`crewrig.config.toml`, with values appropriate for the upstream CrewRig
project.

## Out of scope

- Enforcement of the `overlay_paths` field by the sync mechanism — that is
  the responsibility of sub-spec D.
- Validation tooling that checks whether an adopting organisation's
  `crewrig.config.toml` conforms to the template schema — a potential
  follow-up spec.
- Migrating existing CrewRig forks to populate `crewrig.config.toml` from
  the template — each adopting organisation's responsibility.
- Relocating `crewrig.config.toml.template` from the root into `examples/`
  — deferred until `examples/` is populated and the relocation scope is
  clearer.

## Open questions

(none)
