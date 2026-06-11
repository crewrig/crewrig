---
id: "0005"
slug: retroactive-routing-engine
status: draft
complexity: standard
interaction-mode: AUTO
related-issue: 288
version: 2.0.0
---

# Automatic retroactive routing engine

## ADDED

(none)

## MODIFIED

Requirement 10 is replaced. The original placed **INTERMEDIATE** on the
"present non-blocking findings to the user" branch alongside FULL, which
conflicts with the `AGENTS.md` `(mode × stage)` matrix (spec 0006), where
the INTERMEDIATE REVIEW cell is autonomous. The canonical model chosen for
issue #288 is **Option Z**: only FULL consults the user on non-blocking
findings; INTERMEDIATE joins MINIMAL and AUTO on the auto-route branch.

Original R10:

```text
10. Non-blocking findings SHALL be routed conditionally by mode:
    - FULL / INTERMEDIATE — the orchestrator SHALL present every
      non-blocking finding to the user (Rule 4) and route only those
      the user accepts to the loop; the rest are journalled in the
      logbook and left unactioned.
    - MINIMAL / AUTO — the orchestrator SHALL route every non-blocking
      finding into the loop using the same matrix; in autonomous modes
      there is no user to defer to, so non-blocking findings become
      blocking by default.
```

Replacement R10:

```text
10. Non-blocking findings SHALL be routed conditionally by mode:
    - FULL — the orchestrator SHALL present every non-blocking finding
      to the user (Rule 4) and route only those the user accepts to the
      loop; the rest are journalled in the logbook and left unactioned.
    - INTERMEDIATE / MINIMAL / AUTO — the orchestrator SHALL route every
      non-blocking finding into the loop using the same matrix as
      blocking findings; in these modes the REVIEW loop fires no user
      gate, so non-blocking findings become blocking by default.
```

## REMOVED

(none)
