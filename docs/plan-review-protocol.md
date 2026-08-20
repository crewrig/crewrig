<!-- Extracted from AGENTS.md. Cross-references to other sections refer to AGENTS.md. -->

# Plan review protocol

<!-- crewrig-doc: published=false -->

**Authoring rule.** The plan SHALL be authored by the existing
`architect` role on the team (per *Agent Team Protocol → Standard
Team Templates*); no new specialist role is introduced. The same
`architect` invocation that runs the PLAN stage owns the comment.

**Review rule.** The plan SHALL be reviewed by a **second
`architect`** spawned cold — no authoring context, no prior session
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
SHALL cause the review pass to return a `### Verdict: REQUEST CHANGES`.

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
grep -c '^| v[0-9]* | [0-9]' <plan-comment>
```

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
which MAY lift the cap for that ticket (R3–R4 of spec 0138). A review
returned for retagging — a malformed verdict per `docs/plan-format.md`
→ *Finding tag schema* and `docs/retroactive-loop.md` → *Class tagging
discipline* — does not count as a revision (R5 of spec 0138). A plan
approved on its first cold review consumes zero revisions.

These clauses bound the plan's size and the loop's length; they remove no item from the reviewer's checklist at any tier.

**Plan-validation gate.** In the modes that gate the PLAN stage (FULL
and INTERMEDIATE per *Interaction modes → Behavioral contract per (mode
× stage) cell*), the user gate that validates the plan comment before
DEV starts is realised through the `user-validate` skill — not through a
direct `AskUserQuestion` call. That keeps the user's configured
validation backend (including `plannotator`) in effect.
