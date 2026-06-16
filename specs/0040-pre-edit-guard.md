---
id: "0040"
slug: pre-edit-guard
status: approved
complexity: small
interaction-mode: AUTO
related-issue: 317
version: 1.0.0
---

# Add pre-edit guard to AGENTS.md — ticket and branch required before any file edit

## Intent

`AGENTS.md` already mandates worktree isolation and feature branches, but the
rule is expressed as a team-setup step ("before any `TaskCreate` or `Agent`
spawn"). It does not surface as an explicit gate at the moment an agent is
about to write or edit a file. This gap allows an agent to begin implementing
directly on the current working tree — bypassing the branch, the ticket, and
the team — before the branching and worktree rules are encountered.

Adding a **Pre-Edit Guard** section to `AGENTS.md` closes the gap: it fires
at the earliest possible moment (the intent to edit a file) rather than
during team setup, and it enumerates the three conditions that must hold
before any file is written.

## Requirements

1. `AGENTS.md` SHALL gain a **Pre-Edit Guard** section placed immediately
   after the *Branching Strategy* section.

2. The section SHALL state that before writing or editing any file in the
   repository, the agent MUST confirm all three of the following:

   a. A GitHub issue exists for the work (pre-existing or freshly created).

   b. A feature branch is active — the current working context is NOT
      `main` (or `master`). The branch name MUST follow the
      `<prefix>/<NNNN>-<slug>` convention defined in *Branching Strategy*.

   c. The working directory in use is a **dedicated worktree** under
      `.worktrees/<ticket-id>/`, NOT the repository root.

3. The section SHALL state that violating the guard by editing files
   without a ticket, branch, or worktree is a **process violation** that
   SHALL be surfaced as a `class: tech` finding by any REVIEW pass that
   audits the session.

4. The section SHALL state that **trivial single-file edits** explicitly
   scoped by the user in the same conversational turn are the sole exemption
   — they do not require a full team or worktree, but STILL require a ticket
   (R2a) and feature branch (R2b). There is no edit-without-branch exemption.

5. No other section of `AGENTS.md` SHALL be modified by this spec.

## Scenarios

**Scenario:** Agent receives a bug fix request and respects the guard.

Given the user asks the agent to fix a bug  
And no existing GitHub issue covers the fix  
When the agent is about to write or edit a file  
Then it first creates (or references) a GitHub issue  
And creates a feature branch following the naming convention  
And creates a worktree under `.worktrees/<ticket-id>/`  
And only then performs the edit within the worktree

**Scenario:** Agent starts editing without a ticket or branch.

Given the agent decides to fix a bug inline  
And it has not created a GitHub issue or branch  
When it writes or edits any file  
Then this constitutes a process violation  
And a REVIEW pass SHALL emit a `class: tech` finding citing *Pre-Edit Guard*

**Scenario:** User explicitly scopes a trivial single-file edit inline.

Given the user says "change the title in README.md"  
And the agent confirms this is a trivial single-file edit scoped in this turn  
When the agent is about to edit the file  
Then it MAY omit the worktree but MUST still have (or create) a ticket and
a feature branch before writing  
And it SHALL NOT bypass the ticket and branch requirements even under this
exemption

## Out of scope

- Changing the worktree creation command or naming convention — those live
  in *Agent Team Protocol*.
- Adding a shell hook that enforces the guard — hooks cannot inspect
  conversational intent. The guard is a documented procedure, not a
  technical enforcement.
- Changing the definition of "trivial single-file edit" beyond the inline
  scope given by the user in the same conversational turn.

## Open questions

- None. The guard surface (`AGENTS.md`), the three conditions, and the
  exemption scope are all derived from existing rules already present in
  *Branching Strategy* and *Agent Team Protocol*.
