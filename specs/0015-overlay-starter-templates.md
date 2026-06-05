---
id: "0015"
slug: overlay-starter-templates
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 229
version: 1.0.0
---

# Overlay Starter Templates

## Intent

CrewRig ships three template files that an adopting organisation copies and
fills in to initialise its overlay layer: `crewrig.config.toml.template` (the
fork-level build configuration), `config/ORGANIZATION.md.template` (the
organisation identity and standards file), and `config/TOOLS.md.template` (the
tool and MCP server guidelines file). Each template is a skeleton with
commented placeholder content that tells the organisation exactly what to write
in each section, without imposing any organisation-specific content. The comment
block in the existing `crewrig.config.toml` is updated to remove the stale
reference to the relocated `community-config/FORMAT.md`.

## Requirements

1. The repository SHALL contain a `crewrig.config.toml.template` file at the
   repository root, classified as `examples` layer. This file is the starting
   point that an adopting organisation copies to `crewrig.config.toml` and fills
   in before running the build pipeline.

2. `crewrig.config.toml.template` SHALL define, at minimum, the following keys
   with placeholder string values and inline comments explaining each field:
   `canonical_repo` (the URL of the upstream repository this fork was created
   from, used for audit trail and license traceability) and `feedback_repo` (the
   URL of the repository where the harness curator SHALL open feedback issues).
   Copying `crewrig.config.toml.template` to `crewrig.config.toml` and replacing
   the placeholder values with valid URLs SHALL be sufficient to produce a green
   `bash scripts/build-components.sh` run.

3. The repository SHALL contain a `config/ORGANIZATION.md.template` file,
   classified as `examples` layer. This file is the starting point that an
   adopting organisation copies to `config/ORGANIZATION.md` and customises.

4. `config/ORGANIZATION.md.template` SHALL contain, at minimum, the following
   sections as a skeleton with commented placeholder content indicating what the
   organisation should write in each section:
   - A company overview section (company context, mission, product area).
   - A code quality standards section (readability, maintainability priorities).
   - A security and compliance section (credential hygiene, data protection,
     access control principles).
   - A collaboration standards section (commit conventions, branch naming,
     review process, documentation norms).

5. The repository SHALL contain a `config/TOOLS.md.template` file, classified
   as `examples` layer. This file is the starting point that an adopting
   organisation copies to `config/TOOLS.md` and customises.

6. `config/TOOLS.md.template` SHALL contain, at minimum, the following sections
   as a skeleton with commented placeholder content indicating what the
   organisation should write in each section:
   - A tooling preferences section (editor, terminal, communication, CI/CD
     tooling in use).
   - An MCP server guidelines section (which MCP servers are enabled, their
     scope, and any restrictions on their use).
   - A workflow preferences section (working rhythms, sprint cadence, on-call,
     deployment frequency).

7. The comment block at the top of `crewrig.config.toml` SHALL be updated to
   replace the reference to `community-config/FORMAT.md` with `artifacts/FORMAT.md`,
   reflecting the path change introduced by spec 0014.

## Scenarios

**Scenario:** Organisation forks CrewRig and initialises its build configuration

Given a developer at an adopting organisation who has just forked the CrewRig
repository
When they copy `crewrig.config.toml.template` to `crewrig.config.toml` and
replace the `canonical_repo` and `feedback_repo` placeholder values with their
own repository URLs
Then `bash scripts/build-components.sh` exits zero and the built CLI output
directories are populated correctly.

**Scenario:** Template is missing a required build field

Given a `crewrig.config.toml.template` that omits the `feedback_repo` key
When a reviewer cross-checks the template against the fields consumed by
`scripts/build-components.sh`
Then the missing field is visible as a gap — the template does not satisfy R2
and the implementation PR fails the spec review.

**Scenario:** Organisation customises ORGANIZATION.md from the template

Given a developer copying `config/ORGANIZATION.md.template` to
`config/ORGANIZATION.md`
When they read each section
Then the commented placeholder content in every section tells them exactly what
to write without requiring them to consult external documentation.

## Out of scope

- The step-by-step adoption guide that walks an organisation through the full
  fork initialisation sequence — covered by sub-spec E1 (issue #231).
- `config/SOUL.md.template` and `config/PROFILE.md.template` — these already
  exist in the repository and are not modified by this sub-spec.
- Creation of the `artifacts/` directory structure — covered by sub-spec B
  (spec 0014, issue #228).
- The dirty-core guard / sync mechanism — covered by sub-spec D (issue #230).
- Assembly verification tooling — covered by sub-spec E2 (issue #232).

## Open questions

(none)
