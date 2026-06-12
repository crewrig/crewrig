---
id: "0028"
slug: docs-section-overviews
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 296
version: 1.0.0
---

# Overview content for the four empty doc sections

## Intent

The four currently-empty top-level documentation sections — Introduction,
Concepts, Authoring, and Harness engineering — each gain one published overview
page that accurately introduces the section's subject and points the reader to
the existing detailed documentation, so that a newcomer can understand what
CrewRig is, its core concepts, how shared components are authored, and how the
harness feedback loop works without reading the source.

## Requirements

1. The Introduction, Concepts, Authoring, and Harness engineering sections
   SHALL each contain at least one published documentation page.
2. The Introduction page SHALL explain what CrewRig is, name its five pillars,
   and give the mental model a newcomer needs to navigate the rest of the
   documentation.
3. The Concepts page SHALL explain, at a conceptual level, the layered context
   system (the priority-ordered context files), the core/overlay/examples
   layering, multi-CLI parity, the shared cross-tool memory, and the harness
   feedback loop.
4. The Authoring page SHALL explain how skills, agents, and commands are
   authored once and compiled to every supported command-line tool.
5. The Harness engineering page SHALL explain the friction-reporting and
   curation feedback loop and the friction taxonomy.
6. Every statement in these pages SHALL be accurate to the framework as it
   currently exists; the pages SHALL NOT describe behavior the framework does
   not have.
7. Each new page SHALL carry the publication metadata required by the
   documentation publication contract and SHALL appear in the generated
   documentation index under its declared section.
8. Each page SHALL link to the relevant existing detailed documentation rather
   than duplicating it.
9. Each section SHALL receive exactly one overview page in this pass.

## Scenarios

**Scenario:** A newcomer gets oriented

Given a reader who has never seen CrewRig opens the Introduction page
When they read it
Then they understand what CrewRig is, can name its five pillars, and know which
section to read next.

**Scenario:** The four sections enter the index

Given the four overview pages are added with their publication metadata
When the documentation index is regenerated
Then the Introduction, Concepts, Authoring, and Harness engineering sections
appear in the index, each with its overview page.

**Scenario:** An unsubstantiated claim is caught before publish

Given a drafted sentence describes behavior the framework does not actually have
When the page is reviewed
Then the claim is corrected or removed before the page is published.

**Scenario:** A page missing metadata fails the contract

Given a new overview page without the required publication metadata
When the documentation index check runs
Then it fails, so the page cannot ship untracked.

## Out of scope

- Exhaustive per-topic pages within each section; this pass delivers one
  overview page per section, with deeper pages left to future child specs.
- Editing the already-populated sections (Adoption, Lifecycle, Reference,
  Architecture & ADRs).
- The documentation publication contract and its mechanism (spec 0027, already
  merged) — these pages consume it, they do not change it.
- Surfacing the new pages on crewrig.org/docs; that requires a deliberate pin
  bump in the site repository (spec 0002) and is a separate follow-up.

## Open questions

- [USER-PARKED] The relative navigation order of the four new section pages
  among any future sibling pages is deferred; this pass assigns each overview
  page a stable nav order within its section, refined when deeper pages land.
