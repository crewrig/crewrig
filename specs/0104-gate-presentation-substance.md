---
id: "0104"
slug: gate-presentation-substance
status: draft
complexity: small
interaction-mode: AUTO
related-issue: 670
version: 1.0.0
---

# Substance-embedding guidance for caller-built plannotator gate presentations

## Intent

When a CrewRig validation gate runs through the `plannotator` backend and the
situation obliges the caller to construct a bespoke presentation of the
artifact — rather than hand the review viewer the raw artifact file — under a
richer pedagogy or translate framing, the reviewing user must actually see the
real substance of what is being decided: the concrete changed content itself,
not merely a prose summary describing it. Today the `user-validate` skill
offers no guidance that a caller-built presentation must carry the artifact's
actual substance, and that gap has already surfaced to a real user, who was
shown a merge-authorization gate that summarized the change in a few sentences
— a title, a one-line description, and the prior reviewer's verdict — yet never
displayed the actual modified content, even though translation and
professor-level pedagogy were active. This spec closes the gap: the skill's
`plannotator`-backend guidance states that a caller-built presentation must
embed the concrete substance under decision — and, for a decision over a change
set such as a merge authorization, must show enough of the actual change for
the reviewing user to judge it independently rather than take a prior review's
word for it.

## Requirements

1. The `user-validate` skill SHALL carry substance-embedding guidance within
   the existing `plannotator` backend section of
   `artifacts/library/skills/user-validate/SKILL.md`, co-located with the
   contrast-safety guidance it complements.
2. The guidance SHALL apply specifically to the case where a caller constructs
   a bespoke presentation of the artifact before handing it to the review
   viewer, and SHALL distinguish that case from passing the raw artifact file
   straight through.
3. When the `pedagogy` option is set to `professor` and/or the `translate`
   option is `on`, the guidance SHALL direct that the caller-built presentation
   embed the actual substance of the artifact under decision — the concrete
   changed content itself — rather than only a prose summary describing what
   changed.
4. For a decision over a change set or diff, such as a merge-authorization
   gate, the guidance SHALL direct showing enough of the actual modified
   content — a rendered diff excerpt, or the added or changed prose verbatim —
   for the reviewing user to judge the change independently, rather than
   relying solely on a prior REVIEW verdict.
5. When `translate` is `on`, the guidance SHALL direct that the embedded
   substance itself be translated in the presentation, consistent with the
   existing translate boundary: the translation is presentation-only and the
   repository artifact stays in English, never written back translated.
6. The guidance SHALL state that when the caller passes the raw artifact file
   directly to the review viewer, the viewer already renders the full
   substance, so no separate substance-embedding step is required.
7. The guidance SHALL make clear that this substance obligation is
   presentation-only and does not modify the invocation command, the
   dual-validation rule, the decision mapping, or the defined semantics of the
   cross-cutting options; it only clarifies how a caller-built presentation
   applies them.

## Scenarios

**Scenario:** A caller embeds the real change and the user judges it
independently

```text
Given the `plannotator`-backend guidance in the `user-validate` skill states
      the substance-embedding requirement
And   `pedagogy=professor` and `translate=on` are active, obliging the caller
      to build a bespoke presentation of a merge-authorization artifact
When  the caller embeds the actual modified content — the rendered diff excerpt
      and the added prose verbatim, translated for presentation — as the
      guidance directs
Then  the reviewing user sees the concrete change under decision and can judge
      it independently rather than take a prior review's word for it
```

**Scenario:** A summary-only merge-authorization presentation is recognized as
non-compliant

```text
Given the guidance requires a caller-built presentation of a change set to
      embed enough of the actual modified content for independent judgement
When  a caller-built merge-authorization presentation shows only a title, a
      one-line description, and the prior reviewer's verdict, with no rendered
      diff and no changed prose verbatim
Then  an agent or reviewer applying the guidance identifies the presentation as
      non-compliant before it reaches the user, avoiding the summary-only
      outcome observed during the merge-authorization gate reported in issue
      #670
```

**Scenario:** Raw artifact passthrough carries no substance-embedding
obligation

```text
Given the guidance scopes the substance-embedding requirement to caller-built
      presentations only
When  a caller passes the raw artifact file directly to the review viewer
      without building a bespoke presentation
Then  the caller is not required by the guidance to embed a separate substance
      excerpt, because the viewer's own renderer already displays the full
      artifact
```

## Out of scope

- Any change to the `plannotator` tool itself — its review viewer, its
  rendering of embedded content, or its handling of a caller-built
  presentation. This spec designs caller guidance around the viewer's behavior
  as a fixed constraint; it does not ask the viewer to change.
- The `internal` backend of `user-validate`. It realizes the gate through
  `AskUserQuestion` (or the host CLI's structured-prompt equivalent), a
  surface out of scope for this spec, whose presentation of the artifact is
  governed by the `internal` backend's own contract rather than by
  caller-built presentation guidance.
- Prescribing a numeric threshold or an exact quantity for "how much" of the
  change to show. The guidance mandates that a caller-built presentation embed
  enough of the actual substance for independent judgement; deciding how much
  that is in a given case is left to caller judgement.
- A programmatic or automated enforcement mechanism — for example a linter that
  detects a summary-only presentation. This spec mandates written guidance for
  the human or agent authoring the presentation, not an automated check.
- Any change to the skill's invocation command, its dual-validation rule (exit
  status plus gate JSON), its decision mapping, or the defined semantics of the
  `translate` / `pedagogy` / `illustration` cross-cutting options. This spec
  clarifies how a caller-built presentation applies those options; it does not
  redefine them.
- Duplicating the guidance into every skill that might request a validation
  gate. Callers reach the review viewer through `user-validate`, which owns the
  `plannotator` invocation, so the guidance is centralized there.
- Code changes of any kind. This is a documentation-only edit to one
  `SKILL.md`; the only mechanical obligation beyond the prose is the
  `metadata.provenance.version` bump that the project's version-bump convention
  already requires of any modified skill source.

## Open questions

None outstanding. The boundary decisions above — leaving the `plannotator`
viewer unchanged, excluding the `internal` backend, declining to prescribe a
numeric quantity of change to show, and declining to mandate an automated
enforcement mechanism — were each resolved by explicit exclusion during
authoring rather than left open.
