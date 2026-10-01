---
id: "0244"
slug: multi-contributor-assignment
status: implemented
complexity: standard
interaction-mode: MINIMAL
related-issue: 1387
version: 1.0.0
max-iterations: 6
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

1. Ownership of a ticket SHALL be determined from the forge's assignment
   record for its issue — its current assignees and its assignment history —
   and from no other record: agent memory, a local file, a comment, or a chat
   message SHALL NOT override it. An issue SHALL be free when it has no
   current assignee; requirement 4 guarantees that no repair ever produces
   that state. Otherwise it SHALL have exactly one owner: the contributor who
   took it first since it was last free, a change that replaces one
   contributor's assignment with another's not making it free. In the
   ordinary case the owner is simply the issue's sole assignee.
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
   never through a second assignment. The following invariants SHALL hold on
   every supported forge, whatever that forge does when a second assignment
   is made:
   - **Uniqueness.** At no moment SHALL two contributors both be performing
     authoring actions on the same ticket, other than the pushes
     requirement 9 permits.
   - **First taker wins.** When several contributors take the same free
     ticket, the one whose assignment the forge recorded first SHALL own it,
     and every other SHALL withdraw before performing any authoring action.
   - **Repairs preserve ownership.** Any correction an agent makes to the
     assignment record — withdrawing its own user's assignment from an issue
     someone else owns, or restoring an owner's assignment that a later one
     displaced — SHALL keep the owner's ownership intact throughout, and
     SHALL never leave the issue in a state that another contributor's check
     under requirement 11 would read as free.
   - **Undecidable means not yours.** Whenever the record cannot establish
     who took the ticket first — including two assignments recorded at the
     same instant — no contributor involved SHALL be treated as its owner, and
     no agent SHALL start on it. The contributors involved SHALL settle it by
     agreement, recorded as a comment on the issue: they SHALL leave the
     issue free, and the contributor agreed upon SHALL then take it as a free
     ticket under requirement 3, which restarts the history requirement 1
     reads.
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
   path of requirement 8.
8. When an owned ticket shows no activity by its assignee for a nudge delay,
   another contributor MAY ask for it in a comment that mentions the assignee.
   If the assignee has not answered within a further grace delay, that
   contributor MAY take the ticket over, leaving a takeover comment that links
   the unanswered request. The defaults SHALL be 14 days for the nudge delay
   and 7 days for the grace delay, and an adopting organization SHALL be able
   to override both. Activity SHALL mean any comment on the issue, commit on
   any of the ticket's branches, or update to any of its pull requests by the
   assignee. A takeover SHALL never be silent.

   A transfer under requirement 7 and a takeover under this requirement SHALL
   each leave the issue free before the new owner's assignment is recorded,
   so that requirement 1 recognizes the new owner. They SHALL be performed by the
   contributors concerned — by hand, or by an agent at its user's explicit
   instruction in the same session — and never by an agent on its own
   initiative, nor by the pickup check of requirement 11, which SHALL only
   recognize their outcome.
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
    agent SHALL determine the issue's owner under requirement 1 and compare it
    with the identity of its current forge user:
    - owned by someone else → the agent SHALL stop, name the owner, and
      surface the permitted paths (ask the owner, wait for the stale-lock
      path of requirement 8, or pick another ticket), without creating any
      branch, spec-id reservation, or worktree, after withdrawing any
      assignment of its own user on the issue under requirement 4;
    - owned by its own user → the agent SHALL proceed, after restoring its
      own user's assignment under requirement 4 when a later one displaced
      it;
    - free → the agent SHALL assign its own user and determine the owner
      again. It SHALL proceed only when that owner is its own user; when the
      issue is still free, requirement 14 SHALL apply; when the owner is
      undecidable under requirement 4, requirement 13 SHALL apply; otherwise
      the agent SHALL stop as in the first case.
12. The requirement-11 check SHALL behave identically on GitHub, GitLab, and
    Gitea, through each forge's own command-line tool, consistent with
    `AGENTS.md` → *Forge Access*, and SHALL require no credential beyond the
    one the contributor already holds for that tool. On each forge, the means
    of reading and repairing the assignment record SHALL satisfy
    requirements 1, 4, and 11 as written; where a forge's record cannot
    support one of them, the gap SHALL be documented in `docs/cli-matrix.md`
    and the check SHALL fail closed on that forge under requirement 13.
13. When the agent cannot determine either side of the requirement-11
    comparison — forge unreachable, current user undeterminable, record
    unreadable, or the order of assignments undecidable under requirement 4 —
    it SHALL fail closed, and this requirement SHALL prevail over every
    branch of requirement 11: stop before any authoring action and report what
    could not be determined. When it had already assigned its own user, it
    SHALL report that assignment to the user as left in place; that
    assignment SHALL confer ownership only when requirement 1 grants it, and
    the next pickup of the issue by any contributor SHALL resolve it under
    requirement 11. Proceeding without the check SHALL require the user's
    explicit instruction in the same session.
14. When the agent's own self-assignment under requirement 11 leaves the
    issue free — typically because the forge silently dropped the assignment
    of a contributor without permission to assign themselves, such as a fork
    contributor — the agent SHALL NOT retry the self-assignment in that
    pickup. It SHALL stop before any authoring action, report that the
    assignment could not be recorded, and ask a maintainer, in a comment on
    the issue, to assign the ticket to its user. The ticket SHALL remain free
    until a maintainer records that assignment, and the agent SHALL proceed
    only once it has.
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
And   reports that the assignment record or the current user could not be determined
And   proceeds only if the user explicitly instructs it to in the same session
```

**Scenario:** two assignments recorded at the same instant

```text
Given contributors A and B both took free issue #N, and the forge recorded both assignments at the same instant
When  either contributor's agent runs its ticket-pickup check
Then  it treats neither A nor B as the owner and stops before any authoring action
And   reports that the order of assignments cannot be decided, leaving its own user's assignment in place
When  A and B agree on #N that B takes it, then leave #N free
And   B's agent picks up #N as a free ticket
Then  B's agent assigns B, finds B as the owner, and proceeds
And   A's agent, on a later pickup, refuses #N as owned by B
```

**Scenario:** a stale ticket is taken over openly

```text
Given issue #N is assigned to contributor A
And   A has shown no activity on it for 14 days
When  contributor B comments on #N mentioning A and asking for the ticket
And   A has not answered 7 days later
Then  B may take #N over, leaving it free and then assigning B
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
Then  both find A's assignment first since #N was last free
And   A's agent proceeds
And   B's agent withdraws B's assignment and stops before any authoring action, naming A as the owner
```

**Scenario:** on a forge that replaces assignments, the later self-assignment withdraws

```text
Given issue #N has no assignee, on a forge where a new assignment replaces the current one
And   contributor A's agent assigns A, reads the timeline, finds A as the owner, and proceeds
When  contributor B's agent then assigns B, which replaces A's assignment in one change
And   B's agent determines the owner from the timeline since #N was last free
Then  it finds that A took #N first, the replacement not having made #N free
And   B's agent withdraws B's assignment and restores A's, without #N ever being readable as free
And   B's agent stops before any authoring action, naming A
```

**Scenario:** a session interrupted right after a displacing self-assignment

```text
Given contributor A owns issue #N, on a forge where a new assignment replaces the current one
And   contributor B's agent assigned B, replacing A's assignment, then failed closed before undoing it
When  either contributor's agent next picks up #N
Then  it determines from the record that A still owns #N, the replacement not having made #N free
And   B's agent withdraws B's assignment and restores A's, without #N ever being readable as free, then stops naming A
And   A's agent, if it picks #N up first, restores A's assignment the same way and proceeds
```

**Scenario:** a contributor without assign permission picks up a free ticket

```text
Given issue #N has no assignee
And   contributor F, working from a fork, cannot assign themselves on the reference repository
When  F's agent assigns F and determines the owner again
Then  #N is still free, the forge having dropped the assignment
And   the agent stops before any authoring action and asks a maintainer, in a comment on #N, to assign F
And   the agent does not retry the self-assignment
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
Then  the contributors, by hand or through an agent they explicitly instruct, leave #N free, then assign B
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
