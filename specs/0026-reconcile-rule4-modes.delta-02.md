---
id: "0026"
slug: reconcile-rule4-modes
status: draft
complexity: standard
interaction-mode: AUTO
related-issue: 281
version: 3.0.0
---

# Reconcile review-finding handling with the interaction modes

## ADDED

(none)

## MODIFIED

Delta-01 set R2/R3 to "auto-route in every mode; FULL only notifies",
which contradicts the deliberate design of **spec 0005 R10** (non-blocking
findings: FULL / INTERMEDIATE present to the user, MINIMAL / AUTO
auto-route) that `docs/retroactive-loop.md` already implements. This
delta re-aligns R2/R3 to spec 0005 R10.

Requirement 2 is replaced.

- Current R2 (from delta-01):

  > In every interaction mode, the team protocol SHALL require that every
  > finding — blocking and non-blocking — is routed into the fix cycle
  > automatically, in the same session, with no user gate other than the
  > merge authorization. The REVIEW loop SHALL NOT fire an interactive
  > per-finding fix, skip, or defer prompt in any mode.

- Replacement R2:

  > Review-finding handling SHALL be conditional on the ticket's
  > interaction mode and SHALL match spec 0005 R10. In FULL and
  > INTERMEDIATE modes, blocking findings SHALL be routed into the fix
  > cycle automatically, and every non-blocking finding SHALL be presented
  > to the user, with only the findings the user accepts routed into the
  > fix cycle and the rest journalled in the logbook.

Requirement 3 is replaced.

- Current R3 (from delta-01):

  > In FULL mode, the team protocol SHALL additionally require a
  > non-blocking notification of the findings at the REVIEW iteration
  > boundary; this notification SHALL NOT block the fix cycle and SHALL
  > NOT be counted as a user gate.

- Replacement R3:

  > In MINIMAL and AUTO modes, the team protocol SHALL require that every
  > finding — blocking and non-blocking — is routed into the fix cycle
  > automatically, in the same session, with no user gate other than the
  > merge authorization; non-blocking findings become blocking by default.

The `Fully interactive mode notifies without gating` scenario (from
delta-01) is replaced, since FULL and INTERMEDIATE do consult the user on
non-blocking findings per spec 0005 R10.

Current scenario (from delta-01):

```text
**Scenario:** Fully interactive mode notifies without gating

Given a ticket runs in FULL mode and a reviewer posts blocking and
      non-blocking findings
When  the team-lead processes the review verdict
Then  every finding is routed into the fix cycle automatically and a
      non-blocking notification is posted at the iteration boundary;
      no interactive per-finding prompt is fired
```

Replacement scenario:

```text
**Scenario:** Interactive modes consult the user on non-blocking findings

Given a ticket runs in FULL or INTERMEDIATE mode and a reviewer posts
      blocking and non-blocking findings
When  the team-lead processes the review verdict
Then  blocking findings are routed into the fix cycle automatically, every
      non-blocking finding is presented to the user, and only the ones the
      user accepts are routed; the rest are journalled and left unactioned
```

## REMOVED

(none)
