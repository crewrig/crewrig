---
id: "0109"
slug: spec-status-invariant-on-main
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 700
version: 1.0.1
---

# 0109 — spec-status-invariant-on-main (delta-01)

This delta makes spec 0109's Requirement 5 **consistent with the carve-out it
cites**. As merged, R5 requires a status correction to change "`status` and
nothing else — no body line, no `id`, no `slug`, no `interaction-mode`, no
`version` — per the lifecycle-metadata carve-out in `docs/spec-format.md` →
*Recording a status transition*". That carve-out says the opposite about one of
those five fields: it states the edit "sets `interaction-mode` to the mode the
spec was qualified under" when `interaction-mode` was omitted while the spec was
`draft`.

The contradiction is not academic. It makes R5 **unsatisfiable together with
R1 and R4** for five of the specs R4 covers. `specs/0098`, `0100`, `0101`,
`0102` and `0103` carry no `interaction-mode`, because the frontmatter schema
(`docs/spec-format.md`, the frontmatter table) makes that field required only
"from `approved` onward" and permits its omission while `draft`, where it
defaults to `INTERMEDIATE`. Correcting those five to a non-`draft` status
therefore *requires* adding the field — and every escape route is closed:

- A status-only edit leaves those five failing the spec linter's own
  frontmatter check (`'interaction-mode' MUST be present if status is not
  'draft'`), so the corrected tree does not pass its own validation.
- Leaving those five at `draft` violates R1 and R4, and makes the check R2
  introduces fail on the very change that introduces it — contradicting R6.

So the letter of R5 forbids the only conforming action. Each of the five
spec-PRs, moreover, recorded the omission as deliberate and deferred to exactly
this moment: PR #655 states "`interaction-mode` intentionally omitted (added at
the `approved` transition per `docs/spec-format.md`)". That transition never
happened, which is the defect this ticket exists to fix.

This delta MODIFIES Requirement 5 only. Every other requirement of spec 0109 —
Requirements 1 through 4 and 6 through 8 — is **UNCHANGED** and remains in
force. No scenario changes: none of the five scenarios mentions the field list.
No open question is introduced.

The version bump is **PATCH** (`1.0.0` → `1.0.1`). Per `docs/spec-format.md` →
*Delta-spec convention → Versioning*, `PATCH` covers a "clarification, wording
fix". This delta constrains no previously unspecified case and invalidates no
work: it aligns a field list with the document it already defers to, and the
implementation authored against the parent spec already does the conforming
thing.

*Recorded for whoever reads this later:* this is the same authoring defect that
issue #703 catalogues five times against spec 0108 — a requirement stating what
is **forbidden** by enumeration, without checking the enumeration against the
rule it references. #703's closing observation, that four instances in one spec
point at the authoring habit rather than at that spec's luck, was written by the
same author who then produced this sixth instance in the next spec they wrote.
It is the strongest available argument for the checklist item #703 proposes.

## ADDED

(None. This delta modifies one requirement's field list; it adds no
requirement, scenario, or out-of-scope item.)

## MODIFIED

1. **Requirement 5 is replaced** so that its field list matches the carve-out it
   cites.

   - Original R5:

     > **R5.** A correction per requirement 4 SHALL be metadata-only: it changes
     > `status` and nothing else — no body line, no `id`, no `slug`, no
     > `interaction-mode`, no `version` — per the lifecycle-metadata carve-out
     > in `docs/spec-format.md` → *Recording a status transition*.

   - Replacement R5:

     > **R5.** A correction per requirement 4 SHALL be metadata-only in the
     > sense the lifecycle-metadata carve-out in `docs/spec-format.md` →
     > *Recording a status transition* defines: it changes `status`, and it
     > SHALL additionally set `interaction-mode` when — and only when — that
     > field was absent because the spec was `draft`, setting it to the mode the
     > spec was qualified under, since the frontmatter schema requires the field
     > from `approved` onward. It SHALL touch nothing else: no body line, no
     > `id`, no `slug`, no `version`. A diff that alters any normative content
     > under cover of a status correction is a violation, exactly as that
     > carve-out states.

## REMOVED

(None. This delta modifies Requirement 5 only; it removes no requirement,
scenario, or out-of-scope item. Requirements 1 through 4 and 6 through 8 of
spec 0109 remain in force unchanged.)
