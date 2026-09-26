---
id: "0223"
slug: verdict-header-transport-aware
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 1271
version: 1.0.0
---

# Transport-aware verdict recognition in the REVIEW-stage termination check

## Intent

A reader of `docs/retroactive-loop.md` → *Termination* consulting condition
1 to decide whether a REVIEW pass on an implementation pull request has
approved it sees a rule that actually matches how an approval can be
posted on that pass — a formal GitHub review event, a shared-identity
plain pull-request comment, or a verdict recorded on the logbook issue —
instead of a rule that names a heading level borrowed from a different
review surface's convention and silently fails to recognize the two
transports that carry no such heading at all.

## Requirements

1. Termination condition 1 in `docs/retroactive-loop.md` → *Termination*
   SHALL state that, for the `review` surface (the implementation
   pull-request REVIEW pass that this termination check governs), APPROVE
   is recognized through exactly one of the three transports of the
   posting-identity fallback ladder defined in
   `artifacts/core/skills/pr-reviewer/SKILL.md` → *Post the review*, with
   the seat-line placement each transport carries as defined in
   `docs/reviewer-seat.md` → *The seat line, and where it goes*:
   - a formal review posted via `gh pr review <number> --approve`
     (distinct-identities rung) — the APPROVE review event itself SHALL
     be treated as the verdict; no verdict text line is present or
     required;
   - a plain pull-request comment (`gh pr comment`, shared-identity
     rung) whose body opens with a `## Verdict: APPROVE` line
     (level-2 heading);
   - a verdict recorded on the logbook issue (posting-denied rung)
     whose body opens with a `## Verdict: APPROVE` line (level-2
     heading).
2. The revised condition 1 text SHALL NOT name, describe, or otherwise
   depend on the `plan` surface's `### Verdict: APPROVE` (level-3
   heading) convention defined in `docs/plan-format.md` → *Header
   conventions*. Condition 1 governs only the REVIEW-stage pass that
   ends the lifecycle at MERGE on the `review` surface; the `plan`
   surface's convention is already correctly documented independently
   and is not evaluated by this termination check.
3. The revised condition 1 text SHALL NOT accept a `### Verdict: APPROVE`
   line (level-3 heading), or a verdict header match at any arbitrary
   heading level, as satisfying condition 1 on the `review` surface. The
   `review` surface's transports are fully enumerated by requirement 1
   above; a level-3 heading appearing in a `review`-surface verdict
   signals the `plan` surface's convention misapplied to the wrong
   surface, not a legitimate alternate form of the same verdict.
4. Termination conditions 2, 3, and 4 in `docs/retroactive-loop.md` →
   *Termination* SHALL remain unchanged in wording, numbering, and
   position.
5. The implementation of this spec SHALL modify only Termination
   condition 1 in `docs/retroactive-loop.md`. No other section of that
   file, and no other file in the repository, SHALL be modified.

## Scenarios

**Scenario:** Formal review APPROVE event satisfies condition 1

Given a REVIEW-stage pass on an implementation pull request posts a
formal review via `gh pr review <number> --approve` (the distinct
posting-identity rung)
When the orchestrator evaluates Termination condition 1 for that pass
per the revised `docs/retroactive-loop.md` text
Then the orchestrator SHALL treat condition 1 as satisfied by the
APPROVE review event alone, with no verdict text line expected or
required.

**Scenario:** Shared-identity plain comment with a level-2 verdict header satisfies condition 1

Given a REVIEW-stage pass posts a plain pull-request comment (the
shared-identity rung, solo-maintainer case) whose body opens with
`## Verdict: APPROVE`
When the orchestrator evaluates Termination condition 1 for that pass
Then the orchestrator SHALL treat condition 1 as satisfied by the
level-2 `## Verdict: APPROVE` line.

**Scenario:** Logbook-recorded verdict with a level-2 verdict header satisfies condition 1

Given a REVIEW-stage pass has its verdict recorded on the logbook issue
(the posting-denied rung) whose body opens with `## Verdict: APPROVE`
When the orchestrator evaluates Termination condition 1 for that pass
Then the orchestrator SHALL treat condition 1 as satisfied by the
level-2 `## Verdict: APPROVE` line, exactly as for the shared-identity
rung.

**Scenario:** A level-3 verdict header on the review surface does not satisfy condition 1

Given a REVIEW-stage plain pull-request comment body opens with
`### Verdict: APPROVE` (the `plan` surface's level-3 convention,
misapplied to the `review` surface)
When the orchestrator evaluates Termination condition 1 for that pass
Then the orchestrator SHALL NOT treat condition 1 as satisfied, because
the `review` surface's transports (per requirement 1) require either
the APPROVE review event or a level-2 `## Verdict: APPROVE` line, and a
level-3 heading is not among them.

## Out of scope

- Any change to `docs/plan-format.md` or to the `plan` surface's
  `### Verdict: APPROVE` convention — that convention is already
  correct and is not governed by this termination check.
- Any change to Termination conditions 2, 3, or 4 in
  `docs/retroactive-loop.md`.
- Any change to the malformed- or untagged-finding handling protocol in
  `docs/retroactive-loop.md` → *Class tagging discipline*.
- Any change to `artifacts/core/skills/pr-reviewer/SKILL.md` or
  `docs/reviewer-seat.md` — both already document the correct,
  transport-aware contract this spec brings condition 1 into alignment
  with.
- Implementing an automated or scripted termination-check engine — the
  retroactive review loop remains a documented procedure the
  orchestrator follows by hand, per `docs/retroactive-loop.md` →
  *Doc-only engine*.
- Any change to the seat-line placement rules already defined in
  `docs/reviewer-seat.md` → *The seat line, and where it goes*.

## Open questions

None.
