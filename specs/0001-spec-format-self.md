---
id: "0001"
slug: spec-format-self
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 167
version: 1.0.0
---

# Specification format and `/specs/` scaffold

## Intent

Authors of CrewRig tickets gain a single, normative file format for the
specifications that anchor the SPECS stage of the lifecycle, plus a
top-level `/specs/` directory ready to receive them. Anyone reading a
merged spec recognises its shape at a glance, knows where its
frontmatter fields are documented, and can find a copy-ready template
without leaving the repository.

## Requirements

1. The repository SHALL contain a normative document `docs/spec-format.md`
   that defines the spec frontmatter schema, the mandatory body
   sections, the delta-spec convention, the lifecycle states, and the
   filename naming convention.
2. The frontmatter schema SHALL include the fields `id`, `slug`,
   `status`, `complexity`, `interaction-mode`, `related-issue`,
   `version`, and the optional `max-iterations` and `superseded-by`
   fields with the types and constraints defined in `docs/spec-format.md`.
3. The mandatory body sections SHALL be `## Intent`, `## Requirements`,
   `## Scenarios`, `## Out of scope`, and `## Open questions`, in that
   order.
4. The repository SHALL contain a top-level `/specs/` directory
   containing at least `README.md`, `_template.md`, and this spec file.
5. The template `specs/_template.md` SHALL be a copy-ready file with
   every mandatory section present, frontmatter populated with
   `status: draft`, `complexity: standard`, `interaction-mode:
   INTERMEDIATE`, `version: 1.0.0`, and explanatory placeholders for
   author-facing fields.
6. `AGENTS.md` SHALL contain a single-sentence pointer from its
   *Lifecycle* section to `docs/spec-format.md`, and SHALL NOT
   duplicate the schema.
7. The spec file naming pattern SHALL be `/specs/<NNNN>-<kebab-slug>.md`
   for originals and `/specs/<NNNN>-<kebab-slug>.delta-<NN>.md` for
   delta-specs, with `<NNNN>` zero-padded to four digits and allocated
   monotonically across the repository.

## Scenarios

**Scenario:** Author opens a new spec from the template

Given the repository contains `specs/_template.md`
When  an author copies it to `specs/<next-id>-<their-slug>.md`
Then  the new file passes `markdownlint` with the project configuration
and  every mandatory frontmatter field and body section is present.

**Scenario:** Author writes a delta-spec for a `spec`-class finding

Given an approved spec `specs/0042-build-dryrun.md` exists on `main`
When  the REVIEW loop surfaces a `spec`-class finding
Then  the author creates `specs/0042-build-dryrun.delta-01.md`
and   the delta file contains the `## ADDED`, `## MODIFIED`, and
      `## REMOVED` sections at H2 level
and   the original spec on `main` is left untouched.

**Scenario:** Reviewer rejects a delta-spec that violates MD001

Given a delta-spec PR is opened with `### ADDED`, `### MODIFIED`,
      `### REMOVED` sub-sections placed directly under the file's
      `# <title>` H1 heading
When  `markdownlint` runs on the file with the project's default
      configuration
Then  the linter rejects the file with MD001 (heading-increment)
and   the reviewer asks the author to promote the three headings
      to H2 per `docs/spec-format.md` → *Delta-spec body sections*.

**Scenario:** Reviewer rejects a spec with implicit scope

Given a spec PR is opened with an empty `## Out of scope` section and
      `complexity: standard`
When  the spec reviewer inspects the file
Then  the reviewer rejects the PR and asks the author to enumerate the
      excluded behaviours.

**Scenario:** Reviewer rejects a spec with HOW words in requirements

Given a spec PR contains a requirement line written as
      "The system SHALL retry transient errors by using exponential
      backoff via the `retry-go` library"
When  the spec reviewer inspects the file
Then  the reviewer rejects the line as a HOW statement and asks the
      author to move the technology choice to the plan artefact.

## Out of scope

- The dedicated spec-PR workflow (branching, ordering against the
  implementation PR) — formalised in issue #170.
- The `spec-author` skill and agent — issue #168.
- The plan format and plan-review protocol — issue #169.
- The retroactive routing engine that classifies REVIEW findings and
  re-spawns the correct team — issue #172.
- A working spec linter that enforces the invariants listed in
  `docs/spec-format.md` → *Linting hints*. The document describes the
  invariants so the linter can be written later; the linter itself
  ships in issue #178.
- Multi-CLI distribution of any spec-related skills — issue #174.
- Migration of in-flight tickets onto the new format — issue #175.

## Open questions

- None. Downstream uncertainty is parked in the issues listed under
  *Out of scope* and will be resolved there.
