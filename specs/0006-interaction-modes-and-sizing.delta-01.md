---
id: "0006"
slug: interaction-modes-and-sizing
status: draft
complexity: standard
interaction-mode: AUTO
related-issue: 288
version: 2.0.0
---

# Interaction modes and complexity-based team sizing

## ADDED

The reconciliation chosen for issue #288 (Option Z) pins the REVIEW-stage
user-gate contract that was previously left implicit in the `AGENTS.md`
matrix and contradicted by spec 0005 R10. This delta adds that contract as
a normative requirement so the gate semantics are owned by this spec — the
interaction-mode authority — rather than asserted only in operational doc.

```text
10. The REVIEW-stage user-gate contract SHALL be: in FULL mode the
    orchestrator SHALL fire a bounded AskUserQuestion to triage the
    non-blocking findings of a REVIEW pass (per spec 0005 R10, FULL
    branch), in addition to the per-iteration non-blocking notification;
    in INTERMEDIATE, MINIMAL, and AUTO modes the REVIEW loop SHALL fire
    no user gate. The AGENTS.md (mode x stage) matrix SHALL reflect this
    contract in its REVIEW row, and the bounded FULL triage
    AskUserQuestion SHALL be the sole exception to the prior "REVIEW
    fires no AskUserQuestion" reading of the FULL cell.
```

## MODIFIED

(none)

## REMOVED

(none)
