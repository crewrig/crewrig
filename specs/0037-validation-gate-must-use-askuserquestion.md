---
id: "0037"
slug: validation-gate-must-use-askuserquestion
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 318
version: 1.0.0
---

# Validation gate must use AskUserQuestion, never prose

## Intent

`AGENTS.md` already defines a user gate narrowly as an `AskUserQuestion` call
or a pre-merge authorization request. It does not explicitly prohibit prose
questions as a substitute. This gap lets the host text-output bias toward prose
communication silently override the gate contract. Adding an explicit prose-gate
prohibition to the `User-gate definition` section closes the gap so that
orchestrators in INTERMEDIATE and FULL mode cannot mistake a prose question for
a valid gate.

## Requirements

1. `AGENTS.md` → *Interaction modes → User-gate definition* SHALL gain an
   explicit negative constraint immediately after the enumeration of the two
   valid gate forms: **"A prose question or status message directed at the user
   is NOT a gate, even when it ends with a `?`. The host CLI's text-output
   guidance biases toward prose communication; that bias does not override
   this contract. Every INTERMEDIATE or FULL mode gate MUST be realised as an
   `AskUserQuestion` call — never as a prose question."**
2. The prohibition SHALL be phrased as a SHALL NOT rule so that the
   retroactive review loop can classify any violation as a `class: tech`
   finding in REVIEW.
3. The existing enumeration of non-gate outputs (logbook comments, progress
   messages, etc.) SHALL be preserved without change.
4. No other section of `AGENTS.md` is modified by this spec.

## Scenarios

**Scenario:** Orchestrator uses AskUserQuestion for a FULL-mode PLAN gate.

Given the lifecycle is running in FULL mode  
And the PLAN stage is ready to gate  
When the orchestrator fires the gate  
Then it calls `AskUserQuestion` with Approve / Request changes options  
And it does NOT post a prose question like "Shall I proceed with this plan?"

**Scenario:** Reviewer flags prose gate as a tech finding.

Given the lifecycle is running in INTERMEDIATE mode  
And the orchestrator posted a prose question "Does this plan look good?" instead
of calling `AskUserQuestion`  
When the retroactive review loop audits the PR  
Then the reviewer flags a `class: tech` finding citing spec 0037 R1  
And the loop routes back to DEV for the orchestrator guidance to be fixed

## Out of scope

- Modifying gate definitions in individual skill files (`spec-author/SKILL.md`,
  `pr-reviewer/AGENT.md`, etc.) — those already implement the gate via
  `AskUserQuestion` where applicable; this spec targets the AGENTS.md contract.
- Changing the gate forms themselves — the two valid forms (AskUserQuestion,
  pre-merge authorization) remain unchanged.
- AUTO mode — AUTO has no SPECS or PLAN gates; only the pre-merge gate
  applies (invariant across modes and already enforced).

## Open questions

- None. The fix surface (a single negative-constraint sentence in the
  `User-gate definition` section of `AGENTS.md`) is unambiguous.
