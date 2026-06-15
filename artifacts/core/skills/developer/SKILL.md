---
name: developer
description: "Implementation skill for writing, modifying, and refactoring
  code. Activate by default for any coding task that does not warrant the
  architect skill. Optimized for parallelisable execution, fast feedback
  loops, and minimal surface area per change."
type: skill
license: Apache-2.0
compatibility: "Requires bash (used by scripts/build-components.sh) and git (used for staged-file inspection of executable bits)."
metadata:
  provenance:
    canonical: "${CANONICAL_REPO}"
    feedback: "${CANONICAL_REPO}"
    version: "1.1.5"
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

Before creating your branch, always synchronize with the remote to
avoid basing work on a stale commit:

```sh
git fetch origin
git checkout -b <branch-name> origin/main
```

Never use `git checkout -b <branch> main` (local ref) — it may be
behind `origin/main` if the remote was updated since your last fetch,
which causes the branch to miss recently merged PRs and forces a
rebase round-trip.

### 2. Read before writing

Read the file you are about to modify. Read the function calling it.
Read the tests around it. Two minutes of reading saves twenty minutes
of guessing.

If the codebase is unfamiliar, run a focused grep for the symbol or
pattern you intend to change before editing — never edit blind.

### 3. Smallest correct change

Write the change that solves the stated problem. Resist:

- Refactoring "while you are there".
- Adding error handling for cases that cannot happen.
- Introducing abstractions for hypothetical future use.
- Renaming things that are merely *not how you would have named them*.

Three repeated lines is preferable to a premature abstraction. If a
genuine duplication emerges, the next change will surface it.

### 4. Prove it locally

Before reporting a task as done, run:

- Review the full diff (`git diff HEAD`) against the declared task scope
  before reporting done. Any modified file not explicitly in scope is a red
  flag — revert it or confirm it was intentional. Pay special attention to
  Unicode → ASCII regressions (e.g. `→` silently replaced by `->`, `—` by
  `--`): a quick `git diff HEAD | grep -P '[^\x00-\x7F]'` catches additions
  of non-ASCII, but the inverse — loss of non-ASCII — requires checking the
  removed lines.
- The unit test for the changed code (or write one if none exists and
  the project's testing convention requires it).
- The narrowest type-check / lint that covers the change.
- For UI / frontend work: open the change in a browser and exercise
  the golden path *and* one edge case.
- For changes to bundled-script source files (any file under
  `artifacts/core/skills/<name>/scripts/`,
  `artifacts/library/skills/<name>/scripts/`,
  `artifacts/community/skills/<name>/scripts/`,
  `artifacts/core/agents/<name>/scripts/`,
  `artifacts/library/agents/<name>/scripts/`, or
  `artifacts/community/agents/<name>/scripts/`): run
  `bash scripts/build-components.sh` to regenerate the `.gemini/` and
  `.claude/` mirrors, stage them in the same commit, then run
  `bash scripts/build-components.sh --check` to confirm drift-free.
  This is non-optional — the CI `check-components` job rejects PRs
  where source and bundles disagree.
- For changes that include shell scripts: after any push via the MCP
  `push_files` tool (which strips file modes), verify the executable
  bit survived. `git ls-files --stage -- '*.sh'` must show `100755`,
  or `ls -la` show `755`. Restore with `git update-index --chmod=+x
  <file>` before the next push.

If the project has no test or type-check infrastructure, say so
explicitly in the report — do not claim verification you did not do.

### 5. Parallelisable work

When a task decomposes into independent subtasks (e.g. apply the same
fix to several files), prefer launching them concurrently rather than
serially. State the decomposition in one line, then dispatch.

If two subtasks share a file or a contract, they are *not*
independent — serialize them.

## Output expectations

- Diffs over full rewrites. Edit in place; do not Write a file you
  could Edit.
- No trailing summary of "what I just did" unless the user explicitly
  asks. The diff is the summary.
- Comments only where the *why* is non-obvious. Do not narrate *what*
  the code does — the code already does that.

## Finding class taxonomy

When re-spawned as the DEV target of a `tech`-class iteration of the
retroactive review loop (per
[`specs/0005-retroactive-routing-engine.md`](../../../specs/0005-retroactive-routing-engine.md)
R4 and [`docs/retroactive-loop.md`](../../../docs/retroactive-loop.md)
→ *Routing matrix*), the brief carries reviewer findings each
tagged with a `class:` field. The skill SHALL act on findings whose
`class:` is `tech` and SHALL surface a violation back to the
orchestrator if any incoming finding it is asked to address omits
the tag — a missing tag is a reviewer protocol error, not a hint to
guess at the loop target. Findings tagged `arch` or `spec` are
out-of-scope for this skill and indicate misrouting; flag and
return.

## Friction reporting

When a recognition signal fires (see `config/TOOLS.md` →
*Friction Reporting → Recognition signals*), invoke the
`harness-report` skill rather than reimplementing the protocol
inline. The reporter walks you through identifying the offender,
picking the room, and filling the payload.
