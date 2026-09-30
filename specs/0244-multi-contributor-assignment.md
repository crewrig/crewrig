---
id: "0244"
slug: multi-contributor-assignment
status: approved
complexity: standard
interaction-mode: MINIMAL
related-issue: 1387
version: 1.0.0
---

# A ticket assigned to one contributor is never worked on by another

## Intent

When several people contribute to the same project, each driving their own
agent sessions, a ticket that one of them has taken is never picked up by
another. Whoever is assigned to a ticket owns it until they release it, hand
it over, or leave it idle long enough for a documented takeover; a ticket
nobody is assigned to is free for anyone to take, and taking it is visible to
everyone the moment it happens. The agent a contributor works through refuses
to start on a ticket someone else owns and claims a free ticket for its user
before doing anything else, so the rule holds without depending on each
person remembering it. Today every coordination guard in the framework is
scoped to one machine — spec-id reservation, worktree claims, reviewer seats —
and the shared agent memory is per-person, so nothing prevents two people from
duplicating the same work; the forge's assignment record is the only state
all contributors share, and this convention makes it authoritative.

## Requirements

1. The forge's assignment record on an issue — its current assignees and the
   assignment history in its timeline — SHALL be the single authoritative
   record of who owns a ticket. An issue with no current assignee SHALL be
   free. Otherwise its owner SHALL be the contributor whose assignment
   appears earliest in the timeline since the issue was last released, a
   release being a change that leaves the issue without any assignee; in the
   ordinary case this is simply its sole assignee. A single change that
   removes one contributor's assignment and adds another's SHALL NOT count as
   a release. No other record — agent memory, a local file, a comment, a chat
   message — SHALL override it.
2. A ticket owned by one contributor SHALL NOT be worked on by any other
   contributor, nor by an agent acting on another contributor's behalf.
   "Worked on" covers every authoring action that produces a deliverable for
   that ticket: creating any of its branches (spec, delta-spec, or
   implementation), securing its spec id, opening its worktree, and opening
   or pushing to any of its pull requests. Reading the ticket, commenting on
   it, and reviewing its pull requests SHALL remain permitted to everyone, as
   SHALL the pushes requirement 9 permits, together with the local checkout of
   the branch those pushes require.
3. A contributor taking a free ticket SHALL become its assignee before the
   first authoring action listed in requirement 2.
4. An issue SHALL carry at most one assignee. Other contributors SHALL
   participate through comments, review suggestions, or commit co-authorship,
   never through a second assignment. Every legitimate change of owner — a
   release (requirement 6), a transfer (requirement 7), a takeover
   (requirement 8), or a maintainer's assignment (requirement 14) — SHALL
   pass through a release: the current owner's assignment is removed before
   the next owner's is added. An assignment added while another contributor
   owns the issue — whether the forge keeps it next to the owner's or
   replaces the owner's with it — SHALL confer no ownership; the contributor
   it names SHALL remove it and, when it displaced the owner's, restore the
   owner's. When the timeline cannot establish which assignment came first,
   the issue SHALL be treated as owned by none of the contributors involved,
   no agent SHALL start on it, and they SHALL reduce it to one assignee by
   agreement.
5. Assigning an epic SHALL lock the epic issue only. Each sub-ticket SHALL be
   free or owned according to its own assignment. The epic's assignee SHALL be
   the arbiter of how its sub-tickets are split and distributed, and a
   dispute over a sub-ticket SHALL be settled by that arbiter.
6. A contributor abandoning a ticket SHALL release it explicitly: remove their
   own assignment and leave a status comment stating what is done and what
   remains. A ticket with no remaining work SHALL be closed rather than
   released.
7. A ticket SHALL change owner only with the current owner's written
   consent, recorded as a comment on the issue, except under the stale-lock
   path of requirement 8. The transfer SHALL remove the current owner's
   assignment before adding the new owner's.
8. When an owned ticket shows no activity by its assignee for a nudge delay,
   another contributor MAY ask for it in a comment that mentions the assignee.
   If the assignee has not answered within a further grace delay, that
   contributor MAY take the ticket over — removing the assignee's assignment,
   then adding their own — leaving a takeover comment that links the
   unanswered request. The defaults SHALL be 14 days for the nudge delay
   and 7 days for the grace delay, and an adopting organization SHALL be able
   to override both. Activity SHALL mean any comment on the issue, commit on
   any of the ticket's branches, or update to any of its pull requests by the
   assignee. A takeover SHALL never be silent.
9. No contributor SHALL push to a branch of a ticket owned by another
   contributor. Changes proposed to someone else's work SHALL go through
   review suggestions or a pull request that targets their branch. Two pushes
   SHALL remain permitted: bringing the branch up to date with the reference
   branch as required by `AGENTS.md` → *Branching Strategy* → *Up-to-date merge
   precondition*, by the contributor about to merge it; and any push the owner
   has explicitly invited in a comment on the issue or pull request.
10. For a pull request that modifies a file most tickets touch — at least
    `docs/cli-matrix.md`, `AGENTS.md`, `.crewrig/core-paths.txt`, and compiled
    component outputs — a change to a shared contract in such a file SHALL be
    announced on the ticket's issue before the pull request is opened, and the
    pull request SHALL be brought up to date with the reference branch before
    review is requested, in addition to the pre-merge update required by
    `AGENTS.md` → *Branching Strategy* → *Up-to-date merge precondition*.
11. At ticket pickup, before any authoring action listed in requirement 2, an
    agent SHALL determine the issue's owner under requirement 1 — from the
    current assignees and the timeline together, never from the current
    assignee list alone — and compare it with the identity of its current
    forge user:
    - owned by someone else → the agent SHALL stop, name the owner, and
      surface the permitted paths (ask the owner, wait for the stale-lock
      path of requirement 8, or pick another ticket), without creating any
      branch, spec-id reservation, or worktree. When its own user holds an
      assignment on the issue, the agent SHALL first remove it and, when that
      assignment displaced the owner's, restore the owner's;
    - owned by its own user → the agent SHALL proceed, first restoring its
      own user's assignment when a later assignment displaced it;
    - free → the agent SHALL assign its own user, then determine the owner
      again under requirement 1 and apply this requirement to the result. It
      SHALL proceed only when that owner is its own user.
12. The requirement-11 check SHALL behave identically on GitHub, GitLab, and
    Gitea, through each forge's own command-line tool, consistent with
    `AGENTS.md` → *Forge Access*, and SHALL require no credential beyond the
    one the contributor already holds for that tool.
13. When the agent cannot establish either side of the requirement-11
    comparison — forge unreachable, current user undeterminable, issue or
    timeline unreadable — it SHALL fail closed: stop before any authoring
    action and report which side could not be read. When the agent had
    already assigned its own user before failing, it SHALL report that
    assignment to the user as left in place. Such a leftover assignment SHALL
    confer ownership only when requirement 1 grants it, and the next pickup of
    the issue, by any contributor, SHALL resolve it under requirement 11.
    Proceeding without the check SHALL require the user's explicit
    instruction in the same session.
14. When the post-assignment determination of requirement 11 still finds the
    issue free — the self-assignment did not take effect — typically a contributor without the
    permission to assign themselves, such as a fork contributor, whose
    assignment the forge may drop silently — the agent SHALL stop before any
    authoring action, report that the assignment could not be recorded, and
    ask a maintainer, in a comment on the issue, to assign the ticket to its
    user, instead of stopping as in requirement 11's first case. The ticket
    SHALL remain free until a maintainer records that
    assignment; the agent SHALL proceed only once it has.
15. The requirement-11 check SHALL be wired into every framework path through
    which an agent picks up a ticket for authoring, on every supported
    command-line tool — at least: the `spec-author` skill at the SPECS stage;
    the direct inline handling of a `trivial` ticket, which bypasses
    `spec-author`; and the pickup of a ticket whose spec is already merged, at
    the PLAN or DEV stage. Each modified skill or agent source SHALL carry its
    version bump per `AGENTS.md` → *Version Bump Convention*.
16. The convention SHALL be documented in the generic core — a reference
    document under `docs/` and a short section in `AGENTS.md` within its size
    budget (`specs/0067-agents-md-size-budget.md`) — and SHALL name no
    individual contributor. The ownership model SHALL be recorded as an ADR.
17. Several agent sessions of the **same** contributor working one ticket
    SHALL remain governed by the existing machine-scoped guards
    (`specs/0112-spec-id-reservation.md`, the worktree claim of
    `docs/agent-team-protocol.md`), which this convention SHALL NOT replace or
    weaken.

## Scenarios

**Scenario:** an agent takes a free ticket for its user

```text
Given issue #N has no assignee
And   the contributor's agent is asked to start work on issue #N
When  the agent runs its ticket-pickup check
Then  the agent assigns issue #N to its current forge user
And   reads the timeline and finds its own user as the owner
And   only then creates the ticket's branch, spec-id reservation, or worktree
And   the assignment is visible in the issue timeline to every contributor
```

**Scenario:** an agent refuses a ticket owned by someone else

```text
Given issue #N is assigned to contributor A
And   contributor B's agent is asked to start work on issue #N
When  the agent runs its ticket-pickup check
Then  the agent stops before creating any branch, spec-id reservation, or worktree
And   the agent reports that issue #N is owned by contributor A
And   the agent offers the permitted paths: ask A, wait for the stale-lock path, or pick another ticket
```

**Scenario:** the ownership check cannot be performed

```text
Given the forge is unreachable from the contributor's machine
When  the agent is asked to start work on issue #N
Then  the agent stops before any authoring action
And   reports that the issue's assignees or the current user could not be read
And   proceeds only if the user explicitly instructs it to in the same session
```

**Scenario:** a stale ticket is taken over openly

```text
Given issue #N is assigned to contributor A
And   A has shown no activity on it for 14 days
When  contributor B comments on #N mentioning A and asking for the ticket
And   A has not answered 7 days later
Then  B may remove A's assignment, then assign themselves
And   leaves a takeover comment linking the unanswered request
```

**Scenario:** an epic assignment does not lock its sub-tickets

```text
Given epic #E is assigned to contributor A
And   its sub-ticket #S has no assignee
When  contributor B's agent is asked to start work on #S
Then  the agent treats #S as free and assigns it to B
And   A remains the arbiter of how the epic's sub-tickets are distributed
```

**Scenario:** two contributors self-assign the same free ticket at once

```text
Given issue #N has no assignee
And   contributors A and B each ask their agent to start work on #N at the same moment
When  both agents assign their own user, then determine the owner from the timeline
Then  both find A's assignment first since #N was last released
And   A's agent proceeds
And   B's agent removes B's assignment and stops before any authoring action, naming A as the owner
```

**Scenario:** on a forge that replaces assignments, the later self-assignment withdraws

```text
Given issue #N has no assignee, on a forge where a new assignment replaces the current one
And   contributor A's agent assigns A, reads the timeline, finds A as the owner, and proceeds
When  contributor B's agent then assigns B, which replaces A's assignment in one change
And   B's agent determines the owner from the timeline since #N was last released
Then  it finds A's assignment first, the replacement not counting as a release
And   B's agent restores A's assignment, removes B's, and stops before any authoring action, naming A
```

**Scenario:** a session interrupted right after a displacing self-assignment

```text
Given contributor A owns issue #N, on a forge where a new assignment replaces the current one
And   contributor B's agent assigned B, replacing A's assignment, then failed closed before undoing it
When  either contributor's agent next picks up #N
Then  it determines from the timeline that A still owns #N, the replacement not counting as a release
And   B's agent removes B's assignment and restores A's, then stops naming A
And   A's agent restores A's assignment and proceeds
```

**Scenario:** a contributor without assign permission picks up a free ticket

```text
Given issue #N has no assignee
And   contributor F, working from a fork, cannot assign themselves on the reference repository
When  F's agent assigns F and determines the owner again
Then  #N is still free, the forge having dropped the assignment
And   the agent stops before any authoring action and asks a maintainer, in a comment on #N, to assign F
And   #N remains free for everyone until a maintainer records the assignment
```

**Scenario:** the contributor about to merge updates someone else's branch

```text
Given contributor A owns issue #N and its approved pull request is behind the reference branch
When  contributor B, about to merge that pull request, brings its branch up to date with the reference branch
Then  the push is permitted by requirement 9
And   any other push by B to that branch requires A's explicit invitation
```

**Scenario:** a ticket changes hands with the owner's consent

```text
Given contributor A owns issue #N
When  contributor B asks for #N in a comment
And   A replies on #N agreeing to hand it over
Then  A's assignment is removed, then B's is added
And   without that written consent, and outside the stale-lock path, B's agent refuses #N as owned by A
```

**Scenario:** a contributor releases a ticket they cannot finish

```text
Given contributor A owns issue #N and has completed part of the work
When  A decides to stop working on #N
Then  A removes their own assignment
And   leaves a status comment stating what is done and what remains
And   #N becomes free for the next contributor whose agent picks it up
```

## Out of scope

- A continuous-integration check that a pull request's author matches the
  linked issue's assignee. Enforcement is agent-only by decision; the accepted
  risk is that a pull request opened by hand, without an agent, bypasses the
  guard.
- Rules for cross-review between human contributors and for who may merge
  whose pull request.
- Any automated un-assignment on inactivity: the stale-lock path of
  requirement 8 is always driven by a contributor, never by a scheduled job.
- Coordination of agent sessions belonging to the same contributor, already
  covered by the machine-scoped guards named in requirement 17.
- Retroactive redistribution of already-open tickets; the convention applies
  from its adoption onward, and current epics are settled by their arbiter
  under requirement 5.

## Open questions
