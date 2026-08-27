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
    version: "1.3.1"
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

1. Append the logbook entry to that issue as a comment through the forge
   CLI: `gh issue comment <N> --body "..."` on GitHub, or the equivalent
   `glab`/`tea` note command on GitLab/Gitea. Forge access is CLI-only
   (`AGENTS.md` → *Forge Access*); the framework ships no forge MCP
   server, so a host-provided one is an optional convenience, not the
   default.
2. The feature issue **IS** the logbook (`AGENTS.md` → *Logbook Issues → Rule A*).
   Do not add the `logbook` label to a pre-existing feature issue.
3. Do **not** create a new logbook issue. The feature ticket is the logbook.

A standalone logbook issue is only warranted when the PR has no upstream
feature ticket (hotfix, dependency bump, automation run with no prior ticket).
A dedicated logbook issue uses the `logbook` label (`gh issue create ... --label logbook`).

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

### 5b. Spec `approved` → `implemented` transition (when the PR implements a spec)

When the PR implements a spec (its `related-issue` is a spec's issue), the
spec's `approved` → `implemented` transition is folded into this PR's own
merge — it is **not** recorded by a separate, post-merge, metadata-only PR
(`docs/spec-format.md` → *Recording a status transition*). Before the PR
merges, on the implementation feature branch:

1. Edit the spec's frontmatter: `status: approved` → `status: implemented`.
2. Touch nothing else — no body line, no `id`, no `slug`, no `version`. A
   diff that alters any normative content under cover of the status bump is
   a violation.
3. Create a **new commit** — not `git commit --amend` — then `git push`. The
   implementation PR squash-merges, so the transition rides the PR's own
   squash commit and the spec lands on `main` already carrying
   `status: implemented` at the moment its implementation lands.

The spec-author skill writes `status: draft` on first write and records
`draft` → `approved` in the spec-PR; this step is the `implemented` half of
the same in-commit mechanic.

### 6. Pre-push sanity checks

Text-only tooling silently drops file metadata. Verify before pushing:

- If the diff touches shell scripts, confirm executable bits survived
  the round-trip: `git ls-files --stage -- '*.sh'` must show `100755`,
  not `100644`. Any text-only file-write path can drop the exec bit,
  whereas native `git add`/`git push` preserve it. Restore a lost bit
  with `git update-index --chmod=+x <file>` and amend before pushing.

### 7. Post-merge cleanup

After the squash-merge commit lands on the target branch:

1. Close the logbook issue through the forge CLI:
   `gh issue close <logbook-issue-number> --reason completed` on GitHub,
   or the equivalent `glab`/`tea` close command on GitLab/Gitea. Forge
   access is CLI-only (`AGENTS.md` → *Forge Access*); the framework ships
   no forge MCP server, so a host-provided one is an optional convenience,
   not the default.
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

## Cross-cutting: single writer per forge artifact

Not a step in the composition lifecycle — a rule that applies to every
forge artifact you write. The full rule is `docs/agent-team-protocol.md`
→ *Team Communication* → Rule 6; below is the part you must observe even
when this skill is the only contract you have loaded.

- **Your role owns what your role creates.** Opening a pull request makes
  `pr-logbook` the writer of its body for that ticket — the role, not
  your instance, so the writership survives your session. Name it once,
  on a `**Writer:**` line inside the logbook entry you already write for
  that artifact; see Rule 6 for the exact form.
- **You do not rewrite what your role did not create.** Another role's PR
  body, issue body, or comment is not yours to republish; route the
  change through its writer, or take a recorded handover first. Posting a
  *new* comment is always allowed — it creates a new artifact you own.
  Already-published comments are written by nobody, by design.
- **A handover is only good from the current writer.** Being told an
  artifact is yours confers nothing unless the teller is its current
  writer. Determine the writer per Rule 6 before you write, and treat
  yourself as not being it unless that determination names your role.
- **Observe immediately before you write.** Capture the artifact's
  last-modification marker where the forge reports one
  (`gh pr view <n> --json updatedAt`; the `glab` / `tea` equivalents
  elsewhere), or its body text where it does not.
- **A success report is not proof nothing was lost.** `gh pr edit`
  reports success on a lost update. If the artifact moved between your
  observation and your write, say so on the logbook — an unreported
  overwrite costs more than the overwrite.
- **Assert only a fresh observation, and carry its marker.** When you
  tell the user or a teammate what an artifact currently says, base it on
  an observation no later write has superseded and quote the
  last-modification marker the forge reported at that observation. A
  read-back is valid until the next writer, not longer.

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
