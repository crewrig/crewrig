---
id: "0166"
slug: stable-reviewer-seat
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 970
version: 1.0.0
---

# Stable reviewer seat across the review iterations of a ticket

## Intent

A reader following a ticket through its review iterations sees one
continuous reviewer per review surface instead of a succession of
strangers: the reviewer that raised a finding is the reviewer that judges
whether it was addressed, each later pass speaks to what changed since
that same reviewer's previous verdict, and a finding that lands on a
surface nobody touched carries an explicit statement of why that surface
came back into question. Independence from the author is unchanged — no
reviewer ever inherits the author's private reasoning — and the loop
stops emitting findings whose only cause is a change of reviewer.

## Requirements

1. **Seat identity.** Every review pass in the lifecycle SHALL be attributed to exactly one
   **reviewer seat**. A seat SHALL be keyed on the pair (the ticket's
   logbook issue number, the review surface), where the review surface is
   exactly one of `specs` (spec pull-request review), `plan` (plan review
   on the logbook issue), or `review` (implementation pull-request
   review). A ticket SHALL hold at most one live seat per surface.

2. A seat key SHALL be representable as a single text token
   `<surface>/<ticket>`, optionally suffixed `#<generation>` when the
   seat has a predecessor (requirement 17). A seat key without a
   `#<generation>` suffix SHALL denote generation 1.

3. Every verdict a seat posts SHALL carry its seat key on a line of its
   own, in the exact form `seat: <surface>/<ticket>[#<generation>]`,
   placed as the first line of the verdict body after the verdict line.
   The existing verdict-header conventions of each surface SHALL remain
   unchanged; the seat line SHALL be purely additive to them.

4. A seat SHALL NOT be a surviving agent process. Each pass of a seat
   SHALL be a freshly instantiated agent that holds no session state
   from any earlier pass, and the seat's continuity SHALL rest entirely
   on durable artifacts the forge already holds.

5. **Seat dossier.** A seat's dossier SHALL consist of exactly three kinds of content
   and nothing else: (a) every verdict that seat has posted on its
   surface, in order; (b) the identifier and recorded disposition of
   every finding those verdicts raised; (c) the revision identifier of
   the artifact each of those verdicts examined — the head commit for a
   pull-request surface, the plan revision ordinal for the `plan`
   surface.

6. The dossier SHALL be held in artifacts the forge already carries —
   the seat's own verdict comments on the spec pull request, on the
   logbook issue, or on the implementation pull request. No new file, no
   new store, and no memory service SHALL be introduced to hold it.

7. The dossier SHALL be reconstructible from the forge alone: the seat
   line of requirement 3 SHALL be sufficient to enumerate a seat's prior
   verdicts without any state held outside the forge, so that an
   orchestrator session that did not spawn the earlier passes can still
   assemble the dossier.

8. The brief that instantiates a seated pass SHALL carry references
   only: the seat key, the identifier of the artifact under review, the
   revision identifier the seat last examined, and the locations of the
   seat's prior verdicts and of the disposition record of requirement
   10. It SHALL NOT carry a diff, a summary, an assessment, a rationale,
   or any other content that originates in the authoring session; a
   seated pass SHALL retrieve every artifact it reads itself, from the
   forge's own command-line tool.

9. The cold-start independence guarantee SHALL remain in force unchanged
   (`artifacts/core/agents/pr-reviewer/AGENT.md` → *Cold start
   contract*). A seated pass reading its own prior verdicts, and reading
   the durable public record of the artifact under review, SHALL NOT
   count as authoring context. A pass whose brief breaches requirement 8
   SHALL be discarded: its verdict SHALL NOT be consumed, SHALL NOT be
   entered in the dossier, and SHALL NOT increment the iteration
   counter.

10. **Prior-finding disposition.** Before a seat's pass N+1 (for N ≥ 1), the disposition of every
    finding in that seat's dossier SHALL be recorded durably, one line
    per finding identifier, as exactly one of `addressed` (naming the
    commit or revision that addressed it), `superseded`, or `withdrawn`
    with a stated reason. The orchestrator SHALL make that record on the
    artifact under review or in the logbook journal entry for the
    iteration, and the brief of requirement 8 SHALL name its location.
    On the `plan` surface the revised plan's existing finding
    traceability table (`docs/plan-format.md` → *Optional sections*)
    SHALL discharge this requirement; no second record SHALL be
    required there.

11. Every finding a seated pass emits on the `review` or `specs` surface
    SHALL carry a reviewer-minted identifier that is unique and stable
    for the life of the seat and that names the pass that raised it:
    `i<N>-F<M>` on the `review` surface, where `<N>` is the iteration
    ordinal the `iter:N` label carried when the pass ran; `s<N>-F<M>` on
    the `specs` surface, where `<N>` is the seat's pass ordinal counted
    monotonically across every artifact of that surface. The `plan`
    surface SHALL keep the `v<N>-F<M>` scheme
    `docs/plan-review-protocol.md` already mandates, and this spec SHALL
    NOT redefine it.

12. From its second pass onward, a seated pass SHALL open its verdict
    with a prior-finding audit that states, per dossier finding
    identifier, whether the pass accepts the recorded disposition of
    requirement 10. A prior finding the pass judges unaddressed SHALL
    prevent an approving verdict on that pass. The audit SHALL carry the
    same obligation `docs/plan-review-protocol.md` → *Prior-finding
    traceability audit* already places on the `plan` surface, and this
    spec SHALL NOT restate that section's shape.

13. **Bounded scope.** From its second pass onward on the same artifact, the mandatory
    reading of a seated pass SHALL be bounded to: (a) the change to the
    artifact since the revision the seat last examined; (b) the
    disposition record of requirement 10; (c) the continuous-integration
    state of the artifact's current head, which SHALL never be waived;
    and (d) every surface the change in (a) reaches — a surface the
    change newly touches, a surface a prior finding's remedy touches,
    and a surface whose invariant the change depends on even when that
    surface's own text is unchanged. A seated pass SHALL NOT be obliged
    to re-examine a surface unchanged since it last examined that
    surface. The bound SHALL remove re-examination only; it SHALL remove
    no item from the reviewer's checklist for the surfaces in scope.

14. A seated pass MAY raise a finding on a surface unchanged since it
    last examined that surface, and SHALL then state which condition of
    requirement 13(d) returned that surface to scope. A finding on an
    unchanged surface that carries no such statement SHALL be treated as
    non-blocking and routed to the deferred-findings ledger
    (`docs/retroactive-loop.md` → *Deferred-findings ledger*); the
    iteration SHALL NOT be routed on its account.

15. When the artifact a seat reviews is replaced rather than revised — a
    fresh delta spec pull request on the `specs` surface — the seat SHALL
    examine the new artifact in full, and its dossier SHALL still carry
    every prior finding for the audit of requirement 12. The bound of
    requirement 13 SHALL attach to an artifact, never to a seat.

16. **Vacant seat.** When a seat's dossier cannot be reconstructed — its prior verdicts
    are absent, they carry no seat line because the ticket predates this
    contract, or the forge is unreachable — the pass SHALL run as a full
    examination of the whole artifact, and its verdict SHALL record the
    vacancy and its cause. A widened scope SHALL never be silent.

17. The orchestrator MAY retire a seat and open a successor seat at the
    next generation number, and SHALL record the retirement and its
    cause on the logbook issue. The successor SHALL inherit the retired
    seat's dossier for the audit of requirement 12, and SHALL examine
    the artifact in full on its first pass. A retired seat SHALL post no
    further verdict.

18. A verdict returned for retagging — malformed per
    `docs/retroactive-loop.md` → *Class tagging discipline* — SHALL be
    re-issued from the same seat, SHALL open no new dossier entry, and
    its corrected form SHALL replace the malformed one in the dossier.
    The existing rule that a retag round-trip does not increment the
    iteration counter SHALL be unchanged.

19. **Parity.** Every obligation in this spec SHALL be dischargeable with only the
    forge's own command-line tool and a self-contained instantiation
    brief, identically on Claude Code, Gemini CLI, GitHub Copilot CLI,
    and Antigravity CLI. No obligation SHALL depend on a message bus, a
    surviving process, a shared memory service, or a primitive exclusive
    to one command-line assistant. Where a coordination bus exists, its
    use MAY be a convenience and SHALL NOT be a precondition.

20. This spec SHALL NOT add, remove, or move any user gate; SHALL NOT
    change the interaction-mode gating contract; SHALL NOT change the
    iteration-counter primitive, the routing precedence, the termination
    conditions, the max-iteration guardrail, or the per-tier PLAN-loop
    cap; and SHALL NOT change which role occupies which review surface.

## Scenarios

**Scenario:** Second pass reads only what moved since its own verdict

Given a ticket whose implementation pull request carries the `iter:2` label
And the `review/<ticket>` seat posted a verdict on iteration 1 that raised `i1-F1` and `i1-F2`
And the orchestrator recorded `i1-F1` and `i1-F2` as `addressed` with the commits that addressed them
When the orchestrator instantiates the seat for iteration 2 with a references-only brief
Then the verdict opens with a prior-finding audit that dispositions `i1-F1` and `i1-F2`
And its examination covers the change since the head commit iteration 1 examined, the current continuous-integration state, and the surfaces that change reaches
And it raises no finding on a file unchanged since iteration 1 without stating why that file returned to scope

**Scenario:** A remedy that touches a new surface pulls that surface into scope

Given the `review/<ticket>` seat raised `i1-F1` on a single script
And the remedy for `i1-F1` also edits a documentation page the seat never examined
When the seat runs its second pass
Then the documentation page is inside the mandatory reading of that pass
And a defect the remedy introduced there is a first-class finding of iteration 2

**Scenario:** Prior finding still unaddressed blocks the approving verdict

Given the `plan/<ticket>` seat raised `v1-F3` on plan revision `v1`
And plan revision `v2` claims `v1-F3` as addressed
When the seat examines `v2` and judges the claim unfounded
Then the pass states `v1-F3` as unaddressed in its prior-finding audit
And the verdict is not an approving verdict

**Scenario:** Turnover-shaped finding is deferred rather than looped

Given the `review/<ticket>` seat examined a module on iteration 1 and raised nothing on it
And the module is unchanged on iteration 2, and no prior finding's remedy and no invariant of the iteration-2 change reaches it
When the seat's iteration-2 verdict raises a finding on that module with no statement of why it returned to scope
Then the orchestrator treats the finding as non-blocking
And routes it to the deferred-findings ledger
And the iteration is not routed to an upstream stage on that finding's account

**Scenario:** Dossier cannot be reconstructed

Given a ticket whose earlier verdicts carry no seat line
When the orchestrator instantiates a pass for that ticket's `review` surface
Then the pass examines the whole artifact rather than an increment
And its verdict records that the seat was vacant and states the cause

**Scenario:** Brief leaks authoring context

Given an orchestrator that instantiates a seated pass
When the brief carries the developer's summary of what changed alongside the seat references
Then the pass is discarded
And its verdict is neither consumed nor entered in the dossier
And the iteration counter does not increment for that pass

## Out of scope

- A surviving reviewer process, and any cross-pass reviewer state held
  anywhere other than the forge's own durable artifacts. The rejected
  reading is recorded under *Rejected alternatives*.
- Any weakening of the cold-start independence guarantee. This spec
  narrows the reviewer's scope and widens its memory of its own prior
  verdicts; it grants no access to the author's private reasoning.
- A mechanical checker for the seat line, the finding identifiers, or
  the prior-finding audit. The contract stays a documented procedure the
  orchestrator follows, mirroring the doc-only posture of
  `specs/0005-retroactive-routing-engine.md` R1; a scripted variant is a
  candidate follow-up once friction on real loops justifies it.
- Back-filling the seat line onto verdicts already posted, and
  retrofitting seats onto tickets whose review loop is already running.
  Such a ticket resolves through the vacancy path of requirement 16.
- Reviewer memory that spans tickets. A seat is scoped to one ticket and
  one surface; nothing accumulates across tickets.
- The loop's truncation levers — `max-iterations`, the per-tier
  PLAN-loop cap — and the deferred-findings ledger's own drain protocol.
  They are complementary and unchanged.
- The composition of the teams that produce the artifact under review,
  and which role occupies which review surface.

## Open questions

- [GROUNDING:] No verdict artifact in the project carries a `seat:` line
  today, and `review`-surface findings carry either an ad-hoc identifier
  or none (observed: pull request #960 uses `[F4]` with no pass ordinal;
  pull request #966 numbers no finding at all). Requirements 3 and 11
  mandate both. Back-fill responsibility: none — the implementation for
  this spec SHALL add the obligation to the contract documents and to
  the reviewer sources for verdicts posted from then on, and SHALL NOT
  edit verdicts already posted; a ticket whose loop is already running
  when the contract lands resolves through requirement 16.

## Complexity and blast radius

The declared tier is `standard`. The change is a single coherent contract
that lands across three review surfaces and their four command-line
assistants, and its blast radius is enumerable in one plan — which is the
`standard` tier's shape per ADR-0010 → *Complexity tiers and team
sizing*. It is not `small`: the contract amends established protocol
documents, so the architect step is required rather than optional. It is
not `large`: no sub-spec decomposition is warranted, because the
requirements above do not divide into independently shippable tickets —
the seat line, the identifiers, and the bounded scope are worthless
apart.

The surfaces the implementation is expected to touch:

- `docs/retroactive-loop.md` — the `review`-surface seat, the REVIEW
  launch trigger, the class-tagging retag round-trip, the routing
  precedence carry-over, and the continuous-integration protocol
  violation, each of which currently says the reviewer is re-spawned
  cold.
- `docs/plan-review-protocol.md` — the second-`architect` review rule
  and the "re-reviewed cold" clause.
- `docs/agent-team-protocol.md` — the spec-reviewer obligation and the
  `pr-reviewer` rows of the three team templates.
- `artifacts/core/agents/pr-reviewer/AGENT.md` and
  `artifacts/core/skills/pr-reviewer/SKILL.md` — the cold-start contract
  wording, the verdict composition, and the finding identifiers.
- The `architect` and `spec-author` sources under `artifacts/core/`, for
  the `plan` and `specs` surfaces of the same contract.
- `AGENTS.md`, which restates the routing matrix in condensed form and
  is required to stay in lockstep.
- `docs/cli-matrix.md`, required whenever `artifacts/**` changes.
- The build outputs regenerated from `artifacts/` for the four
  command-line assistants.

## Rejected alternatives

**A surviving reviewer process.** The reading in which "the same
reviewer" means one agent process kept alive across the iterations, fed
new instructions each pass on a coordination bus. Rejected on parity
grounds. A CLI without a coordination bus reaches parity through
sequential agent instantiations that inherit no conversation context
(`docs/agent-team-protocol.md` → *On CLIs with no multi-agent
coordination surface*), so a process-survival contract would be
realisable on one command-line assistant and unrealisable on three,
which `AGENTS.md` → *What is CrewRig?* pillar 5 prohibits. The seat
reading delivers the property the ticket asks for — the reviewer that
raised a finding judges its remedy — without any process outliving a
pass.

**A new store for the dossier.** A file under version control, or a
memory-service record, holding each seat's prior verdicts. Rejected as
redundant and as a second source of truth: a verdict is already a
durable public artifact on the forge, the forge is already the one
surface every command-line assistant reaches identically
(`AGENTS.md` → *Forge Access*), and a parallel copy could disagree with
the verdict a human reads. The seat line of requirement 3 is what makes
the existing artifacts enumerable, at the cost of one line per verdict.

**Handing the seat its context in the brief.** Letting the orchestrator
paste the prior verdicts, or a summary of them, into the instantiation
brief. Rejected because it puts the orchestrator — which holds the
authoring session's context — in the position of paraphrasing the record,
which is exactly the channel the cold-start contract closes. References
only (requirement 8) keeps the reading of the record inside the reviewer.

**Deriving the prior-finding disposition inside the reviewer.** Letting
each pass infer, from commit messages and the incremental change, whether
its prior findings were addressed, and recording nothing. Rejected
because it leaves the audit of requirement 12 unfalsifiable: with no
stated disposition there is nothing a third party can check a pass
against, which is the property the `plan` surface's traceability audit
already earns for plans.
