---
id: "0038"
slug: review-loop-immediate-launch
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 315
version: 1.0.0
---

# REVIEW loop must launch immediately after PR creation without prompting the user

## Intent

`docs/retroactive-loop.md` documents the REVIEW loop mechanics (routing,
iteration, termination) but does not state WHEN the first iteration begins.
This gap lets orchestrators pause after PR creation and wait for a user
prompt — a mode violation in INTERMEDIATE, MINIMAL, and AUTO, where the REVIEW
loop is autonomous. Adding an explicit launch-trigger rule to
`retroactive-loop.md` closes the gap.

## Requirements

1. `docs/retroactive-loop.md` SHALL gain a **REVIEW launch trigger** section
   stating that the orchestrator SHALL spawn the cold-start `pr-reviewer`
   **immediately** after the implementation PR is created, without prompting
   the user first.
2. The launch trigger SHALL be mode-conditional:
   - **INTERMEDIATE, MINIMAL, AUTO:** spawn immediately — no user prompt, no
     wait, no acknowledgement requested.
   - **FULL:** post the non-blocking start-of-iteration notification on the
     logbook issue (per the FULL-mode rule in `AGENTS.md`), then spawn the
     reviewer. The notification does NOT block spawning.
3. The section SHALL explicitly state that pausing after PR creation and
   waiting for user input before spawning the reviewer is a process violation
   in INTERMEDIATE, MINIMAL, and AUTO modes.
4. The implementation PR number SHALL be recorded in the `iter:1` label on
   the PR before spawning (per the existing iteration-counter rule in
   `retroactive-loop.md`).
5. No other section of `retroactive-loop.md` is modified by this spec.

## Scenarios

**Scenario:** Orchestrator launches REVIEW immediately in INTERMEDIATE mode.

Given the lifecycle is running in INTERMEDIATE mode  
And the implementation PR has just been created and pushed  
When the orchestrator transitions to the REVIEW stage  
Then it applies the `iter:1` label to the PR  
And it immediately spawns the cold-start `pr-reviewer` with the PR number  
And it does NOT post a prompt or wait for user input before spawning

**Scenario:** Orchestrator sends a notification before spawning in FULL mode.

Given the lifecycle is running in FULL mode  
And the implementation PR has just been created  
When the orchestrator transitions to the REVIEW stage  
Then it posts a non-blocking start-of-iteration notification on the logbook issue  
And it applies the `iter:1` label to the PR  
And it immediately spawns the cold-start `pr-reviewer` without waiting for acknowledgement

## Out of scope

- Changing the routing matrix or termination rules in `retroactive-loop.md`
  — only the launch trigger section is new.
- Adding a launch trigger for subsequent iterations (iterations 2..N are
  already launched by the re-spawn rule in the routing matrix; this spec
  targets only iteration 1).
- Changing the FULL-mode notification content or format.

## Open questions

- None. The trigger surface (`retroactive-loop.md`) and the mode-conditional
  launch rule are unambiguous from the existing AGENTS.md matrix.
