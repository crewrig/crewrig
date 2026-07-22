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

## Rule C — close immediately after merge

The `AGENTS.md` → *Logbook Issues → Rule C* obligation ("close
immediately after merge") exists because stale open issues accumulate
and obscure the actual state of work in flight — an issue left open
after its PR merged reads as unfinished work to anyone scanning the
tracker, and erodes trust in the issue list as a source of truth.

**Spec-PR `related-issue` exception.** When the closing issue is also
the ticket's spec-PR `related-issue` under *Logbook Issues → Rule A*
(the common case: no separate dedicated logbook issue exists, so the
shared logbook issue doubles as the spec's `related-issue`), Rule C's
"close immediately" default does not apply to the spec-PR merge itself.
The spec-PR body carries no closing-keyword directive (no `Closes #<N>`,
`Fixes #<N>`, `Resolves #<N>`, in any phrasing) for that issue, so
merging the spec-PR leaves it open. The issue only closes once the
implementation-PR merges and the change is verified — closing it at
spec-PR time would end the journal before PLAN, DEV, and REVIEW have
even run. See
[`docs/spec-pr-workflow.md`](docs/spec-pr-workflow.md) → *Independence
rule* for the full mechanics of why the two PRs close their own issues
independently.
