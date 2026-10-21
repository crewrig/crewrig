<!-- Extracted from AGENTS.md. Cross-references to other sections refer to AGENTS.md. -->

# Plan review protocol

<!-- crewrig-doc: published=false -->

**Authoring rule.** The plan SHALL be authored by the existing
`architect` role on the team (per *Agent Team Protocol → Standard
Team Templates*); no new specialist role is introduced. The same
`architect` invocation that runs the PLAN stage owns the comment.

**Review rule.** At the `large` tier, and at the `standard` tier whenever
the *Conditional review* script below does not yield `skipped`, the plan
SHALL be reviewed by a **second `architect`** spawned cold — no authoring context, no prior session
state — to preserve independence. Every pass of that review is
attributed to the `plan/<ticket>` seat, whose verdicts carry a `seat:`
line and whose second and later passes read a bounded scope; which role
occupies the surface is unchanged. The reviewer posts the review as a
follow-up comment on the same logbook issue. The review header and
verdict line follow `docs/plan-format.md` → *Header conventions*, and the
`seat:` line goes immediately after the verdict line
([`docs/reviewer-seat.md`](reviewer-seat.md) → *The seat line, and where
it goes*).
When the orchestrator and the reviewer share the same GitHub
identity, the shared-identity workaround from *Standard Team
Templates → Template 1* applies (post the verdict as a regular
comment).

**Conditional review.** At the `standard` tier the cold review above is
conditional, and the condition is decided by a deterministic script, never
by the plan author's judgement (spec 0277, option b of
[ADR-0020](adr/0020-risk-proportional-ceremony.md)).

- **Command.** The orchestrator runs
  `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-plan-review.ts <spec-path> [<plan-path>|-] [--prior-review]`
  (or `task check-plan-review -- <args>`), with the plan comment body from a
  file or stdin. Line 1 of stdout is exactly one of `plan-review: required`,
  `plan-review: skipped` or `plan-review: not-applicable`, followed by
  `reason:` lines. The script exits 0 for all three decisions and 2 on a
  usage error or an unreadable input. It is a plain `node` script with no
  CLI-specific path and runs identically on all four CLIs.
- **Tier gate.** `skipped` is reachable only at `standard`. `large` always
  yields `required`. `trivial` and `small` yield `not-applicable` and keep
  the protocol unchanged. An absent, unparsable or unknown tier yields
  `required`.
- **Skip condition.** At `standard`, `skipped` requires a component count N
  of at most 3 (the threshold is one named constant in
  `scripts/lib/governance/plan-review-gate.ts`) AND no shared-contract hit.
  N is the set union of the components declared on the plan's `Components:`
  line (`docs/plan-format.md` → *Blast radius*) and the components derived
  from every repo path named in the plan's `### Steps`, resolved through
  `.crewrig/plan-components.txt`. The `Components:` line lists component
  names as they appear in `.crewrig/plan-components.txt`; a declared name
  absent from the manifest counts as its own component. Under-declaring
  therefore never lowers N. A shared-contract hit is any repo path named in
  the plan's `### Steps` or the spec's `## Requirements` that matches an
  entry of `.crewrig/shared-contract-paths.txt`, whatever the verb that
  introduces it; a path cited read-only still counts, since over-triggering
  only pushes toward `required`.
- **Fail closed.** Any ambiguity yields `required` with the ambiguity named
  in a `reason:` line: a missing or empty `Components:` line, an absent tier,
  a missing, unreadable, empty or malformed manifest, a plan with no
  `### Steps` section, or a `standard` plan whose Steps name no repo path. An
  unreadable spec or plan is a usage error (exit 2), not a decision.
- **Reasons.** The `reason:` lines state the tier, the declared count, the
  derived count, N against the threshold, and the matched shared-contract
  paths (or `none`), in stable text that can be diffed.
- **Sticky once reviewed.** The decision is recomputed for every plan
  version, but once any plan review verdict exists on the ticket (a comment
  carrying a `seat: plan/<ticket>` line), the review stays mandatory for
  every later revision. The orchestrator SHALL then pass `--prior-review`,
  and the script prints `plan-review: required` with a reason naming the
  flag. A REVIEW-stage `arch` finding on a ticket that skipped plan review
  routes back to PLAN ([`docs/retroactive-loop.md`](retroactive-loop.md)),
  and the revised plan is then cold-reviewed; this is the rollback signal.
- **Floor, not ceiling.** The orchestrator MAY run the plan review when the
  script says `skipped`; the script never forbids a review.
- **Skip record.** The script output SHALL be posted verbatim in the PLAN
  logbook comment. A skip with no recorded script output is a process
  violation, and a REVIEW pass that finds it SHALL emit a `class: tech`
  finding. The REVIEW pass SHALL also re-run the script on the posted plan
  comment and the spec, and a mismatch with the recorded output is a
  `class: tech` finding.
- **Unchanged controls.** The user plan-validation gate (below), the
  PLAN-revision cap semantics (a skipped review consumes zero revisions) and
  the cold `pr-reviewer` on every PR are unchanged.
- **Scope.** The script runs author-side at PLAN time; CI proves it against
  committed fixtures only and is not a gate on live plans.

**Reviewer-minted identifiers.** Every finding emitted by a PLAN review
pass SHALL carry a reviewer-minted identifier in the format `v<N>-F<M>`
(e.g., `v1-F1`, `v1-F2` for pass 1 reviewing plan `v1`; `v2-F1` for pass
2 reviewing plan `v2`). If a finding is later split by the author or
reviewer, sub-findings SHALL retain the parent prefix (e.g., `v1-F2a`,
`v1-F2b`). Reviewer-minted IDs stabilize finding identities across plan
revisions and prevent renumbering drift.

**Prior-finding traceability audit.** A PLAN review of a revised plan
(`v<N+1>` for N ≥ 1) SHALL begin with a **Finding Traceability Audit**
section before listing any new findings. The audit section SHALL
enumerate every reviewer-minted ID (`v<N>-F<M>`) raised across all prior
review passes and state its disposition in the revised plan: *addressed*,
*superseded*, or *withdrawn with reason*. Any unaddressed prior finding
whose class or severity warrants a plan revision SHALL cause the review
pass to return a `### Verdict: REQUEST CHANGES`. Non-blocking prior-finding
residue (e.g. wording corrections or mechanical adjustments that do not
alter the architectural approach) MAY instead be disposed as DEV-routed named
edits recorded directly in the review verdict without consuming a revision
iteration.

**On this surface the two clauses above already discharge the seat
contract's finding-identifier, disposition-record and audit obligations.**
[`docs/reviewer-seat.md`](reviewer-seat.md) preserves and references
`v<N>-F<M>`, the revised plan's traceability table, and the audit above
rather than redefining any of them, so no second identifier scheme and no
second disposition record apply here.

**Countable invariant.** Reviewers and third parties MAY verify that all
raised review findings are claimed in a revised plan's traceability
table by asserting that the row count of addressed reviewer-minted IDs
matches the total findings raised across prior review comments:

```sh
# Count findings raised across prior review comments
for id in <review-comment-ids>; do
  gh api repos/crewrig/crewrig/issues/comments/$id --jq .body | grep -c '^\*\*Finding '
done
# Count rows in the plan comment's traceability table
grep -c '^| v[0-9]* | v[0-9]*-F[0-9]*' <plan-comment>
```

**Delta plans and cumulative traceability.** A revised plan `v2` or later is
posted as a delta ([`docs/plan-format.md`](plan-format.md) → *Delta
revisions*), but its traceability table remains cumulative and complete, so
the invariant and the two commands above are unchanged and apply to a delta
as to a full plan. The Finding Traceability Audit is likewise unchanged.
Plan and verdict comments are held to the 12 KB budget of
[`docs/plan-format.md`](plan-format.md) → *Comment size budget*.

**Finding class taxonomy.** Every plan-review finding SHALL carry
exactly one `class:` field whose value drives the loop target:

- `class: tech` — DEV-stage fix (e.g. a step names the wrong file
  path or omits a required edit).
- `class: arch` — PLAN-stage rework (e.g. the approach is unsound;
  the blast radius missed a downstream consumer).
- `class: spec` — SPECS-stage rework (e.g. a requirement is
  ambiguous; the spec admits the plan but the plan reveals the WHAT
  is under-specified).

The full routing matrix — re-spawn composition, delta-spec impact,
termination — lives in [`docs/retroactive-loop.md`](retroactive-loop.md)
→ *Routing matrix*, restated in condensed form in
[ADR-0010](adr/0010-spec-plan-review-lifecycle.md) → *Routing matrix*;
this list states the taxonomy, not the routing.

**REQUEST CHANGES blocks DEV.** A plan-review verdict of `### Verdict:
REQUEST CHANGES` SHALL block the DEV stage from starting until a
revised plan is posted and re-reviewed by the **same seat** — a fresh
agent holding no session state from the earlier pass, which is what
"cold" has always meant here
([`docs/reviewer-seat.md`](reviewer-seat.md) → *Seat identity*).

**PLAN-loop cap.** The loop halts when a further plan revision would
exceed the tier's cap (numbers per the ADR-0010 → *Complexity tiers
and team sizing* table, not restated here). On halt, the orchestrator
SHALL post a structured summary on the logbook issue and escalate to
the user regardless of interaction mode; it SHALL NOT auto-approve the
halted plan, and the loop resumes only on explicit user instruction,
which MAY lift the cap for that ticket (R3–R4 of spec 0138).

The cap counts verdicts that send a plan back for revision; arbitration
folds, message-crossing splits, and reviews returned for retagging — a
malformed verdict per `docs/plan-format.md` → *Finding tag schema* and
`docs/retroactive-loop.md` → *Class tagging discipline* — do not count as
revisions (R5 of spec 0138). A plan approved on its first cold review
consumes zero revisions, and so does a plan whose review was skipped.

When a plan review routes an iteration out to the SPECS stage for
delta-spec authoring (via a `class: spec` finding), the resulting approved
delta-spec establishes a new specification baseline. Returning to the PLAN
stage initiates a fresh planning cycle against that revised baseline and
resets the PLAN-revision counter to zero for the new iteration.

These clauses bound the plan's size and the loop's length; they remove no item from the reviewer's checklist at any tier.

**Plan-validation gate.** In the modes that gate the PLAN stage (FULL
and INTERMEDIATE per *Interaction modes → Behavioral contract per (mode
× stage) cell*), the user gate that validates the plan comment before
DEV starts is realised through the `user-validate` skill — not through a
direct `AskUserQuestion` call. That keeps the user's configured
validation backend (including `plannotator`) in effect.
