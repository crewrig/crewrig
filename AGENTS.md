# CrewRig — Agent Working Rules

This document defines the rules and conventions that all agents (human or AI) must follow when contributing to this project.

## Language

All project content (code, comments, documentation, commits, issues, PRs) **must be written in English**.

**Exception:** Interpersonal interactions between the user and the agent (chat sessions) MUST be conducted in the **User Preferred Language**.

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

Every PR **must** be linked to a **logbook issue** on GitHub.

A logbook issue is a detailed journal entry that traces:

- Every obstacle encountered and the resolution or avoidance strategy applied
- Every challenge faced during implementation
- Every success and breakthrough

This strategy ensures that all experience (failures and successes) from agents working on the project is recorded and available for future reference.

Logbook issues must be written in English and use the label `logbook`.

Once the PR is merged and any linked feature issue is closed, the logbook
issue must also be closed (`state_reason: completed`).

## GitHub Access

All GitHub operations (PRs, issues, branch protection) are performed through the dedicated MCP server.
