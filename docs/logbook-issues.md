<!-- Extracted from AGENTS.md. Cross-references to other sections refer to AGENTS.md. -->

# Logbook Issues

<!-- crewrig-doc: published=false -->

## Rule B — triggers that require an immediate logbook comment

The `AGENTS.md` → *Logbook Issues → Rule B* obligation ("update
incrementally, not at the end") fires on each of the following events. A
logbook comment MUST be posted **before** resuming work on the trigger's
resolution — not after the PR is opened.

- Merge conflicts encountered during rebase or merge
- CI failures (any red check that prompts a code change)
- Friction declarations (`harness-report` activations)
- Scope changes or requirement pivots mid-ticket
- Rebase operations that resolve conflicts (one comment per rebase, summarizing the conflict and resolution)
- Architectural course corrections (an ADR-worthy decision made inline)
