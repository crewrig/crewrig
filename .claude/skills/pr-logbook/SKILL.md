---
name: pr-logbook
description: "Pull request and logbook composer. Activate when opening a PR, updating a PR description, or appending to a logbook issue. Produces titles, bodies, test plans, and logbook entries that conform to the project's AGENTS.md conventions."
license: Apache-2.0
compatibility: "Requires git (for log and staged-file inspection), the gh CLI (for PR creation and logbook issue updates), and bash."
allowed-tools:
  - Read
  - Bash
user-invocable: true
metadata:
  provenance:
    canonical: "https://github.com/crewrig/crewrig"
    feedback: "https://github.com/crewrig/crewrig"
    version: "1.1.6"
---


# PR & Logbook Composer

The skill that turns a finished change into a PR a reviewer can read in
under five minutes, and a logbook entry the next agent can pick up cold.

## When to activate

- Opening a new PR.
- Updating the body of an existing PR after review feedback.
- Appending a logbook entry to the PR's linked issue.
- Drafting the squash-merge commit message.

## Operating mode

### 1. Read the project's PR contract

Before composing, read the project's `AGENTS.md` (or equivalent) for:

- The required PR sections.
- The commit-message convention (Gitmoji, Conventional Commits, etc.).
- The logbook label and where logbook issues live.
- Any branch-naming or merge-method rules.

Do not assume a convention. The same crew of agents serves repos with
different rules.

### 2. PR title

- Under 70 characters. Imperative mood. No trailing period.
- For Gitmoji projects, lead with the appropriate emoji.
- The title states *what* changed, not *why*. The body explains *why*.

### 3. PR body — read this first / how to test / detailed

Default crewrig template — adapt to the project's `AGENTS.md` if it
specifies otherwise:

```markdown
<Two sentences max — purpose, for a human reader.>

## How to read this PR?

<Reading order. Highlight the load-bearing files. Call out
non-obvious design decisions and why they were made.>

## How to test this PR?

<Step-by-step. Prerequisites, commands, expected outcomes. Cover the
golden path and at least one failure mode.>

## Detailed description (for agents)

<Structured walkthrough of every change, intended for the next agent
that touches this code. Be explicit about additions, modifications,
deletions, and the rationale for each.>
```

### 4. Logbook entries

**Before creating a new logbook issue**, check whether the PR already closes
an existing feature issue (scan the PR body for `Closes #N`, `Fixes #N`,
`Resolves #N` patterns). If a feature issue exists:

1. Append the logbook entry to that issue as a comment via the GitHub MCP
   `add_issue_comment` tool (or `gh issue comment <N> --body "..."`).
2. Ensure the issue carries the `logbook` label — add it with
   `gh issue edit <N> --add-label logbook` if absent.
3. Do **not** create a new logbook issue. The feature ticket is the logbook.

A standalone logbook issue is only warranted when the PR has no upstream
feature ticket (hotfix, dependency bump, automation run with no prior ticket).

A logbook is *not* a status update. It is the record the next agent
will read to avoid your mistakes. Optimize for that reader.

```markdown
### YYYY-MM-DD — <one-line topic>

**Context**: <what task / PR this entry attaches to>

**What was tried**: <decision or experiment>

**Outcome**: <green / red / partial — with link to evidence>

**Lesson**: <the durable insight, in one sentence>
```

Append, never rewrite. Even a wrong-turn that was reverted belongs in
the log — the next agent needs to know it was tried.

### 5. Squash-merge commit message

When the project squash-merges, the commit message is what survives in
`git log` forever. Compose it deliberately:

```text
<gitmoji or convention> <imperative-title> (#<pr-number>)

<one paragraph: what the PR delivered, in past tense>

<one paragraph: why — the constraint or motivation that drove it>

<bullet list of significant follow-ups, if any>

Co-authored-by lines, if any.
```

Do not paste the entire PR description. The commit message is denser.

### 6. Pre-push sanity checks

Text-only tooling silently drops file metadata. Verify before pushing:

- If the diff touches shell scripts, confirm executable bits survived
  the round-trip: `git ls-files --stage -- '*.sh'` must show `100755`,
  not `100644`. The MCP `push_files` tool strips the exec bit. Restore
  with `git update-index --chmod=+x <file>` and amend before pushing.

### 7. Post-merge cleanup

After the squash-merge commit lands on the target branch:

1. Close the logbook issue:
   `gh issue close <logbook-issue-number> --reason completed`
   or via the GitHub MCP `issue_write` tool with `state: "closed"` and
   `state_reason: "completed"`.
2. If the PR also closes a feature issue (detected via `Closes #N` /
   `Fixes #N` / `Resolves #N` in §4), confirm that issue is closed too
   — GitHub auto-closes on merge when the keyword is in the PR body,
   but verify rather than assume.

Skip step 1 if the logbook entry was appended to an existing feature
issue (the §4 upstream-check path) — closing the feature issue is
sufficient.

## Cross-cutting: skill / agent source version bumps

This is not a step in the composition lifecycle — it is a *rule*
that applies to any PR you compose whose diff touches a
`artifacts/core/skills/*/SKILL.md` or
`artifacts/core/agents/*/AGENT.md` source. The PR MUST bump
`provenance.version` in the same diff. The rule is enforced by
`scripts/check-skill-versions.sh` in CI (and locally via
`task check-skill-versions`).

SemVer applies:

- **PATCH** for friction-driven fixes and wording changes (the
  common case — most curator-driven fixes are PATCH).
- **MINOR** for additive changes (new section, new recognition
  signal, new optional payload field).
- **MAJOR** for breaking contract changes (removed payload fields,
  renamed required fields, semantics flip).

A "version-only bump" PR is not a thing — the version bump always
accompanies the content edit. See `artifacts/FORMAT.md` →
*Version semantics* for the contract.

## Grounding discipline

PR bodies, logbook entries, and squash commit messages compose under
narrative pressure — the temptation is to produce a fluent paragraph that
*sounds* like a faithful summary. Plausible-sounding detail is the failure
mode, not vague writing.

**Hard rule.** Every technical claim MUST cite a verifiable source — a
file path with line range, a command output excerpt, or a sentence from
the input brief. This applies to file counts, line counts, assertion
lists, pass-count deltas, exit codes, CI step names, and build-system
invariants (e.g. "content-addressed", "drift-free", "idempotent"). If you
cannot cite, write "see diff" or omit the claim. Do not estimate, round,
or generalize.

**Self-check before returning.** Re-read the draft once. Mark every
number, list-count, named invariant, and concrete technical assertion.
For each mark, ask: does this trace to a file path, a command output, or
a sentence in my brief? If no, delete it or replace it with "see diff".
The self-check is cheap; a fabricated claim that reaches a reviewer or CI
is not.

## Output expectations

- All output in the project's primary language (English by default per
  crewrig convention; check the project's `AGENTS.md` for overrides).
- Markdown that renders cleanly on the project's PR platform.
- No emoji in the body unless the project's convention uses them.

## Friction reporting

When a recognition signal fires (see `config/TOOLS.md` →
*Friction Reporting → Recognition signals*), invoke the
`harness-report` skill rather than reimplementing the protocol
inline. The reporter walks you through identifying the offender,
picking the room, and filling the payload.

## Idle behavior

When re-activated after going idle with no new assignment, confirm
availability in one sentence. Do not re-summarize a completed task.

Example: "Task #2 (logbook + PR for #N) is already completed — available for new work."

## Shutdown protocol

When the team lead sends a `shutdown_request` message, respond
immediately with `shutdown_response` (approve: true) and stop:

```json
{"type": "shutdown_response", "request_id": "<id from request>", "approve": true}
```

Do not defer, summarize completed tasks, or wait for an ongoing
operation. The shutdown_request is a hard stop signal — the team lead
has confirmed all work is done.

After completing a task and reporting to the team lead, do not start
any further processing or re-enter a wait loop. Mark the task as
completed via `TaskUpdate`, send the completion message, and then stop.
The team lead will send the next assignment or the shutdown signal.
