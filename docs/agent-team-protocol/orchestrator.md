# Agent Team Protocol — Orchestrator rules

<!-- crewrig-doc: published=false -->
<!-- markdownlint-disable MD033 -->

<a id="when-this-applies"></a>

## When this applies

Any time the agent is asked to treat a project ticket (a GitHub issue, a PR
task, a feature request, or any equivalent unit of tracked work), the
**first action** is to assemble a team of relevant specialist agents sized
to the ticket's scope. This applies even for tickets that look small at
first glance — the cost of assembling a team is low, the cost of solo
rework is high.

<a id="claude-code-implicit-team"></a>

## On Claude Code CLI (single implicit session team)

Claude Code runs a single implicit session team: the orchestrating session
*is* the team, so there is no team-creation step. Within that implicit team,
the following two primitives are confirmed present in the harness's tool
surface and **mandatory**:

1. **`Agent`** — delegate work to a specialist by spawning it with an
   explicit `subagent_type` matching the role (`architect`, `developer`,
   `tester`, `security`, `doc-writer`, `pr-reviewer`, `pr-logbook`, etc.).
   The spawn happens within the implicit session team — there is no
   `TeamCreate`.
2. **`SendMessage`** — coordinate progress, hand off intermediate
   artifacts, and unblock teammates. All cross-agent communication flows
   through this tool — never through plain text replies.

**`TaskCreate`** — assign **one task per agent role** for tracking — is
used when the harness exposes it, but is confirmed absent from the
current Claude Code harness's tool surface (`docs/cli-matrix.md` →
*Parity gaps*, issue #1267). That absence is neither a protocol
violation an agent must work around nor a condition a REVIEW pass may
cite for a `tech`-class finding; proceed with `Agent` and `SendMessage`
alone when `TaskCreate` is unavailable.

**Single-source brief rule**: The `Agent` spawn prompt is the
authoritative brief — it must be self-contained because spawned agents
inherit no conversation context. When `TaskCreate` is available, use it
for tracking only: its `description` should be a one-liner (e.g.
`"Implement feature X — full brief in Agent prompt"`), not a duplicate of
the Agent prompt. Never write the same brief in both places.

**Handoff reference rule**: Every non-seat `Agent` spawn brief carries the
`handoff_key` (bare decimal ticket number) and the handoff drawer id (the
`drawer_id` of the `[TASK:ongoing]` drawer found by sweep step 2; omit when
none exists). The subagent never runs the sweep, MAY make one
`mempalace_get_drawer` call when its task needs it, and reports its outcome in
its final report; the orchestrator writes the handoff drawer and the diary
entry once.

**Seat brief lint rule**: The orchestrator SHALL run
`scripts/check-seat-brief.ts` on every seated-pass brief before the spawn and
SHALL NOT spawn on a non-zero exit (form check only; see
`docs/reviewer-seat.md` → *Instantiating a seated pass*).

**Role-file citation rule**: A spawn brief cites
`docs/agent-team-protocol/<role-file>.md#<anchor>` for the role it spawns,
using the table in [`docs/agent-team-protocol.md`](../agent-team-protocol.md),
not the whole protocol.

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

**User-intent fidelity rule**: When an `Agent` spawn brief restates a
proposal the user has already made, the part of the brief stating what
the user asked for SHALL quote the user's own wording verbatim — a
direct quote, not a paraphrase. The spawned agent MAY be asked to
identify risks or implementation concerns with that proposal, but the
proposal itself SHALL NOT be presented as one option among alternatives
the agent is free to invent or prefer in its place. Before adopting a
sub-agent recommendation that changes, narrows, or reframes the user's
original proposal, the orchestrator SHALL re-check that recommendation
against the user's literal statement — recovered from the conversation
itself, not from an intermediate summary — and SHALL surface any
discrepancy to the user rather than silently adopting the reframed
version. This rule applies to every `Agent` spawn whose brief restates
a user proposal, regardless of the spawned role (`architect`,
`developer`, or any other specialist).

**Model compatibility rule**: When the orchestrating Claude Code session
runs on a non-Anthropic backend (Ollama, Ollama Cloud, or any
non-default model provider), every spawned `Agent` MUST use the same
model as the parent orchestrator. This is achieved either by passing an
explicit `model` parameter matching the parent model identifier, or by
omitting the `model` parameter to let the harness inherit from the
parent session. A model mismatch causes spawned agents to fail silently
— no output, no file edits, no error — which makes
**the `Agent` spawn effectively non-functional.**

Since spec 0200, a compiled Claude Code or Antigravity CLI agent output's
`description` may carry guidance prose naming the Anthropic or Google
model that agent's declared capability profile resolves to (spec 0197
R14, spec 0198). **That guidance prose is a statement of the work's
need, and it is subordinate to this rule wherever the two disagree.** On
a non-default model provider, the rule's own resolution — matching the
parent orchestrator's model, by explicit parameter or by inheritance —
governs the spawn; the compiled prose is advisory and never overrides it.
No mapping and no agent source changes on this account: spec 0197 R14
forbids the guidance prose from introducing a frontmatter field, so it
can never force a spawn's model by itself, and this statement exists so
a session on a non-default provider is not directed into the silent-
failure mode this rule exists to prevent.

### Conditional plan review

At the `standard` tier the cold plan review is a conditional template step.
Before spawning the second `architect`, run
`node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-plan-review.ts <spec-path> <plan-path>`
(or `task check-plan-review -- <args>`), post its output verbatim in the
PLAN logbook comment, and pass `--prior-review` once any comment carrying a
`seat: plan/<ticket>` line exists on the logbook issue. `required` means the
review runs; `skipped` means it does not, though you MAY run it anyway.
Rule: [`docs/plan-review-protocol.md`](../plan-review-protocol.md) →
*Conditional review*.

### Waiting rules in a worker brief

Every brief for a worker or a `pr-reviewer` carries these two rules:

- **One call to wait for CI.** Run `gh pr checks <n> --watch` as one background command; it exits when no check is pending. Never poll with `sleep`, `until` loops, a monitor or repeated `gh pr checks` and `ci-preflight` calls: each call re-reads a large context. A check still pending after its workflow run is `completed/success` is a ghost check and counts as resolved when the merge state is `CLEAN`.
- **Never end a turn to wait.** Do not end a turn to wait for CI or for a subagent: nothing wakes a session in that state. End a turn only on a question to the coordinator or on the worker's final report.

### Output hygiene and stage-scoped sessions in a worker brief

Every brief for a worker or a `pr-reviewer` also carries these four rules, with
this wording, because every tool result stays in context and is re-read on each
later call:

- Query `gh` with `--json` and `--jq` fields, never the full payload.
- `tail` or `grep` logs down to the failing lines.
- Read files by line range, never a whole spec.
- Run `git diff --stat` before reading hunks.

A worker also scopes its session by stage. It hands each heavy stage (DEV,
REVIEW) to a fresh subagent with a self-contained brief and keeps only that
subagent's result, or it compacts its own context between stages. It never
carries the raw output of one heavy stage into the next.

<a id="coordinator-playbook"></a>

## Coordinator playbook

A coordinator is the session that owns a multi-ticket run and assigns one
worker session per ticket or ticket group. The playbook is tool-agnostic: it
says what the coordinator decides and what the brief carries, never how a
given tool delivers it. Every coordinator call re-reads a large context, so
each rule below removes a call or a decision from the workers.

1. **Size before assignment.** Decide the tier, whether a spec or delta-spec is
   needed, the interaction mode and the branch name, and write them in the
   brief. A worker is never left to choose the tier, least of all under a "no
   new issues" constraint, where open sizing drifts toward delta-specs.
2. **Group by area.** Tickets that share files or a spec go to one worker and
   one PR. Check the shared files of the whole run before assigning work.
3. **Pre-authorise merges.** The owner grants the authorisation and the
   coordinator relays it in the brief under explicit conditions: the latest
   review pass has no blocking finding, every required check is green, and the
   branch is up to date with the target. It is the merge permission of
   `AGENTS.md` given in advance, never a replacement for it. The worker merges,
   then reports; it does not ask. A denied merge is retried once, then
   escalated to the owner through the coordinator, never delegated to a
   sibling.
4. **Trust worker evidence.** Re-verify a PR only on a gap or a contradiction
   in the final report, or by sampling. Re-reading every PR before approval
   repeats work the workers already evidenced.
5. **Intervene on defects only.** Mid-flight, step in for a defect (a failing
   check, a violated rule, a wrong scope), never for a style preference. A
   preference becomes a follow-up item for the owner after the run.
6. **Pick the coordinator model.** A mid-tier model by default; the top-tier
   model only on the owner's request. Coordination is routing and checking,
   not deep reasoning.
7. **Carry the hygiene rules in the brief.** Include the sections *Waiting
   rules in a worker brief* and *Output hygiene and stage-scoped sessions in a
   worker brief* above: copy their bullets verbatim into the brief and
   point back to those sections; never paraphrase or restate them here.

The reusable brief is in
[`worker-brief-template.md`](worker-brief-template.md). At the end of a run the
coordinator reports its own calls and tokens, to compare runs.

<a id="no-coordination-surface"></a>

## On CLIs with no multi-agent coordination surface (e.g. Gemini CLI)

A CLI that lacks the `SendMessage` / `TaskCreate` coordination bus reaches
parity through **sequential `Agent` spawns** — first-class guidance, not a
degraded mode. The orchestrator spawns one specialist at a time with an
explicit `subagent_type` matching the role, carrying a self-contained brief
(the spawned agent inherits no conversation context), and aggregates each
result in the orchestrating session before spawning the next role. This
sequential discipline delivers the same specialist division of labour the
coordination bus provides elsewhere.

<a id="solo-work-prohibition"></a>

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

<a id="team-shutdown"></a>

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

<a id="harness-team-primitives"></a>

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
4. If a teammate goes idle without responding, apply *Team Communication → Rule 3* (let the channel drain, check side-effects) before escalating. If the silence persists past the next turn, the team-lead MAY proceed to Phase 2 for that teammate only, after recording the unresponsive shutdown in the logbook (see *Logbook Issues → Rule B* in AGENTS.md). The orchestrator is the single writer of every seat ledger comment ([`docs/reviewer-seat.md`](../reviewer-seat.md) → *Seat ledger*).

**Phase 2 — Dispose of the team.** Once every teammate has either
approved its shutdown or been declared unresponsive per Phase 1 step 4,
call `TeamDelete` to remove the team record itself.

**Prohibition.** Invoking `TeamDelete` without a preceding
`shutdown_request` round-trip for every teammate is a protocol
violation, regardless of whether the teammates appear idle. "Idle" is a
harness display state, not a confirmation that the underlying process
has released its resources.
