---
id: "0115"
slug: forge-artifact-single-writer
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 735
version: 1.0.0
---

# A forge artifact has a single writer at a time

## Intent

Two agents working the same ticket no longer overwrite each other's edits to
a pull-request body, an issue body, or a comment without either of them
noticing. Each such artifact has one agent answerable for its text at any
instant; that answerability is knowable to anyone about to write, and changes
hands only when it is handed over deliberately. An agent that tells the user
or a teammate what an artifact currently says is reporting something it has
just seen, not something it saw before another writer arrived. And when an
overwrite happens anyway, the writer that caused it learns that it did,
instead of reading a success report indistinguishable from a clean write.

## Requirements

1. This spec SHALL declare `complexity: standard` rather than `small`,
   because realizing it amends `docs/agent-team-protocol.md` — an
   established protocol document that `AGENTS.md` → *Agent Team Protocol*
   refers every team to. `docs/agent-team-protocol.md` → *Standard Team
   Templates → Template 2* mandates inserting `architect` as a DEV-stage
   step whenever "the documentation change modifies an established
   protocol, convention, or contract", and the `small`-tier composition in
   *Team sizing by complexity* excludes `architect`, which would suppress
   that mandatory review — the same reasoning recorded in
   [`specs/0095-orchestrator-deliverable-edit-fence.md`](0095-orchestrator-deliverable-edit-fence.md)
   requirement 1.
2. The protocol document SHALL define *forge artifact*, for the purposes of
   this rule, as the mutable text body of a pull request, of an issue, or of
   a comment on either. The definition SHALL state that publishing a **new**
   comment produces a new artifact whose writer is its author, so the
   incremental-logbook practice of `AGENTS.md` → *Logbook Issues → Rule B*
   is unaffected — only editing an already-published body or comment is
   governed here.
3. Every forge artifact a team writes SHALL have exactly one writer at any
   instant. That writership SHALL be established when the artifact is
   created and SHALL rest initially with the agent that created it.
4. An agent about to write a forge artifact SHALL be able to determine that
   artifact's current writer from a record that survives the writer's own
   session and that is readable without an exchange with the current writer.
   An agent that cannot determine the current writer SHALL treat itself as
   not being that writer.
5. An agent that is not a forge artifact's current writer SHALL NOT write
   that artifact. When such an agent judges the artifact needs a change, it
   SHALL either route the change through the current writer or SHALL first
   receive writership per requirement 6.
6. Writership SHALL change hands only through an explicit handover, recorded
   where requirement 4's determination reads. Writership SHALL NOT transfer
   by assumption, by the time elapsed since the current writer's last write,
   by an idle notification, by the current writer's apparent inactivity, or
   by a peer having finished a related task.
7. An agent that asserts to the user or to a peer what a forge artifact
   currently contains SHALL base that assertion on an observation of that
   artifact that no later write has superseded, and SHALL carry with the
   assertion the artifact's last-modification marker as the forge reported
   it at that observation. An observation taken before another agent's write
   SHALL NOT support an assertion made after it.
8. An agent that writes a forge artifact SHALL determine whether the
   artifact changed between that agent's own last observation of it and its
   write, and SHALL NOT treat the forge's report of a successful write as
   evidence that nothing was discarded. When the artifact did change in that
   interval, the writer SHALL report on the ticket's logbook that its write
   may have discarded another agent's content; a ticket SHALL NOT be left
   carrying an unreported overwrite.
9. Requirements 3 through 8 SHALL hold identically on every forge the
   project's `AGENTS.md` → *Forge Access* policy admits, and SHALL NOT
   depend on a capability only one of those forges offers. Where a forge
   reports no last-modification marker for an artifact, requirements 3
   through 6 SHALL still hold in full — writership is this spec's primary
   protection and detection is its backstop, never the reverse.
10. The obligation SHALL be carried by the contracts of the roles that
    actually write forge artifacts — at minimum the `pr-logbook` skill
    contract and the orchestrator guidance in `docs/agent-team-protocol.md`
    → *Team Communication* — in addition to the protocol document itself, so
    that an agent that has loaded only its own role contract still observes
    the rule.
11. The rule SHALL state explicitly that it is the forge-side counterpart to
    the file-side fence of `docs/agent-team-protocol.md` → *Team
    Communication* → Rule 5, and that worktree isolation affords a forge
    artifact no protection whatever, because a forge artifact lives outside
    every worktree.
12. This spec SHALL NOT require a lock, a lease, a mutex, a compare-and-swap
    write, or any change to a forge's own write path. What is qualified here
    is a documented behavioural obligation, followed rather than
    mechanically enforced — the same posture as
    [`specs/0095-orchestrator-deliverable-edit-fence.md`](0095-orchestrator-deliverable-edit-fence.md)
    requirement 6.

## Scenarios

**Scenario:** the creating agent stays the writer and a peer routes through it

```text
Given an agent has created a pull request and is therefore that pull
      request's body's writer
And   a peer agent on the same ticket has loaded only its own role contract
And   that peer judges the body needs an additional change
When  the peer determines the body's current writer
Then  it finds the creating agent named as the writer
And   it does not write the body itself
And   it asks the creating agent to make the change
```

**Scenario:** writership is handed over explicitly before the new writer writes

```text
Given an agent is the writer of a pull-request body
And   that agent hands writership to a peer and records the handover where a
      writer determination reads
When  the peer subsequently writes the body
Then  the peer is the artifact's current writer at the moment of the write
And   the previous writer does not write the body again without a handover
      back
```

**Scenario:** a non-writer's write is a protocol violation

```text
Given an agent has created a pull request and is its body's writer
And   a peer has published its own revision of that same body without having
      received writership
When  the ticket's conduct is audited
Then  the peer's write is a violation of the single-writer rule
And   the audit does not require the lost content to be recoverable to
      establish the violation
```

**Scenario:** an assertion is not made from a superseded observation

```text
Given an agent observed a pull-request body and the forge reported a
      last-modification marker for that observation
And   another agent has since written that body
When  the first agent is about to tell the user what the body contains
Then  it does not assert the content of its earlier observation
And   it observes the body again and asserts what it then sees, carrying the
      last-modification marker of that new observation
```

**Scenario:** a lost update is reported instead of passing as a clean write

```text
Given an agent observed a forge artifact and recorded the last-modification
      marker the forge reported
And   another agent wrote that artifact afterwards
When  the first agent writes the artifact and the forge reports the write
      succeeded
Then  the first agent determines that the artifact changed between its
      observation and its write
And   it reports on the ticket's logbook that its write may have discarded
      another agent's content
And   it does not report the write as clean on the strength of the forge's
      success report
```

**Scenario:** an idle notification does not transfer writership

```text
Given a peer agent is the writer of a forge artifact
And   the orchestrator receives an idle notification for that peer and no
      handover has been recorded
When  the orchestrator considers writing that artifact
Then  it does not treat the idle notification as a handover
And   it does not write the artifact
```

**Scenario:** an additional logbook comment stays unrestricted

```text
Given an agent is the writer of a logbook issue's body
And   a peer agent needs to record an obstacle on that same logbook issue
When  the peer publishes a new comment on the issue
Then  the peer is not writing an artifact whose writer is the first agent
And   the peer is the writer of the comment it has just created
And   the incremental-logbook practice is unaffected
```

**Scenario:** the same obligations hold on a forge other than GitHub

```text
Given a ticket whose repository is hosted on a forge other than GitHub that
      the project's Forge Access policy admits
And   two agents on that ticket can both write one merge-request description
When  the single-writer rule is applied to that description
Then  the writership, handover, and assertion-freshness obligations hold
      exactly as they do on GitHub
And   no obligation depends on a capability only one forge offers
```

## Out of scope

- Concurrent **file** edits by two agents sharing one worktree. That is a
  distinct defect with a distinct mechanism — a working tree rather than a
  forge — and it is tracked separately in issue #736. This spec governs only
  the mutable text of an artifact that lives on a forge; nothing here
  changes what worktree isolation does or does not guarantee for files.
- Any lock, lease, mutex, compare-and-swap write, or other mechanical
  enforcement of the single-writer rule, and any change to how a forge
  command-line tool performs a write. Requirement 12 forecloses this
  deliberately: the rule is meant to be followed, as Rule 5 is.
- Mutable forge state that is not an artifact's text body — labels,
  assignees, milestones, review-state transitions, merge state, reactions.
  These are additive or state-machine fields whose concurrent writes do not
  silently destroy authored prose, and folding them in would widen the rule
  past the defect that motivates it.
- Commits, branches, tags, and continuous-integration runs. They are not
  forge artifacts under requirement 2's definition and are already governed
  by the branching and worktree rules.
- Binding a human collaborator who edits the same artifact outside the agent
  protocol. A human's own edits are not governed by an agent-team rule;
  requirement 8's detection still surfaces such a write to the agent that
  writes after it.
- Adopting a forge-native compare-and-swap affordance should one become
  available on a forge the project admits. Requirement 9 forbids depending
  on a single forge's capability; taking advantage of one where it exists is
  a later ticket, not this one.
- Any change to the existing text of `docs/agent-team-protocol.md` → *Team
  Communication* Rules 1 through 5, or to *Worktree Isolation*, beyond the
  minimal cross-reference that requirement 11 calls for.
- Retroactive repair of the occurrence that motivated this spec — the body
  of pull request #734, already reconciled by hand. This spec qualifies the
  go-forward protocol, not a one-time cleanup.

## Open questions

None. Two points that the anchor issue left implicit were settled while
drafting, and are recorded here so a reader can audit the choice rather than
rediscover it.

The first is where requirement 4's writer determination reads. The assumption
taken is the ticket's logbook — the record `AGENTS.md` → *Logbook Issues →
Rule A* already obliges every agent on the ticket to read and write, which
makes it the only durable, session-independent surface the protocol already
guarantees. The requirement therefore constrains the property (determinable
without an exchange with the current writer) and leaves the exact rendering
of the record to the PLAN stage.

The second is how fresh requirement 7's observation must be. The assumption
taken is that freshness is established at the moment of the assertion rather
than by a bounded staleness window, because no evidence supports any
particular window: in the occurrence that motivated this spec the read-back
expired within roughly half a minute, so any window short enough to be safe
would be indistinguishable from re-observing.
