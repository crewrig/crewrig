---
id: "0220"
slug: ci-wait-primitives
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 1261
version: 1.0.0
---

# CI-wait primitives — foreground verification before a pr-reviewer verdict

## Intent

When a `pr-reviewer` pass finds a required check still pending, the
reviewer that waits for it must end up trusting a wait signal that
actually reflects the check's live state. Today a reviewer may treat a
background task's or a live-monitor's "completed" signal as sufficient
grounds to post a verdict, even though that signal can misreport a
still-pending check as finished. After this change, a reviewer never
posts a CI-gated verdict off a background or live-monitor signal alone
— it always takes one direct, synchronous look at the check state
immediately before writing the verdict, so the verdict always reflects
what CI actually reports at that moment.

## Requirements

1. The `pr-reviewer` skill's CI preflight step SHALL state explicitly
   that a background-task or live-monitor completion signal is a hint,
   never sufficient grounds on its own to treat a pending required
   check as resolved.
2. The `pr-reviewer` skill SHALL name a synchronous, direct query as
   the required final check of a required check's state, to be run
   immediately before any verdict is posted whenever that check was
   ever observed pending during the same review pass.
3. The `pr-reviewer` skill SHALL offer a concrete foreground bounded
   wait primitive (a fixed-count retry loop with an inter-attempt
   delay, run synchronously in the reviewer's own turn) as the
   recommended mechanism for waiting on a pending required check,
   as an alternative to a background task or a live monitor.
4. The skill's guidance SHALL be file-scoped to the CI preflight
   section it amends — it MUST NOT alter the step's existing
   pass/fail/pending classification rules or verdict-blocking
   semantics for a failing or still-pending check.

## Scenarios

**Scenario:** required check reported pending, reviewer waits in the foreground

```text
Given a pr-reviewer pass at step 1 (CI preflight) observes one required
      check in the `pending` bucket
When  the reviewer waits for it using a foreground bounded retry loop
      (fixed attempt count, fixed inter-attempt delay, run synchronously)
Then  the loop's own exit reflects a direct query result, and the
      reviewer proceeds to compose the verdict only once that direct
      query itself reports the check out of `pending`
```

**Scenario:** a background or monitor signal reports completion

```text
Given a pr-reviewer pass delegated the wait to a background task or a
      live-monitor primitive, and that primitive reports the check
      complete
When  the reviewer is about to post its verdict
Then  the reviewer re-verifies with one direct, synchronous query of
      the check state before writing the verdict, and does not accept
      the background/monitor signal alone as sufficient grounds
```

## Out of scope

- Any change to the Monitor tool, `run_in_background`, or the RTK hook
  themselves — this spec addresses the reviewer's protocol, not the
  underlying primitives' implementation.
- Any change to the CI preflight step's pass/fail/pending
  classification rules, or to the verdict-blocking semantics for a
  failing or pending required check (`docs/plan-review-protocol.md`
  and the skill's existing step 1 govern those unchanged).
- Extending this guidance to skills other than `pr-reviewer`; the
  friction cluster's evidence is scoped to that skill and PR
  crewrig/crewrig#1209.

## Open questions

- None.
