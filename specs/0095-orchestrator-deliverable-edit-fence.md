---
id: "0095"
slug: orchestrator-deliverable-edit-fence
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 602
version: 1.0.0
---

# Orchestrator deliverable-edit fence for delegated sub-agent work

## Intent

After this change, an orchestrator that has delegated a deliverable file to
a sub-agent no longer edits that same file itself while the sub-agent is
still working on it. The orchestrator waits for an actual completion
signal — the sub-agent's own report, or a confirmed observable trace of
its finished work — before touching the file, instead of treating an idle
notification as proof the sub-agent is done. A user or reviewer reading
the Team Communication guidance finds this write-side expectation stated
as an explicit, numbered rule sitting next to the existing read-side rule
about idle notifications, so both halves of the same race condition are
visible together. The concrete symptom this closes is the one already
observed twice — in ticket #569 and in the Harness Curator's
`concurrent-deliverable-edit` friction cluster (issue #602) — where an
orchestrator's own completion edits landed asynchronously alongside a
sub-agent's parallel edits to the same file, producing duplicate content
that then had to be manually reconciled.

## Requirements

1. This spec SHALL declare `complexity: standard`, not `small`, because
   the change modifies `docs/agent-team-protocol.md` itself — an
   established protocol document that `AGENTS.md` → *Agent Team Protocol*
   refers every team to. `docs/agent-team-protocol.md` → *Standard Team
   Templates → Template 2* already mandates inserting `architect` as a
   DEV-stage step whenever "the documentation change modifies an
   established protocol, convention, or contract," and that conditional
   clause SHALL fire for this ticket's own implementation, exactly as it
   did for the near-identical precedent in
   [`specs/0093-worktree-subagent-cwd-guard.md`](0093-worktree-subagent-cwd-guard.md)
   (which amended *Worktree Isolation* rather than *Team Communication*,
   but under the same Template 2 clause). The `small`-tier team
   composition in `docs/agent-team-protocol.md` → *Team sizing by
   complexity* explicitly excludes `architect` ("No `architect` — the
   spec is its own architectural input"), which would suppress that
   mandatory review for a change to the protocol document itself;
   `standard` is therefore the only tier that does not contradict the
   existing Template 2 clause.
2. `docs/agent-team-protocol.md` → *Team Communication* SHALL gain a new
   **Rule 5**, positioned immediately after Rule 4, stating that while a
   deliverable file is delegated to a sub-agent — i.e. the sub-agent's
   brief names that file as its target — the orchestrator SHALL NOT edit
   that file itself until the sub-agent's completion has been confirmed,
   either (a) via the sub-agent's own `SendMessage` result per Rule 1, or
   (b) via the observable-side-effect check described in Rule 3 step 2.
   Rule 5 SHALL state explicitly that an `idle_notification` alone is NOT
   a completion barrier — the orchestrator SHALL NOT treat receipt of an
   idle notification, by itself, as license to edit a file still
   delegated to that sub-agent.
3. Rule 5 SHALL state the remediation path for the case where the
   orchestrator determines a delegated file needs a change while the
   sub-agent is still live: either (a) instruct the still-live sub-agent
   to make the change itself, rather than editing the file directly, or
   (b) confirm — per the conclusion check in *Team Shutdown* — that the
   sub-agent has concluded its work before the orchestrator takes
   ownership of the file and edits it directly.
4. Rule 5 SHALL explicitly cross-reference Rule 3 by name and state that
   Rule 5 is the write-side counterpart to Rule 3's read-side guidance:
   Rule 3 already establishes that an idle notification does not prove a
   teammate skipped its Rule 1 report; Rule 5 draws the corresponding
   consequence for the orchestrator's own edits — the same unreliable
   signal that must not be mistaken for a completion proof when reading
   also must not be acted upon when writing.
5. The rewrite SHALL be scoped to `docs/agent-team-protocol.md` → *Team
   Communication*, adding Rule 5 only. It SHALL NOT alter the existing
   text of Rules 1 through 4, the *Worktree Isolation* section, the
   *Standard Team Templates*, or the *Team sizing by complexity* table,
   beyond whatever minimal cross-reference touch is needed to keep those
   surfaces internally consistent with the new rule (e.g. a "see Rule 5"
   pointer, if the implementer judges one useful — not a restatement of
   Rule 5's content elsewhere).
6. This spec SHALL NOT request, imply, or describe any locking
   mechanism, mutex, file-system-level lock, or other tooling change to
   enforce the edit fence. The remediation this spec qualifies is a
   documentation-only behavioral rule — the same posture as
   [`specs/0093-worktree-subagent-cwd-guard.md`](0093-worktree-subagent-cwd-guard.md)'s
   Requirement 9 — because this repository does not control harness tool
   behavior and the fence is meant to be followed, not mechanically
   enforced.

## Scenarios

**Scenario:** Orchestrator waits for a completion report before editing a
delegated file

Given an orchestrator has delegated `specs/0084-custom-root-ca-support.md`
to a `spec-author` sub-agent as its brief's named target
When the sub-agent sends a `SendMessage` result reporting the file
complete, per Rule 1
Then the orchestrator only edits that file after receiving the result
message, and no concurrent edit from the orchestrator's own turn lands on
the file while the sub-agent is still working

**Scenario:** Orchestrator receives only an idle notification and
correctly withholds editing

Given an orchestrator has delegated a deliverable file to a sub-agent, and
the orchestrator's next turn surfaces only an `idle_notification` for that
sub-agent, with no result message yet delivered
When the orchestrator applies Rule 5 together with Rule 3
Then the orchestrator does NOT treat the idle notification as a completion
signal and does NOT edit the file on the strength of it alone; instead it
lets the channel drain and checks the file's observable state (`git
status`, `git log`) per Rule 3 step 2, or waits for the result message,
before touching the file itself — contrasting with the #569 incident,
where the orchestrator's completion edits landed on the same file the
sub-agent was still editing, asynchronously after an idle notification,
producing a duplicate persistence scenario and a duplicate Windows
out-of-scope bullet that then required manual reconciliation

**Scenario:** Orchestrator needs a change to a still-delegated file and
routes it through the live sub-agent

Given an orchestrator determines that a file still delegated to a live
sub-agent needs an additional change
When the orchestrator applies Rule 5's remediation path
Then the orchestrator instructs the still-live sub-agent to make the
change itself, rather than editing the file directly, and does not take
ownership of the file unless the sub-agent's conclusion has first been
confirmed per *Team Shutdown*

## Out of scope

- Any locking mechanism, mutex, file-system-level lock, or other tooling
  change that would enforce the edit fence mechanically — Rule 5 is a
  documented, followed behavioral rule, not an enforced one.
- Any change to the existing text of Rules 1 through 4, the *Worktree
  Isolation* section, the *Standard Team Templates*, or the *Team sizing
  by complexity* table, beyond the minimal cross-reference consistency
  touch permitted by Requirement 5.
- Defining the exact `SendMessage` payload schema used to instruct a
  still-live sub-agent to make a change to its own delegated file, or to
  confirm its conclusion — left to the implementer's judgment within the
  existing *Team Communication* and *Team Shutdown* conventions.
- Retroactive reconciliation of any past incident already resolved
  manually (e.g. the #569 duplicate-content reconciliation, or the
  duplicate content once present in
  `.worktrees/0084-spec/specs/0084-custom-root-ca-support.md`) — this
  spec qualifies the go-forward protocol, not a one-time cleanup.
- Any harness-level or tool-level change to how `SendMessage`, idle
  notifications, or `Agent` spawns are delivered or sequenced — that
  surface belongs to Anthropic, not to this repository.

## Open questions

- None — this is a scoped, narrow addition of one new rule to one
  existing section of one documentation file, directly modeled on the
  precedent set by spec 0093; no ambiguity was identified that the
  Requirements and Out of scope sections above do not already resolve.
