<!-- Extracted from AGENTS.md. Cross-references to other sections refer to AGENTS.md. -->

# Logbook Issues

<!-- crewrig-doc: published=false -->

Three rules govern how logbooks are kept:

## Rule A — A feature issue IS its own logbook

When a feature issue (or any pre-existing tracked issue) already exists for the work, **that issue IS the logbook**. Post all logbook content — obstacles, decisions, breakthroughs — as **incremental comments directly on that issue**. Never open a separate logbook issue in this case; duplicating the journal across two issues fragments the trail.

Only create a dedicated logbook issue when there is **no pre-existing issue** to anchor the work to (e.g., spontaneous refactor, exploratory fix). A dedicated logbook issue uses the `logbook` label.

## Rule B — One comment per stage transition, never batched at the end

Post one logbook comment at every **stage transition** (SPECS to PLAN, PLAN to DEV, DEV to REVIEW, REVIEW to merge). Each transition comment carries **one bullet per obstacle, decision, correction or rebase** since the previous comment, written while context is fresh. The incremental intent is unchanged: do **not** batch the entire journey into a single end-of-work comment, and defer nothing past the next transition. Batching loses the chronological structure, the failed attempts, and the reasoning behind course corrections, which is precisely the value the logbook is meant to preserve.

The events below are the **bullet kinds** a transition comment records, one bullet per event:

- Merge conflicts encountered during rebase or merge
- CI failures (any red check that prompts a code change)
- Friction declarations (`harness-report` activations)
- Scope changes or requirement pivots mid-ticket
- Rebase operations that resolve conflicts (one bullet per rebase, summarizing the conflict and resolution)
- Architectural course corrections (an ADR-worthy decision made inline)

**Immediate comment.** Only a **blocker that needs a user decision** is posted at once, before work resumes on its resolution.

**DEV-stage checkpoint.** During DEV, a checkpoint comment carrying the bullets accumulated so far is also posted before any hand-off to the user, and when a CI-failure cycle repeats (a second consecutive red run on the same ticket), so a long DEV stage never holds unrecorded events across a session end.

## Rule C — close immediately after merge

The `AGENTS.md` → *Logbook Issues → Rule C* obligation ("close
immediately after merge") exists because stale open issues accumulate
and obscure the actual state of work in flight — an issue left open
after its PR merged reads as unfinished work to anyone scanning the
tracker, and erodes trust in the issue list as a source of truth.

See [`docs/spec-pr-workflow.md`](spec-pr-workflow.md) → *Independence
rule* for the spec-PR `related-issue` exception and its full mechanics.
