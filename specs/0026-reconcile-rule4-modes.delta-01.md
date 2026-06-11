---
id: "0026"
slug: reconcile-rule4-modes
status: draft
complexity: standard
interaction-mode: AUTO
related-issue: 281
version: 2.0.0
---

# Reconcile review-finding handling with the interaction modes

## ADDED

(none)

## MODIFIED

Requirement 2 is replaced. The original required the fully interactive
mode to gate the fix cycle on a per-finding user decision, which
contradicts the authoritative `(mode × stage)` matrix in `AGENTS.md`:
the REVIEW loop fires no user gate in any mode, and FULL only posts a
non-blocking notification.

- Original R2:

  > In the fully interactive mode, the team protocol SHALL require that
  > every finding — blocking and non-blocking — is presented to the user
  > for a fix, skip, or defer decision before the fix cycle proceeds.

- Replacement R2:

  > In every interaction mode, the team protocol SHALL require that every
  > finding — blocking and non-blocking — is routed into the fix cycle
  > automatically, in the same session, with no user gate other than the
  > merge authorization. The REVIEW loop SHALL NOT fire an interactive
  > per-finding fix, skip, or defer prompt in any mode.

Requirement 3 is replaced. FULL mode no longer differs by consulting the
user; it differs only by emitting a non-blocking notification.

- Original R3:

  > In every non-fully-interactive mode, the team protocol SHALL require
  > that every finding — blocking and non-blocking — is routed into the
  > fix cycle automatically, in the same session, with no user gate other
  > than the merge authorization.

- Replacement R3:

  > In FULL mode, the team protocol SHALL additionally require a
  > non-blocking notification of the findings at the REVIEW iteration
  > boundary; this notification SHALL NOT block the fix cycle and SHALL
  > NOT be counted as a user gate.

The `Fully interactive mode consults the user` scenario is replaced,
since FULL no longer consults the user inside the REVIEW loop.

Original scenario:

```text
**Scenario:** Fully interactive mode consults the user

Given a ticket runs in the fully interactive mode and a reviewer posts
      blocking and non-blocking findings
When  the team-lead processes the review verdict
Then  every finding is presented to the user, who decides per finding
      whether to fix, skip, or defer before the fix cycle proceeds
```

Replacement scenario:

```text
**Scenario:** Fully interactive mode notifies without gating

Given a ticket runs in FULL mode and a reviewer posts blocking and
      non-blocking findings
When  the team-lead processes the review verdict
Then  every finding is routed into the fix cycle automatically and a
      non-blocking notification is posted at the iteration boundary;
      no interactive per-finding prompt is fired
```

## REMOVED

(none)
