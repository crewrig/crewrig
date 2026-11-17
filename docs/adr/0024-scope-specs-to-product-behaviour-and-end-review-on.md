# ADR-0024: Scope specs to product behaviour and end review on blocking findings

<!-- crewrig-doc: section=architecture-adr nav_order=240 published=true title="ADR 0024 — Scope specs to product behaviour and end review on blocking findings" -->

## Status

Proposed

Amends [ADR-0010](0010-spec-plan-review-lifecycle.md) (*Stage definitions* and *REVIEW loop termination*). Issues #1962 and #1964, parent #1930.

## Context

Wave 3 of #1856 produced 10 spec-PRs (specs 0300-0304, 6 deltas) for 5 implementation PRs; several deltas only reworded eval cases a spec had frozen. Its implementation PRs needed 7, 3, 4 and 5 review passes because the loop ended only on a pass with zero findings, non-blocking ones included. #1930 measured the same pattern on bugs: tickets with a spec-PR cost about 5x more tokens and wall-clock time, and a one-skill change consumed most of a contributor's budget.

## Decision

**1. Spec scope follows the change type.** A spec describes how the product behaves for its users and adopters, and the contracts shared between components; implementation detail lives in the issue and the PR.

- A spec is **required** only when a change alters behaviour observable by a CrewRig user or adopter (install, setup, CLI-facing behaviour, deployed surfaces), or a contract shared across components or CLIs (script CLI contract, frontmatter/emitter format, `metadata.tools` vocabulary, eval-gate rule, the lifecycle itself).
- A spec is **not required** for the content of a skill, agent or command; an agent's model or tools within the existing vocabulary; skill-bundled scripts implementing an existing contract; `evals/evals.json` cases; bug fixes restoring documented behaviour. For these the issue checklist is the contract and the plan goes in the PR body.
- The SPECS stage and the spec-PR are skipped for the no-spec kind; PLAN, DEV and REVIEW still run.

**2. REVIEW ends on no blocking finding.** The loop terminates when a pass reports APPROVE with no blocking finding and CI is green on the reviewed head. Non-blocking findings go to the findings ledger (#961) or a follow-up issue and never trigger a pass on their own. The pass cap is 2 at `trivial` and `small`, 3 at `standard`; beyond the cap the coordinator decides (merge with ledger entries, or escalate). A fix pass is scoped to the change since the last reviewed revision, as `docs/reviewer-seat.md` already requires.

## Consequences

- Positive: component changes ship as one PR; review cost is bounded; contributors can change one skill cheaply.
- Negative: a non-blocking defect can merge and wait in the ledger; the spec-or-not call is a judgement the reviewer must check.
- Neutral: the max-iteration guardrail of 5 stays as the outer bound; the `tech`/`arch`/`spec` routing matrix is unchanged.

## Alternatives rejected

- **Keep the two-PR rule with a light lane for component changes.** Still pays a spec-PR CI run, review seat and serialized merge for text that restates the issue.
- **Put the spec inside the implementation PR.** Removes the serialized merge but keeps the artifact and its review pass, and mixes WHAT and HOW in one diff, which the one-file rule exists to prevent.
- **Keep zero-finding termination with a lower cap.** Caps cost but still forces fixes of non-blocking findings or an arbitrary halt.
