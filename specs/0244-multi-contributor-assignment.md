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

1. The assignment recorded on the forge SHALL be the single authoritative
   record of who owns a ticket. An issue with an assignee SHALL be owned by
   that assignee; an issue with no assignee SHALL be free. No other record —
   agent memory, a local file, a chat message — SHALL override it.
2. A ticket owned by one contributor SHALL NOT be worked on by any other
   contributor, nor by an agent acting on another contributor's behalf.
   "Worked on" covers every authoring action that produces a deliverable for
   that ticket: creating its branch, securing its spec id, opening its
   worktree, and opening or pushing to its pull request. Reading the ticket,
   commenting on it, and reviewing its pull request SHALL remain permitted to
   everyone.
3. A contributor taking a free ticket SHALL become its assignee before the
   first authoring action listed in requirement 2. When two contributors
   assign themselves concurrently, the earlier assignment in the forge's issue
   timeline SHALL own the ticket, and the later one SHALL withdraw.
4. An issue SHALL carry at most one assignee. Other contributors SHALL
   participate through comments, review suggestions, or commit co-authorship,
   never through a second assignment. An issue found with several assignees
   SHALL be treated as owned by none of them until they reduce it to one, and
   no agent SHALL start on it in the meantime.
5. Assigning an epic SHALL lock the epic issue only. Each sub-ticket SHALL be
   free or owned according to its own assignment. The epic's assignee SHALL be
   the arbiter of how its sub-tickets are split and distributed, and a
   dispute over a sub-ticket SHALL be settled by that arbiter.
6. A contributor abandoning a ticket SHALL release it explicitly: remove their
   own assignment and leave a status comment stating what is done and what
   remains. A ticket with no remaining work SHALL be closed rather than
   released.
7. A ticket SHALL change owner only with the current assignee's written
   consent, recorded as a comment on the issue, except under the stale-lock
   path of requirement 8.
8. When an owned ticket shows no activity by its assignee for a nudge delay,
   another contributor MAY ask for it in a comment that mentions the assignee.
   If the assignee has not answered within a further grace delay, that
   contributor MAY take the ticket over, leaving a takeover comment that links
   the unanswered request. The defaults SHALL be 14 days for the nudge delay
   and 7 days for the grace delay, and an adopting organization SHALL be able
   to override both. Activity SHALL mean any comment, commit on the ticket's
   branch, or pull-request update by the assignee. A takeover SHALL never be
   silent.
9. No contributor SHALL push to a branch owned by another contributor's
   ticket. Changes proposed to someone else's work SHALL go through review
   suggestions or a pull request that targets their branch.
10. Changes to files that most tickets touch — at least `docs/cli-matrix.md`,
    `AGENTS.md`, `.crewrig/core-paths.txt`, and compiled component outputs —
    SHALL be kept in short-lived pull requests rebased frequently on the
    reference branch, and a change to a shared contract in such a file SHALL
    be announced on the ticket's issue before its pull request is opened.
11. At ticket pickup, before any authoring action listed in requirement 2, an
    agent SHALL compare the issue's assignees with the identity of its current
    forge user:
    - assigned to someone else → the agent SHALL stop, name the assignee, and
      surface the permitted paths (ask the assignee, wait for the stale-lock
      path of requirement 8, or pick another ticket), without creating any
      branch, spec-id reservation, or worktree;
    - assigned to its own user → the agent SHALL proceed;
    - free → the agent SHALL assign its own user, then proceed.
12. The requirement-11 check SHALL behave identically on GitHub, GitLab, and
    Gitea, through each forge's own command-line tool, consistent with
    `AGENTS.md` → *Forge Access*, and SHALL require no credential beyond the
    one the contributor already holds for that tool.
13. When the agent cannot establish either side of the requirement-11
    comparison — forge unreachable, current user undeterminable, or issue
    unreadable — it SHALL fail closed: stop before any authoring action and
    report which side could not be read. Proceeding without the check SHALL
    require the user's explicit instruction in the same session.
14. When the current user lacks the permission to assign themselves — a fork
    contributor without triage rights, for instance — the agent SHALL post a
    claim comment on the free issue and ask a maintainer to record the
    assignment. That claim comment SHALL count as ownership under
    requirement 1 until a maintainer assigns the ticket or 7 days pass
    without an assignment, whichever comes first.
15. The requirement-11 check SHALL be wired into every framework entry point
    that picks up a ticket for authoring, starting with the `spec-author`
    skill, on every supported command-line tool, and each modified skill or
    agent source SHALL carry its version bump per `AGENTS.md` → *Version Bump
    Convention*.
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
Then  B may reassign #N to themselves
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
