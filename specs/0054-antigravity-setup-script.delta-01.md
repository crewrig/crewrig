---
id: "0054"
slug: antigravity-setup-script
status: draft
complexity: trivial
interaction-mode: INTERMEDIATE
related-issue: 424
version: 1.1.0
---

# Antigravity CLI setup script

## ADDED

(none)

## MODIFIED

**Community-tier scenario path — original (spec 0054, line 84):**

> Given a built `dist/community/.gemini/` staging tree is present

**Replacement:**

> Given a built `dist/community/.agents/` staging tree is present

Rationale: spec 0053 R2 establishes that the Antigravity build pipeline
emits non-core tier outputs to `<output-root>/.agents/` (i.e.
`dist/<tier>/.agents/`), not to `dist/<tier>/.gemini/`. The original
scenario text predates spec 0053 and referenced the Gemini staging path
by mistake. The implementation plan correctly follows `dist/community/.agents/`
already; the spec text is brought into alignment here.

---

**R6 tier-routing policy — original (spec 0054, line 37):**

> 6. The script SHALL follow the tier-routed install pattern: the core tier
>    SHALL be deployed automatically; library, community, and org tiers SHALL
>    each require explicit opt-in from the user.

**Replacement:**

> 6. The script SHALL follow the tier-routed install pattern: the core tier
>    SHALL be deployed automatically; the library tier SHALL also be deployed
>    automatically (matching the behavior of `scripts/setup-gemini-interactive.sh`,
>    which auto-installs the library tier); the community and org tiers SHALL
>    each require explicit opt-in from the user.

Rationale: the Gemini setup script (`scripts/setup-gemini-interactive.sh`)
auto-installs the library tier without prompting. The Antigravity setup
script is specified to follow that same pattern for consistency across CLIs.
The original R6 text incorrectly grouped the library tier with the opt-in
tiers; the plan's implementation mirrors the Gemini precedent and is correct.
This delta aligns the WHAT (spec) with the plan and the implemented behavior.

## REMOVED

(none)
