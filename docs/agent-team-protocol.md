<!-- Extracted from AGENTS.md. Cross-references to other sections refer to AGENTS.md. -->

# Agent Team Protocol

<!-- crewrig-doc: published=false -->

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

## On Claude Code CLI (single implicit session team)

Claude Code runs a single implicit session team: the orchestrating session
*is* the team, so there is no team-creation step. Within that implicit team,
the following three primitives are **mandatory**:

1. **`Agent`** — delegate work to a specialist by spawning it with an
   explicit `subagent_type` matching the role (`architect`, `developer`,
   `tester`, `security`, `doc-writer`, `pr-reviewer`, `pr-logbook`, etc.).
   The spawn happens within the implicit session team — there is no
   `TeamCreate`.
2. **`TaskCreate`** — assign **one task per agent role** for tracking. Each
   task targets a specific specialist with a self-contained brief.
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
**the `Agent` spawn effectively non-functional.**

## On CLIs with no multi-agent coordination surface (e.g. Gemini CLI)

A CLI that lacks the `SendMessage` / `TaskCreate` coordination bus reaches
parity through **sequential `Agent` spawns** — first-class guidance, not a
degraded mode. The orchestrator spawns one specialist at a time with an
explicit `subagent_type` matching the role, carrying a self-contained brief
(the spawned agent inherits no conversation context), and aggregates each
result in the orchestrating session before spawning the next role. This
sequential discipline delivers the same specialist division of labour the
coordination bus provides elsewhere.

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

**Cwd verification (every spawned role).** Before issuing its first `Write`, `Edit`, or file-mutating `Bash` call, a sub-agent whose brief names a worktree path (`.worktrees/<ticket-id>/`) as its working location MUST verify that its own working directory resolves inside that worktree. This obligation attaches to the brief's target, not to the role — it applies identically to `developer`, `tester`, `doc-writer`, `architect`, or any other spawned specialist whenever the brief names a worktree path. Embed the following instruction verbatim in the spawned `Agent` prompt whenever the brief targets a worktree:

> Before your first `Write`, `Edit`, or file-mutating `Bash` call, `cd` into `.worktrees/<ticket-id>/` and confirm the resolved working directory (e.g. via `pwd`) actually resolves inside that worktree. If it does not, `cd` into the worktree and re-verify before proceeding — do not issue any mutating call until the check passes.

This is a distinct, actionable check from the "treat the main directory as read-only" expectation above: that sentence states the constraint, this is the step that catches a session whose working directory silently defaulted to the main checkout before any file lands there.

**Stray-file discovery — no unilateral action.** Discovering a file on the main repository checkout that appears misplaced from a worktree-scoped ticket — whether the discoverer is the orchestrator or a sibling sub-agent — does NOT trigger deletion of that file, on sight or by any other means. A file's location does not establish its provenance: a sibling agent's own in-flight write may be transiting through that same path at the moment of discovery, and location alone cannot distinguish an abandoned stray from a write still in progress. Instead:

1. **Flag, don't act.** The discoverer flags the file to the orchestrator (or `team-lead`) for adjudication.
2. **Relocate only after provenance is confirmed.** The file is moved into the correct worktree path only once its provenance has been confirmed — it is never deleted or relocated unilaterally by the discoverer.

**Whole-tree git operations need an exclusive claim over a clean tree.** `git reset --hard`, `git checkout -- .`, `git stash`, and `git clean` — and every other operation that discards, reverts, or relocates uncommitted changes across a whole tree rather than a named set of files — SHALL NOT run inside `.worktrees/<ticket-id>/` unless the acting agent holds the claim below for the **whole duration** of the operation and `git status --porcelain --untracked-files=all` is empty. The claim never waives the clean-tree condition: git records no author for an uncommitted change, so an empty status is the only proof that nothing you did not author is at risk. Their usual motive is verification: use the recipes below instead. The gate reads `git status`, which is blind to a path matched by `.gitignore`, so the guarantee is narrower than *nothing gets destroyed*: no whole-tree operation proceeds over work git can **name** as tracked or untracked. Ignored build output and local scratch are outside it — `git clean -fdx` passes the gate, deletes them, and exits `0` — so adding `-x` or `-X` leaves the claim's cover: enumerate with `git clean -ndx` first, and treat whatever it lists as a sibling's until provenance says otherwise.

**Taking, inspecting, and releasing the claim.** Prefer `run` — it takes the claim, executes, and releases on exit, so *whole duration* is structural.

```sh
bash scripts/worktree-claim.sh run     --agent <name> -- <command…>
bash scripts/worktree-claim.sh take    --agent <name>   # then release --agent <name>
bash scripts/worktree-claim.sh status
```

Exit `4` names the current holder; `5` prints the uncommitted changes that closed the gate. `status` answers without asking any agent; it and `history` also run from the main checkout, given `--ticket <id>`.

**Who held the worktree, after the fact.** `worktree-claim.sh history --ticket <id>` prints the append-only ledger — every take, release, and takeover, with agent, timestamp, and operation. It lives beside the shared `.git`, not in the worktree, so it survives the cleanup below.

**A claim whose holder has ended.** `worktree-claim.sh takeover --agent <name>` transfers a claim untouched for 30 minutes (`--stale-after <minutes>` overrides) and records both agents in the ledger. It rewrites the claim only — never a working-tree file — and grants **no** clean-tree waiver: the gate is re-evaluated on every `take` and `run`, whoever holds the claim.

**Residue left by an agent that ended.** When a takeover finds the tree dirty, adjudicate on authorship, not convenience. Residue you authored: commit it — that is the route back to a clean tree. Residue you did not author is not yours: flag it to `team-lead` under *Stray-file discovery* above and stop — do not commit another agent's work, run a whole-tree operation, or remove the worktree. The orchestrator adjudicates: commit on the branch, respawn the role that owns it, or route to a human operator.

**`git worktree remove --force` is not an escape hatch.** Plain `git worktree remove` exits `128` on a worktree carrying uncommitted changes; `--force` exits `0` having destroyed them. It belongs to the prohibited class above; the refusal is your signal to escalate. The one exception is a scratch tree you created yourself under `$TMPDIR` (Tier 2b).

**Verification without touching a shared worktree — the default.** Reserve the claim for operations that must act on the shared tree itself; observe everything else from outside. `git fetch` writes only into `.git`, never into a working tree, so Tier 1 — inspection — destroys nothing:

```sh
git fetch crewrig <branch>
git --no-pager log --oneline -5 crewrig/<branch>
git --no-pager show "crewrig/<branch>:<path>"
git --no-pager diff crewrig/main...crewrig/<branch>
```

Tier 2, when a check must *execute* against a clean state, extracts it instead of cleaning a shared one:

```sh
scratch="$(mktemp -d)"
git fetch crewrig <branch>
git archive "crewrig/<branch>" | tar -x -C "$scratch"
( cd "$scratch" && bash scripts/tests/<suite>.sh )
rm -rf "$scratch"
```

Tier 2b, when the check needs git metadata or dependencies: `git worktree add --detach "$scratch/tree" <ref>` under `$TMPDIR`, removed with `git worktree remove --force "$scratch/tree"` in the same step.

**Commit before you report or hand off.** No outcome you report — a passing test run above all — may exist only in a working tree. Commit what you authored first, so the result survives from committed state.

**Measure from the suite's own fixture.** When a test suite already constructs the state you need to observe, measure from that fixture, not from a fresh probe. A measurement whose setup cannot be shown to have reached the subject is no measurement at all; report a failed probe, not a number.

**Enforcement.** A REVIEW pass that audits a session in which a whole-tree git operation ran in a shared worktree without a recorded claim SHALL emit a `class: tech` finding citing this section.

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

### Session-boundary worktree hygiene

The per-ticket cleanup above runs at the single moment one ticket's pull request merges. It does not, on its own, account for the whole `.worktrees/` directory at the boundaries of a session — yet a session can begin on top of a backlog left by earlier sessions, and can end for reasons unrelated to any ticket completing (context exhaustion, the user stopping, an unrelated wrap-up). Left unchecked, worktrees whose work has already merged accumulate unnoticed and slow later sessions. The two steps below add session-boundary triggers that **reuse** the ordered cleanup above; they are **additional to, and do not replace,** the per-ticket cleanup that runs the moment a ticket's pull request merges.

Both steps confirm merge status the same way the ordered cleanup's step 1 does — from the pull request's own state, **never** from `git branch --merged`. Under the project's squash-merge workflow a squash-merged branch is not reported as merged by `git branch --merged` (the squash commit does not carry the branch's commits as ancestors), so that signal both misses genuinely-merged worktrees and misreads them as still in flight. Worktrees are keyed by branch name — `.worktrees/<ticket-id>/` has `<branch-name>` checked out — so resolve each worktree's pull request by its head branch:

```sh
gh pr view <branch-name> --repo crewrig/crewrig --json state,mergedAt
```

A `state == MERGED` result is positive confirmation the branch has merged. A branch with no associated pull request, or any result that does not positively confirm `MERGED`, counts as **unconfirmable** — treated as still in flight, never as merged.

**Session start — non-destructive surfacing.** Before opening a new ticket worktree, enumerate the existing worktrees (`git worktree list`), resolve each one's branch to its pull request with the command above, and **report** every worktree whose pull request is `MERGED` as a stale backlog item — so the agent is aware of the accumulated backlog before piling new work on top of it. This step is strictly report-only: it removes no worktree and deletes no branch, so a sibling session's in-flight worktree is never destroyed at another session's start.

**Session end — confirmed-merge sweep.** When the session reaches its end, account for the worktrees under `.worktrees/` and, for every worktree whose pull request is positively confirmed `MERGED` by the command above, remove the worktree together with its local branch by following the ordered cleanup procedure documented earlier in this section (verify the merge landed → `git worktree remove` → `git branch -D` → close the logbook issue) — do not invent a new sequence. A worktree whose pull request is still open, whose branch carries unmerged or uncommitted work, or whose merge status cannot be positively confirmed SHALL be left in place and surfaced for later adjudication — never removed. This mirrors the *Stray-file discovery — no unilateral action* discipline above: a worktree's mere presence or apparent staleness never authorizes removal, and positive confirmation of a merged pull request is the sole precondition for removing any worktree.

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
| `trivial` | No team — orchestrator handles the work inline in a single turn. | Bypasses `spec-author` per *Standard Team Templates → Step 0*. The artifact-validation gate(s) of the declared interaction mode — realised through the `user-validate` skill — and the distinct merge-authorization gate still apply to inline work. |
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

Five rules govern how teammates report back inside a team and how the team-lead interprets their signals.

**Rule 1 — Report before idle.** Every agent operating inside a team
(delegated via `Agent` and tracked via `TaskCreate`) MUST send a message to
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

## Team Shutdown

On Claude Code's single implicit session team there is no team record to
delete — `TeamDelete` has nothing to act on. Shutdown therefore reduces to
a **teammate-conclusion courtesy**: before the orchestrator merges the PR,
closes the logbook, or pivots scope, it MUST confirm that every spawned
`Agent` has reported back per *Team Communication → Rule 1*. Where a result
message has not landed, apply *Rule 3*'s side-effect checks (let the channel
drain, inspect the artifacts the teammate was tasked to produce) to confirm
the work concluded before moving on. No `shutdown_request` round-trip is
required, because a spawned `Agent` releases its resources when its turn
ends — there is no persistent team process to orphan.

**Triggers.** Run the conclusion check above whenever:

- The ticket's PR has been merged and the logbook closed (the standard end-of-ticket path — see *Logbook Issues → Rule C* in AGENTS.md).
- The user cancels the ticket or pivots scope to a different team composition.
- A fatal error makes the current team unrecoverable and a fresh team is needed.

### On a harness that genuinely exposes team primitives

When the harness exposes a persistent team record and teammate processes
(via `TeamCreate` / `TeamDelete`) — which is **not** the current Claude Code
harness; see the single-implicit-team primary path above — the following
two-phase disposal applies.
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

**Prohibition.** Invoking `TeamDelete` without a preceding
`shutdown_request` round-trip for every teammate is a protocol
violation, regardless of whether the teammates appear idle. "Idle" is a
harness display state, not a confirmation that the underlying process
has released its resources.
