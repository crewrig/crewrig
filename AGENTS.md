# CrewRig — Agent Working Rules

This document defines the rules and conventions that all agents (human or AI) must follow when contributing to this project.

## What is CrewRig?

CrewRig is a centralized configuration framework for Gemini CLI, Claude Code,
and GitHub Copilot CLI. Any agent loading this file should understand these
five pillars without needing to read README.md or ADRs:

1. **Layered context system engineering** — 00–60 priority files deployed to
   CLI user directories (`~/.gemini/`, `~/.claude/rules/`,
   `~/.copilot/instructions/`) that shape how AI assistants behave for a
   specific user's role, team, and seniority.
2. **Shared cross-tool memory** — MemPalace provides persistent agent memory
   accessible across tools and sessions, enabling continuity between Gemini
   CLI, Claude Code, and Copilot CLI.
3. **Skill/agent/command creation and sharing** — `artifacts/` is the
   single-source zone where skills, agents, and commands are authored once;
   `scripts/build-components.sh` compiles them into outputs for all three CLIs.
4. **Harness engineering** — a built-in feedback loop where agents invoke the
   `harness-report` skill to tag frictions during real work, and the
   `harness-curator` skill clusters those frictions into actionable GitHub
   issues.
5. **Multi-CLI parity** — features are implemented symmetrically across Claude
   Code, Gemini CLI, and GitHub Copilot CLI. Silent asymmetry is prohibited;
   every parity gap requires concrete evidence that the missing mechanism does
   not exist in the target CLI.

## Session Bootstrap

**Before any work begins**, the agent SHALL run the complete deterministic
session-start sweep defined in
`artifacts/core/rules/60-tools.md` → *Memory Activation Protocol → Session Start*
(all six steps, in order). The project-specific parameter for step 3 is
`wing="crewrig"`, `room="task-handoff"`.

Skipping the sweep is a process violation equivalent to missing a lifecycle
stage. A REVIEW pass that audits a session where the sweep was omitted SHALL
emit a `class: tech` finding citing this section.

## Lifecycle

Every non-trivial ticket SHALL flow through the four-stage lifecycle
**SPECS → PLAN → DEV → REVIEW**. REVIEW loops back into the upstream
stage corresponding to the class of each finding (`tech` → DEV,
`arch` → PLAN, `spec` → SPECS). The lifecycle terminates only when a
full REVIEW pass produces zero findings.

```text
   user intent
       │
       ▼
┌──────────────┐    spec PR    ┌──────────────┐
│   SPECS      │ ───────────▶  │  spec merged │
│  (WHAT)      │  /specs/<id>  │  on main     │
└──────┬───────┘               └──────┬───────┘
       │                              │
       │ (loop on spec finding)       ▼
       │                       ┌──────────────┐
       │                       │    PLAN      │  reviewed in
       │                       │   (HOW)      │  logbook issue
       │                       └──────┬───────┘
       │                              │
       │ (loop on arch finding)       ▼
       │                       ┌──────────────┐
       │                       │     DEV      │  feature branch + PR
       │                       └──────┬───────┘
       │                              │
       │ (loop on tech finding)       ▼
       │                       ┌──────────────┐
       └───────────────────────│   REVIEW     │
                               └──────┬───────┘
                                      │ clean
                                      ▼
                                    MERGE
```

The full contract — stage definitions, transition rules, finding
taxonomy, routing matrix, complexity tiers, and termination criterion
— lives in [ADR-0010](docs/adr/0010-spec-plan-review-lifecycle.md).
The file format for the spec artifact produced by the SPECS stage —
frontmatter schema, mandatory body sections, delta-spec convention,
and naming rules — lives in [`docs/spec-format.md`](docs/spec-format.md).
The sections below (*Agent Team Protocol*, *Interaction modes*,
*Retroactive review loop*) layer the operational rules onto that
contract.

## Language

All **project content must be written in English**. "Project content" covers
every artifact that lands in the repository or on GitHub — there are no
exceptions for "internal" notes, draft documents, or AI-authored prose.

This includes, but is not limited to:

- **File content in the repository** — source code, inline comments,
  documentation prose, READMEs, ADRs, RFCs, configuration files, shell
  scripts, and every framework artifact (`SKILL.md`, `AGENT.md`,
  `AGENTS.md`, `CLAUDE.md`, etc.).
- **GitHub artifacts** — commit messages, PR titles, PR bodies, PR review
  comments, issue titles, issue bodies, and every comment posted on an
  issue or PR (including incremental logbook updates).

**Decision rule:** *Is this landing in the project or on GitHub?* → English
only.

**Exception:** Interpersonal interactions between the user and the agent
(chat sessions, transient terminal output) MUST be conducted in the **User
Preferred Language**. This exception covers only ephemeral dialogue — the
moment content is committed, pushed, or posted to GitHub, the English-only
rule takes over.

## Branching Strategy

- The primary branch is `main`, linked to the `origin` remote (GitHub).
- The `main` branch is **protected**: no direct pushes allowed.
- Every change must go through a **feature branch** merged into `main` via a Pull Request.
- **NEVER merge a Pull Request (PR/MR)** without asking for the user's formal permission JUST BEFORE executing the merge.
- The `import/gitlab` branch tracks the legacy GitLab project (`gitlab` remote) and serves as inspiration only.
- Non-trivial tickets follow the **Spec-PR workflow** (see section below): a `spec/<NNNN>-<slug>` PR qualifies the WHAT and merges to `main` before the implementation branch is cut.

## Spec-PR workflow

This section operationalises the SPECS stage of the lifecycle defined in
[ADR-0010](docs/adr/0010-spec-plan-review-lifecycle.md) — specifically
the *Stage definitions → SPECS* contract — and the two-PR convention
mandated by [`specs/0003-spec-pr-workflow.md`](specs/0003-spec-pr-workflow.md).
The SPECS-stage artifact (a single Markdown file under `/specs/`) MUST
ship as its own pull request — the **spec-PR** — and be merged to `main`
**before** any implementation branch for the same ticket is opened.
This keeps the WHAT auditable as a standalone diff and decouples the
qualification timeline from the realization timeline.

### Branch naming

- Initial spec-branch: `spec/<NNNN>-<slug>` — where `<NNNN>` is the
  zero-padded spec id and `<slug>` is the kebab-case slug. Both values
  MUST match the spec file's frontmatter `id` and `slug` fields; the
  schema is defined in [`docs/spec-format.md`](docs/spec-format.md).
- Delta-spec branch (produced by a `spec`-class iteration of the
  *Retroactive review loop*): `spec/<NNNN>-<slug>-delta-<NN>` — where
  `<NN>` is the zero-padded delta sequence number for that spec id.

### One-file rule

A spec-branch SHALL contain **exactly one new file** under `/specs/`
and nothing else. No co-mingling with implementation edits, no
incidental fixes, no build outputs. The rationale: the spec-PR is the
auditable artifact of qualification — its diff must be reviewable as a
self-contained WHAT, without the reader having to mentally subtract
unrelated changes.

### Ordering rule

The spec-PR MUST merge to `main` **before** the implementation branch
is cut. The four valid implementation-branch prefixes — `feat/`,
`fix/`, `docs/`, `refactor/` — all follow the `<prefix>/<NNNN>-<slug>`
suffix convention so that implementation work traces back to its spec
id by branch name alone. Cutting an implementation branch while the
corresponding spec-PR is still open is a process violation; the
*Retroactive review loop* surfaces this as a `class: tech` finding
(see the rule there).

### Independence rule

The spec-PR and the implementation-PR are **independent pull
requests**: each closes its own GitHub issue via its own
`Closes #<related-issue>` directive, and the implementation-PR MUST
NOT auto-close the spec-PR. Treating them as a single coupled unit
would defeat the purpose of the two-PR flow — qualification and
realization are deliberately separated so that a merged spec can
outlive a failed implementation attempt and be re-realized by a
later PR without information loss.

### Delta-spec cumulative rule

A single implementation-PR MAY absorb **N delta-spec PRs** targeting
the same ticket. Delta-specs accumulate on `main` as immutable
amendments to the original spec; the implementation-PR realizes the
union of the original spec plus every merged delta. The originating
loop iteration is defined in the *Retroactive review loop* section
below — a `spec`-class finding produces a new delta-spec PR before
the implementation-PR is retried.

### Worktree pointer

The *Worktree Isolation* rule (see *Agent Team Protocol → Worktree
Isolation*) applies unchanged to both `spec/*` and the corresponding
implementation branch — each PR runs in its own dedicated worktree.

## Post-Merge Flow

After any `gh pr merge`, the agent MUST verify the merge target before closing the task:

1. **Check the target branch.** If the PR was merged into `main` (or `master`), no further action is needed — the change is already on the primary branch.
2. **If the target was NOT `main`/`master`:** verify whether a downstream PR toward `main` is needed. This is required when:
   - A sibling repository or workflow is gated on `main` (e.g. deploy pipelines that only trigger from `main`).
   - The merge target is an intermediate integration branch that must eventually reach `main`.
3. **Open or propose the downstream PR** before considering the task complete. If the downstream PR can be created automatically (fast-forward or trivial rebase), open it. Otherwise, surface the need to the user with a clear explanation of what remains.

This rule applies regardless of whether the merge was initiated by a human or an agent — the obligation to verify downstream propagation is the same.

## Naming Convention

The [Gitmoji](https://gitmoji.dev/) convention applies to **all named project artifacts** — not only git commit messages:

- **Git commits** — `<emoji> <Short description>`
- **Issue titles** — `<emoji> <Short description>`
- **Pull request titles** — `<emoji> <Short description>`

Never use conventional-commit prefixes (`feat:`, `fix:`, `chore:`, etc.) in any of the above. Gitmoji is the sole convention.

Examples:

- `🎉 Initial commit`
- `✨ Add user authentication module`
- `🐛 Fix null pointer in config loader`
- `📝 Update README with setup instructions`
- `♻️ Refactor settings parser for clarity`

Refer to [gitmoji.dev](https://gitmoji.dev/) for the full list of valid emojis and their meanings.

## Version Bump Convention

Skill and agent sources carry a `metadata.provenance.version` field that
tracks shipped revisions. One rule and one exemption govern when it must change.

**Rule — bump on modification of shipped sources.** Any diff that modifies
a skill or agent source already present on `main` MUST bump
`metadata.provenance.version` in the same diff. Affected paths:

- `artifacts/core/skills/*/SKILL.md`
- `artifacts/library/skills/*/SKILL.md`
- `artifacts/community/skills/*/SKILL.md`
- `artifacts/core/agents/*/AGENT.md`
- `artifacts/library/agents/*/AGENT.md`
- `artifacts/community/agents/*/AGENT.md`

**Exemption — new components do not bump in-branch.** Components
introduced on a feature branch start at `1.0.0` and stay there until the
branch is merged. In-branch fixes to a brand-new component MUST NOT bump
its version — the version is only meaningful once the component ships on
`main`. CI enforces this: only files with `git diff --name-status` status
`M` (modified) trigger the check; newly added files (`A`) are skipped.

**SemVer guidance for bumps:**

- `PATCH` (1.0.x) — friction fix, wording change
- `MINOR` (1.x.0) — additive change (new section, new field)
- `MAJOR` (x.0.0) — breaking contract change

**Enforcement.** `scripts/check-skill-versions.sh` runs in CI, diffs the
PR against its target branch, and fails the build when a modified source
ships without a version bump.

## CLI Matrix Maintenance

See [`docs/cli-matrix-maintenance.md`](docs/cli-matrix-maintenance.md) for the full protocol governing CLI-specific integration points, parity checks, gap-acceptance evidence, and the symmetric-script rule.

**Summary:** Any PR touching `.claude/**`, `.gemini/**`, `artifacts/**`, `extensions/**`,
`hooks/*-transcript-hooks.json`, `config/claude/**`, `config/gemini/**`,
`scripts/build-components.sh`, any `scripts/{build,install,setup,import,manage}-*.sh`,
`.github/workflows/claude.yml` or `.github/workflows/gemini.yml`,
`CLAUDE.md`, `GEMINI.md`, or CLI-prefixed `Taskfile.yml` entries MUST consult and update
`docs/cli-matrix.md` in the same diff.

**Core-paths manifest co-maintenance.** Any PR that adds, removes, or reclassifies a
core-layer path in `docs/layers.md` MUST update `.crewrig/core-paths.txt` in the same diff.
This manifest is the machine-readable source of truth consumed by `scripts/sync-from-upstream.sh`.

## Agent Team Protocol

See [`docs/agent-team-protocol.md`](docs/agent-team-protocol.md) for the full protocol: team templates, worktree isolation, team communication rules, team shutdown, and team sizing by complexity.

**Critical rules — apply without reading the full doc:**

- **Solo work prohibition.** Never treat a multi-step ticket with inline solo work when specialist agents are available. Inline solo work is reserved for trivial single-file edits explicitly scoped by the user.
- **Mandatory tools on Claude Code CLI.** Use `TeamCreate` (one team per ticket, named after the ticket id), `TaskCreate` (one task per agent role, self-contained brief in the Agent prompt), and `SendMessage` (all cross-agent communication). These three tools are mandatory — not optional.
- **Worktree isolation.** Before any `TaskCreate` or `Agent` spawn, create a dedicated git worktree. All team edits happen inside `.worktrees/<ticket-id>/`. The main working directory is read-only for the duration.
- **Built components.** Any commit touching `artifacts/` MUST also run `bash scripts/build-components.sh` and stage the regenerated outputs in the same commit.
- **Complexity tier.** Read the spec frontmatter `complexity` field at ticket pickup: `trivial` = inline, `small` = developer + pr-logbook + pr-reviewer, `standard` = full Template 1/2/3, `large` = architect-led sub-spec decomposition.

```sh
git worktree add -b <branch-name> .worktrees/<ticket-id> crewrig/main
```

## Interaction modes

The lifecycle (per ADR-0010) runs in one of four modes. Mode controls
*user gating*, not stage execution — every mode runs all four stages.

| Mode | SPECS | PLAN | REVIEW loop |
|---|---|---|---|
| **FULL** | user interactive + validation | user interactive + validation | user notified at each iteration |
| **INTERMEDIATE** | user interactive + validation | user interactive + validation | autonomous |
| **MINIMAL** | user interactive + validation | autonomous | autonomous |
| **AUTO** | LLM-authored, no user gate | autonomous | autonomous |

Rules:

- Default mode is **INTERMEDIATE**.
- Mode is declared in the spec frontmatter (schema defined in #167)
  and SHALL NOT change mid-lifecycle without re-entering SPECS.
- In FULL mode, the orchestrator MUST post a notification on the
  logbook issue at the start and end of every REVIEW iteration.
  "Notify" is non-blocking; it does not gate the next iteration.
- In AUTO mode, SPECS is authored by the `spec-author` skill (#168);
  the user audits after the fact via the merged spec PR.

The mode-driven engine — argument parsing, gate enforcement, user
notification surface — lands in #173. This section states the
contract.

### User-gate definition

A **user gate** is defined narrowly as one of two actions:

1. A call to `AskUserQuestion` (or the equivalent interactive prompt
   exposed by the host CLI).
2. The pre-merge authorization request mandated by *Branching
   Strategy* — the explicit "may I merge?" question the agent MUST
   ask JUST BEFORE every `gh pr merge` invocation.

Both gates **block** agent execution until the user responds. Nothing
else does. **A prose question or status message directed at the user is
NOT a gate, even when it ends with `?`. The host CLI's text-output
guidance biases toward prose communication; that bias does NOT override
this contract. Every INTERMEDIATE or FULL mode gate SHALL NOT be
realised as a prose question — it MUST be an `AskUserQuestion` call.**

The following outputs are explicitly **NOT** user gates and
SHALL NOT pause the agent:

- Logbook comments (per *Logbook Issues → Rule B*) — informational.
- Progress messages and intermediate `SendMessage` traffic between
  teammates — coordination, not consent.
- Idle notifications, status pings, and harness-level events —
  observational.
- ADR drafts, plan comments, review verdicts posted to a PR or issue
  — artifacts of stage execution, audited asynchronously.

The mode table above governs only the two gating actions. Whether the
agent posts ADRs, plan comments, or REVIEW iteration notices in a
given mode is fixed by the lifecycle contract (ADR-0010), independent
of mode.

### Behavioral contract per (mode × stage) cell

Each cell below names precisely the user gates the orchestrator SHALL
fire while running that stage in that mode. "—" means no gate; the
stage runs autonomously and the user is informed (if at all) only via
non-blocking artifacts (logbook comments, PR/spec-PR diffs to audit
post hoc).

| Stage \ Mode | FULL | INTERMEDIATE | MINIMAL | AUTO |
|---|---|---|---|---|
| **SPECS** | `AskUserQuestion` per interview turn during `spec-author`; merge-authorization gate before merging the spec-PR. | `AskUserQuestion` per interview turn during `spec-author`; merge-authorization gate before merging the spec-PR. | `AskUserQuestion` per interview turn during `spec-author`; merge-authorization gate before merging the spec-PR. | No interview gate (spec authored autonomously); merge-authorization gate before merging the spec-PR. |
| **PLAN** | `AskUserQuestion` to validate the plan comment before DEV starts; second `architect` cold-review remains autonomous. | `AskUserQuestion` to validate the plan comment before DEV starts; second `architect` cold-review remains autonomous. | — (plan authored and cold-reviewed autonomously; DEV starts on APPROVE without user prompt). | — (plan authored and cold-reviewed autonomously). |
| **DEV** | Merge-authorization gate before merging the implementation-PR (and before merging any delta-spec PR produced by the loop). | Merge-authorization gate before merging the implementation-PR (and before merging any delta-spec PR produced by the loop). | Merge-authorization gate before merging the implementation-PR (and before merging any delta-spec PR produced by the loop). | Merge-authorization gate before merging the implementation-PR (and before merging any delta-spec PR produced by the loop). |
| **REVIEW** | Non-blocking notification posted on the logbook issue at the start and end of every iteration (per the FULL-mode rule above), **plus** a bounded `AskUserQuestion` to triage the non-blocking findings of each pass (spec 0006 R10 / spec 0005 R10 FULL branch). That triage is the sole REVIEW-loop gate. | — (loop runs autonomously; iteration count visible via the `iter:N` PR label). | — (loop runs autonomously). | — (loop runs autonomously; halt at max-iteration guardrail pages the user per *Retroactive review loop*). |

Notes on the matrix:

- The merge-authorization gate is **invariant across modes**: every
  mode, including AUTO, MUST ask the user before any `gh pr merge`.
  *Branching Strategy* is not waivable.
- FULL-mode REVIEW notifications are non-blocking — posting them does
  not pause the loop. The one FULL-mode REVIEW gate is the bounded
  non-blocking-finding triage `AskUserQuestion` (spec 0006 R10), under
  which only FULL consults the user on optional findings; INTERMEDIATE,
  MINIMAL, and AUTO fire no REVIEW gate. The per-iteration notifications
  themselves are not gates.
- The max-iteration guardrail (*Retroactive review loop*) pages the
  user in **every** mode, including AUTO. That paging is a gate by
  exception — the loop has halted and the user must decide whether
  to relax the iteration cap, accept the partial work, or close the
  ticket. It is not part of the steady-state matrix above.

## Plan review protocol

The PLAN stage of the lifecycle (per
[ADR-0010](docs/adr/0010-spec-plan-review-lifecycle.md) →
*Stage definitions → PLAN*) emits exactly one artifact: a Markdown
comment posted on the logbook issue. The protocol below operationalises
who authors that comment, who reviews it, what shape the review takes,
and how revisions chain. The format of the plan comment itself —
header conventions, mandatory sections, optional sections, finding tag
schema — lives in [`docs/plan-format.md`](docs/plan-format.md) and is
mandated by [`specs/0004-plan-format-and-review.md`](specs/0004-plan-format-and-review.md).
This section SHALL NOT duplicate that schema; consult the format
document for any field-level question.

**Authoring rule.** The plan SHALL be authored by the existing
`architect` role on the team (per *Agent Team Protocol → Standard
Team Templates*); no new specialist role is introduced. The same
`architect` invocation that runs the PLAN stage owns the comment.

**Review rule.** The plan SHALL be reviewed by a **second
`architect`** spawned cold — no authoring context, no prior session
state — to preserve independence. The reviewer posts the review as a
follow-up comment on the same logbook issue. The review header and
verdict line follow `docs/plan-format.md` → *Header conventions*.
When the orchestrator and the reviewer share the same GitHub
identity, the shared-identity workaround from *Standard Team
Templates → Template 1* applies (post the verdict as a regular
comment).

**Finding class taxonomy.** Every plan-review finding SHALL carry
exactly one `class:` field whose value drives the loop target:

- `class: tech` — DEV-stage fix (e.g. a step names the wrong file
  path or omits a required edit).
- `class: arch` — PLAN-stage rework (e.g. the approach is unsound;
  the blast radius missed a downstream consumer).
- `class: spec` — SPECS-stage rework (e.g. a requirement is
  ambiguous; the spec admits the plan but the plan reveals the WHAT
  is under-specified).

The full routing matrix — re-spawn composition, delta-spec impact,
termination — lives in *Retroactive review loop* below; this list
states the taxonomy, not the routing.

**REQUEST CHANGES blocks DEV.** A plan-review verdict of `### Verdict:
REQUEST CHANGES` SHALL block the DEV stage from starting until a
revised plan is posted and re-reviewed cold.

**Append-only revisions.** Validated plan comments are immutable: a
revised plan SHALL be posted as a **new comment** carrying the
revision header defined in `docs/plan-format.md` (citing the
revision trigger). Silent edits or deletions of a validated plan
comment break the retroactive review loop's audit trail and are
prohibited.

## Retroactive review loop

This section operationalises the REVIEW stage of the lifecycle (per
ADR-0010 → *Stage definitions → REVIEW*) and the routing contract
mandated by [`specs/0005-retroactive-routing-engine.md`](specs/0005-retroactive-routing-engine.md).
The engine is **doc-only**: the orchestrator (the `team-lead` role)
follows the procedure documented in
[`docs/retroactive-loop.md`](docs/retroactive-loop.md), which is the
reference home for the routing precedence, the iteration mechanics,
the termination check, the max-iteration guardrail, and the
mode-conditional handling of non-blocking findings. The iteration
counter SHALL be persisted as a GitHub label `iter:N` on the PR whose
content the iteration is reshaping (implementation-PR for `tech` /
`arch`; the active delta spec-PR for `spec`).

Every REVIEW finding SHALL be tagged with exactly one class. Class
drives the loop target.

| Finding class | Loop target | Re-spawn | Spec-PR impact |
|---|---|---|---|
| `tech` | DEV | developer + tester | none |
| `arch` | PLAN | architect → developer + tester | none |
| `spec` | SPECS | spec-author → architect → developer + tester | new delta-spec PR (per #170) |

Rules:

- A single REVIEW pass MAY produce findings of multiple classes. The
  routing engine SHALL pick the most upstream class present
  (`spec` > `arch` > `tech`) and route the entire pass to that
  stage. Mixing loop targets within a single iteration is prohibited.
- Re-spawn columns are minimums. The `security` trigger surface (see
  *Agent Team Protocol → Standard Team Templates → Security rule*)
  applies to every re-spawn that touches it.
- A `spec`-class loop SHALL produce a delta-spec PR; the original
  spec's content on `main` is immutable (lifecycle metadata such as
  `status` aside — see `docs/spec-format.md`).
- The loop SHALL NOT change the logbook issue (Rule A still holds).
- When an implementation branch (`feat/<NNNN>-<slug>` and siblings) is
  opened against `main` while the corresponding spec-PR is still open,
  the REVIEW pass on that implementation-PR SHALL emit a `class: tech`
  finding citing *Spec-PR workflow → Ordering rule*, and the
  implementation-PR SHALL NOT be retried until the spec-PR is merged
  on `main`.

**Termination.** The lifecycle terminates at MERGE iff a REVIEW pass
verdict is APPROVE AND the pass surfaces zero findings of any class
AND CI is green on the head commit reviewed.

**Max-iteration guardrail.** The loop halts after **5 iterations**
(configurable in the spec frontmatter, default 5) without
termination. On halt, the orchestrator posts a structured summary on
the logbook issue and pages the user regardless of mode (including
AUTO).

Definitions of each class, canonical and borderline examples, and the
disambiguation rule (escalate upstream on tie) live in ADR-0010 →
*Finding classification taxonomy*. The routing engine itself lands in
issue #172 — this section states the contract.

## Pull Request Format

Every PR must follow this structure:

### Title

A concise, descriptive title.

### Body

```markdown
<Two sentences maximum explaining the purpose of this PR for a human reader.>

## How to read this PR?

<A reading guide to help reviewers navigate the changeset. Highlight key files,
the order in which to read them, and any non-obvious design decisions.>

## How to test this PR?

<Step-by-step instructions to test the proposed changes locally.
Include prerequisites, commands to run, and expected outcomes.>

## Detailed description (for agents)

<A thorough, structured description of every change made in this PR.
This section is intended for AI agents that will analyze the PR.
Be explicit about what was added, modified, or removed and why.>
```

## Logbook Issues

Every PR **must** be anchored to a **logbook** on GitHub — a journal that
traces every obstacle encountered (with its resolution or avoidance
strategy), every challenge faced during implementation, and every success
or breakthrough. This ensures that the full experience of agents working
on the project — failures and successes alike — is recorded for future
reference.

Three rules govern how logbooks are kept:

### Rule A — A feature issue IS its own logbook

When a feature issue (or any pre-existing tracked issue) already exists
for the work, **that issue IS the logbook**. Post all logbook content —
obstacles, decisions, breakthroughs — as **incremental comments directly
on that issue**. Never open a separate logbook issue in this case;
duplicating the journal across two issues fragments the trail.

Only create a dedicated logbook issue when there is **no pre-existing
issue** to anchor the work to (e.g., spontaneous refactor, exploratory
fix). A dedicated logbook issue uses the `logbook` label.

### Rule B — Update incrementally, not at the end

Post a logbook comment **every time a significant obstacle, correction,
or decision occurs** — as it happens, while context is fresh. Do **not**
batch the entire journey into a single end-of-work comment: batching
loses the chronological structure, the failed attempts, and the reasoning
behind course corrections, which is precisely the value the logbook is
meant to preserve.

Triggers that require an immediate logbook comment:

- Merge conflicts encountered during rebase or merge
- CI failures (any red check that prompts a code change)
- Friction declarations (`harness-report` activations)
- Scope changes or requirement pivots mid-ticket
- Rebase operations that resolve conflicts (one comment per rebase, summarizing the conflict and resolution)
- Architectural course corrections (an ADR-worthy decision made inline)

The comment must be posted **before** resuming work on the obstacle's resolution — not after the PR is opened.

### Rule C — Close immediately after merge

Once the PR is merged and the changes verified, **close the linked issue
immediately** (`state_reason: completed`). Do not defer closing to a
later cleanup pass — stale open issues accumulate and obscure the actual
state of work in flight.

## GitHub Access

All GitHub operations (PRs, issues, branch protection) are performed through the dedicated MCP server.

## Legacy ticket policy

### Cutoff rule

Tickets opened **before** the merge of PR #176 — which introduced
[ADR-0010](docs/adr/0010-spec-plan-review-lifecycle.md) and the
SPECS → PLAN → DEV → REVIEW lifecycle — on `main` (literal date for
the human reader: **2026-05-31**) were eligible for one-time
migration triage under
[`specs/0008-migration-of-in-flight-tickets.md`](specs/0008-migration-of-in-flight-tickets.md).
Tickets opened on or after that date SHALL follow the new lifecycle
by default. The migration was a one-time pass; this cutoff rule is
the steady-state contract.

### Legacy contract

Tickets classified `keep-legacy` by the spec 0008 audit continue to
run under the contract that preceded ADR-0010:

- The team protocol defined above in *Agent Team Protocol → Standard
  Team Templates* (Templates 1 / 2 / 3) applies unchanged.
- A direct implementation pull request closes the issue.
- **No** SPECS stage — no `/specs/<NNNN>-<slug>.md` file is required.
- **No** PLAN comment — no `## PLAN — issue #<N>` artifact on the
  logbook.
- **No** spec-PR / delta-spec ordering — implementation may proceed
  without a preceding qualification PR.
- **No** retroactive review-loop class tagging (`tech` / `arch` /
  `spec`) on findings.

### Audit reference

The one-time migration audit table — classifying every ticket open
at the time of the cutoff into `keep-legacy`, `retrofit`, or
`NA — post-cutoff` — lives in
[`specs/0008-migration-of-in-flight-tickets.md`](specs/0008-migration-of-in-flight-tickets.md)
under *Audit table*. Reclassification requires a delta-spec
amendment.

## Organization rules extension

The adopting organization extends these rules through the org-owned
`AGENTS.org.md`, never by editing this upstream-owned file (spec 0020).
Claude Code resolves the import below natively and recursively. Gemini CLI
and GitHub Copilot CLI do not resolve `@file` includes in this surface, so
their setup scripts deploy `AGENTS.org.md` as a priority-66 rules file
(`~/.gemini/66_ORG_RULES.md` and
`~/.copilot/instructions/66-org-rules.instructions.md` respectively) — see
[`docs/cli-matrix.md`](docs/cli-matrix.md) row 7e.

<!-- Claude-native recursive import; per-CLI fallback handled at setup time. -->
@AGENTS.org.md
