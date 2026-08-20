# Reviewer seat

<!-- crewrig-doc: section=lifecycle nav_order=20 published=true title="Reviewer seat" -->

This document is the normative contract for the **reviewer seat**: the
mechanism that makes a reader following a ticket through its review
iterations see one continuous reviewer per review surface instead of a
succession of strangers. It operationalises
[`specs/0166-stable-reviewer-seat.md`](../specs/0166-stable-reviewer-seat.md)
and binds three review surfaces (`specs`, `plan`, `review`), two reviewer
roles (`pr-reviewer`, `architect`), and the orchestrator that instantiates
them.

**The contract lives here, once.** Every protocol document and every
reviewer source points at the section below that its own reader needs;
none paraphrases it. That is deliberate rather than tidy. Several
documents in this repository claimed that `AGENTS.md` → *Retroactive
review loop* held a condensed copy of the routing matrix; it never did,
and the claim had been copied from document to document until spec 0166's
implementation repointed every instance at the section that actually holds
the matrix. That is what duplicated normative prose does to a rule set of
this size. A future editor tempted to inline the rules below into the
documents that point here should read that sentence twice.

Worked examples use `gh` because GitHub is this project's forge; the
equivalent `glab` or `tea` invocation is the contract on a forge that is
not GitHub. Every obligation below is dischargeable with the forge's own
command-line tool and a self-contained instantiation brief, identically on
Claude Code, Gemini CLI, GitHub Copilot CLI, and Antigravity CLI. No
obligation depends on a message bus, a surviving process, a shared memory
service, or a primitive exclusive to one command-line assistant. Where a
coordination bus exists its use is a convenience and never a precondition.

## Seat identity

Every review pass in the lifecycle is attributed to exactly one
**reviewer seat**. A seat is keyed on the pair (the ticket's logbook issue
number, the review surface), where the surface is exactly one of:

| Surface | Artifact reviewed | Occupied by |
|---|---|---|
| `specs` | the spec pull request, and every delta-spec pull request of the same ticket | per `docs/agent-team-protocol.md` → *Spec-reviewer obligation* |
| `plan` | the plan comment on the logbook issue | per `docs/plan-review-protocol.md` → *Review rule* |
| `review` | the implementation pull request | per `docs/retroactive-loop.md` → *REVIEW launch trigger* |

A ticket holds at most one live seat per surface. Which role occupies
which surface is settled by the documents named in the third column and
is not this contract's to change.

A seat key is a single text token, `<surface>/<ticket>`, optionally
suffixed `#<generation>` when the seat has a predecessor (see *Retirement
and generation*). A key with no suffix denotes generation 1 — `review/970`
and `review/970#1` are the same seat.

**A seat is not a surviving agent process.** Each pass of a seat is a
freshly instantiated agent holding no session state from any earlier pass.
The seat's continuity rests entirely on durable artifacts the forge
already holds, which is why the seat line below is load-bearing rather
than decorative.

## The seat line, and where it goes

Every verdict a seat posts carries its seat key on a line of its own, in
the exact form:

```text
seat: <surface>/<ticket>[#<generation>]
```

The line is placed as the first line of the verdict body after the
verdict line. It is **purely additive**: each surface's existing
verdict-header conventions remain unchanged, and no convention is
relaxed to make room for it.

"After the verdict line" resolves differently per **verdict transport**,
so it is resolved once, here, rather than independently in each reviewer
source:

- **`plan` surface.** Immediately after the `### Verdict: …` line that
  [`docs/plan-format.md`](plan-format.md) → *Header conventions*
  mandates.
- **A pull-request surface posted as a formal review** (`gh pr review`,
  the distinct-identities rung of
  [`artifacts/core/skills/pr-reviewer/SKILL.md`](../artifacts/core/skills/pr-reviewer/SKILL.md)
  → *Post the review*). The review body carries no verdict line — the
  event itself is the verdict — so the seat line is the **first body
  line**.
- **A pull-request surface posted as a shared-identity plain comment**
  (`gh pr comment`, the same ladder's shared-identity rung). That body
  opens with `## Verdict: …`, so the seat line goes immediately after it.

## Seat dossier

A seat's dossier consists of exactly three kinds of content and nothing
else:

1. Every verdict that seat has posted on its surface, in order.
2. The identifier and the recorded disposition of every finding those
   verdicts raised.
3. The revision identifier of the artifact each of those verdicts
   examined — the head commit for a pull-request surface, the plan
   revision ordinal for the `plan` surface.

**The dossier is held only in artifacts the forge already carries** — the
seat's own verdict comments on the spec pull request, on the logbook
issue, or on the implementation pull request. No new file, no new store,
and no memory service is introduced to hold it.

That prohibition scopes to the **dossier**: the store of a seat's prior
verdicts, their findings, and their dispositions. This page holds no
dossier content — no verdict, no finding identifier, no disposition — so
it is not a store the prohibition bars. It states the rules a seat
follows; the record a seat accumulates stays on the forge.

### Reconstructing a dossier

The dossier is reconstructible from the forge alone. The seat line is
what makes the existing artifacts enumerable, so an orchestrator session
that did not spawn the earlier passes can still assemble the dossier:

```bash
# plan surface — verdicts are comments on the logbook issue
gh issue view <ticket> --json comments \
  --jq '[.comments[] | select(.body | test("(?m)^seat: "))]'

# pull-request surface — both transports must be enumerated
gh pr view <pr> --json comments
gh api repos/<owner>/<repo>/pulls/<pr>/reviews
```

**Enumerate both pull-request transports.** A verdict posted as a formal
review does not appear among a pull request's comments, and a verdict
posted as a shared-identity plain comment does not appear among its
reviews. A seat that queries only one of the two reads an empty dossier
on a solo-maintainer project and declares itself vacant for no reason —
see *Vacant seat*.

## Instantiating a seated pass

The brief that instantiates a seated pass carries **references only**:

- the seat key;
- the identifier of the artifact under review;
- the revision identifier the seat last examined;
- the location of the seat's prior verdicts;
- the location of the disposition record described under *Prior-finding
  disposition*.

It carries no diff, no summary, no assessment, no rationale, and no other
content that originates in the authoring session. A seated pass retrieves
every artifact it reads itself, from the forge's own command-line tool.

**The cold-start independence guarantee is unchanged**
([`artifacts/core/agents/pr-reviewer/AGENT.md`](../artifacts/core/agents/pr-reviewer/AGENT.md)
→ *Cold start contract*). A seated pass reading its own prior verdicts,
and reading the durable public record of the artifact under review, does
not count as authoring context: both are public artifacts a third party
can read. What the contract still closes is the channel through which the
orchestrator — which does hold the authoring session's context — could
paraphrase the record into the brief.

**A pass whose brief breaches the references-only rule is discarded.**
Its verdict is not consumed, it is not entered in the dossier, and it
does not increment the iteration counter. The orchestrator re-instantiates
the pass with a conforming brief.

## Prior-finding disposition

Before a seat's pass N+1 (for N ≥ 1), the disposition of every finding in
that seat's dossier is recorded durably — one line per finding
identifier — as exactly one of:

- `addressed`, naming the commit or revision that addressed it;
- `superseded`;
- `withdrawn`, with a stated reason.

The orchestrator makes that record on the artifact under review or in the
logbook journal entry for the iteration, and the instantiation brief names
its location.

**On the `plan` surface there is nothing new to write.** The revised
plan's existing finding traceability table
([`docs/plan-format.md`](plan-format.md) → *Optional sections*)
discharges this requirement, and no second record is required there.

## Finding identifiers

Every finding a seated pass emits carries a reviewer-minted identifier
that is unique and stable for the life of the seat and that names the pass
that raised it:

| Surface | Format | `<N>` is |
|---|---|---|
| `review` | `i<N>-F<M>` | the iteration ordinal the `iter:N` label carried when the pass ran |
| `specs` | `s<N>-F<M>` | the seat's pass ordinal, counted monotonically across every artifact of that surface |
| `plan` | `v<N>-F<M>` | unchanged — see below |

The `plan` surface keeps the `v<N>-F<M>` scheme
[`docs/plan-review-protocol.md`](plan-review-protocol.md) → *Reviewer-minted
identifiers* already mandates. This contract does not redefine it.

The `specs` ordinal counts passes, not artifacts: a ticket whose spec was
reviewed once and whose delta spec is then reviewed twice has emitted
`s1-*`, `s2-*` and `s3-*` from one seat across two pull requests. Those
pull requests are enumerable by a third party because
[`docs/logbook-issues.md`](logbook-issues.md) already requires the logbook
to record each stage artifact, and because the instantiation brief names
the locations of the prior verdicts — a seat never performs a forge-wide
search to find its own record.

## Prior-finding audit

From its second pass onward, a seated pass opens its verdict with a
**prior-finding audit** stating, per dossier finding identifier, whether
the pass accepts the recorded disposition. A prior finding the pass judges
unaddressed prevents an approving verdict on that pass.

The audit carries the same obligation
[`docs/plan-review-protocol.md`](plan-review-protocol.md) → *Prior-finding
traceability audit* already places on the `plan` surface; that section's
shape is not restated here.

## Bounded scope from the second pass

From its second pass onward on the same artifact, the mandatory reading of
a seated pass is bounded to:

1. the change to the artifact since the revision the seat last examined;
2. the disposition record described under *Prior-finding disposition*;
3. the continuous-integration state of the artifact's current head, which
   is **never waived** — the bound is a reading bound, not a licence to
   skip the preflight;
4. every surface the change in (1) reaches — a surface the change newly
   touches, a surface a prior finding's remedy touches, and a surface
   whose invariant the change depends on even when that surface's own text
   is unchanged.

A seated pass is not obliged to re-examine a surface unchanged since it
last examined that surface. **The bound removes re-examination only.** It
removes no item from the reviewer's checklist for the surfaces that are in
scope: a surface inside the bound is reviewed to the same standard as on a
first pass.

The bound attaches to an **artifact**, never to a seat. On the seat's
first pass, and on any pass of a fresh generation, nothing is bounded.

### A finding on an unchanged surface

A seated pass may raise a finding on a surface unchanged since it last
examined that surface, and then states which condition of (4) above
returned that surface to scope.

A finding on an unchanged surface that carries no such statement is
non-blocking and is routed to the deferred-findings ledger
([`docs/retroactive-loop.md`](retroactive-loop.md) → *Deferred-findings
ledger*); the iteration is not routed to an upstream stage on its account.

**How the orchestrator applies that disposition depends on the mode, and
no gate moves.** In INTERMEDIATE, MINIMAL and AUTO the orchestrator
applies the disposition directly, as
[`docs/retroactive-loop.md`](retroactive-loop.md) → *Non-blocking
conditional routing* already requires ("route every non-blocking finding
to the **ledger** by default. No user gate SHALL fire"). In FULL it is the
disposition the orchestrator **presents** in that same section's
per-finding triage; the user's `loop` / `ledger` / `dismiss` choice, and
*Termination* condition 4's treatment of a FULL-mode loop-routed finding,
are unchanged. Spec 0166 R20 forbids this contract from removing that
gate.

### A replaced artifact

When the artifact a seat reviews is replaced rather than revised — a fresh
delta-spec pull request on the `specs` surface — the seat examines the new
artifact **in full**, and its dossier still carries every prior finding
for the audit above. A replaced artifact resets the reading bound; it does
not reset the dossier.

## Vacant seat

A seat is **vacant** when its dossier cannot be reconstructed: its prior
verdicts are absent, they carry no seat line because the ticket predates
this contract, or the forge is unreachable.

A pass on a vacant seat runs as a full examination of the whole artifact,
and its verdict records the vacancy **and its cause**. A widened scope is
never silent — a reader must be able to tell a full examination that was
owed from one that happened because a query came back empty.

A ticket whose review loop is already running when this contract lands
resolves through this path. Verdicts already posted are not back-filled
with seat lines.

## Retirement and generation

The orchestrator may retire a seat and open a successor at the next
generation number, and records the retirement **and its cause** on the
logbook issue. The successor:

- inherits the retired seat's dossier for the prior-finding audit;
- examines the artifact in full on its first pass.

A retired seat posts no further verdict.

## Retagged verdicts

A verdict returned for retagging — malformed per
[`docs/retroactive-loop.md`](retroactive-loop.md) → *Class tagging
discipline* — is re-issued **from the same seat**. It opens no new dossier
entry, and its corrected form replaces the malformed one in the dossier.
The existing rule that a retag round-trip does not increment the
iteration counter is unchanged.

## What this contract does not change

The following are outside this contract by construction, and an edit here
that touched one of them would be a defect rather than an improvement:

- Every user gate, and the interaction-mode gating contract
  ([`docs/interaction-modes.md`](interaction-modes.md)).
- The iteration-counter primitive, the routing precedence, the
  termination conditions, and the max-iteration guardrail
  ([`docs/retroactive-loop.md`](retroactive-loop.md)).
- The per-tier PLAN-loop cap
  ([`docs/plan-review-protocol.md`](plan-review-protocol.md)).
- Which role occupies which review surface, and the composition of the
  teams that produce the artifact under review
  ([`docs/agent-team-protocol.md`](agent-team-protocol.md)).
- Reviewer memory that spans tickets. A seat is scoped to one ticket and
  one surface; nothing accumulates across tickets.

## Nothing mechanical observes this

There is no continuous-integration check for the seat line, the finding
identifiers, or the prior-finding audit, and none is planned here:
spec 0166 → *Out of scope* rules one out by name, mirroring the doc-only
posture of
[`specs/0005-retroactive-routing-engine.md`](../specs/0005-retroactive-routing-engine.md)
R1. A green pipeline says nothing about whether a pass emitted a seat
line, bounded its reading, or opened with an audit.

The consequence is worth stating plainly rather than discovering later:
the first live seated loops are the only detector this contract has, and a
scripted variant becomes a candidate follow-up once friction on real loops
justifies it.

## Cross-references

- Spec 0166 — [`specs/0166-stable-reviewer-seat.md`](../specs/0166-stable-reviewer-seat.md).
- Retroactive review loop — [`docs/retroactive-loop.md`](retroactive-loop.md).
- Plan review protocol — [`docs/plan-review-protocol.md`](plan-review-protocol.md) and plan format — [`docs/plan-format.md`](plan-format.md).
- Agent Team Protocol — [`docs/agent-team-protocol.md`](agent-team-protocol.md).
- Reviewer sources — [`artifacts/core/agents/pr-reviewer/AGENT.md`](../artifacts/core/agents/pr-reviewer/AGENT.md), [`artifacts/core/skills/pr-reviewer/SKILL.md`](../artifacts/core/skills/pr-reviewer/SKILL.md), [`artifacts/core/skills/architect/SKILL.md`](../artifacts/core/skills/architect/SKILL.md), [`artifacts/core/skills/spec-author/SKILL.md`](../artifacts/core/skills/spec-author/SKILL.md).
