---
name: pr-logbook
description: "Composes pull request titles, bodies, logbook entries and squash-merge messages that follow the project's conventions, linting the body with bundled scripts. Use when opening a PR, updating a PR description, appending to a logbook issue, or writing a squash message."
type: skill
license: Apache-2.0
compatibility: "Requires Node.js 24 (scripts run as node scripts/<name>.ts), git, and the forge CLI (gh for GitHub, glab for GitLab, tea for Gitea)."
metadata:
  provenance:
    canonical: "${CANONICAL_REPO}"
    feedback: "${CANONICAL_REPO}"
    version: "1.5.0"
claude:
  allowed-tools:
    - Read
    - Bash
  user-invocable: true
---

# PR & Logbook Composer

Turns a finished change into a PR a reviewer can read in under five
minutes, and a logbook entry the next agent can pick up cold. Mechanical
checks live in bundled scripts; you supply the judgement.

## Scripts

Run from the skill directory. Each takes `--json` for a machine-readable
result and exits `0` (ok), `1` (finding), `2` (usage error) or `3`
(precondition failed). Conventions shared by all scripts are in
[`references/script-contract.md`](references/script-contract.md).

| When | Command | Exit `1` means |
|---|---|---|
| After drafting a title and body, before opening or editing the PR | `node scripts/lint-pr-body.ts --title-file <file> --body-file <file>` (add `--title-style gitmoji` when the project uses Gitmoji; `--template <file>` when it has its own body template) | A rule is broken: title over 70 characters or ending in a period, a missing, duplicated or misordered section, an empty preamble, or a CI skip directive. Fix the draft and rerun until clean. |
| Before writing the logbook entry | `node scripts/resolve-logbook-target.ts --body-file <file>` | Never used. Read `data.mode`: `feature-issue` means comment on `data.issue`; `standalone` means create a logbook issue with the `logbook` label. |
| When the PR implements a spec, before it merges | `node scripts/flip-spec-status.ts <spec-file>` (use `--dry-run` to preview) | The spec has a status other than `approved` or `implemented`. Stop and tell the orchestrator; do not edit the status by hand. |

Exit `2` or `3` means the call or the environment is wrong, not the draft.
Fix the invocation; do not work around it by skipping the script.

## Workflow

### 1. Read the project's conventions

Read the project's `AGENTS.md` (or equivalent) for the required PR
sections, the commit-message convention, the logbook label and location,
and any branch or merge-method rules. The same crew serves repositories
with different rules, so an assumed convention is usually a wrong one. If
the project defines its own body template, pass it to the linter.

### 2. Compose title and body

- Title: imperative, states what changed (the body carries why). Use the
  project's emoji or prefix convention.
- Body: start from `assets/pr-body.template.md`, or the project's own.
  Write the purpose in two sentences for a human, a reading order that
  points at the load-bearing files and non-obvious decisions, a test plan
  covering the golden path and one failure mode, and a walkthrough for
  agents that states what was added, changed and removed, and why.
- On a bug-type issue that folds related bugs, give the folded-bugs entry
  each item with its status; otherwise write "not applicable".
- Write both to files and run `lint-pr-body.ts`. Open or edit the PR only
  once it exits `0`.

### 3. Logbook entry

Run `resolve-logbook-target.ts` on the final body. A feature issue is its
own logbook, so comment on it through the forge CLI
(`gh issue comment <issue> --body ...`). Do not add the `logbook` label to a pre-existing feature issue.
Only a PR with no feature issue gets a standalone logbook issue, created
with `gh issue create ... --label logbook`. Forge access is CLI-only.

A logbook is the record the next agent reads to avoid your mistakes, not
a status update. Use this shape and append, never rewrite; a reverted
wrong turn still belongs in the log:

```markdown
### YYYY-MM-DD — <one-line topic>

**Context**: <what task or PR this entry attaches to>

**What was tried**: <decision or experiment>

**Outcome**: <green / red / partial, with a link to evidence>

**Lesson**: <the durable insight, in one sentence>
```

When folded bugs exist, the next stage-transition comment carries one
bullet per folded item (symptom, the step that exposed it, status), a
bullet for the final sweep, and one per bug filed elsewhere. The closure
comment lists each item's resolution.

### 4. Squash-merge message

When the project squash-merges, this message is what survives in `git
log`, so make it denser than the PR description rather than a paste of it:

```text
<convention prefix> <imperative title> (<PR number>)

<one paragraph: what the PR delivered, past tense>

<one paragraph: why, the constraint or motivation behind it>

<bullets for significant follow-ups, if any>
```

### 5. Spec status flip

If the PR implements a spec, run `flip-spec-status.ts` on the spec file
on the implementation branch before merge, then record it in a new commit
(not an amend) and push. The spec then lands on the main branch already
marked implemented. The script changes the status line only; any other
edit to the spec does not belong in this change.

A spec PR is opened as a draft and marked ready after its approval flip
is pushed.

### 6. Before pushing: executable bits

Text-only file writes silently drop the executable bit. If the diff
touches executable files, check `git ls-files --stage -- <file>` shows
`100755`, not `100644`. Restore with `git update-index --chmod=+x <file>`
and amend before pushing.

### 7. After merge

Close the logbook issue through the forge CLI with reason completed,
unless the entry went on a feature issue, in which case closing that issue
is enough. Verify a feature issue named by a closing keyword really closed
instead of assuming the forge auto-closed it.

## Version bumps

A PR whose diff changes a skill or agent source must bump
`metadata.provenance.version` in the same diff, because CI rejects the PR
otherwise. Use PATCH for wording fixes, MINOR for additive changes and
MAJOR for breaking contract changes.
<!-- crewrig-repo-only:start -->
CrewRig repository only: run `task check-skill-versions` to check locally.
<!-- crewrig-repo-only:end -->

## Single writer per forge artifact

Concurrent edits to one PR body or issue silently lose updates, so each
artifact has one writer.

- Your role owns what it creates. Opening a PR makes `pr-logbook` the
  writer of its body; say so once on a `**Writer:**` line in the logbook
  entry.
- Do not rewrite another role's body or comment; route the change through
  its writer. A new comment is always fine, since you own it.
- A handover only counts when it comes from the current writer.
- Observe immediately before writing: record the last-modification marker
  (`gh pr view <n> --json updatedAt`, or the `glab`/`tea` equivalent).
- `gh pr edit` reports success even on a lost update. If the artifact
  moved between your observation and your write, say so on the logbook.
- When telling anyone what an artifact says, base it on a fresh
  observation and quote its marker.

## Grounding

Every technical claim (file counts, line counts, assertion lists, pass
deltas, exit codes, CI step names, invariants such as "idempotent") needs a
verifiable source: a path with line range, a command output, or a sentence
from your brief. Without one, write "see diff" or omit it; never estimate.
Re-read the draft once before returning and strip any number or invariant
you cannot trace, since a fabricated claim that reaches a reviewer is
costly.

## Output

Write in the project's primary language (check `AGENTS.md`), as Markdown
that renders on the PR platform, with no emoji in the body unless the
project's convention uses them.

## Friction reporting

When something in this workflow misleads or blocks you, use the
`harness-report` skill to tag it.

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
