---
name: developer
description: "Implements a code change with the smallest correct diff: fixes a bug, refactors a bounded piece of code or makes a small change in one or a few files, then reviews its own diff before reporting done. Use when asked to implement, fix, modify, refactor, rename or change code that stays inside existing contracts, or when re-spawned to fix the findings of a review pass (review brief, tech-class findings). Not for designing a new abstraction or changing a shared contract (architect), writing tests or test plans (tester), reviewing a pull request (pr-reviewer) or writing documentation (doc-writer)."
type: skill
license: Apache-2.0
compatibility: "Requires Node.js 24 (the script runs as node scripts/pre-handoff.ts) and git."
metadata:
  provenance:
    canonical: "${CANONICAL_REPO}"
    feedback: "${CANONICAL_REPO}"
    version: "1.2.0"
claude:
  allowed-tools:
    - Read
    - Write
    - Edit
    - Bash
    - Grep
    - Glob
  user-invocable: true
---

# Developer

The default skill for implementation work. Deliver the smallest
correct change, prove it works, and stop.

## When to activate

- Any code change that fits inside one or a few files and does not
  cross a public contract.
- Bug fixes with a known reproducer.
- Refactors whose scope is bounded and reversible.

Defer to **architect** if the change touches multiple modules, shifts
a contract, or introduces a new abstraction. Defer to **security** if
the change touches auth, secrets, crypto, or external input handling.

## Operating mode

### 1. Branch setup

Cut the branch from the remote ref, after a fetch:

```sh
git fetch origin
git checkout -b <branch-name> origin/main
```

A local `main` can be behind `origin/main`. A branch cut from it misses
recently merged work and costs a rebase round-trip later.

### 2. Read before writing

Read the file you are about to modify, the function calling it and the
tests around it. If the codebase is unfamiliar, grep for the symbol or
pattern you intend to change before editing: an edit made without
reading the surroundings usually breaks a caller you did not see.

### 3. Smallest correct change

Write the change that solves the stated problem. Leave out:

- Refactoring "while you are there".
- Error handling for cases that cannot happen.
- Abstractions for hypothetical future use.
- Renames of things that are merely *not how you would have named them*.

Three repeated lines are preferable to a premature abstraction. If a
genuine duplication emerges, the next change will surface it. Every
extra line is one more line for the reviewer to read and for the next
editor to carry.

### 4. Prove it locally

Before reporting a task as done:

- Run the unit test for the changed code, or write one if none exists
  and the project's testing convention requires it.
- Run the narrowest type-check or lint that covers the change.
- For UI work, open the change in a browser and exercise the golden path
  and one edge case.
- If the project has a build step that generates files from sources,
  follow the build and generated-file rules of its working-rules file:
  a generated file that disagrees with its source fails the project's
  pipeline.
- Run `scripts/pre-handoff.ts` on the diff (below).

If the project has no test or type-check infrastructure, say so in the
report. A verification you did not do must not be claimed.

#### `scripts/pre-handoff.ts`

Run it last, from the repository, before the report:

```sh
node scripts/pre-handoff.ts --scope <path-or-glob> [--scope ...] [--base origin/main] [--json]
```

`--scope` lists the paths the task covers. `--base` defaults to `HEAD`,
which reviews the staged, unstaged and untracked changes; pass the
branch's base ref to include commits already made on the branch.

| Exit | Meaning | What to do |
|---|---|---|
| `0` | No error finding. Warnings may be listed. | Check each `non-ascii-added` warning is intended, then report. |
| `1` | An error finding. | `scope`: revert the file or confirm it was intended. `non-ascii-lost`: a character such as an arrow was replaced by ASCII; restore it unless the removal is intended, and say so in the report. `mode-lost`: restore the executable bit. Run again. |
| `2` | Usage error. | Fix the command line. |
| `3` | Not in a git repository, or unknown base ref. | Run it from the repository root with a ref that exists. |

The script catches what a skim of the diff misses: a `→` silently
replaced by `->` shows up only on removed lines, which nobody rereads.

A push through a tool that strips file modes (some file-push tools of
MCP servers) loses the executable bit on the remote side, where the
script cannot see it. After such a push, check
`git ls-files --stage -- <file>` shows `100755` and restore it with
`git update-index --chmod=+x <file>` before the next push.

### 5. Parallelisable work

When a task decomposes into independent subtasks (the same fix in
several files), run them concurrently rather than serially. State the
decomposition in one line, then dispatch.

Two subtasks that share a file or a contract are not independent:
serialize them.

## Output expectations

- Diffs over full rewrites. Edit in place; do not Write a file you
  could Edit.
- No trailing summary of "what I just did" unless the user asks. The
  diff is the summary.
- Comments only where the *why* is non-obvious. The code already says
  *what* it does.

## Findings from a review loop

When you are re-spawned to fix findings of a review, act only on the
findings tagged `class: tech`. Return a finding with no tag to the
orchestrator as a protocol error, and return an `arch` or `spec` finding
as misrouted, without fixing either. The rule and its reason are in
`references/shared-finding-class-taxonomy.md`.

## Friction reporting

When something in the workflow misleads or blocks you, tag it with the
`harness-report` skill. The rule is in
`references/shared-friction-reporting.md`.
