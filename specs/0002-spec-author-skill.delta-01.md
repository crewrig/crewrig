---
id: "0002"
slug: spec-author-skill
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 198
version: 1.1.0
---

# 0002 — spec-author-skill (delta-01)

This delta aligns the two references in spec 0002 that still teach the
obsolete H3 placement of delta sections (`### ADDED` / `### MODIFIED` /
`### REMOVED`) with the canonical H2 convention introduced by the
merged spec `0001-spec-format-self.delta-01.md` (v1.1.0) and realised
on `main` by PR #197. Without this delta, spec 0002 R9 mandates the
exact heading level that `docs/spec-format.md` now forbids — a
normative contradiction surfaced by the cold `pr-reviewer` finding F1
on PR #197.

## ADDED

(None. The delta corrects existing wording; no new requirement or
scenario is introduced.)

## MODIFIED

1. **`specs/0002-spec-author-skill.md` → `## Requirements` → R9 (the
   single requirement covering delta-mode body emission).**

   Original:

   ```text
   In delta mode, the skill MUST emit the three delta sections
   `### ADDED`, `### MODIFIED`, and `### REMOVED` in that order, all
   present even when empty, in place of the five mandatory body
   sections.
   ```

   Replacement:

   ```text
   In delta mode, the skill MUST emit the three delta sections
   `## ADDED`, `## MODIFIED`, and `## REMOVED` at H2 level, in that
   order, all present even when empty, in place of the five mandatory
   body sections. No intermediate H2 wrapper (`## Body`,
   `## Delta sections`, or any other) SHALL be introduced above the
   three sections.
   ```

2. **`specs/0002-spec-author-skill.md` → `## Scenarios` → existing
   scenario *"Delta mode on a `spec`-class REVIEW finding"* (the
   Then-clause that names the three sub-sections).**

   Original:

   ```text
   Then  the skill detects the parent spec, switches to delta mode,
         writes `/specs/0042-build-dryrun.delta-01.md`, and the file
         contains the three sub-sections `### ADDED`, `### MODIFIED`, and
         `### REMOVED` in that order with all three present even when
         empty, while the original spec on `main` is left untouched.
   ```

   Replacement:

   ```text
   Then  the skill detects the parent spec, switches to delta mode,
         writes `/specs/0042-build-dryrun.delta-01.md`, and the file
         contains the three sections `## ADDED`, `## MODIFIED`, and
         `## REMOVED` at H2 level, in that order, with all three
         present even when empty, while the original spec on `main`
         is left untouched.
   ```

## REMOVED

(None. The convention is aligned, not retracted; no requirement of the
parent spec is deleted.)
