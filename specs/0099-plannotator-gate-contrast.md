---
id: "0099"
slug: plannotator-gate-contrast
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 608
version: 1.0.0
---

# Contrast-safety guidance for caller-built plannotator gate presentations

## Intent

When a CrewRig validation gate runs through the `plannotator` backend and
the situation obliges the caller to construct a bespoke rich presentation
of the artifact — rather than hand the review viewer a raw Markdown or
plain-text file — the person performing the review must always see
legible, sufficiently-contrasted content. Today the `user-validate` skill
offers no guidance on keeping such a caller-built presentation readable
across the review viewer's possible host themes, and that gap has already
surfaced to a real user as black text on a black background during a live
spec-approval gate. This spec closes the gap: the skill's
`plannotator`-backend guidance states the contrast-safety expectations a
caller-built presentation must meet so the reviewing user is never shown
unreadable low-contrast content, whatever theme the viewer places behind
it.

## Requirements

1. The `user-validate` skill SHALL carry contrast-safety guidance within
   the existing `plannotator` backend section of
   `artifacts/library/skills/user-validate/SKILL.md`, co-located with the
   `plannotator annotate … --gate` invocation step that the guidance
   qualifies.
2. The guidance SHALL apply specifically to the case where a caller
   constructs a bespoke HTML presentation of the artifact before invoking
   the review viewer, and SHALL distinguish that case from passing a raw
   Markdown or plain-text artifact file straight through.
3. The guidance SHALL state the rationale for the requirement: the review
   viewer renders the document body but does not reliably honor a
   document-`<head>`-scoped `<style>` block, and may place the content on
   a dark host surface — so colors declared only in the head can surface
   as unreadable low-contrast content such as dark text on a dark
   background.
4. The guidance SHALL require that every color and contrast declaration on
   which the presentation's readability depends be self-contained inline
   on the content wrapper element and on the document `<body>` element,
   rather than declared only inside a `<head>` `<style>` block.
5. The guidance SHALL direct that any `<style>` block used for
   supplementary, non-critical styling be placed inside `<body>` rather
   than in `<head>`.
6. The guidance SHALL direct the caller-built document to declare a light
   color-scheme hint (`<meta name="color-scheme" content="light only">`)
   so the host does not place light-assuming content on a dark surface.
7. The guidance SHALL include at least one concrete example of a compliant
   inline color/contrast declaration, so a caller can apply the
   requirement without inferring the shape from prose alone.
8. The guidance SHALL state that the contrast-safety requirement does NOT
   apply when the caller passes a raw Markdown or plain-text artifact file
   directly to the review viewer, because in that case the viewer's own
   renderer is responsible for readability.

## Scenarios

**Scenario:** A caller follows the guidance and the review renders legibly

```text
Given the `plannotator`-backend guidance in the `user-validate` skill
      states the contrast-safety requirement
And   a caller must build a bespoke HTML presentation for a validation
      gate because a `pedagogy` or `illustration` option is active
When  the caller declares the presentation's background and text colors
      inline on the `<body>` and content wrapper as the guidance directs
Then  the reviewing user sees legible, sufficiently-contrasted content
      regardless of the theme the review viewer places behind it
```

**Scenario:** A head-only stylesheet is recognized as non-compliant

```text
Given the guidance requires readability-critical color declarations to be
      self-contained inline rather than only in a `<head>` `<style>` block
When  a caller-built presentation declares its light background only inside
      a `<head>` stylesheet
Then  an agent or reviewer applying the guidance identifies the
      presentation as non-compliant before it reaches the user, avoiding
      the black-text-on-black-background outcome observed during the spec
      0083 validation gate
```

**Scenario:** Raw Markdown passthrough carries no contrast obligation

```text
Given the guidance scopes the contrast-safety requirement to caller-built
      HTML presentations only
When  a caller passes a raw Markdown artifact file directly to the review
      viewer without building a bespoke presentation
Then  the caller is not required by the guidance to inject inline contrast
      styling, and the viewer's own renderer remains responsible for
      readability
```

## Out of scope

- Any change to the `plannotator` tool itself — its review viewer, its
  handling (dropping or overriding) of `<head>`-scoped stylesheets, or its
  choice of host background. This spec designs caller guidance around the
  viewer's behavior as a fixed constraint; it does not ask the viewer to
  change.
- The `internal` backend of `user-validate`. It realizes the gate through
  `AskUserQuestion` (or the host CLI's structured-prompt equivalent) and
  has no browser or HTML surface, so contrast-safety of caller-built HTML
  does not apply to it.
- Any change to the skill's invocation command, its dual-validation rule
  (exit status plus gate JSON), its decision mapping, or the semantics of
  the `translate` / `pedagogy` / `illustration` cross-cutting options. This
  spec adds contrast-safety guidance only.
- A programmatic or automated contrast checker — for example a linter that
  measures a WCAG contrast ratio on caller-built HTML. This spec mandates
  written guidance for the human or agent authoring the presentation, not
  an automated enforcement mechanism.
- Prescribing a specific numeric contrast ratio or an exact color palette.
  The guidance mandates self-contained, contrast-safe declarations and an
  illustrative example; it does not fix a particular ratio or a set of hex
  values.
- Duplicating the guidance into every skill that might request a validation
  gate. Callers reach the review viewer through `user-validate`, which owns
  the `plannotator` invocation, so the guidance is centralized there.
- Code changes of any kind. This is a documentation-only edit to one
  `SKILL.md`; the only mechanical obligation beyond the prose is the
  `metadata.provenance.version` bump that the project's version-bump
  convention already requires of any modified skill source.

## Open questions

None outstanding. The boundary decisions above — leaving the `plannotator`
viewer unchanged, excluding the `internal` backend and the raw-passthrough
case, and declining to mandate a numeric contrast ratio or an automated
checker — were each resolved by explicit exclusion during authoring rather
than left open.
