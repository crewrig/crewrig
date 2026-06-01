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
3. **Skill/agent/command creation and sharing** — `community-config/` is a
   single-source sandbox where skills, agents, and commands are authored once;
   `scripts/build-components.sh` compiles them into outputs for all three CLIs.
4. **Harness engineering** — a built-in feedback loop where agents invoke the
   `harness-report` skill to tag frictions during real work, and the
   `harness-curator` skill clusters those frictions into actionable GitHub
   issues.
5. **Multi-CLI parity** — features are implemented symmetrically across Claude
   Code, Gemini CLI, and GitHub Copilot CLI. Silent asymmetry is prohibited;
   every parity gap requires concrete evidence that the missing mechanism does
   not exist in the target CLI.

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
The file format for the spec artefact produced by the SPECS stage —
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
The SPECS-stage artefact (a single Markdown file under `/specs/`) MUST
ship as its own pull request — the **spec-PR** — and be merged to `main`
**before** any implementation branch for the same ticket is opened.
This keeps the WHAT auditable as a standalone diff and decouples the
qualification timeline from the realisation timeline.

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
auditable artefact of qualification — its diff must be reviewable as a
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
realisation are deliberately separated so that a merged spec can
outlive a failed implementation attempt and be re-realised by a
later PR without information loss.

### Delta-spec cumulative rule

A single implementation-PR MAY absorb **N delta-spec PRs** targeting
the same ticket. Delta-specs accumulate on `main` as immutable
amendments to the original spec; the implementation-PR realises the
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

## CLI Matrix Maintenance

`docs/cli-matrix.md` is the source of truth for every CLI-specific
integration point. It MUST stay in lockstep with the code.

**Trigger surface.** A change is CLI-specific when it touches any of:
`.claude/**`, `.gemini/**`, `community-config/**`, `extensions/**`,
`hooks/*-transcript-hooks.json`, `config/claude/**`, `config/gemini/**`,
`scripts/build-components.sh`, any `scripts/{build,install,setup,import,manage}-*.sh`,
`.github/workflows/claude.yml` or `.github/workflows/gemini.yml`,
the top-level entry-point files (`CLAUDE.md`, `GEMINI.md`), or a
CLI-prefixed entry in `Taskfile.yml` / `.gitignore`.

**Obligation.** Any PR that modifies the trigger surface MUST consult
`docs/cli-matrix.md` and update it in the same diff — new row, edited
cell, or refreshed `Parity gaps` entry. Drift is a parity bug.

**Parity check.** When adding or modifying a feature for one CLI,
verify every other supported CLI. The default is **implement
symmetrically in the same PR**. Recording a gap is an exception that
requires written evidence (see *Gap-acceptance evidence rule* below);
linking a follow-up issue is not, by itself, sufficient justification
to defer. Silent asymmetry is prohibited.

**Gap-acceptance evidence rule.** A `Parity gaps` entry MAY be added
only when the agent has produced concrete evidence that no mechanism
exists in the target CLI to support the feature. "Concrete evidence"
means at least one of:

- A citation from the CLI's public reference documentation explicitly
  stating the absence (with URL and quoted sentence in the PR body
  or the matrix entry itself).
- An empirical reproduction (command + output) showing the CLI
  rejecting or ignoring the symmetric artifact.
- An upstream issue link where the CLI maintainers have declined or
  deferred the capability.

The following are **NOT** acceptable evidence and MUST NOT be used to
justify a gap:

- "The public reference does not mention it" (absence of mention is
  not absence of mechanism — search for user-level, hook-level, and
  alternative file-system paths first).
- "A follow-up issue is filed."
- "Out of scope for this PR."

If the agent's own ADR, design note, or research surfaced a viable
path — even an unconventional one (user-level config, hook directory,
env var injection, wrapper script) — that path MUST be implemented in
the current PR. Documenting a viable path and then declining to use
it is a parity violation, not a deferral.

**Protocol-only exemption.** When the only file touched on the trigger
surface is a top-level entry-point file (`AGENTS.md`, `CLAUDE.md`,
`GEMINI.md`) AND the diff adds purely lifecycle / process documentation
with no CLI-specific behaviour (no new path, command, hook, or
configuration unique to one CLI), the obligation to update
`docs/cli-matrix.md` does NOT apply. This codifies the precedent set by
PRs #181 (Spec-PR workflow) and #183 (Plan review protocol) — both
AGENTS.md-only, both pure lifecycle-protocol additions. The exemption
SHALL NOT extend to changes that introduce or modify CLI-specific
behaviour even when delivered exclusively through an entry-point file.

**Symmetric-script rule.** When adding a new CLI target, every script
under `scripts/` that already has a target for an existing CLI MUST
gain a target for the new CLI in the **same PR** that introduces the
CLI. This is a direct extension of working code, not new research,
and is therefore in-scope by default. The list of trigger scripts is
authoritative:

- `scripts/setup-<cli>-interactive.sh`
- `scripts/import-<cli>-history.sh`
- `scripts/manage-<cli>-component.sh` (or a new `--target <cli>`
  branch in `scripts/manage-workspace-component.sh` if that script
  already serves multiple CLIs)
- `scripts/build-components.sh` `--target <cli>` branch
- Every `Taskfile.yml` entry whose name carries a CLI prefix

Deferring any of the above to a follow-up ticket requires **explicit
prior user authorization** captured in the PR or its linked logbook
issue. Agent-initiated deferral of a symmetric script is prohibited.

## Agent Team Protocol

Project tickets are multi-step work. They must be treated by a **team of specialist agents**, not by a single agent working solo inline.

The team protocol below governs the **DEV stage** of the lifecycle
defined in [ADR-0010](docs/adr/0010-spec-plan-review-lifecycle.md).
SPECS and PLAN run before DEV (with their own artefacts: a spec file
under `/specs/` and a plan comment on the logbook issue); REVIEW runs
after, and its findings may re-enter DEV (`tech`), PLAN (`arch`), or
SPECS (`spec`) per the routing matrix in *Retroactive review loop*
below. Templates 1 / 2 / 3 in this section describe how the DEV stage
is staffed for a `standard`-tier ticket; trivial / small / large
tiers adjust the composition per ADR-0010 → *Complexity tiers and
team sizing*.

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

Once the PR is merged and the linked logbook issue closed (see *Logbook Issues → Rule C*), clean up the worktree and its branch in this **exact order**:

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

The templates below describe the **`standard`**-tier composition.
Trivial / small / large tickets follow the tier-specific rules in
*Team sizing by complexity* below; consult that section before
spawning a team.

**Security rule (applies to all templates):** When a change touches the
security skill's trigger surface (authentication, authorization, secrets,
cryptography, input parsing, deserialization, network calls, or dependency
upgrades), insert `security` after `developer` in the applicable template.

#### Step 0 — `spec-author` (every non-trivial template)

Templates 1, 2, and 3 below describe the DEV-stage staffing of the
ADR-0010 lifecycle. Before any of them runs, the `spec-author` skill
authors the SPECS-stage artefact: a single Markdown file under
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

#### Template 1 — Feature implementation (results in a PR)

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

**REVIEW is a looping stage**, not terminal — the orchestrator follows the routing engine documented in [`docs/retroactive-loop.md`](docs/retroactive-loop.md) until the termination criterion is met.

**Ordering constraint:** `pr-logbook` MUST open the PR (or hand the complete
draft to `team-lead` for opening) before `pr-reviewer` is spawned. The
orchestrator MUST NOT parallelise these two roles — `pr-reviewer` cannot
fulfil its cold-start contract without a valid PR number. `pr-reviewer`
receives the PR number from `pr-logbook`'s result message (see *Team
Communication → Rule 1*).

**Shared-identity workaround:** When the orchestrator and `pr-reviewer` share the same GitHub identity (common in solo-dev setups), GitHub rejects `gh pr review --approve` with "Can not approve your own pull request"; in that case `pr-reviewer` MUST post its verdict as a regular PR comment opening with a `## Verdict: APPROVE` or `## Verdict: REQUEST CHANGES` header. This applies to every template below that includes `pr-reviewer`.

Use multiple `developer` agents in parallel when the work decomposes into
independent files or modules; a single developer suffices otherwise.

#### Template 2 — Documentation-only change

Preceded by step 0 (spec-author) — see the subsection above.

Lighter pipeline — no code, no tests.

| Order | Role | Responsibility |
|---|---|---|
| 1 | `doc-writer` | Write / update the documentation |
| 2 | `pr-logbook` | Draft PR title, body, and logbook entry |
| 3 | `pr-reviewer` | Independent cold review of the diff; verifies CI checks pass before posting verdict |

**REVIEW is a looping stage**, not terminal — the orchestrator follows the routing engine documented in [`docs/retroactive-loop.md`](docs/retroactive-loop.md) until the termination criterion is met.

**Ordering constraint:** `pr-logbook` MUST open the PR (or hand the complete
draft to `team-lead` for opening) before `pr-reviewer` is spawned. The
orchestrator MUST NOT parallelise these two roles — `pr-reviewer` cannot
fulfil its cold-start contract without a valid PR number. `pr-reviewer`
receives the PR number from `pr-logbook`'s result message (see *Team
Communication → Rule 1*).

If the documentation change modifies an established protocol, convention, or
contract (e.g. AGENTS.md itself), insert `architect` as step 0.

#### Template 3 — Bug fix

Preceded by step 0 (spec-author) — see the subsection above.

Test-first pipeline: the failing regression test is written before the fix
to lock in reproduction.

| Order | Role | Responsibility |
|---|---|---|
| 1 | `tester` | Write a failing regression test that reproduces the bug |
| 2 | `developer` | Implement the fix until the regression test passes |
| 3 | `pr-logbook` | Draft PR title, body, and logbook entry |
| 4 | `pr-reviewer` | Independent cold review of the diff; verifies CI checks pass before posting verdict |

**REVIEW is a looping stage**, not terminal — the orchestrator follows the routing engine documented in [`docs/retroactive-loop.md`](docs/retroactive-loop.md) until the termination criterion is met.

**Ordering constraint:** `pr-logbook` MUST open the PR (or hand the complete
draft to `team-lead` for opening) before `pr-reviewer` is spawned. The
orchestrator MUST NOT parallelise these two roles — `pr-reviewer` cannot
fulfil its cold-start contract without a valid PR number. `pr-reviewer`
receives the PR number from `pr-logbook`'s result message (see *Team
Communication → Rule 1*).

`architect` is optional: include it only when the root cause exposes a
design flaw rather than a localized defect.

### Team sizing by complexity

The complexity tier declared in a spec's frontmatter (per ADR-0010 →
*Complexity tiers and team sizing* and
[`specs/0006-interaction-modes-and-sizing.md`](specs/0006-interaction-modes-and-sizing.md)
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
Behavioural contract per (mode × stage) cell*; the tier governs team
composition per the table above.

**Spec-reviewer obligation.** When a spec-PR is cold-reviewed, the
reviewer MUST challenge a tier that appears under-stated relative
to the spec's declared blast radius (the union of
`## Requirements` and the file paths the spec touches). The
challenge is emitted as a `class: spec` finding citing this
section — see
[`community-config/skills/pr-reviewer/SKILL.md`](community-config/skills/pr-reviewer/SKILL.md)
→ *Spec-review obligation — tier challenge*. Over-statement is a
non-blocking observation, not a blocking finding.

### Team Communication

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

**Rule 4 — Review findings are not auto-deferrals.** When a reviewer
lists findings marked "non-blocking", that label means the PR can merge
without them — it does NOT mean the findings should be deferred to a
follow-up ticket without asking the user. The agent MUST present every
finding to the user and implement each one in the same session unless
the user explicitly decides to skip or defer it. The user sets the
scope, not the reviewer's severity labels. Auto-deferring findings to
follow-up tickets without user authorization is prohibited.

### Team Shutdown

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
4. If a teammate goes idle without responding, apply *Team Communication → Rule 3* (let the channel drain, check side-effects) before escalating. If the silence persists past the next turn, the team-lead MAY proceed to Phase 2 for that teammate only, after recording the unresponsive shutdown in the logbook (see *Logbook Issues → Rule B*).

**Phase 2 — Dispose of the team.** Once every teammate has either
approved its shutdown or been declared unresponsive per Phase 1 step 4,
call `TeamDelete` to remove the team record itself.

**Triggers.** Run the sequence above whenever:

- The ticket's PR has been merged and the logbook closed (the standard end-of-ticket path — see *Logbook Issues → Rule C*).
- The user cancels the ticket or pivots scope to a different team composition.
- A fatal error makes the current team unrecoverable and a fresh team is needed.

**Prohibition.** Invoking `TeamDelete` without a preceding
`shutdown_request` round-trip for every teammate is a protocol
violation, regardless of whether the teammates appear idle. "Idle" is a
harness display state, not a confirmation that the underlying process
has released its resources.

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
else does. The following outputs are explicitly **NOT** user gates and
SHALL NOT pause the agent:

- Logbook comments (per *Logbook Issues → Rule B*) — informational.
- Progress messages and intermediate `SendMessage` traffic between
  teammates — coordination, not consent.
- Idle notifications, status pings, and harness-level events —
  observational.
- ADR drafts, plan comments, review verdicts posted to a PR or issue
  — artefacts of stage execution, audited asynchronously.

The mode table above governs only the two gating actions. Whether the
agent posts ADRs, plan comments, or REVIEW iteration notices in a
given mode is fixed by the lifecycle contract (ADR-0010), independent
of mode.

### Behavioural contract per (mode × stage) cell

Each cell below names precisely the user gates the orchestrator SHALL
fire while running that stage in that mode. "—" means no gate; the
stage runs autonomously and the user is informed (if at all) only via
non-blocking artefacts (logbook comments, PR/spec-PR diffs to audit
post hoc).

| Stage \ Mode | FULL | INTERMEDIATE | MINIMAL | AUTO |
|---|---|---|---|---|
| **SPECS** | `AskUserQuestion` per interview turn during `spec-author`; merge-authorization gate before merging the spec-PR. | `AskUserQuestion` per interview turn during `spec-author`; merge-authorization gate before merging the spec-PR. | `AskUserQuestion` per interview turn during `spec-author`; merge-authorization gate before merging the spec-PR. | No interview gate (spec authored autonomously); merge-authorization gate before merging the spec-PR. |
| **PLAN** | `AskUserQuestion` to validate the plan comment before DEV starts; second `architect` cold-review remains autonomous. | `AskUserQuestion` to validate the plan comment before DEV starts; second `architect` cold-review remains autonomous. | — (plan authored and cold-reviewed autonomously; DEV starts on APPROVE without user prompt). | — (plan authored and cold-reviewed autonomously). |
| **DEV** | Merge-authorization gate before merging the implementation-PR (and before merging any delta-spec PR produced by the loop). | Merge-authorization gate before merging the implementation-PR (and before merging any delta-spec PR produced by the loop). | Merge-authorization gate before merging the implementation-PR (and before merging any delta-spec PR produced by the loop). | Merge-authorization gate before merging the implementation-PR (and before merging any delta-spec PR produced by the loop). |
| **REVIEW** | Non-blocking notification posted on the logbook issue at the start and end of every iteration (per the FULL-mode rule above). No `AskUserQuestion`. | — (loop runs autonomously; iteration count visible via the `iter:N` PR label). | — (loop runs autonomously). | — (loop runs autonomously; halt at max-iteration guardrail pages the user per *Retroactive review loop*). |

Notes on the matrix:

- The merge-authorization gate is **invariant across modes**: every
  mode, including AUTO, MUST ask the user before any `gh pr merge`.
  *Branching Strategy* is not waivable.
- FULL-mode REVIEW notifications are non-blocking — posting them does
  not pause the loop. They are listed under "REVIEW" only because
  they are the FULL-mode-specific surface the orchestrator must
  produce; they are not gates.
- The max-iteration guardrail (*Retroactive review loop*) pages the
  user in **every** mode, including AUTO. That paging is a gate by
  exception — the loop has halted and the user must decide whether
  to relax the iteration cap, accept the partial work, or close the
  ticket. It is not part of the steady-state matrix above.

## Plan review protocol

The PLAN stage of the lifecycle (per
[ADR-0010](docs/adr/0010-spec-plan-review-lifecycle.md) →
*Stage definitions → PLAN*) emits exactly one artefact: a Markdown
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
  spec on `main` is immutable.
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
