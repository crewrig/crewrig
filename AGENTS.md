# CrewRig — Agent Working Rules

This document defines the rules and conventions that all agents (human or AI) must follow when contributing to this project.

## What is CrewRig?

CrewRig is a centralized configuration framework for Gemini CLI, Claude Code,
GitHub Copilot CLI, and Antigravity CLI. Any agent loading this file should
understand these five pillars without needing to read README.md or ADRs:

1. **Layered context system engineering** — 00–60 priority files deployed to
   CLI user directories (`~/.gemini/`, `~/.claude/rules/`,
   `~/.copilot/instructions/`, `~/.gemini/antigravity-cli/`) that shape how AI
   assistants behave for a specific user's role, team, and seniority.
2. **Shared cross-tool memory** — MemPalace provides persistent agent memory
   accessible across tools and sessions, enabling continuity between Gemini
   CLI, Claude Code, Copilot CLI, and Antigravity CLI.
3. **Skill/agent/command creation and sharing** — `artifacts/` is the
   single-source zone where skills, agents, and commands are authored once;
   `scripts/build-components.sh` compiles them into outputs for all four CLIs.
4. **Harness engineering** — a built-in feedback loop where agents invoke the
   `harness-report` skill to tag frictions during real work, and the
   `harness-curator` skill clusters those frictions into actionable GitHub
   issues.
5. **Multi-CLI parity** — features are implemented symmetrically across Claude
   Code, Gemini CLI, GitHub Copilot CLI, and Antigravity CLI. Silent asymmetry
   is prohibited; every parity gap requires concrete evidence that the missing
   mechanism does not exist in the target CLI.

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

## Pre-Edit Guard

Before writing or editing **any** file in the repository, the agent MUST
confirm that all three of the following conditions hold:

1. **A GitHub issue exists** for the work — pre-existing or freshly created
   in this session.
2. **A feature branch is active** — the current working context is NOT
   `main` (or `master`). The branch name MUST follow the
   `<prefix>/<NNNN>-<slug>` convention defined in *Branching Strategy* above.
3. **A dedicated worktree is in use** — the working directory is
   `.worktrees/<ticket-id>/`, NOT the repository root.

**Process violation.** Editing any file without satisfying all three
conditions is a process violation. A REVIEW pass that audits a session
where the guard was bypassed SHALL emit a `class: tech` finding citing
this section.

**Exemption.** Trivial single-file edits explicitly scoped by the user in
the same conversational turn are exempt from condition 3 (worktree), but
NOT from conditions 1 (issue) and 2 (feature branch). There is no
edit-without-branch exemption.

## Spec-PR workflow

This section operationalises the SPECS stage of the lifecycle defined in
[ADR-0010](docs/adr/0010-spec-plan-review-lifecycle.md) — specifically
the *Stage definitions → SPECS* contract — and the two-PR convention
mandated by [`specs/0003-spec-pr-workflow.md`](specs/0003-spec-pr-workflow.md).
The SPECS-stage artifact (a single Markdown file under `/specs/`) MUST
ship as its own pull request — the **spec-PR** — and be merged to `main`
**before** any implementation branch for the same ticket is opened.

See [`docs/spec-pr-workflow.md`](docs/spec-pr-workflow.md) for the
rationale and the full rule set: the one-file rule, the ordering rule,
the independence rule, the delta-spec cumulative rule, and the worktree
pointer.

### Branch naming

- Initial spec-branch: `spec/<NNNN>-<slug>` — where `<NNNN>` is the
  zero-padded spec id and `<slug>` is the kebab-case slug. Both values
  MUST match the spec file's frontmatter `id` and `slug` fields; the
  schema is defined in [`docs/spec-format.md`](docs/spec-format.md).
- Delta-spec branch (produced by a `spec`-class iteration of the
  *Retroactive review loop*): `spec/<NNNN>-<slug>-delta-<NN>` — where
  `<NN>` is the zero-padded delta sequence number for that spec id.

## Post-Merge Flow

After any `gh pr merge`, the agent MUST verify the merge target before closing the task.

See [`docs/post-merge-flow.md`](docs/post-merge-flow.md) for the
target-branch check, the downstream-PR criteria, and the open-or-propose
step.

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
`metadata.provenance.version` in the same diff.

See [`docs/version-bump-convention.md`](docs/version-bump-convention.md)
for the full list of affected paths, the extension provenance-carrier
detail, and the new-component in-branch exemption.

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
- In FULL mode, the orchestrator MUST post a notification on the
  logbook issue at the start and end of every REVIEW iteration.
  "Notify" is non-blocking; it does not gate the next iteration.

The mode-driven engine — argument parsing, gate enforcement, user
notification surface — lands in #173. This section states the
contract.

See [`docs/interaction-modes.md`](docs/interaction-modes.md) for the
`User-gate definition` and the full `Behavioral contract per (mode ×
stage) cell` table.

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

See [`docs/plan-review-protocol.md`](docs/plan-review-protocol.md) for
the authoring rule, the cold second-`architect` review rule, the
finding-class taxonomy (`tech` / `arch` / `spec`), and the
REQUEST-CHANGES-blocks-DEV rule.

## Retroactive review loop

This section operationalises the REVIEW stage of the lifecycle (per
ADR-0010 → *Stage definitions → REVIEW*) and the routing contract
mandated by [`specs/0005-retroactive-routing-engine.md`](specs/0005-retroactive-routing-engine.md).
The engine is **doc-only**: the orchestrator (the `team-lead` role)
follows the procedure documented in
[`docs/retroactive-loop.md`](docs/retroactive-loop.md), which is the
reference home for the routing precedence, the iteration mechanics,
the termination check, the max-iteration guardrail, the spec-PR
ordering guard, and the mode-conditional handling of non-blocking
findings.

Every REVIEW finding SHALL be tagged with exactly one class. Class
drives the loop target.

| Finding class | Loop target | Re-spawn | Spec-PR impact |
|---|---|---|---|
| `tech` | DEV | developer + tester | none |
| `arch` | PLAN | architect → developer + tester | none |
| `spec` | SPECS | spec-author → architect → developer + tester | new delta-spec PR (per #170) |

Rules:

- The loop SHALL NOT change the logbook issue (Rule A still holds).

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

The comment must be posted **before** resuming work on the obstacle's
resolution — not after the PR is opened. See
[`docs/logbook-issues.md`](docs/logbook-issues.md) for the full list of
triggers that require an immediate logbook comment.

### Rule C — Close immediately after merge

Once the PR is merged and the changes verified, **close the linked issue
immediately** (`state_reason: completed`). Do not defer closing to a
later cleanup pass — stale open issues accumulate and obscure the actual
state of work in flight.

## Forge Access

Forge access is CLI-only. Forge operations (issues, PRs/MRs, branch protection, releases) route through the forge's own CLI — `gh` (GitHub), `glab` (GitLab), `tea` (Gitea) — with authentication delegated to that CLI; the framework ships no forge MCP server. Native `git` remains the tool for ordinary version control and is unchanged. See `artifacts/core/rules/60-tools.md` → *Forge Access* for the per-CLI `auth login` details. An organization wanting a forge MCP re-adds it via the org-owned `mcp-servers.org.json` channel ([`docs/org-mcp-declaration.md`](docs/org-mcp-declaration.md), spec 0091).

## Legacy ticket policy

Tickets opened **before** the merge of PR #176 (which introduced
[ADR-0010](docs/adr/0010-spec-plan-review-lifecycle.md) and the
SPECS → PLAN → DEV → REVIEW lifecycle, on `main` on **2026-05-31**)
were eligible for one-time migration triage under
[`specs/0008-migration-of-in-flight-tickets.md`](specs/0008-migration-of-in-flight-tickets.md).
Tickets opened on or after that date SHALL follow the new lifecycle
by default.

See [`docs/legacy-ticket-policy.md`](docs/legacy-ticket-policy.md) for
the full cutoff rule, the legacy contract that `keep-legacy` tickets
run under, and the audit-table reference.

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
