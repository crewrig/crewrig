---
id: "0002"
slug: spec-author-skill
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 194
version: 1.3.0
---

# 0002 — spec-author-skill (delta-03)

This delta adds one requirement (R16) on a **pre-write grounding
step** the `spec-author` skill SHALL perform when it qualifies a
verification, audit, or sanity-check tool whose acceptance is
file-level. The friction surfaced in #194 — a real bug history: spec
0007 mandated a `type` field that never existed in any built artefact,
discovered only at DEV time (#174) and corrected via the delta-spec
in PR #189. R16 closes that gap by requiring the skill to inspect at
least one real instance of the artefact class under verification
before authoring the requirements list, so the wrong-shape spec is
caught at qualification time rather than at implementation time.

The trigger is intentionally **narrow** — only verification / audit /
sanity-check specs, as cited verbatim by the friction reporter — to
avoid imposing grounding ceremony on specs that have no concrete
artefact to ground against (e.g. brand-new components, pure
documentation changes).

## ADDED

1. **New requirement (R16) — pre-write grounding for
   verification / audit specs.** When the spec under authoring
   qualifies a **verification, audit, or sanity-check tool** whose
   acceptance is file-level (an `R<N>`-style requirement of the form
   *"the tool SHALL exit zero on a clean checkout"* or *"every
   generated artefact SHALL contain field X"* or any equivalent
   file-shape assertion), the `spec-author` skill SHALL execute a
   *pre-write grounding step* before writing the `## Requirements`
   section. The grounding step SHALL:

   1. Identify the **artefact class under verification** (e.g.
      "every built skill SKILL.md frontmatter", "every Gemini
      mirror agent file", "every generated bundle's `provenance`
      block").
   2. **Inspect at least one real instance** of that artefact class
      that currently exists in the repository under `main`. Read the
      file end-to-end (or the relevant section) with the same tools
      the skill normally uses to read repository content.
   3. **Compare the observed shape** to the requirements the skill
      is about to write. The comparison is informational: the skill
      cross-checks that the WHAT it is qualifying matches the WHAT
      that already lives in the codebase.

2. **Anomaly handling.** If the grounding inspection surfaces an
   anomaly between the spec's intended assertions and the observed
   artefact shape (a mandated field is missing, the file path is
   different from the spec's assumption, the layout diverges from
   the contract the spec implies), the skill SHALL emit a bullet
   into the spec's `## Open questions` section describing the
   anomaly in one line, prefixed with `[GROUNDING:]`. The bullet
   blocks skill exit in MINIMAL / INTERMEDIATE / FULL modes per
   R10's open-question discipline, forcing the user (or, in AUTO
   mode, the audit reader) to reconcile the spec with reality
   before the spec PR ships.

3. **Conforming-case silence.** If the grounding inspection confirms
   that the observed artefact shape is consistent with the
   requirements the skill is about to write, the skill SHALL NOT
   add any `[GROUNDING:]` bullet, any new section, or any other
   spec-level artefact reflecting the grounding work. The
   inspection is silently consumed; its only output in the conforming
   case is its absence of pushback. This keeps the spec body lean
   when grounding has nothing to flag.

4. **Mode applicability.** R16 applies to **all four interaction
   modes** — `MINIMAL`, `INTERMEDIATE`, `FULL`, and `AUTO`. The
   AUTO mode benefits especially from R16: AUTO has no interactive
   user round-trip to challenge the requirements list, so grounding
   inspection is the only safety net catching reality drift before
   the spec PR is opened.

5. **Out-of-scope-mode declaration.** When the spec under authoring
   does NOT qualify a verification / audit / sanity-check tool
   (e.g. brand-new component, pure documentation change,
   convention amendment with no built-artefact target), R16
   SHALL NOT apply. The skill SHALL NOT manufacture a grounding
   inspection for specs that have no concrete artefact class to
   ground against — that would be ceremony with no signal.

6. **Trigger detection heuristic.** The skill SHALL classify the
   spec as in-scope for R16 when ANY of the following conditions
   holds for any drafted requirement:

   a. **Quantifier pattern.** The requirement contains *"every"*
      or *"each"* followed by a noun naming a built artefact class
      (e.g. *"every built SKILL.md frontmatter"*, *"each generated
      bundle"*).
   b. **File-level assertion.** The requirement asserts a property
      at the file level (an `exit zero`-style claim, a
      field-presence claim, a layout claim, or a content-shape
      claim).
   c. **Validation-verb on existing class.** The requirement uses
      a validation, rejection, refusal, or enforcement verb
      (*refuse*, *reject*, *validate*, *require*, *mandate*,
      *disallow*, *enforce*, *forbid*) acting on a property of an
      artefact class that the codebase already produces.
   d. **Semantic catch-all.** The drafted requirement describes
      the shape, structure, or content of a class of artefacts
      that the codebase already produces, regardless of the
      surface wording.

   When none of the four conditions holds, the spec is out of
   scope for R16. The skill SHALL prefer false positives (over-
   classifying as in-scope) over false negatives (missing a
   verification spec): grounding ceremony in an out-of-scope case
   is informational at worst, while grounding skipped in an
   in-scope case re-introduces the friction R16 exists to close.

7. **New field on existing artefact class.** When the spec mandates
   a field, attribute, or property that no instance of the
   artefact class currently exhibits on `main` (a *"new field on
   existing class"* case — exactly the PR-189 scenario that
   originated this delta), the grounding step SHALL still execute
   against at least one real instance. The inspection's purpose
   in this case is NOT to confirm field presence (the field is by
   definition absent) but to confirm that:

   a. The artefact class genuinely exists in the codebase under
      the path the spec assumes (no typo, no stale path).
   b. The existing instances have a coherent shape into which the
      new field can be added without breaking the structure.

   The skill SHALL emit a `[GROUNDING:]` bullet under
   `## Open questions` stating explicitly that the new field is
   absent from every existing instance and naming who is
   responsible for the back-fill — the same implementation PR, a
   migration PR scoped in `## Out of scope`, or a separate
   follow-up ticket. This forces the back-fill-scope decision
   into the spec PR rather than deferring it to DEV time.

## MODIFIED

1. **`specs/0002-spec-author-skill.md` → `## Scenarios` (after the
   three failure-path scenarios introduced by delta-02 R15).** Two
   new scenarios SHALL be inserted, one happy-path and one
   failure-path, recording the contract R16 imposes:

   ```text
   **Scenario:** Skill catches a built-artefact mismatch at
   qualification time via grounding inspection

   Given the skill is authoring a spec that qualifies a verification
         tool whose drafted `R8` reads "every built SKILL.md
         frontmatter SHALL contain a `type` field"
   When  the skill executes the pre-write grounding step and reads
         one real `community-config/skills/<any>/SKILL.md` frontmatter
   Then  the skill SHALL detect that no `type` field exists in the
         observed file
   and   the skill SHALL emit a bullet under `## Open questions`
         prefixed `[GROUNDING:]` describing the anomaly
   and   skill exit SHALL block until the user or the AUTO-mode
         audit reader reconciles the requirement with reality.
   ```

   ```text
   **Scenario:** Reviewer rejects a verification/audit spec authored
   without grounding inspection

   Given a spec PR is opened that qualifies a verification, audit,
         or sanity-check tool with at least one file-shape
         requirement
   When  the cold spec-reviewer inspects the spec and finds no
         evidence of pre-write grounding (no `[GROUNDING:]` bullet
         under `## Open questions`, no logbook comment recording an
         inspection that confirmed conformance)
   Then  the reviewer SHALL reject the spec PR
   and   the finding SHALL carry `class: tech` per the retroactive
         routing matrix.
   ```

## REMOVED

(None. R16 is purely additive; no existing requirement is removed
or relaxed.)
