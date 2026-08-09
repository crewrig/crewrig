---
id: "0115"
slug: forge-artifact-single-writer
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 735
version: 1.1.0
---

# 0115 — forge-artifact-single-writer (delta-01)

This delta closes three holes on one axis of spec 0115: **who a writer is, and
who may move writership**. Two were raised as `class: spec` findings by the cold
PLAN review on issue #735; the third was observed live on that same ticket, on a
real artifact, and recorded on the logbook before this delta was written.

**The granularity question is settled first, because it decides the other two.**
Spec 0115 requirement 3 vests writership in "the agent that created it" and
requirement 4 demands a record of that writer which "survives the writer's own
session". The two readings of "agent" — the individual instance, or the role it
plays on the ticket — are not interchangeable, and the merged spec never chose
between them.

Requirement 4 chooses for it. On this harness an agent instance does not outlive
its own session, so a record that survives the writer's session cannot be a
record naming an instance: it would name something that has ceased to exist and
identify no one who can act. Only a role persists across the boundary
requirement 4 draws. Requirement 5 points the same way — its first remediation
branch, "route the change through the current writer", is vacuous the moment the
creating instance ends unless the writer is something a later agent can still be.
So writership is **role-scoped**, tied to the ticket the artifact belongs to. The
protocol already behaves this way elsewhere: `docs/agent-team-protocol.md` →
*Team Communication* → Rule 2 answers an unreachable teammate with a fresh agent
carrying the same brief, not with a reassignment of the work to a different role.

That decision **dissolves the deadlock** the review's first finding was raised
against. The reviewer held — correctly — that the plan's reclamation clause is
not admitted by requirements 5 and 6 as written: requirement 6 admits transfer
"only through an explicit handover", requirement 5's remediation set is closed at
two branches, and the clause's second limb (a side effect confirmed per Rule 3
step 2) involves no act by the current writer at all. The premise for wanting a
third branch was that a concluded writer can neither be routed through nor hand
writership over, leaving the artifact permanently unwritable. Under role-scoped
writership that premise fails: the role remains the writer, an agent of that role
on that ticket can both make the change and hand writership over, and both
branches stay open. The remedy the reviewer proposed — mirror
[`specs/0095-orchestrator-deliverable-edit-fence.md`](0095-orchestrator-deliverable-edit-fence.md)
requirement 3 by spelling the conclusion path into the spec rather than leaving
it to the plan — is applied below, and what it spells out is that there is **no**
third branch. The reviewer's own asymmetry observation supports that outcome:
Rule 5 is a *conditional* fence that lifts on conclusion by its own terms,
whereas 0115's writership is unconditional and persistent, so the conclusion of
an instance is exactly the event that must not move it.

**The third hole is the one the merged spec cannot see at all.** Every
requirement in 0115 is written from the standpoint of the current writer or of a
would-be writer. Requirement 6 constrains *how* writership moves and says nothing
about *who is entitled to move it*. On 2026-08-08, three concurrent sessions each
told another that the repair of `specs/0114-shared-worktree-agent-isolation.md`
was theirs, within about ten minutes; one of those messages was explicit,
recorded, and inferred from neither silence nor elapsed time — satisfying
requirement 6 on its face — and was void, because its sender had never been the
writer. No lost update followed, only because the real owner spoke before anyone
wrote. A recipient acting on such a nomination in good faith would believe itself
compliant, and nothing in the spec would tell it otherwise.

The version bump is **MINOR** (`1.0.0` → `1.1.0`): two requirements are added,
two are replaced in a way that settles an ambiguity and narrows a reading without
withdrawing any obligation the merged spec already imposed, and no implementation
is in flight to invalidate — the PLAN stage for issue #735 is blocked pending
this delta.

## ADDED

1. **R13.** Where an agent of the writer role is live on a ticket and the
   orchestrator brings a further agent of that same role live on that ticket,
   the orchestrator SHALL NOT direct more than one of them to write any given
   forge artifact, so that requirement 3's one-writer-at-any-instant guarantee is
   preserved across the writer role's own agents. That obligation SHALL rest on
   the orchestrator rather than on those agents, because an agent of the writer
   role resolves requirement 4's determination to its own role and therefore
   cannot observe that a second agent of that role is live. Requirements 7 and 8
   SHALL nonetheless hold between two agents of the same role exactly as they
   hold between agents of different roles, since each binds a writing agent alone
   and requires no knowledge that the other exists.

2. **R14.** A handover under requirement 6 SHALL be effective only when the party
   handing writership over is the artifact's current writer. A nomination,
   designation, assignment, or purported transfer of a forge artifact's
   writership made by any agent that is not that artifact's current writer SHALL
   confer no writership, SHALL NOT make its recipient the artifact's writer, and
   SHALL NOT be treated by its recipient as a handover under requirement 6 —
   however explicitly it is stated, and wherever it is recorded. An agent offered
   writership SHALL determine the artifact's current writer per requirement 4
   before writing, and SHALL treat itself as not being the writer unless that
   determination names its role.

3. **Scenario — a concluded instance does not end the role's writership.**

   ```text
   Given an agent of the pr-logbook role created a pull request on a ticket and
         is therefore that pull request's body's writer
   And   that agent's session has since concluded
   And   the team-lead judges the body needs a change
   When  the team-lead determines the body's current writer
   Then  it finds the pr-logbook role on that ticket named as the writer, not a
         particular concluded instance
   And   it does not take writership on the strength of that conclusion, of a
         landed completion report, or of an observed side effect of the
         concluded instance's work
   And   the change is made by an agent of that role acting on the ticket
   ```

4. **Scenario — the orchestrator does not put two agents of the writer role on
   one artifact.**

   ```text
   Given an agent of the role that holds a pull-request body's writership is
         live on a ticket
   And   the orchestrator brings a further agent of that same role live on that
         ticket after the first went unreachable
   When  the orchestrator directs work on that body
   Then  it directs at most one of the two agents to write it
   And   neither agent is expected to have observed that the other is live,
         since each resolves the writer determination to its own role
   And   an agent that does write observes the body immediately before its write
         and reports a change it finds between that observation and that write,
         exactly as it would for a write by an agent of a different role
   ```

5. **Scenario — a nomination from a non-writer confers nothing.**

   ```text
   Given an agent is the current writer of a pull-request body
   And   a second agent, which is not that writer, states explicitly and on the
         record — where a writer determination reads — that writership of that
         body now belongs to a third agent
   When  the third agent is about to write the body
   Then  it determines the current writer per requirement 4 and finds the first
         agent's role named
   And   it does not treat the second agent's statement as a handover under
         requirement 6
   And   it does not write the body
   ```

6. **Out of scope — an instance-level writership record.** Requirement 3 as
   replaced deliberately requires no per-instance identifier, no instance
   register, and no record distinguishing one agent of the writer role from
   another. Requirement 4's determination names a role on a ticket, which is
   what survives the writer's own session; a record naming an instance would
   expire with the session it names, and requirement 13 governs the
   concurrent-instance case without one.

## MODIFIED

1. **Requirement 3 is replaced** to settle whether writership is held by an
   agent instance or by the role it plays on the ticket. The merged text is
   compatible with both readings; requirement 4's session-survival obligation
   admits only one of them.

   - Original R3:

     > **R3.** Every forge artifact a team writes SHALL have exactly one writer
     > at any instant. That writership SHALL be established when the artifact is
     > created and SHALL rest initially with the agent that created it.

   - Replacement R3:

     > **R3.** Every forge artifact a team writes SHALL have exactly one writer
     > at any instant. That writership SHALL be established when the artifact is
     > created and SHALL rest initially with the **role** of the agent that
     > created it, scoped to the ticket the artifact belongs to, rather than with
     > the individual agent instance that performed the creation. An agent of
     > that role acting on that ticket SHALL be the artifact's writer whether or
     > not it is the instance that created the artifact, and the conclusion of
     > any one instance of that role SHALL NOT end the role's writership nor make
     > the artifact unwritable.

2. **Requirement 5 is replaced** to state, in the spec rather than in a plan,
   what a would-be writer does when the instance that created the artifact has
   concluded — the path
   [`specs/0095-orchestrator-deliverable-edit-fence.md`](0095-orchestrator-deliverable-edit-fence.md)
   requirement 3 spells out for the file-side fence and 0115 left implicit.

   - Original R5:

     > **R5.** An agent that is not a forge artifact's current writer SHALL NOT
     > write that artifact. When such an agent judges the artifact needs a
     > change, it SHALL either route the change through the current writer or
     > SHALL first receive writership per requirement 6.

   - Replacement R5:

     > **R5.** An agent that is not a forge artifact's current writer SHALL NOT
     > write that artifact. When such an agent judges the artifact needs a
     > change, it SHALL either route the change through the current writer or
     > SHALL first receive writership per requirement 6. That remediation set
     > SHALL remain closed at those two branches, and the conclusion of the agent
     > instance that created the artifact SHALL NOT exhaust it: routing the
     > change through the current writer SHALL be satisfied by an agent of the
     > writer role acting on the ticket, whether or not it is the instance that
     > created the artifact. A concluded instance SHALL NOT be grounds for any
     > agent to take writership of the artifact, and no third remediation branch
     > SHALL be read into this requirement on the strength of a confirmed
     > conclusion, of a landed completion report, or of an observed side effect
     > of the concluded instance's work.

## REMOVED

(None. This delta adds two requirements, three scenarios and one out-of-scope
item, and replaces two requirements. Requirements 1, 2, 4, and 6 through 12 of
spec 0115 stand unchanged, as do all eight of its original scenarios and the
whole of its out-of-scope list. Its `## Open questions` section is unaffected:
both assumptions recorded there — that requirement 4's determination reads on the
ticket's logbook, and that requirement 7's freshness is established at the moment
of the assertion — survive this delta intact.)
