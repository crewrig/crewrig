<!-- Extracted from AGENTS.md. Cross-references to other sections refer to AGENTS.md. -->

# Agent Team Protocol

Project tickets are multi-step work. They must be treated by a **team of specialist agents**, not by a single agent working solo inline.

The team protocol below governs the **DEV stage** of the lifecycle
defined in [ADR-0010](adr/0010-spec-plan-review-lifecycle.md).
SPECS and PLAN run before DEV (with their own artifacts: a spec file
under `/specs/` and a plan comment on the logbook issue); REVIEW runs
after, and its findings may re-enter DEV (`tech`), PLAN (`arch`), or
SPECS (`spec`) per the routing matrix in *Retroactive review loop*
in AGENTS.md. Templates 1 / 2 / 3 in this section describe how the DEV stage
is staffed for a `standard`-tier ticket; trivial / small / large
tiers adjust the composition per ADR-0010 → *Complexity tiers and
team sizing*.

## When this applies

Any time the agent is asked to treat a project ticket (a GitHub issue, a PR
task, a feature request, or any equivalent unit of tracked work), the
**first action** is to assemble a team of relevant specialist agents sized
to the ticket's scope. This applies even for tickets that look small at
first glance — the cost of assembling a team is low, the cost of solo
rework is high.

## On Claude Code CLI (team support available)

When running on a harness that exposes team-management tools (Claude Code
CLI and equivalent), the following three tools are **mandatory**:

1. **`TeamCreate`** — instantiate a dedicated team for the ticket. Name
   the team after the ticket identifier (e.g. `issue-42-auth-refactor`).
2. **`TaskCreate`** — assign **one task per agent role**. Each task
   targets a specific specialist (`architect`, `developer`, `tester`,
   `security`, `doc-writer`, `pr-reviewer`, `pr-logbook`, etc.) with a
   self-contained brief.
3. **`SendMessage`** — coordinate progress, hand off intermediate
   artifacts, and unblock teammates. All cross-agent communication flows
   through this tool — never through plain text replies.

**Single-source brief rule**: The `Agent` spawn prompt is the
authoritative brief — it must be self-contained because spawned agents
inherit no conversation context. Use `TaskCreate` for tracking only:
its `description` should be a one-liner (e.g. `"Implement feature X — full brief in Agent prompt"`), not a duplicate of the Agent prompt. Never write the same
brief in both places.

**Verified-claim rule**: Technical assertions embedded in a developer
brief (package names, install paths, command flags, file locations,
schema fields, API shapes) MUST be either (a) sourced from the
architect's design output for this ticket, or (b) prefixed inline with
`UNVERIFIED —` so the developer treats them as hypotheses to validate
before acting. The team-lead's own inline guesses are not ground
truth. When `UNVERIFIED` claims accumulate to the point of shaping
the approach, escalate to `architect` for a design pass before
spawning the developer — that is the existing Template 1 step 1, not
a new step.

**Model compatibility rule**: When the orchestrating Claude Code session
runs on a non-Anthropic backend (Ollama, Ollama Cloud, or any
non-default model provider), every spawned `Agent` MUST use the same
model as the parent orchestrator. This is achieved either by passing an
explicit `model` parameter matching the parent model identifier, or by
omitting the `model` parameter to let the harness inherit from the
parent session. A model mismatch causes spawned agents to fail silently
— no output, no file edits, no error — which makes
`TeamCreate`/`TaskCreate`/`Agent` effectively non-functional.

## On CLIs without team support (e.g. Gemini CLI)

When the harness does not expose `TeamCreate` / `TaskCreate` /
`SendMessage`, fall back to **sequential `Agent` spawns** with an
explicit `subagent_type` matching the specialist role. Each spawn must
carry a self-contained brief — the spawned agent inherits no
conversation context. Aggregate results in the orchestrating session
before moving to the next role.

## Solo work prohibition

**Never** treat a multi-step ticket with inline solo work when specialist
agents are available. Inline solo work on a ticket is reserved for trivial
single-file edits explicitly scoped that way by the user. If in doubt,
assemble the team.

**Issue-anchored work forces a team.** When the unit of work references a
tracked GitHub issue number, assembling a team is mandatory: such work
SHALL NOT be downgraded to the `trivial` tier's inline handling on the
basis of perceived small scope. "Small fix" and "scoped solo work" are
orthogonal — a two-line fix on a tracked issue still requires a team. The
trivial single-file inline exemption above applies only to a change the
user explicitly scopes as inline with no tracked issue behind it; it never
applies to issue-anchored work, however small the fix looks.

## Worktree Isolation

Parallel agent teams operating on the same git working directory collide on branch checkout and the staging index, corrupting each other's work. To prevent this, the orchestrating agent **MUST** create a dedicated git worktree **before** issuing any `TaskCreate` call or `Agent` spawn for the ticket:

```sh
git worktree add -b <branch-name> .worktrees/<ticket-id> crewrig/main
```

All file edits performed by the team — by every specialist, without exception — **MUST** happen inside `.worktrees/<ticket-id>/`. The main working directory is off-limits for the duration of the ticket; treat it as read-only.

Before pushing, always rebase the worktree branch against the upstream main to avoid merge conflicts on shared files:

```sh
git fetch crewrig && git rebase crewrig/main
```

If the rebase raises conflicts, resolve them, then `git rebase --continue`. Log the conflict on the issue logbook before resuming (Rule B).

Once the PR is merged and the linked logbook issue closed (see *Logbook Issues → Rule C* in AGENTS.md), clean up the worktree and its branch in this **exact order**:

1. **Verify the merge landed.** `gh pr view <pr-number> --json state,mergedAt` — proceed only when `state == MERGED`.
2. **Remove the worktree.** `git worktree remove .worktrees/<ticket-id>` — this releases the branch reference held by the worktree.
3. **Delete the local branch.** `git branch -D <branch-name>` — required because `gh pr merge --delete-branch` only deletes the **remote** branch; the local ref survives.
4. **Close the logbook issue** per *Logbook Issues → Rule C* (if not already closed by the merge).

**Why this order matters.** Git refuses to delete a branch that is checked out by an active worktree. Running `gh pr merge --delete-branch` (or `git branch -D`) while the worktree still exists fails with `error: cannot delete branch '<name>' checked out at '.worktrees/<ticket-id>'`. Removing the worktree first releases the ref so step 3 can proceed cleanly.

```sh
# canonical sequence
gh pr view <pr-number> --json state,mergedAt
git worktree remove .worktrees/<ticket-id>
git branch -D <branch-name>
gh issue close <issue-number> --reason completed
```

Any obstacle encountered during the worktree lifecycle — merge conflicts, CI failures, friction declarations, scope changes, rebases that resolve conflicts — must be logged on the issue logbook before resuming work. See **Rule B** in AGENTS.md for the full trigger list.

## Built Components

Source files under `artifacts/` are compiled into `.gemini/` and `.claude/` by `scripts/build-components.sh`. The CI `check-components` job fails if the built outputs drift from sources.

**Rule:** any commit that modifies a file under `artifacts/` MUST also run `bash scripts/build-components.sh` and stage the regenerated outputs in the same commit or an immediately following one — never deferred to a separate PR.

**Verify before push:** run `bash scripts/build-components.sh` after staging. A clean `git status --porcelain` means no drift.

This rule applies to every role — doc-writer edits to `SKILL.md`, architect edits to `AGENT.md`, and pr-reviewer self-edits all count. The CI job is a backstop; this rule closes the loop before push.

## Standard Team Templates

Every role in the templates below operates inside the ticket worktree as
required by the rule above.

Agents **MUST** use the closest matching template below as the starting team
composition. Adjust by dropping a role only when the ticket's scope explicitly
excludes it, or by adding a role when the change crosses a specialist's
trigger surface (e.g. `security`, `architect`). Either adjustment requires a
one-line rationale in the task handoff comment. Ad-hoc partial crews —
omitting roles without justification — are prohibited.

The templates below describe the **`standard`**-tier composition.
Trivial / small / large tickets follow the tier-specific rules in
*Team sizing by complexity* below; consult that section before
spawning a team.

**Security rule (applies to all templates):** When a change touches the
security skill's trigger surface (authentication, authorization, secrets,
cryptography, input parsing, deserialization, network calls, or dependency
upgrades), insert `security` after `developer` in the applicable template.

### Step 0 — `spec-author` (every non-trivial template)

Templates 1, 2, and 3 below describe the DEV-stage staffing of the
ADR-0010 lifecycle. Before any of them runs, the `spec-author` skill
authors the SPECS-stage artifact: a single Markdown file under
`/specs/` conforming to `docs/spec-format.md`. The skill is invoked
once per ticket, in the mode declared by the parent ticket (default
INTERMEDIATE per ADR-0010).

The skill runs as step 0 for every ticket whose complexity tier is
NOT `trivial` (ADR-0010 → *Complexity tiers and team sizing*).
`trivial`-tier tickets bypass `spec-author` entirely; the orchestrator
handles them inline per the trivial-tier row of the ADR.

The spec PR SHALL be merged before the team proceeds to PLAN/DEV. The
ordering is enforced by the spec-PR workflow (#170) — agents do not
hand-roll it.

### Template 1 — Feature implementation (results in a PR)

Preceded by step 0 (spec-author) — see the subsection above.

Full pipeline. Every role is mandatory unless explicitly scoped out by the
user.

| Order | Role | Responsibility |
|---|---|---|
| 1 | `architect` | Design review, ADR if needed, blast-radius check |
| 2 | `developer` (×N) | Implementation in the worktree |
| 3 | `tester` | Write / update tests |
| 4 | `pr-logbook` | Draft PR title, body, and logbook entry |
| 5 | `pr-reviewer` | Independent cold review of the diff; verifies CI checks pass before posting verdict |

**REVIEW is a looping stage**, not terminal — the orchestrator follows the routing engine documented in [`docs/retroactive-loop.md`](retroactive-loop.md) until the termination criterion is met.

**Ordering constraint:** `pr-logbook` MUST open the PR (or hand the complete
draft to `team-lead` for opening) before `pr-reviewer` is spawned. The
orchestrator MUST NOT parallelise these two roles — `pr-reviewer` cannot
fulfill its cold-start contract without a valid PR number. `pr-reviewer`
receives the PR number from `pr-logbook`'s result message (see *Team
Communication → Rule 1*).

**Shared-identity workaround:** When the orchestrator and `pr-reviewer` share the same GitHub identity (common in solo-dev setups), GitHub rejects `gh pr review --approve` with "Can not approve your own pull request"; in that case `pr-reviewer` MUST post its verdict as a regular PR comment opening with a `## Verdict: APPROVE` or `## Verdict: REQUEST CHANGES` header. This applies to every template below that includes `pr-reviewer`.

Use multiple `developer` agents in parallel when the work decomposes into
independent files or modules; a single developer suffices otherwise.

### Template 2 — Documentation-only change

Preceded by step 0 (spec-author) — see the subsection above.

Lighter pipeline — no code, no tests.

| Order | Role | Responsibility |
|---|---|---|
| 1 | `doc-writer` | Write / update the documentation |
| 2 | `pr-logbook` | Draft PR title, body, and logbook entry |
| 3 | `pr-reviewer` | Independent cold review of the diff; verifies CI checks pass before posting verdict |

**REVIEW is a looping stage**, not terminal — the orchestrator follows the routing engine documented in [`docs/retroactive-loop.md`](retroactive-loop.md) until the termination criterion is met.

**Ordering constraint:** `pr-logbook` MUST open the PR (or hand the complete
draft to `team-lead` for opening) before `pr-reviewer` is spawned. The
orchestrator MUST NOT parallelise these two roles — `pr-reviewer` cannot
fulfill its cold-start contract without a valid PR number. `pr-reviewer`
receives the PR number from `pr-logbook`'s result message (see *Team
Communication → Rule 1*).

If the documentation change modifies an established protocol, convention, or
contract (e.g. AGENTS.md itself), insert `architect` as step 0.

### Template 3 — Bug fix

Preceded by step 0 (spec-author) — see the subsection above.

Test-first pipeline: the failing regression test is written before the fix
to lock in reproduction.

| Order | Role | Responsibility |
|---|---|---|
| 1 | `tester` | Write a failing regression test that reproduces the bug |
| 2 | `developer` | Implement the fix until the regression test passes |
| 3 | `pr-logbook` | Draft PR title, body, and logbook entry |
| 4 | `pr-reviewer` | Independent cold review of the diff; verifies CI checks pass before posting verdict |

**REVIEW is a looping stage**, not terminal — the orchestrator follows the routing engine documented in [`docs/retroactive-loop.md`](retroactive-loop.md) until the termination criterion is met.

**Ordering constraint:** `pr-logbook` MUST open the PR (or hand the complete
draft to `team-lead` for opening) before `pr-reviewer` is spawned. The
orchestrator MUST NOT parallelise these two roles — `pr-reviewer` cannot
fulfill its cold-start contract without a valid PR number. `pr-reviewer`
receives the PR number from `pr-logbook`'s result message (see *Team
Communication → Rule 1*).

`architect` is optional: include it only when the root cause exposes a
design flaw rather than a localized defect.

## Team sizing by complexity

The complexity tier declared in a spec's frontmatter (per ADR-0010 →
*Complexity tiers and team sizing* and
[`specs/0006-interaction-modes-and-sizing.md`](../specs/0006-interaction-modes-and-sizing.md)
R4) determines the DEV-stage team composition. The orchestrator reads
the tier once at ticket pickup and spawns the matching team. The four
tiers and their exact compositions:

| Tier | DEV-stage team | Notes |
|---|---|---|
| `trivial` | No team — orchestrator handles the work inline in a single turn. | Bypasses `spec-author` per *Standard Team Templates → Step 0*. The `AskUserQuestion` and merge-authorization gates of the declared interaction mode still apply to inline work. |
| `small` | `developer` + `pr-logbook` + `pr-reviewer`. | No `architect` (the spec is its own architectural input). No `tester` unless the change carries a test surface; when added, slot `tester` between `developer` and `pr-logbook`. The *Security rule* still applies. |
| `standard` | The matching Template (1 / 2 / 3) from *Standard Team Templates* above, unchanged. | Default tier when the frontmatter is silent. |
| `large` | `architect`-led decomposition into one or more sub-specs **before** any `developer` spawn. | Each sub-spec is a separate ticket with its own SPECS-stage entry (a new spec file under `/specs/`, a new spec-PR, a new implementation-PR). The parent ticket coordinates; it does not implement. |

**Selection rule.** The orchestrator SHALL read the `complexity`
field from the merged spec's frontmatter at ticket pickup and SHALL
NOT re-evaluate it mid-lifecycle. Per ADR-0010, the tier — like the
interaction mode — is immutable once SPECS merges; correcting a
mis-tagged tier requires a delta-spec PR routed through the
retroactive review loop (`class: spec`).

**Independence from interaction mode.** The tier and the interaction
mode are orthogonal axes. Any combination is legitimate
(e.g. `trivial` + `FULL`, `large` + `AUTO`) and the orchestrator
SHALL NOT reject a spec on the basis of an unusual combination
(spec 0006 R1). The mode governs user gating per *Interaction modes →
Behavioral contract per (mode × stage) cell* in AGENTS.md; the tier governs team
composition per the table above.

**Spec-reviewer obligation.** When a spec-PR is cold-reviewed, the
reviewer MUST challenge a tier that appears under-stated relative
to the spec's declared blast radius (the union of
`## Requirements` and the file paths the spec touches). The
challenge is emitted as a `class: spec` finding citing this
section — see
[`artifacts/core/skills/pr-reviewer/SKILL.md`](../artifacts/core/skills/pr-reviewer/SKILL.md)
→ *Spec-review obligation — tier challenge*. Over-statement is a
non-blocking observation, not a blocking finding.

## Team Communication

Four rules govern how teammates report back inside a team and how the team-lead interprets their signals.

**Rule 1 — Report before idle.** Every agent operating inside a team
(spawned via `TeamCreate` / `TaskCreate`) MUST send a message to
`team-lead` via `SendMessage` with a result summary before its turn ends.
Going idle without sending a result message is a protocol violation. The
result message must include: the task identifier, the outcome, and any
artifact (file path, diff summary, verdict, etc.) the team lead needs to
proceed.

**Rule 2 — Idle fallback.** If a teammate goes idle twice in a row
without reporting back on its assigned task, the team lead MUST NOT send
a third `SendMessage`. Instead, spawn a fresh direct `Agent` with a
self-contained brief — the same brief as the original task, plus context
about what was attempted. Include any state already produced — PR
number, branch name, worktree path, logbook issue — so the fresh spawn
can resume rather than restart from scratch. Direct `Agent` spawns (without team context)
reliably complete and return results; `SendMessage` to a stuck idle
agent does not.

**Rule 3 — Idle notifications can race result messages.** When the
team-lead receives an `idle_notification` for a teammate, that signal
does NOT prove the teammate skipped Rule 1. Result messages and idle
notifications travel as separate events on the harness bus, and the
idle notification can arrive first even when the teammate sent its
result correctly. Before treating an apparent silence as a Rule 1
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

**Rule 4 — Review findings are not auto-deferrals; handling is
mode-conditional.** A reviewer's "non-blocking" label means the pull
request *may merge* without that finding — it never means the finding may
be silently dropped or deferred to a follow-up ticket. Blocking findings
are always routed into the fix cycle, in every mode. Non-blocking findings
are routed conditionally on the ticket's declared interaction mode (see
*Interaction modes* in AGENTS.md), matching `specs/0005-retroactive-routing-engine.md`
R10 and the table in [`docs/retroactive-loop.md`](retroactive-loop.md) →
*Non-blocking conditional routing*:

- **FULL / INTERMEDIATE.** The team-lead MUST present every non-blocking
  finding to the user and route only those the user accepts into the fix
  cycle; the rest are journalled in the logbook and left unactioned. The
  user sets the scope, not the reviewer's severity labels.
- **MINIMAL / AUTO.** The team-lead MUST route every finding — blocking and
  non-blocking — into the fix cycle automatically, in the same session,
  with no user gate other than the merge authorization; in the autonomous
  modes there is no user to defer to, so non-blocking findings become
  blocking by default.

In no mode may a finding be deferred to a follow-up ticket without
authorization appropriate to that mode — the user's explicit decision in
FULL / INTERMEDIATE, never silently in MINIMAL / AUTO.

## Team Shutdown

Calling `TeamDelete` directly — without first requesting each teammate's
shutdown — leaves teammates running as orphaned idle processes on the
harness. This is a protocol violation. Every team disposal MUST follow
the two-phase sequence below.

**Phase 1 — Request shutdown from every teammate.** For each teammate
still registered on the team, the team-lead sends a structured shutdown
request via `SendMessage` and waits for the matching response before
moving on:

1. `SendMessage({to: "<teammate>", message: {type: "shutdown_request"}})`
2. Await the teammate's reply: `{type: "shutdown_response", request_id: "...", approve: true}`. Approving the request terminates the teammate's process — that is the intended effect.
3. If a teammate replies with `approve: false`, the team-lead MUST resolve the blocker the teammate cites (in `reason`) before retrying. Forcing `TeamDelete` over an explicit rejection discards in-flight work.
4. If a teammate goes idle without responding, apply *Team Communication → Rule 3* (let the channel drain, check side-effects) before escalating. If the silence persists past the next turn, the team-lead MAY proceed to Phase 2 for that teammate only, after recording the unresponsive shutdown in the logbook (see *Logbook Issues → Rule B* in AGENTS.md).

**Phase 2 — Dispose of the team.** Once every teammate has either
approved its shutdown or been declared unresponsive per Phase 1 step 4,
call `TeamDelete` to remove the team record itself.

**Triggers.** Run the sequence above whenever:

- The ticket's PR has been merged and the logbook closed (the standard end-of-ticket path — see *Logbook Issues → Rule C* in AGENTS.md).
- The user cancels the ticket or pivots scope to a different team composition.
- A fatal error makes the current team unrecoverable and a fresh team is needed.

**Prohibition.** Invoking `TeamDelete` without a preceding
`shutdown_request` round-trip for every teammate is a protocol
violation, regardless of whether the teammates appear idle. "Idle" is a
harness display state, not a confirmation that the underlying process
has released its resources.
