# Agent Team Protocol — Team Communication

<!-- crewrig-doc: published=false -->
<!-- markdownlint-disable MD033 -->

<a id="team-communication"></a>

## Team Communication

Six rules govern how teammates report back inside a team and how the team-lead interprets their signals.

<a id="rule-1"></a>

**Rule 1 — Report before idle.** Every agent operating inside a team
(delegated via `Agent`, and tracked via `TaskCreate` when the harness
exposes it) MUST send a message to `team-lead` via `SendMessage` with a
result summary before its turn ends.
Going idle without sending a result message is a protocol violation. The
result message must include: the task identifier, the outcome, and any
artifact (file path, diff summary, verdict, etc.) the team lead needs to
proceed.

<a id="rule-2"></a>

**Rule 2 — Idle fallback.** If a teammate goes idle twice in a row
without reporting back on its assigned task, the team lead MUST NOT send
a third `SendMessage`. Instead, spawn a fresh direct `Agent` with a
self-contained brief — the same brief as the original task, plus context
about what was attempted. Include any state already produced — PR
number, branch name, worktree path, logbook issue — so the fresh spawn
can resume rather than restart from scratch. Direct `Agent` spawns (without team context)
reliably complete and return results; `SendMessage` to a stuck idle
agent does not.

<a id="rule-3"></a>

**Rule 3 — Idle notifications can race result messages.** An `idle_notification` event indicates subagent process/thread idleness at the time of event emission and SHALL NOT be interpreted as a completion signal for a pending `SendMessage` request. When the
team-lead receives an `idle_notification` for a teammate, that signal
does NOT prove the teammate skipped Rule 1. Result messages and idle
notifications travel as separate events on the harness bus, and the
idle notification can arrive first even when the teammate sent its
result correctly. The team-lead SHALL NOT abandon, replace, or terminate an active subagent on the basis of an `idle_notification` alone while a request is pending. Before treating an apparent silence as a Rule 1
violation, the team-lead MUST:

1. **Let the channel drain.** Do not send anything to the idle
   teammate on the same turn the idle notification arrives. The
   in-flight result message — if one exists — will be delivered on
   the team-lead's next turn without any prompting.
2. **Check observable side-effects first.** Inspect the artifacts the
   teammate was tasked to produce: `git status` and `git log` in the
   ticket worktree, `gh pr view <num>` for PR state, the logbook
   issue for comments, or the specific file the task targeted. A
   completed task almost always leaves a trace that confirms the
   outcome without the result message itself.
3. **Only then escalate.** If, after the next turn, no result message
   has landed AND no side-effect confirms completion, treat the
   silence as an actual Rule 1 violation and apply Rule 2 (spawn a
   fresh direct `Agent`). Do NOT send a status-check `SendMessage` to
   the idle teammate — it wastes the teammate's next turn
   re-confirming work already done, and Rule 2 is the prescribed
   remedy for genuine non-response.

Sending a status-check ping on every idle notification is itself a
protocol violation: it manufactures the very noise this rule exists
to prevent.

**Bounded wait before declaring death.** Rules 2 and 3 assume the
team-lead eventually receives *some* signal — a second idle
notification, or one it can reconcile against side-effects. A teammate
can also die with no signal at all: no result message, no idle
notification, no side-effect. To bound this case, the team-lead SHALL
keep a wall-clock waiting budget per spawned teammate — roughly 30
minutes for a `pr-logbook` or `pr-reviewer`, proportionally more for a
long implementation task. When the budget elapses with no result
message and no observable side-effect (checked per Rule 3 step 2), the
team-lead SHALL treat the teammate as dead and apply Rule 2 — spawn a
fresh direct `Agent` with a self-contained brief. The budget is a
backstop, not a substitute for the side-effect check: a teammate whose
work is visibly complete is never declared dead merely because the
budget elapsed.

<a id="rule-4"></a>

**Rule 4 — Review findings are not auto-deferrals; handling is
mode-conditional.** A reviewer's "non-blocking" label means the pull
request *may merge* without that finding — it never means the finding may
be silently dropped or deferred to a follow-up ticket. Blocking findings
are always routed into the fix cycle, in every mode. Non-blocking findings
are routed conditionally on the ticket's declared interaction mode (see
*Interaction modes* in AGENTS.md), matching `specs/0005-retroactive-routing-engine.md`
R10 and the table in [`docs/retroactive-loop.md`](../retroactive-loop.md) →
*Non-blocking conditional routing*:

- **FULL.** The team-lead MUST present every non-blocking finding to the
  user and route only those the user accepts into the fix cycle; the rest
  are journalled in the logbook and left unactioned. The user sets the
  scope, not the reviewer's severity labels. This bounded per-pass triage
  is the sole REVIEW-loop user gate (see *Interaction modes → User-gate
  definition* in AGENTS.md and spec 0006 R10).
- **INTERMEDIATE / MINIMAL / AUTO.** The team-lead MUST route every finding
  — blocking and non-blocking — into the fix cycle automatically, in the
  same session, with no user gate other than the merge authorization; in
  these modes the REVIEW loop fires no triage prompt, so non-blocking
  findings become blocking by default.

In no mode may a finding be deferred to a follow-up ticket without
authorization appropriate to that mode — the user's explicit decision in
FULL, never silently in INTERMEDIATE / MINIMAL / AUTO.

<a id="rule-5"></a>

**Rule 5 — Edit fence for delegated deliverables.** While a deliverable
file is delegated to a sub-agent — i.e. the sub-agent's brief names that
file as its task target — the team-lead (orchestrator) SHALL NOT edit
that file itself until the sub-agent's completion has been confirmed,
either (a) via the sub-agent's own `SendMessage` result per Rule 1, or
(b) via the observable-side-effect check described in Rule 3 step 2. An
`idle_notification` alone is NOT a completion signal: the team-lead MUST
NOT treat receipt of an idle notification, by itself, as license to edit
a file still delegated to that sub-agent.

Rule 5 is the write-side counterpart to Rule 3. Rule 3 already
establishes that an idle notification does not prove a teammate skipped
its Rule 1 report; Rule 5 draws the corresponding consequence for the
team-lead's own edits — the same unreliable signal that must not be
mistaken for completion proof when reading a teammate's status also
must not be acted upon when writing to a file that teammate still owns.

If the team-lead determines that a delegated file needs an additional
change while the sub-agent is still live, it MUST NOT edit the file
directly. Instead it SHALL either:

1. Instruct the still-live sub-agent, via `SendMessage`, to make the
   change itself, rather than taking the edit on directly, or
2. Confirm, per the conclusion check in *Team Shutdown*, that the
   sub-agent has concluded its work — a landed Rule 1 result message, or
   a confirmed side-effect per Rule 3 step 2 — before the team-lead takes
   ownership of the file and edits it directly.

This closes the race observed twice in practice — ticket #569 and the
Harness Curator's `concurrent-deliverable-edit` friction cluster
(issue #602) — where the orchestrator's own completion edits landed on
a file the sub-agent was still editing, on the strength of an idle
notification alone, producing duplicate content that required manual
reconciliation.

<a id="rule-6"></a>

**Rule 6 — Single writer per forge artifact.** A **forge artifact** is
the mutable text body of a pull request, of an issue, or of a comment on
either, and has exactly one writer at any instant. Publishing a **new**
comment creates a new artifact whose writer is its author, leaving the
incremental-logbook practice of `AGENTS.md` → *Logbook Issues → Rule B*
untouched: only editing an already-published body or comment is governed.

**The writer is a role on a ticket, not an agent instance.** Writership
is established at creation and rests with the **role** of the creating
agent, scoped to the artifact's ticket. Any agent of that role acting on
that ticket is the writer, whether or not it created the artifact; one
instance concluding ends nothing and makes no artifact unwritable. No
per-instance identifier or register is wanted.

**Determining the writer, without asking it.** Writership starts at
creation and moves only forward, so an agent about to write walks it
forward rather than reading the latest line:

1. **Start at the creator's role** — the `**Writer:**` line the creating
   role posts inside the logbook entry it already writes for that
   artifact. That role is the writer until a valid handover moves it.
2. **Then apply the handovers, oldest first** — a
   `**Writership handover:**` line moves writership only where its
   left-hand role is the writer the walk has reached, that role being
   the one who posts it. A line naming anyone else on the left is void
   (see *Handover* below), contributes nothing, and does not halt the
   walk: the most recent line is not the answer unless it survives.
3. **Otherwise, you are not the writer.** An agent that cannot determine
   the writer treats itself as not being it.

Both lines ride in comments the ticket already gets; the forge's own
authorship field names the *account*, not the role.

```markdown
**Writer:** `pr-logbook` — PR #734 body
**Writership handover:** PR #734 body — `pr-logbook` → `team-lead`
```

**Already-published comments resolve at step 3, by design.** A
`**Writer:**` line is posted for a pull-request or issue body, never per
comment. A comment's writer is its author when it is published, but
nothing records that, so every later determination resolves at step 3
and the comment is written by nobody from then on — effectively
append-only, as `docs/plan-format.md` → *Append-only revisions* and Rule
B already require. No per-comment writer line is owed; correct a
published comment by posting a new one.

**A non-writer does not write.** An agent that is not the writer and
judges the artifact needs a change either routes it through the current
writer or first receives writership; those two branches are the whole
set. A concluded creating instance does not exhaust them — routing
through the current writer is satisfied by any agent of the writer role
on the ticket — and is never grounds to take writership: not on a
confirmed conclusion, not on a landed completion report, not on an
observed side effect of its work.

**Two live agents of one role — the orchestrator's obligation.** Rule 2's
fresh-spawn remedy can leave two agents of the writer role live on one
ticket. An orchestrator that brings a further agent of that role live
does not direct more than one of them to write a given artifact: each
resolves the walk above to its own role and cannot see that the other
is live. The assertion and lost-update obligations below hold between
agents of one role exactly as between agents of different roles.

**Handover, and who may perform one.** Writership changes hands only
through an explicit handover recorded where a writer determination reads.
A nomination, designation, or purported transfer by an agent that is not
the current writer confers nothing — however explicitly stated, wherever
recorded. An agent offered writership determines the current writer per
the walk above *before* writing, and treats itself as not being the
writer unless that determination names its **role**. Writership never
transfers by assumption, elapsed time, an `idle_notification`, apparent
inactivity, or a peer having finished something related.

**Assert only what you have just observed.** An agent that tells the user
or a peer what a forge artifact currently contains bases that on an
observation no later write has superseded, and carries with it the
last-modification marker the forge reported at that observation. A
read-back is valid until the next writer, not longer.

**Detect the lost update; a success report is not proof.** Observe the
artifact immediately before writing it, then determine whether it moved
between that observation and your write — comparing the last-modification
marker where the forge reports one and the body text itself where it does
not, since the point is to know whether it moved, not to read a
particular field. `gh pr edit` reports success on a lost update, so a
success report is never evidence that nothing was discarded. When it did
move, say so on the ticket's logbook: your write may have discarded
another agent's content, and no ticket carries an unreported overwrite.

**Relation to Rule 5, and to worktree isolation.** Rule 6 is the
forge-side counterpart to Rule 5's file-side edit fence, with one
asymmetry: Rule 5 is conditional — it holds *while* a file is delegated
and lifts when the sub-agent concludes — whereas Rule 6's writership is
unconditional, which is why an instance's conclusion is precisely the
event that must not move it. Worktree isolation affords a forge artifact
no protection whatever, because it lives outside every worktree: two
agents in two isolated worktrees still write one pull-request body
through one forge. Rule 6 closes the race seen on ticket #726 / PR #734.

<a id="rule-7"></a>

**Rule 7 — Anti-permission-laundering via orchestrator takeover.** Any tool call or command execution permission denial reported by a subagent MUST be treated as potentially user-authored. The orchestrator (team-lead) SHALL NOT take over and re-execute a subagent's denied action in the parent session on its own classification. Laundering a subagent's permission denial by re-executing it in the parent session bypasses human review.

When a subagent reports a permission rejection:

1. **Surface to user.** The orchestrator SHALL present the denied action, the tool/command context, and the subagent's report directly to the user.
2. **Wait for decision.** The orchestrator SHALL wait for explicit user approval, modification, or guidance before taking or delegating that action further.
