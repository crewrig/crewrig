# Retroactive review loop

<!-- crewrig-doc: section=lifecycle nav_order=10 published=true title="Retroactive review loop" -->

This document is the normative reference for the **retroactive routing
engine** that closes the REVIEW stage of the lifecycle introduced in
[ADR-0010](adr/0010-spec-plan-review-lifecycle.md) — specifically
*Stage definitions → REVIEW*. It operationalises the requirements of
[`specs/0005-retroactive-routing-engine.md`](../specs/0005-retroactive-routing-engine.md)
and the contract layered on top by `AGENTS.md` → *Retroactive review
loop*. Every section below traces back to one of spec 0005's
requirements R1..R14.

## Doc-only engine

The engine is **a documented procedure the orchestrator (the
`team-lead` role) follows**, not an executable script (spec 0005 R1).
Until friction on the first ten real REVIEW loops justifies otherwise,
no helper binary, no parser, no review-comment crawler ships with this
spec — the orchestrator reads the verdict, applies the rules below,
and acts. A scripted variant is a candidate follow-up tracked in
`specs/0005-retroactive-routing-engine.md` → *Out of scope*; pre-empting
it would encode guesses about a routing surface no live run has
exercised end-to-end.

The reading audience is the orchestrator. Reviewers (`architect`,
`pr-reviewer`, `spec-author` when acting as spec reviewer) need only
the *Class tagging discipline* section below; downstream skills
(`developer`, `tester`, `spec-author` in delta mode) need only the
*Routing matrix* row that names them.

## REVIEW launch trigger

The REVIEW stage begins the moment the implementation PR exists on the
remote. The orchestrator SHALL:

1. Apply the `iter:1` label to the implementation PR (per *Iteration
   counter — GitHub label*).
2. **Immediately** spawn the cold-start `pr-reviewer` with the PR
   number — no pause, no prompt, no user acknowledgement requested.

The spawn sequence is mode-conditional:

| Mode | Action |
|---|---|
| **INTERMEDIATE** | Apply `iter:1` label; spawn `pr-reviewer` immediately. |
| **MINIMAL** | Apply `iter:1` label; spawn `pr-reviewer` immediately. |
| **AUTO** | Apply `iter:1` label; spawn `pr-reviewer` immediately. |
| **FULL** | Post the non-blocking start-of-iteration notification on the logbook issue (per `AGENTS.md` → *Interaction modes*); apply `iter:1` label; spawn `pr-reviewer` immediately. The notification does NOT block spawning. |

**Process violation.** Pausing after PR creation and waiting for user
input before spawning the reviewer is a process violation in
INTERMEDIATE, MINIMAL, and AUTO modes. The REVIEW loop in those modes
is fully autonomous from the moment the PR exists — no user gate fires
until the max-iteration guardrail (see *Max-iteration guardrail*) or the
final merge-authorization request.

## Routing matrix

The matrix below is the engine's authoritative reference. It is also
restated in condensed form in `AGENTS.md` → *Retroactive review loop*
for cross-section navigability; the duplication is intentional, and
the two surfaces SHALL stay in lockstep when either is amended.

| Class | Loop target | Re-spawn sequence | Spec-PR impact |
|---|---|---|---|
| `tech` | DEV | `developer` (+ `tester` if the touched surface includes test code) | none |
| `arch` | PLAN | `architect` (PLAN-author) → on revalidation, DEV team re-runs from start of the matching template (per `AGENTS.md` → *Standard Team Templates*) | none |
| `spec` | SPECS | `spec-author` in delta-spec mode → spec-PR review → on merge, PLAN re-runs (fresh `architect`), then DEV team re-runs | new delta-spec PR (per spec 0003 → *Delta-spec cumulative rule*) |

The re-spawn columns are minimums. Every re-spawn SHALL apply the
`security` rule from `AGENTS.md` → *Standard Team Templates →
Security rule* if the touched surface qualifies; the engine does not
override the rule, it inherits it.

## Class tagging discipline

Every reviewer finding SHALL carry exactly one `class:` field whose
value is one of `tech`, `arch`, or `spec` (spec 0005 R2). The tag is
the only signal the engine reads — without it, routing is undefined.

**Untagged-finding round-trip.** A REVIEW verdict that contains at
least one finding without a `class:` field is *malformed*. The
orchestrator SHALL NOT consume it. Instead (spec 0005 R3):

1. Post a comment on the relevant PR (implementation-PR for `tech` /
   `arch` candidates, spec-PR for `spec` candidates) explicitly
   requesting retagging, naming each unlabeled finding by its index.
2. Re-spawn the reviewer cold (same role, fresh agent) with the retag
   instruction.
3. **Do NOT increment the iteration counter for this pass.** A
   malformed verdict does not count as an iteration consumed against
   the max-iteration guardrail (R9). The engine refuses to penalise
   the implementation team for the reviewer's protocol violation.

The orchestrator SHALL NOT default an untagged finding to `tech` — a
silent default would conceal a reviewer defect and would drift the
loop target away from the most upstream class present.

## Routing precedence

A single REVIEW pass MAY surface findings of multiple classes. The
engine SHALL pick the **most upstream class present** and route the
entire iteration to the corresponding stage (spec 0005 R4):

```text
precedence:  spec  >  arch  >  tech
```

Findings of lower-precedence classes from the same pass SHALL NOT be
silently dropped — they SHALL be re-tagged onto the next iteration's
verdict by the next reviewer spawned cold (spec 0005 R5). The engine
does not parallelise multi-class routing within a single iteration;
parallelising would fan out the team and require synchronizing N
upstream re-spawns against a single PR, which the spec-PR workflow
(spec 0003) and the plan-review protocol (spec 0004) explicitly
forbid by their one-artifact-per-stage discipline.

The disambiguation rule on a tie at SPECS time (`arch` vs `spec`,
`tech` vs `arch`) — escalate upstream — lives in ADR-0010 →
*Finding classification taxonomy*. The engine inherits it; it does
not redefine it.

## Spec-class loop — delta mode only

A `spec`-class iteration SHALL invoke `spec-author` in **delta-spec
mode** (spec 0005 R6). The original spec on `main` is immutable per
ADR-0010 and spec 0003 — the delta-spec accumulates as a new file
`/specs/<NNNN>-<slug>.delta-<NN>.md` on a fresh branch
`spec/<NNNN>-<slug>-delta-<NN>` cut from `main`, reviewed as its own
spec-PR, and merged independently. The implementation-PR then
absorbs the delta on the next iteration per spec 0003 →
*Delta-spec cumulative rule*.

Re-authoring a fundamentally broken spec — status transition to
`superseded` — is **out of the loop**. It is a new-ticket path:
abandon the implementation-PR, open a fresh ticket whose SPECS stage
authors a replacement spec (frontmatter `superseded-by: <new-id>` on
the old, `superseded` on its status line). The loop owns deltas;
it does not own full re-authoring.

## Iteration counter — GitHub label

The iteration counter SHALL be persisted as a GitHub label `iter:N`
on the PR (spec 0005 R7). The label is the engine's source of truth
for "what iteration are we on" — no shadow counter in memory, no
parsing of comment timestamps, no spreadsheet.

**Which PR carries the label.** The label lives on the PR whose
content the iteration is reshaping:

- `tech` and `arch` iterations → label on the **implementation-PR**
  (`feat/<NNNN>-<slug>` or sibling).
- `spec` iterations → label on the **spec-PR** for the active delta
  (`spec/<NNNN>-<slug>-delta-<NN>`). Once the delta-spec merges and
  the implementation-PR resumes its loop, the implementation-PR's
  `iter:N` label increments on the next pass; the spec-PR's label
  becomes a permanent record of how many spec-class passes the
  ticket required.

**Increment mechanism.** Atomic via the GitHub label API:

```sh
gh pr edit <pr-number> --add-label "iter:<N>" --remove-label "iter:<N-1>"
```

Run the command at the **start of every new iteration**, after a
verdict has been validated as well-formed (untagged-finding round-
trips do NOT increment, see *Class tagging discipline* above). The
command is idempotent against repeated invocation on the same N and
cross-session-safe by virtue of being a GitHub primitive — two
sibling orchestrators racing the same PR converge on the same label
state without coordinating through MemPalace.

**Initial label.** The `iter:1` label SHALL be applied to the PR
**before** the first reviewer is spawned — between PR creation and
reviewer launch, not after the first verdict is consumed (see
*REVIEW launch trigger* for the exact step ordering). PRs that never
need a second pass therefore carry exactly one `iter:N` label on
merge — a useful searchable signal for ticket-difficulty
retrospectives.

## Termination

The lifecycle terminates at MERGE iff all three conditions hold on
the same REVIEW pass (spec 0005 R8):

1. The verdict line is `### Verdict: APPROVE`.
2. The pass surfaces **zero** findings of any class (blocking or
   non-blocking — see *Non-blocking conditional routing* for the
   non-blocking distinction).
3. CI is **green** on the head commit reviewed. The engine SHALL
   query `gh pr checks <pr-number>` and confirm every required
   check is `pass`; pending or failing checks block termination
   regardless of the verdict text.

All three are necessary. An APPROVE with one nit is one finding away
from termination. An APPROVE with zero findings and red CI is a
reviewer who skipped the CI-status section of `pr-reviewer` →
*Preflight*; the engine SHALL flag this as a protocol violation and
re-spawn the reviewer cold.

## Max-iteration guardrail

The loop SHALL halt after **5 iterations** without termination (spec
0005 R9). The default is configurable per ticket via the spec
frontmatter `max-iterations` field (`docs/spec-format.md` →
*Frontmatter schema*); the engine reads the value at SPECS time and
caches it for the duration of the lifecycle.

On halt, the orchestrator SHALL:

1. Post a structured summary comment on the logbook issue. The
   summary lists, per iteration: the class routed, the role(s)
   re-spawned, the verdict outcome, and the carry-over findings (if
   any).
2. **Page the user regardless of mode** — including AUTO. The
   guardrail is the one place where AUTO breaks its
   no-user-round-trip contract: five autonomous iterations without
   convergence is the engine's signal that the ticket has crossed
   from "automation-tractable" to "needs human judgment", and the
   user is the only role that can decide the next move (abandon,
   re-scope, lift the cap, etc.).

The guardrail SHALL NOT auto-increment past the cap. The orchestrator
stops the loop; the user resumes it (or terminates it) explicitly.

## Non-blocking conditional routing

Reviewer findings carry an implicit *blocking* / *non-blocking*
classification: blocking findings prevent merge, non-blocking
findings are observations the reviewer surfaces without gating the
verdict. The engine routes non-blocking findings conditionally on
the lifecycle's interaction mode (spec 0005 R10):

| Mode | Non-blocking finding handling |
|---|---|
| **FULL** | Apply `AGENTS.md` → *Team Communication → Rule 4*: the orchestrator presents every non-blocking finding to the user and routes only those the user accepts into the loop. Findings the user defers are journalled in the logbook and left unactioned. |
| **INTERMEDIATE** | The orchestrator SHALL route every non-blocking finding into the loop using the same precedence matrix as blocking findings; the REVIEW loop fires no user gate (spec 0005 R10 as amended for #288). |
| **MINIMAL** | Same as INTERMEDIATE — every non-blocking finding is routed via the precedence matrix; no user gate. |
| **AUTO** | Same as MINIMAL — non-blocking becomes effectively blocking, routed via the matrix. |

The asymmetry reflects the lifecycle's gating philosophy: only FULL
keeps the user in the loop during REVIEW and gives the user the last
word on scope; every other mode delegates scope to the engine and
routes every signal through the matrix so that termination genuinely
means "no work left", not "no work the engine bothered to do".

## Worked example — PR #183 iteration 2

The closest live fixture is the second iteration of PR #183 (the
plan-format ticket, issue #169), where the cold review surfaced three
non-blocking findings under `INTERMEDIATE` mode. Under the model as
amended for #288, INTERMEDIATE fires no REVIEW gate, so the engine
routes all three findings into the loop using the same precedence
matrix as blocking findings — none are presented to the user for a
keep-or-defer decision. Had the same findings surfaced under `FULL`,
the orchestrator would instead present them for a bounded per-pass
triage and route only the ones the user accepts (per the table above).

The fixture predates this spec's `iter:N` label convention — the
label was not applied retroactively — so readers should treat the
example as a *retrofit* ("had the engine existed, here is how it would
route today") rather than a literal record of label state.

- <https://github.com/crewrig/crewrig/pull/183>

## Cross-references

- Spec 0005 — [`specs/0005-retroactive-routing-engine.md`](../specs/0005-retroactive-routing-engine.md).
- ADR-0010 — [`docs/adr/0010-spec-plan-review-lifecycle.md`](adr/0010-spec-plan-review-lifecycle.md), specifically *Stage definitions → REVIEW* and *Finding classification taxonomy*.
- Plan format and review protocol — [`docs/plan-format.md`](plan-format.md) and `AGENTS.md` → *Plan review protocol*.
- Spec format and delta-spec convention — [`docs/spec-format.md`](spec-format.md).
- Spec-PR workflow — [`specs/0003-spec-pr-workflow.md`](../specs/0003-spec-pr-workflow.md) and `AGENTS.md` → *Spec-PR workflow*.
- Team Communication Rule 4 — `AGENTS.md` → *Agent Team Protocol → Team Communication*.
