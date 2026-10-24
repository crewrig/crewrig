---
id: "0286"
slug: fold-bugs-into-originating-issue
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1252
version: 1.0.0
---

# Fold newly discovered bugs into the originating bug issue

## Intent

A maintainer who closes a bug issue no longer finds several new open issues spawned by that same fix. While a bug-type issue is being worked, every bug that surfaces from the fix or from the code the fix touches is recorded and resolved inside that issue, as a checklist item and a logbook entry, until the code reaches an observable stable state; only a bug that is genuinely unrelated, or that outgrows the issue, gets an issue of its own. The tracker therefore distinguishes real new debt from fallout of a fix already in flight, and the backlog stops growing as a side effect of making progress. Parent proposal: issue 1252.

## Requirements

1. **R1 (applicability).** The fold rule SHALL apply only to an issue that is bug-type, meaning it carries the `bug` label or its title opens with the `🐛` gitmoji, and that has an assignee. On any other issue, a newly discovered bug SHALL be handled as before (own issue, or ledger entry for a non-blocking review finding). The rule applies at every complexity tier, including `trivial` tickets that have no spec.
2. **R2 (fold criteria, all required).** A newly discovered bug SHALL be classed as **foldable** only if all four tests hold, each answerable from the repository and the logbook alone:
   - (a) *Causal link.* The bug was surfaced by the fix or by the investigation of the originating bug, or it is reproducible only on the code path the fix changes or exercises; the logbook entry names the step (test run, diff hunk, reproduction) that exposed it.
   - (b) *Locality.* Its remedy touches only files already in the issue's diff, the direct callers or callees of a changed symbol, or the tests of those files.
   - (c) *Tech class.* It is a `tech`-class defect in the sense of ADR-0010 (the intent and design are correct, the realization is wrong). A bug that needs a decision about intended behaviour is `spec`-class, and a bug that the current design cannot realize is `arch`-class; neither is ever foldable, and both follow the existing routing of `docs/retroactive-loop.md`. On a tie between classes the existing disambiguation rule applies (escalate upstream).
   - (d) *Size.* The folded item stays within the caps of R9.

   A bug failing any one test is **unrelated** and SHALL go to its own issue (R10).
3. **R3 (tracking inside the issue).** Each foldable bug SHALL be recorded as a task-list item in the originating issue body, in a section titled `Folded bugs`, carrying a one-line symptom, the criteria evidence of R2(a) and a status (open or resolved). Each item SHALL also appear as one bullet in the next stage-transition logbook comment, per Rule B of `docs/logbook-issues.md`. No separate GitHub issue SHALL be opened for a foldable bug.
4. **R4 (regression test per folded bug).** Each folded bug SHALL be resolved together with a regression test that fails before and passes after its fix, or with a written justification in its checklist item for why none is possible. An item SHALL NOT be ticked resolved without one of the two.
5. **R5 (stable state, observable termination).** The originating issue is in **stable state** when all of the following hold on the head commit of its implementation branch: (a) every `Folded bugs` item is resolved or has been moved out under R10; (b) every required CI check is green; (c) a final sweep, recorded as a logbook bullet, re-ran the originating reproduction and the regression test of every folded item and surfaced no further foldable bug; and (d) the REVIEW termination condition of `docs/retroactive-loop.md` → *Termination* holds. Work on the issue SHALL NOT be reported complete, and its pull request SHALL NOT be offered for merge authorization, before the stable state is recorded.
6. **R6 (interaction with the finding loop).** A `tech`-class finding raised by a REVIEW pass keeps its existing route (loop back to DEV, no change to the routing matrix, the class set or the precedence order). When such a finding describes a bug meeting R2, the orchestrator SHALL record it as a folded item under R3 in addition to its finding identifier, so the one defect is traceable on both surfaces. A non-blocking finding that meets R2 is not sent to the ledger: it is folded. A non-blocking finding that fails R2 follows the existing ledger route unchanged. Folding SHALL NOT change the finding class, the logbook issue, or the stage a finding routes to.
7. **R7 (iteration guardrail).** Fixing a folded bug found before the first REVIEW pass consumes no iteration. A folded bug found by a REVIEW pass is fixed inside the iteration that finding already opened and counts under the existing `iter:N` rule. The iteration cap (default 5, or the spec's `max-iterations`) is neither raised nor reset by folding. When the cap is reached, the structured summary posted on the logbook issue SHALL list the folded items with their status, and the user is paged as today.
8. **R8 (ticket ownership).** Folded items SHALL inherit the originating issue's single assignee (spec 0244) and need no assignment of their own. Folding SHALL NOT bypass the pickup check: an agent working an issue that someone else owns still stops on a non-zero `ticket-pickup` exit, and a bug discovered on such an issue cannot be folded by that agent into someone else's issue.
9. **R9 (anti-unbounded-growth caps).** An issue SHALL hold at most **5** folded items, and the lines added by all folded fixes together SHALL NOT exceed the larger of **200 lines** and the lines added by the fix of the originating bug. Crossing either cap makes the next candidate non-foldable.
10. **R10 (escape hatch).** A bug that fails R2, or that would cross a cap of R9, SHALL be filed as a new issue, labelled and assigned under the normal rules, with a `Discovered while fixing #<originating>` back-reference; the originating logbook records one bullet naming the new issue and the failed test or cap. A folded item MAY be moved out at any time under the same rule when it turns out larger than judged, in which case it is struck through in the checklist with the link to its new issue. Filing under R10 is never a process violation; folding a bug that fails R2 is.
11. **R11 (pull request scope).** The folded fixes SHALL ship in the same pull request as the originating fix, in one pull request, by default. A split into several pull requests is allowed only when the combined diff would make the pull request unreviewable at the declared complexity tier, and then every resulting pull request SHALL still cite the originating issue as its logbook (Rule A) and the last SHALL carry the closing keyword. The pull request body SHALL list the folded items in a `Folded bugs` entry of its detailed description.
12. **R12 (spec interaction).** If the originating issue has a spec, folded fixes SHALL NOT widen what the spec obliges; a candidate that would require it is `spec`-class and goes to a delta-spec per R2(c). Folded items are not added to the spec, which remains the statement of the originating bug's contract.
13. **R13 (closure).** On merge the originating issue SHALL be closed immediately (Rule C), with the closure comment listing each folded item and its resolution. A reviewer auditing the issue SHALL be able to reconstruct, from the issue alone, which bugs were folded, why each qualified, and which were filed elsewhere.
14. **R14 (documents updated).** The change SHALL be realized by amending the files listed below and no others; no script, linter or tool is introduced by this spec (consistent with the doc-only engine posture of `docs/retroactive-loop.md`).
    - `docs/logbook-issues.md`: a new rule, *Rule D — Fold newly discovered related bugs*, restating R1 to R5, R9 and R10, with the `Folded bugs` checklist shape.
    - `docs/retroactive-loop.md`: a new section *Folded bugs* stating R6 and R7, a cross-reference from *Finding classes and routing* and *Non-blocking conditional routing*, and a one-line note in *Max-iteration guardrail* (summary lists folded items).
    - `docs/adr/0010-spec-plan-review-lifecycle.md`: a cross-reference only, under *Finding classification taxonomy*, noting that a foldable `tech` finding is also tracked under spec 0286 (the routing matrix is not edited).
    - `docs/pr-format.md`: the `Folded bugs` entry of R11 in the *Detailed description (for agents)* template.
    - `docs/ticket-ownership.md`: one sentence stating R8.
    - `AGENTS.md`: one sentence in *Logbook Issues* pointing to Rule D.
    - `artifacts/core/skills/pr-logbook/SKILL.md` and `artifacts/core/skills/pr-reviewer/SKILL.md`: the folded-items checks (logbook bullet, PR body entry, finding cross-trace), each with a `metadata.provenance.version` MINOR bump and the regenerated built outputs staged in the same commit, per `AGENTS.md`.

## Scenarios

**Scenario:** A related bug is folded (happy path)

Given bug issue 900 is assigned and carries the `bug` label, and its fix changes `scripts/lib/a.ts`
When the regression run exposes a second defect in a direct caller of the changed function, small and of `tech` class
Then the defect is added to the `Folded bugs` checklist with its R2 evidence, fixed with a regression test in the same pull request, and no new issue is opened.

**Scenario:** Stable state ends the work

Given issue 900 has two folded items, both resolved, and CI is green
When the final sweep re-runs the originating reproduction and both regression tests and finds nothing new, and the REVIEW pass has zero findings
Then the stable state is recorded and the pull request may be offered for merge authorization.

**Scenario:** An unrelated bug takes the escape hatch (failure path)

Given the fix of issue 900 is in progress
When the developer notices a defect in a module that the fix neither touches nor exercises
Then it fails R2(a) and R2(b), a new issue is filed with the `Discovered while fixing #900` back-reference, and the logbook records one bullet naming it.

**Scenario:** A spec-class discovery is never folded (failure path)

Given issue 900 has a spec and a candidate bug is really an undecided behaviour of the spec
When the candidate is classed
Then it is `spec`-class, fails R2(c), and is routed to a delta-spec under the existing loop rather than folded.

**Scenario:** The cap forces a split

Given issue 900 already holds 5 folded items
When a sixth foldable-looking bug appears
Then it is filed as a new issue under R10 and the logbook records that the cap was reached.

**Scenario:** A review finding is both a finding and a folded item

Given a REVIEW pass raises a `tech` finding describing a bug that meets R2
When the orchestrator routes the iteration
Then the finding loops to DEV as today, counts under `iter:N`, and the same defect appears as a folded item cross-referencing the finding identifier.

**Scenario:** Another contributor's issue is not folded into

Given issue 901 is bug-type and assigned to someone else
When an agent discovers a related bug while working near it
Then the agent does not edit issue 901, the pickup check still governs, and the bug is filed under the normal rules.

## Out of scope

- Bug discovery by a reviewer on a pull request unrelated to an open bug issue, and bugs found with no originating bug issue.
- Retroactively folding bugs already filed as separate issues, and merging or closing existing duplicate issues.
- Feature, enhancement or refactor issues: the rule covers bug-type issues only.
- Any change to the finding classes, the routing matrix, the precedence order, the findings ledger or its growth guardrail.
- Any script, linter, label automation or CI check enforcing the criteria; the rule is a documented procedure for the orchestrator and agents.
- Changing the iteration cap, the termination condition of REVIEW, or the ticket-ownership rules.
- Tuning the numeric caps of R9 from data; they are initial values.

## Open questions

- Is the `bug` label or the `🐛` title gitmoji the authoritative marker of a bug-type issue, or should the forge's native issue type also count (issue 1252 shows an empty `issue-type`)?
- Are the R9 caps (5 items, 200 lines or the originating fix size) the right initial values, and should the line cap be measured on added lines or on the full diff of the folded fixes?
- Should a non-blocking review finding that meets R2 be folded (as R6 states) or stay on the ledger by default, leaving folding to explicit triage in FULL mode only?
- Should the final sweep of R5(c) be a distinct step with its own logbook bullet, or is the zero-finding REVIEW pass sufficient evidence of stability?
- Does the one-pull-request default of R11 conflict with the branch-prefix convention for multi-PR tickets (`test/<ticket>-<slug>` until the last PR) when a split is allowed, and is that rule worth restating here?
- Maintainer approval: the issue asks for explicit approval of the principle; the takeover comments record the new owner's approval, but the original requester has not yet had the chance to object.
