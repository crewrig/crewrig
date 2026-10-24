<!-- Extracted from AGENTS.md. Cross-references to other sections refer to AGENTS.md. -->

# Logbook Issues

<!-- crewrig-doc: published=false -->

Four rules govern how logbooks are kept:

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

On merge, the closure comment lists each folded item (Rule D) with its
resolution.

## Rule D — Fold newly discovered related bugs

Spec 0286. While a bug-type issue is worked, a related bug that surfaces is
**folded** into that issue instead of opening a new one.

**Applies to** an issue that is bug-type (label `bug`, or a title opening
with `🐛`) and has an assignee, at every complexity tier. Any other issue
keeps the existing handling (own issue, or ledger entry).

**Fold tests — all four must hold**, each answerable from the repository and
the logbook alone. A bug failing any one is *unrelated* and goes to its own
issue (escape hatch below).

- *Causal link.* The fix or the investigation surfaced it, or it reproduces
  only on the code path the fix changes or exercises; the logbook names the
  step (test run, diff hunk, reproduction) that exposed it.
- *Locality.* The remedy touches only files already in the issue's diff, the
  direct callers or callees of a changed symbol, or the tests of those files.
- *Tech class.* It is a `tech`-class defect (ADR-0010). `spec`- and
  `arch`-class bugs are never foldable and follow `docs/retroactive-loop.md`.
- *Size.* It stays within the caps below.

**Tracking.** Each folded bug is a task-list item in the issue body, under a
`Folded bugs` section, and one bullet in the next stage-transition comment
(Rule B). No separate issue is opened.

```markdown
## Folded bugs

- [ ] <one-line symptom> — exposed by: <step per causal-link test> — status: open
- [x] <one-line symptom> — exposed by: <step> — status: resolved (regression test: <path or justification>)
```

**Regression test.** Each folded bug is resolved with a regression test that
fails before and passes after its fix, or a written justification in its item
for why none is possible. An item is not ticked resolved without one of the two.

**Stable state.** Work is not reported complete, and the pull request is not
offered for merge authorization, until the head commit of the implementation
branch satisfies all of:

- every `Folded bugs` item is resolved or moved out;
- every required CI check is green;
- a final sweep, recorded as a logbook bullet, re-ran the originating
  reproduction and every folded item's regression test and surfaced no further
  foldable bug;
- the REVIEW termination condition of `docs/retroactive-loop.md` holds.

**Caps.** At most 5 folded items, and the lines added by all folded fixes
together do not exceed the larger of 200 lines and the lines added by the
originating fix. Crossing either makes the next candidate non-foldable.

**Escape hatch.** A bug failing a fold test, or crossing a cap, is filed as a
new issue, labelled and assigned under the normal rules, with a
`Discovered while fixing #<originating>` back-reference; the originating
logbook records one bullet naming the new issue and the failed test or cap. A
folded item may be moved out at any time the same way: struck through in the
checklist with the link to its new issue. Filing under the escape hatch is
never a process violation; folding a bug that fails a fold test is.

Loop semantics: `docs/retroactive-loop.md` → *Folded bugs*. Ownership:
`docs/ticket-ownership.md`. PR body: `docs/pr-format.md`.
