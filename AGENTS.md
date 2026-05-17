# CrewRig — Agent Working Rules

This document defines the rules and conventions that all agents (human or AI) must follow when contributing to this project.

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

- `community-config/skills/*/SKILL.md`
- `community-config/agents/*/AGENT.md`

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

## Agent Team Protocol

Project tickets are multi-step work. They must be treated by a **team of specialist agents**, not by a single agent working solo inline.

### When this applies

Any time the agent is asked to treat a project ticket (a GitHub issue, a PR
task, a feature request, or any equivalent unit of tracked work), the
**first action** is to assemble a team of relevant specialist agents sized
to the ticket's scope. This applies even for tickets that look small at
first glance — the cost of assembling a team is low, the cost of solo
rework is high.

### On Claude Code CLI (team support available)

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

### On CLIs without team support (e.g. Gemini CLI)

When the harness does not expose `TeamCreate` / `TaskCreate` /
`SendMessage`, fall back to **sequential `Agent` spawns** with an
explicit `subagent_type` matching the specialist role. Each spawn must
carry a self-contained brief — the spawned agent inherits no
conversation context. Aggregate results in the orchestrating session
before moving to the next role.

### Solo work prohibition

**Never** treat a multi-step ticket with inline solo work when specialist
agents are available. Inline solo work on a ticket is reserved for trivial
single-file edits explicitly scoped that way by the user. If in doubt,
assemble the team.

### Worktree Isolation

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

Once the PR is merged and the linked logbook issue closed (see *Logbook Issues → Rule C*), remove the worktree to keep the repository clean:

```sh
git worktree remove .worktrees/<ticket-id>
```

Any obstacle encountered during the worktree lifecycle — merge conflicts, CI failures, friction declarations, scope changes, rebases that resolve conflicts — must be logged on the issue logbook before resuming work. See **Rule B** for the full trigger list.

### Built Components

Source files under `community-config/` are compiled into `.gemini/` and `.claude/` by `scripts/build-components.sh`. The CI `check-components` job fails if the built outputs drift from sources.

**Rule:** any commit that modifies a file under `community-config/` MUST also run `bash scripts/build-components.sh` and stage the regenerated outputs in the same commit or an immediately following one — never deferred to a separate PR.

**Verify before push:** run `bash scripts/build-components.sh` after staging. A clean `git status --porcelain` means no drift.

This rule applies to every role — doc-writer edits to `SKILL.md`, architect edits to `AGENT.md`, and pr-reviewer self-edits all count. The CI job is a backstop; this rule closes the loop before push.

### Standard Team Templates

Every role in the templates below operates inside the ticket worktree as
required by the rule above.

Agents **MUST** use the closest matching template below as the starting team
composition. Adjust by dropping a role only when the ticket's scope explicitly
excludes it, or by adding a role when the change crosses a specialist's
trigger surface (e.g. `security`, `architect`). Either adjustment requires a
one-line rationale in the task handoff comment. Ad-hoc partial crews —
omitting roles without justification — are prohibited.

**Security rule (applies to all templates):** When a change touches the
security skill's trigger surface (authentication, authorization, secrets,
cryptography, input parsing, deserialization, network calls, or dependency
upgrades), insert `security` after `developer` in the applicable template.

#### Template 1 — Feature implementation (results in a PR)

Full pipeline. Every role is mandatory unless explicitly scoped out by the
user.

| Order | Role | Responsibility |
|---|---|---|
| 1 | `architect` | Design review, ADR if needed, blast-radius check |
| 2 | `developer` (×N) | Implementation in the worktree |
| 3 | `tester` | Write / update tests |
| 4 | `pr-logbook` | Draft PR title, body, and logbook entry |
| 5 | `pr-reviewer` | Independent cold review of the diff |

Use multiple `developer` agents in parallel when the work decomposes into
independent files or modules; a single developer suffices otherwise.

#### Template 2 — Documentation-only change

Lighter pipeline — no code, no tests.

| Order | Role | Responsibility |
|---|---|---|
| 1 | `doc-writer` | Write / update the documentation |
| 2 | `pr-logbook` | Draft PR title, body, and logbook entry |
| 3 | `pr-reviewer` | Independent cold review of the diff |

If the documentation change modifies an established protocol, convention, or
contract (e.g. AGENTS.md itself), insert `architect` as step 0.

#### Template 3 — Bug fix

Test-first pipeline: the failing regression test is written before the fix
to lock in reproduction.

| Order | Role | Responsibility |
|---|---|---|
| 1 | `tester` | Write a failing regression test that reproduces the bug |
| 2 | `developer` | Implement the fix until the regression test passes |
| 3 | `pr-logbook` | Draft PR title, body, and logbook entry |
| 4 | `pr-reviewer` | Independent cold review of the diff |

`architect` is optional: include it only when the root cause exposes a
design flaw rather than a localized defect.

### Team Communication

Two rules govern how teammates report back inside a team.

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
- Rebase operations that resolve conflicts (one comment per rebase, summarising the conflict and resolution)
- Architectural course corrections (an ADR-worthy decision made inline)

The comment must be posted **before** resuming work on the obstacle's resolution — not after the PR is opened.

### Rule C — Close immediately after merge

Once the PR is merged and the changes verified, **close the linked issue
immediately** (`state_reason: completed`). Do not defer closing to a
later cleanup pass — stale open issues accumulate and obscure the actual
state of work in flight.

## GitHub Access

All GitHub operations (PRs, issues, branch protection) are performed through the dedicated MCP server.
