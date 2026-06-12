---
id: "0027"
slug: docs-ia-and-publication-contract
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 292
version: 1.0.0
---

# Technical documentation: information architecture and publication contract

## Intent

CrewRig's technical documentation becomes a structured, navigable body of
reference material that lives inside the framework itself, so that any
organization adopting CrewRig inherits the complete documentation simply by
forking, and so that a clearly delimited public subset of that documentation
can be surfaced on the project's documentation website. The documentation is
organized into a fixed top-level taxonomy; every page declares which section
it belongs to, where it sits in the reading order, and whether it is public;
and an adopting organization can add its own documentation pages that never
flow back upstream.

## Requirements

1. The technical documentation SHALL be organized under exactly eight
   top-level sections, in this order: Introduction, Concepts, Adoption,
   Authoring, Lifecycle, Harness engineering, Reference, and
   Architecture & ADRs.
2. Every documentation page belonging to a top-level section SHALL belong to
   exactly one of the eight sections.
3. Each documentation page SHALL declare structured metadata stating: a
   human-readable title, the section it belongs to, its position in the
   navigation order within that section, and whether it is publicly
   published.
4. A page whose published status is false SHALL remain in the repository and
   SHALL NOT appear in the public documentation set.
5. The set of publicly published pages, together with their titles, sections,
   and navigation order, SHALL be derivable as a single machine-readable
   index without reading the body of any page.
6. The core documentation SHALL reside in the synced core layer, so that an
   adopting organization inherits it unchanged on fork.
7. An adopting organization SHALL be able to add its own documentation pages
   in the organization overlay, and those pages SHALL NOT be propagated to
   the upstream project.
8. Organization-overlay documentation pages SHALL be renderable by the
   organization's own site build in addition to the core documentation, under
   the same metadata contract as core pages.
9. The publication contract — the metadata fields, their permitted values,
   and the generated index — SHALL be documented so that a separate site
   repository can consume it without coupling to CrewRig's internal directory
   layout.
10. Reclassifying, adding, or removing a top-level section SHALL require a
    delta-spec amendment to this spec.
11. Every documentation file that predates this spec SHALL, as part of
    realizing this spec, be assigned to a section with the required metadata
    or be explicitly marked unpublished; the implementation pull request that
    realizes this spec SHALL perform that back-fill in the same change.
12. A documentation file that is not explicitly assigned to a public section
    SHALL default to unpublished; promoting such a file to a public section
    SHALL be an explicit per-file decision.

## Scenarios

**Scenario:** Published page reaches the public index

Given a documentation page declaring published status true, a title, a
section, and a navigation order
When the published index is generated
Then the page appears in the index under its section at its position, and a
separate site repository can render it at `crewrig.org/docs` from the index
alone.

**Scenario:** Unpublished contributor-internal page stays off the site

Given a contributor-internal documentation page declaring published status
false
When the published index is generated
Then the page is absent from the index and never appears on the public site,
while remaining present in the repository for contributors.

**Scenario:** Organization overlay page renders without flowing upstream

Given an adopting organization adds a documentation page under the
organization overlay with the required metadata
When the organization builds its own documentation site
Then the page renders alongside the core documentation, and the upstream sync
mechanism never proposes that page for propagation back to CrewRig.

**Scenario:** Page missing required metadata is rejected, not dropped

Given a documentation page that omits one or more required metadata fields
When the published index is generated
Then generation reports the page as a contract violation and fails, so that
no page silently disappears from navigation.

## Out of scope

- The detailed prose content of each of the eight sections — deferred to
  child specs, one per section as needed.
- The `crewrig-website` rendering implementation: routing, theming,
  navigation UI, and the `/docs` route. That lives in the site repository's
  own spec.
- The concrete realization of the metadata mechanism and the index format.
  The agreed direction — per-page frontmatter plus a generated index
  manifest — is recorded here for the PLAN stage and is not re-opened, but
  the field schema and file format are a PLAN-stage decision, not a
  normative part of this contract.
- Rewriting or restructuring the existing ADRs under `docs/adr/` beyond
  assigning each a section and the required metadata.
- Versioned or per-release documentation (multiple concurrent doc versions).
- Search, internationalization, and analytics on the documentation site.

## Open questions

- [USER-PARKED] The exact public-versus-internal classification of the
  borderline existing pages (`docs/agent-team-protocol.md`,
  `docs/cli-matrix-maintenance.md`, `docs/scripting-conventions.md`) is
  deferred to the PLAN stage. It does not affect this contract: Requirement
  12 defaults every unassigned file to unpublished until it is explicitly
  promoted to a public section.
