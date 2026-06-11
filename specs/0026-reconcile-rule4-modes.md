---
id: "0026"
slug: reconcile-rule4-modes
status: draft
complexity: standard
interaction-mode: AUTO
related-issue: 281
version: 1.0.0
---

# Reconcile review-finding handling with the interaction modes

## Intent

When a reviewer posts findings during the REVIEW loop, what happens next
depends on the ticket's interaction mode. In the fully interactive mode a
user still decides, finding by finding, what to fix, skip, or defer; in
every more autonomous mode the team fixes every finding in the same
session without pausing for the user, and the only place the user is
asked anything remains the merge authorization. A reader of the team
protocol finds one rule that names this mode dependency explicitly,
instead of a single rule that reads as if the user is always consulted.

## Requirements

1. The team protocol SHALL make the handling of reviewer findings
   conditional on the ticket's declared interaction mode.
2. In the fully interactive mode, the team protocol SHALL require that
   every finding — blocking and non-blocking — is presented to the user
   for a fix, skip, or defer decision before the fix cycle proceeds.
3. In every non-fully-interactive mode, the team protocol SHALL require
   that every finding — blocking and non-blocking — is routed into the
   fix cycle automatically, in the same session, with no user gate other
   than the merge authorization.
4. The team protocol SHALL preserve the existing meaning of the
   non-blocking label as "the pull request may merge without this," and
   SHALL forbid silently deferring any finding to a follow-up ticket
   without authorization appropriate to the mode.
5. The reconciled rule SHALL remain consistent with the user-gate
   definition of the lifecycle, under which only the interactive question
   and the merge authorization block execution; presentation that does
   not block SHALL NOT be counted as a user gate.

## Scenarios

**Scenario:** Autonomous mode auto-routes findings

```text
Given a ticket runs in a non-fully-interactive mode and a reviewer posts
      blocking and non-blocking findings
When  the team-lead processes the review verdict
Then  every finding is assigned into the fix cycle in the same session
      without asking the user, and the user is asked only at the merge gate
```

**Scenario:** Fully interactive mode consults the user

```text
Given a ticket runs in the fully interactive mode and a reviewer posts
      blocking and non-blocking findings
When  the team-lead processes the review verdict
Then  every finding is presented to the user, who decides per finding
      whether to fix, skip, or defer before the fix cycle proceeds
```

**Scenario:** No finding is silently dropped

```text
Given a reviewer marks a finding non-blocking in any mode
When  the team-lead processes the review verdict
Then  the finding is either implemented in-session or deferred only with
      authorization appropriate to the mode, never dropped silently
```

## Out of scope

- Any change to the interaction-mode definitions themselves or to the
  user-gate definition; this spec aligns finding handling with those
  contracts, it does not amend them.
- Any change to the merge-authorization gate, which remains invariant
  across every mode.
- The routing-class taxonomy (`tech` / `arch` / `spec`) and the
  retroactive review loop mechanics, which are untouched.

## Open questions

- None.
