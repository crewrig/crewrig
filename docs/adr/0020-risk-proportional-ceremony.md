# ADR 0020 — Risk-proportional lifecycle ceremony

<!-- crewrig-doc: section=architecture-adr nav_order=200 published=true title="ADR 0020 — Risk-proportional lifecycle ceremony" -->

**Status:** Proposed (issue #1733, epic #1724 WP6). Amends
[ADR-0010](0010-spec-plan-review-lifecycle.md).

## Context

- Goal: the number of agent passes matches the risk of the change (epic #1724, WP6).
- Constraints: no option may weaken the epic's §4.1 invariants: (1) a cold independent reviewer on every PR, (2) every deterministic control that exists today, (3) a spec for every change to a public or shared contract, (4) the user's explicit approval right before any merge, (5) multi-CLI parity. A quality regression always wins over a token saving (§4.4).
- Non-goals: changing the four lifecycle stages, the interaction modes, or any reviewer checklist item.

ADR-0010 prices every ticket with the same ceremony shape and bounds it only
through the tier table (`docs/adr/0010-spec-plan-review-lifecycle.md` →
*Complexity tiers and team sizing*). WP6 lists seven candidate relaxations,
a to g. This ADR decides which are worth a child spec; it does not implement
any of them.

## Decision

Each option gets a verdict: **ADOPT** (own child spec), **DEFER** (revisit
after data), or **REJECT**. Line references were re-verified on this branch
after WP4/WP5 shifted them.

| Option | Verdict |
|---|---|
| d. Pre-spawn seat-brief linter | ADOPT (ship first) |
| b. Drop the second cold architect at standard tier | ADOPT (ship second) |
| g. Relax the solo-work prohibition at small tier | DEFER |
| f. Cap total PLAN iterations instead of resetting | DEFER |
| a. One PR for spec and implementation | DEFER |
| c. Terminate on zero blocking findings | REJECT (already the mechanism; wording fix only) |
| e. Tier de-escalation | REJECT |

### d. Pre-spawn brief linter — ADOPT

- Today: a seated-pass brief that carries authoring context is discarded after the fact, its verdict voided on the forge (`docs/reviewer-seat.md` → *Instantiating a seated pass*, "A pass whose brief breaches the references-only rule is discarded", and *What counts as a dossier entry*). The same file admits *Nothing mechanical observes this*. The WP6 line range `:233-251` is now `:296-330`.
- Change: a new `scripts/check-seat-brief.ts` validates the brief before the spawn. The rule is unchanged, only the enforcement moves from prose plus a wasted pass to a script.
- Trade-off: a linter can only check form (allowed reference kinds, no free-text diff or summary), not intent. It reduces voided passes but cannot prove a brief is semantically clean.
- Rejected alternatives: keep after-the-fact voiding only (pays a full pass per breach); let the pass itself refuse a dirty brief (the pass has already loaded the context it must not see).
- Invariants: strengthens 4.1.1 and 4.1.2 (adds a deterministic control, removes none). Matches the epic's §3 principle (prose to script). The linter must ship symmetrically for all four CLIs (4.1.5).

### b. No mandatory second cold architect at standard tier — ADOPT

- Today: `docs/plan-review-protocol.md:12` requires a second `architect`, spawned cold, for every plan. The PLAN-revision cap is 2 at standard and 1 at small (ADR-0010 tier table).
- Change: standard-tier plans keep the cold plan review only when the plan touches more than N components (N is a child-spec decision; assumption — verify, 3 is a starting candidate) or when the spec touches a shared contract. The child spec MUST make both tests deterministic: N counted by a script from the plan's declared component list, and "shared contract" decided by a path-based manifest, not by author judgement. Large tier keeps it unconditionally.
- Trade-off: an architecture defect can reach DEV. The backstop is real: REVIEW `arch` findings route back to PLAN (`docs/retroactive-loop.md` → loop targets), and the cold `pr-reviewer` on every PR is untouched.
- Rejected alternatives: drop it at all tiers (large work is exactly where design defects are costly); replace it with a self-review checklist (not independent).
- Invariants: 4.1.1 is about the PR reviewer, not the plan reviewer, so it holds. Q2 and Q3 must show it.

### g. Relax the solo-work prohibition at small tier — DEFER

- Today: `AGENTS.md` → *Agent Team Protocol* forbids inline solo work, and `docs/agent-team-protocol/orchestrator.md` → *Solo work prohibition* forces a team for any issue-anchored work. The small tier already is `developer` + `pr-logbook` + `pr-reviewer` (ADR-0010 tier table).
- Change would be: one author plus one cold review seat.
- Why defer: the saving is the `pr-logbook` and `developer` subagent spawns, which E4 does not yet price separately, and the rule is also the project's guard against the orchestrator's context being used to author what it then coordinates. Revisit only if post-(b) E4 data shows small-tier cost still dominated by team overhead.
- Rejected alternative: allow solo at small tier without a reviewer (breaks 4.1.1).
- Invariants: holds if the cold seat stays; the risk is process, not the invariants.

### f. Cap total PLAN iterations, stop resetting on delta-specs — DEFER

- Today: an approved delta-spec resets the PLAN-revision counter to zero (`docs/plan-review-protocol.md:117-121`; the WP6 range `:109-113` is shifted). The cap counts only verdicts that send a plan back (`:110-115`).
- Change: cap total PLAN iterations per ticket.
- Trade-off: bounds pathological loops, but a halt pages the user in every mode, so a tighter cap trades tokens for user interrupts. A delta-spec that resolves a real spec defect legitimately needs a fresh plan.
- Why defer: there is no measured evidence that delta-spec loops are a material cost. Q4 (delta-specs caused by a spec defect) must be baselined first.
- Rejected alternative: lower the per-tier caps (changes the single source of truth in ADR-0010 without data).

### a. One PR for spec and implementation — DEFER

- Today: the spec ships alone as a spec-PR, one new file under `/specs/`, merged before the implementation branch is cut (`docs/spec-pr-workflow.md` → *One-file rule*, *Ordering rule*).
- Change: at small and standard tier, the spec is the first commit of the implementation PR and the specs seat reviews it before any implementation commit is pushed. The separate spec-PR stays mandatory at large tier and for any public or shared contract (4.1.3).
- Trade-off: saves one PR cycle, but the one-file rule and ordering rule are deterministic controls today; relaxing them removes a check, which 4.1.2 forbids unless a script replaces it. The named risk (spec rewritten to fit the code) needs a mechanical guard, not a reviewer promise: a script asserting the spec commit is unchanged after approval, or that each later change carries its own approval.
- Why defer: it has the largest blast radius (branch-prefix and spec-linter rules, `docs/spec-pr-workflow.md`), and its guard script is a sibling of (d). Take it only after (d) proves the pre-flight-script pattern.
- Rejected alternative: merge spec and implementation without a spec-commit immutability check.

### c. Terminate on zero blocking findings — REJECT

- Today: termination already requires every non-blocking finding to be disposed as ledger or dismiss, with auto-ledger outside FULL (`docs/retroactive-loop.md` → *Termination*, condition 4; findings ledger described near the top of the same file). The `deferred-findings-ledger` issue already exists.
- Verdict: non-blocking findings already do not loop outside FULL; adopting (c) as written would only remove the FULL-mode user triage, which spec 0166 R20 keeps on purpose. The residual is wording, in two places: `AGENTS.md` and `docs/retroactive-loop.md` (line 28) both say the loop ends only when a pass "produces zero findings", which misreads the rule. Fix the sentence in a documentation-only change, not a child spec.
- Rejected alternative: terminate on APPROVE alone (leaves non-blocking findings undisposed, which is the debt this option feared).

### e. Tier de-escalation — REJECT

- Today: ADR-0010 → *Complexity tiers and team sizing*, normative rule 3 prohibits it mid-lifecycle, on the grounds that the larger team's cost is sunk. The WP6 line `:285` still matches.
- Verdict: reject. Allowing a logged rationale makes the tier a negotiable dial at the exact moment the pressure to save tokens is highest, and it weakens rule 1 (tier defendable from the spec). The saving is also small, since the cost it targets is already spent. The better lever is correct tier assignment at SPECS, validated by the spec reviewer.
- Rejected alternative: allow it only with user approval (adds a gate to save a sunk cost).

## Shipping order, measurement, rollback

Per epic §4.4: one option per PR, never bundled; 3 reference tickets recorded
before; 2 to 3 comparable tickets after; **revert if Q1, Q2 or Q3 degrades on
2 of 3 comparable tickets**.

| Order | Option | Watch | Option-specific rollback trigger (on top of §4.4) |
|---|---|---|---|
| 1 | d | E4 (fewer voided passes), Q2 | Any rejected-but-legitimate brief blocks a pass more than once per ticket |
| 2 | b | E4, Q2, Q3, Q4 | An `arch` finding at REVIEW on a standard ticket that skipped plan review (counts toward Q2) |
| 3 | g | E2, E3, E4, Q2 | Q2 rises on 2 of 3 small tickets |
| 4 | f | Q4, E4 | More user escalations than the tickets it saves tokens on |
| 5 | a | E4, Q2, Q4 | Any spec rewritten after approval without its own approval (script must catch it) |

Indicators: Q1 post-merge regressions, Q2 blocking findings at REVIEW, Q3
defects escaping REVIEW, Q4 base-spec delta-specs; E1 always-loaded bytes, E2
subagent first-request context, E3 subagent growth, E4 tokens per ticket by
tier (definitions in epic #1724 §4.2 and §4.3). Each adopted option needs its
own child spec and a keep/rollback entry in issue #1733.

## Consequences

- Only d and b are committed; g, f and a depend on data from d and b.
- ADR-0010 receives an *Amended by ADR-0020* note in its status line, carrying no body edit. The repo has no existing "amended by" convention for ADRs (only `superseded-by` lifecycle metadata for specs), so the note uses the same parenthetical form as the other status lines.
- The `:12`, `:233-251`, `:109-113` citations in WP6 are stale; the child specs must cite the current locations given above.
- 4.1 invariants are unchanged under every verdict.
