---
id: "0001"
slug: spec-format-self
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 195
version: 1.1.0
---

# 0001 — spec-format-self (delta-01)

This delta amends the *Delta-spec body sections* convention defined in
`docs/spec-format.md` so that a delta-spec authored from scratch passes
`markdownlint` with the project's default rules. The current convention
places three `### ADDED` / `### MODIFIED` / `### REMOVED` sub-sections
directly under the file's H1 title, which violates MD001
(heading-increment). Every delta-spec is structurally identical, so the
defect is in the format itself, not in any individual author's diff.

## ADDED

1. The repository SHALL include a regression scenario in spec 0001 →
   `## Scenarios` that exercises a delta-spec failing `markdownlint`
   when its body uses three H3 sub-sections directly under the H1 title.
   The scenario name is *"Reviewer rejects a delta-spec that violates
   MD001"* (see `## MODIFIED` below for the inserted Given/When/Then
   block).
2. The implementation-PR for related-issue 195 SHALL realign the
   already-merged delta-spec
   `specs/0007-build-install-spec-author.delta-01.md` to the new
   convention: remove the `## Body` wrapper introduced as a workaround
   in PR #189 and promote `### ADDED` / `### MODIFIED` / `### REMOVED`
   to H2. This migration is part of #195's DEV stage; no follow-up
   ticket is opened.

## MODIFIED

1. **`docs/spec-format.md` → *Delta-spec body sections* (the fenced
   code block at lines 142–155).**

   Original:

   ````markdown
   ```markdown
   ### ADDED

   <requirements, scenarios, or out-of-scope items that the delta introduces>

   ### MODIFIED

   <requirements, scenarios, or out-of-scope items the delta changes; quote the
   original line, then show the replacement>

   ### REMOVED

   <items the delta deletes; quote the original line>
   ```
   ````

   Replacement:

   ````markdown
   ```markdown
   ## ADDED

   <requirements, scenarios, or out-of-scope items that the delta introduces>

   ## MODIFIED

   <requirements, scenarios, or out-of-scope items the delta changes; quote the
   original line, then show the replacement>

   ## REMOVED

   <items the delta deletes; quote the original line>
   ```
   ````

   The three delta sections SHALL be authored at H2 level. The H1 of a
   delta-spec file remains the spec's title; no intermediate H2 wrapper
   (`## Body`, `## Delta sections`, or any other) SHALL be introduced.

2. **`docs/spec-format.md` → *Linting hints* (the bullet at lines 232–233).**

   Original:

   > For a delta-spec, the three delta section headings (`### ADDED`,
   > `### MODIFIED`, `### REMOVED`) SHALL be present in that order.

   Replacement:

   > For a delta-spec, the three delta section headings (`## ADDED`,
   > `## MODIFIED`, `## REMOVED`) SHALL be present in that order, at H2
   > level. The H1 of a delta-spec file is the spec title; no
   > intermediate H2 wrapper is allowed.

3. **`specs/0001-spec-format-self.md` → `## Scenarios` (after the
   existing *"Author writes a delta-spec for a `spec`-class finding"*
   scenario).** A new scenario SHALL be inserted, recording the
   MD001-rejection contract that the linting hints now imply:

   ```text
   **Scenario:** Reviewer rejects a delta-spec that violates MD001

   Given a delta-spec PR is opened with `### ADDED`, `### MODIFIED`,
         `### REMOVED` sub-sections placed directly under the file's
         `# <title>` H1 heading
   When  `markdownlint` runs on the file with the project's default
         configuration
   Then  the linter rejects the file with MD001 (heading-increment)
   and   the reviewer asks the author to promote the three headings
         to H2 per `docs/spec-format.md` → *Delta-spec body sections*.
   ```

4. **`specs/0001-spec-format-self.md` → `## Scenarios` → existing
   scenario *"Author writes a delta-spec for a `spec`-class finding"*
   (the Then-clause that names the three sub-sections).**

   Original:

   ```text
   and   the delta file contains the `### ADDED`, `### MODIFIED`, and
         `### REMOVED` sub-sections
   ```

   Replacement:

   ```text
   and   the delta file contains the `## ADDED`, `## MODIFIED`, and
         `## REMOVED` sections at H2 level
   ```

## REMOVED

(None. The convention is amended, not retracted; no requirement of
spec 0001 is deleted.)
