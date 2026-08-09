---
id: "0114"
slug: shared-worktree-agent-isolation
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 736
version: 1.0.0
---

# A whole-tree git operation cannot destroy a sibling agent's uncommitted work

## Intent

A ticket's worktree is shared: every agent staffed on that ticket writes into
one checkout with one index. Whole-tree git operations — the ones that discard,
revert, or relocate uncommitted changes across the entire tree rather than a
named set of files — respect no ownership, so one agent's routine verification
step erases another agent's uncommitted work outright. The erasure announces
nothing: the test suite still runs green at its older case count, the traces
left behind establish that a whole-tree operation happened but not which agent
ran it, and the loss surfaces only when something unrelated happens to notice a
file changed underneath. After this spec, an agent working in a shared worktree
cannot reach a sibling's uncommitted work at all — an operation that would
destroy it does not run, whoever holds the worktree is a question anyone can
answer without asking around, and an outcome an agent reports as green
corresponds to a state that survives the next command.

## Requirements

1. This spec SHALL declare `complexity: standard`, not `small`, for two
   independent reasons. First, its implementation amends
   `docs/agent-team-protocol.md` — an established protocol document that
   `AGENTS.md` → *Agent Team Protocol* refers every team to — and
   `docs/agent-team-protocol.md` → *Standard Team Templates → Template 2*
   already mandates inserting `architect` as step 0 whenever "the documentation
   change modifies an established protocol, convention, or contract", while the
   `small`-tier composition in *Team sizing by complexity* explicitly excludes
   `architect`; the same reasoning settled the tier of
   `specs/0093-worktree-subagent-cwd-guard.md`, which amends the same section.
   Second, requirements 5 through 8 mandate a guarantee with observable state
   that outlives a single agent turn, not protocol prose alone.
2. An agent SHALL NOT perform a whole-tree git operation in a shared worktree
   unless it holds the exclusive claim of requirement 5 on that worktree for the
   whole duration of the operation.
3. The prohibition of requirement 2 SHALL name `git reset --hard`,
   `git checkout -- .`, `git stash`, and `git clean` explicitly, and SHALL
   extend to every other operation that discards, reverts, or relocates
   uncommitted changes across a whole working tree rather than a named set of
   files.
4. A whole-tree git operation SHALL NOT proceed while the worktree carries any
   uncommitted change the acting agent did not author, whether or not the acting
   agent holds an exclusive claim. Holding the claim of requirement 5 SHALL NOT,
   on its own, satisfy this requirement.
5. An agent SHALL be able to take an exclusive claim on a shared worktree and to
   release it, and while one agent holds that claim no other agent SHALL perform
   a whole-tree git operation in the same worktree.
6. An agent SHALL be able to determine whether a shared worktree is currently
   claimed, and which agent holds the claim, without asking any other agent and
   without waiting for another agent to answer.
7. After a claim is released, which agent held the worktree, and when, SHALL
   remain answerable, so that an investigation into a destroyed change names the
   agent that acted rather than the set of agents that had the worktree open.
8. A claim whose holder has ended SHALL NOT block a shared worktree
   indefinitely: an agent SHALL be able to establish that a claim is stale and
   take the worktree over, and doing so SHALL destroy no uncommitted change.
9. An agent that needs to observe a ticket's committed state from a clean tree
   SHALL have an available and documented way to do so that touches no file in
   any shared worktree, and the protocol SHALL present that way as the default
   for verification; the exclusive claim of requirement 5 SHALL be reserved for
   operations that must act on the shared tree itself.
10. An agent SHALL commit the work it authored in a shared worktree before it
    reports a result or hands off, so that no outcome it reports — a passing
    test run above all — exists only in a working tree.
11. When a test suite already constructs the state an agent needs to observe,
    the agent SHALL take its measurement from that suite's own fixture rather
    than from a fresh probe constructed for the occasion, and SHALL treat a
    measurement whose setup cannot be shown to have reached the subject as no
    measurement at all.
12. The rules this spec mandates SHALL be documented where an agent already
    looks for worktree obligations — `docs/agent-team-protocol.md` →
    *Worktree Isolation*, reachable from `AGENTS.md` → *Agent Team Protocol* —
    and SHALL NOT be added to the cross-project global rules source
    `artifacts/core/rules/60-tools.md`.

## Scenarios

**Scenario:** Verification from a clean state destroys nothing

```text
Given a shared worktree in which a tester holds uncommitted work
And a team-lead needs to observe the committed state of a pushed branch
When the team-lead performs that verification the documented default way
Then the observation succeeds
And every uncommitted change in the shared worktree is still present afterwards
```

**Scenario:** A whole-tree operation is refused over a sibling's uncommitted work

```text
Given a shared worktree carrying uncommitted changes an agent did not author
When that agent attempts a whole-tree git operation in the worktree
Then the operation does not proceed
And the agent is told that uncommitted changes it does not own are present
And those changes are still present afterwards
```

**Scenario:** A whole-tree operation is refused without a claim

```text
Given a shared worktree on which one agent holds the exclusive claim
When a second agent attempts a whole-tree git operation in that worktree
Then the operation does not proceed
And the second agent can determine that the worktree is claimed and which agent holds it, without asking that agent
```

**Scenario:** A destroyed change is attributed to the agent that acted

```text
Given a whole-tree git operation ran in a shared worktree and has completed
And its claim has since been released
When an investigation asks which agent held the worktree at that moment
Then the answer names a single agent
And the answer does not require asking any agent to self-report
```

**Scenario:** A claim outlives its holder

```text
Given a shared worktree whose claim is held by an agent that has ended
When another agent needs to act on that worktree
Then it can establish that the claim is stale and take the worktree over
And no uncommitted change in the worktree is destroyed in the process
```

**Scenario:** A reported green run exists only in a working tree

```text
Given an agent has run a test suite that passes against uncommitted work
When the agent reports that result or hands off
Then the report is preceded by a commit of the work it authored
And the reported outcome is reproducible from committed state alone
```

**Scenario:** A measurement is taken from a fresh probe instead of the suite's fixture

```text
Given a test suite already constructs the state an agent needs to observe
When the agent instead constructs a fresh probe for the occasion
And that probe fails before reaching the subject under observation
Then the number it produced is not reported as a measurement
And the measurement is retaken from the suite's own fixture
```

## Out of scope

- **Per-agent worktrees within a ticket** (direction 3 of issue #736). The
  guarantee mandated here removes the hazard that motivates the split, at no
  merge cost, so a second worktree per role would buy isolation the
  requirements already provide while adding a merge step to every ticket. The
  option is deliberately left on the table for a later ticket should the
  claim-and-commit guarantee prove too coarse for the `standard` and `large`
  tiers, where roles genuinely edit in parallel.
- **Recovery of work already destroyed.** The incident behind issue #736 was
  unrecoverable because nothing had been staged; this spec prevents the loss and
  says nothing about salvaging one that has already happened.
- **Cross-ticket worktree isolation**, which `docs/agent-team-protocol.md` →
  *Worktree Isolation* already guarantees and which this spec leaves untouched.
- **Non-git paths to the same damage** — one agent overwriting a file a sibling
  is editing through an ordinary write. That family is governed by
  `specs/0095-orchestrator-deliverable-edit-fence.md` and is a different failure
  mode: it is file-scoped and attributable, where the failure specified here is
  whole-tree and anonymous.
- **A human operator acting outside an agent session.** The requirements bind
  agents working a ticket; a person at a shell in the same worktree is not
  constrained here.
- **A general measurement-methodology document.** Requirement 11 states the one
  rule the incident earns and places it with the worktree obligations per
  requirement 12; a broader treatment of measurement validity is a separate
  ticket.
- **Retro-fitting the claim to worktrees already open** when the implementation
  lands.

## Open questions

- [GROUNDING:] `docs/agent-team-protocol.md` → *Worktree Isolation* exists at
  the path requirement 12 assumes and already carries an analogous
  no-unilateral-destruction discipline (*Stray-file discovery — no unilateral
  action*), but no instance of it names a whole-tree git operation or any notion
  of an exclusive claim. Back-fill responsibility: the implementation pull
  request for this spec SHALL add both to that section in the same diff; no
  separate migration is needed, since the document has a single instance.
- [AUTO-PARKED] Whether an agent that is demonstrably alone in a worktree — a
  `trivial`- or `small`-tier ticket staffed with one editing role — must still
  take the claim of requirement 5 before a whole-tree operation, or may skip it.
  Requirement 4 binds it either way; only the claim ceremony is in question.
  Drafted as written (the claim is unconditional) so the cheaper case is a
  deliberate relaxation rather than a silent gap.
- [AUTO-PARKED] Whether requirement 11's measurement rule belongs with the
  worktree obligations, where requirement 12 places it, or in the `tester`
  skill, where measurement discipline is otherwise authored. Placed with the
  worktree obligations because the destructive operation in issue #736 was taken
  in service of a fresh measurement, so the rule and the prohibition it motivates
  are read together.
