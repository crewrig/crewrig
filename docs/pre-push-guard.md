# Pre-push guard

<!-- crewrig-doc: section=reference nav_order=160 published=true title="Pre-push guard" -->

The pre-push guard is an opt-in native git hook that runs the fast tier of the
repository's CI checks on your changeset before `git push` sends anything. It
catches the cheap, deterministic failures (spec lint, Markdown lint, links,
path ownership, drift checks) in seconds instead of after a CI round trip.
It is a convenience, not a gate: CI stays authoritative (spec 0279).

## Enable it

Enablement is explicit and local. The repository setup scripts and
`task install-deps` do **not** enable it, because they also run for adopters
outside a development checkout.

```sh
task ci:hooks-install     # git config --local core.hooksPath .githooks
task ci:hooks-status      # print the current core.hooksPath
task ci:hooks-uninstall   # unset it, only if it is still .githooks
```

- Only the local configuration of this repository is written (`.git/config`,
  shared by its worktrees). Nothing is written globally or under your home
  directory.
- Both install and uninstall are idempotent. A second `install` reports
  `already enabled`.
- When `core.hooksPath` already holds another value, `ci:hooks-install` refuses
  and prints it. Pass `FORCE=true` to overwrite it.
- Outside a CrewRig checkout the tasks refuse with a non-zero exit.

## What runs

On `git push`, `.githooks/pre-push` resolves the checkout it runs in and calls
`task ci:pre-push`, which runs `node scripts/ci-pre-push.ts`. The wrapper:

1. Computes the changeset: the files that differ between `HEAD` and its
   merge-base with `origin/main`, unioned over every ref being pushed.
2. Selects the capabilities of the **fast tier** whose `pull-request` `paths:`
   filter in `ci/ci-capabilities.yml` matches the changeset. A capability
   without a path filter always runs.
3. Runs the matching `ci:<id>` tasks concurrently with a pool of
   `min(4, available cores)`. Each task's output is buffered and printed only on
   failure; a passing task prints one status line with its duration.

The fast tier is the list in `ci/pre-push-tier.json`, a map from capability id
to its measured time in seconds. A capability is admitted only if it is
deterministic, needs no container, network or secret, and runs in at most 30 s
alone. The target is 60 s of wall-clock on a typical change (at most 20 files);
the wrapper prints a warning, without failing, when a run exceeds it.

### Measured cost

The target is met only on an idle machine with at least 8 cores. The exact CI
commands of a capability include the checkers' own self-test suites, which makes
the fast tier CPU-bound: about 200 to 300 CPU-seconds for the whole tier. Measured
on 2026-10-24 on a 10-core Mac, `ci:pre-push` run on a branch of 16 changed files:

| Condition | Tasks | Wall-clock | CPU time |
|---|---|---|---|
| Idle machine | 21 | 29 s | 205 s |
| Light contention (load average about 10 on 10 cores) | 21 | 44 s | 276 s |
| Heavy contention (load average 47 to 60, other agents running) | 21 | 135 s | 311 s |
| `node:24` Linux container, host under heavy contention | 20 | 121 s | 889 s |

Capabilities measured alone on the Mac: `lint-specs` 23 s, `path-ownership` 23 s,
`frontmatter` 27 s, every other one 9 s or less. Splitting each checker's
self-tests from the check, in capabilities of their own with their own `paths:`
filters, is planned work (WP-C of epic #1761) and removes most of that cost. Until
then, push with `git push --no-verify` when the machine is busy; CI stays
authoritative.

### Choosing the base

The default base is `origin/main`. Override it with
`CREWRIG_PRE_PUSH_BASE=<ref>`. When the base cannot be resolved locally the
wrapper prints a notice and runs every capability of the fast tier; it never
runs `git fetch` or any other network command.

### Draft pull requests and spec 0168 R1

Spec 0168 R1 is a merge gate: it fails while a spec's status is still
`draft`-like. Before a PR exists, a spec being pushed is necessarily in that
state, so the hook sets `CREWRIG_PR_DRAFT=true` for the spec linter task only.
Every other rule of the spec linter still applies.

## Worktrees

`core.hooksPath` is shared by every worktree of a repository. The hook never
bakes in an install-time path: it runs `git rev-parse --show-toplevel` from the
directory git gives it and runs the checks from that checkout. A fresh worktree
without `node_modules` fails the push with `run task lint-bootstrap`; it never
passes silently.

## Floors and failure modes

- Node 24 or later (the hook tests `process.getBuiltinModule` first and names
  the floor when it is missing).
- Task 3.39 or later (every Taskfile declares `version: '3.39'`).
- `task` missing from `PATH`, a missing `node_modules`, an unreadable
  capability file or any internal error of the wrapper all block the push with
  a message naming the cause and the fix. The hook runs no `npm` command and no
  network command.
- A repository where `taskfiles/ci.yml` is absent (not a CrewRig checkout) is a
  no-op with a notice.

## Escape hatch

`git push --no-verify` skips the hook. CI stays authoritative, so a skipped
hook only moves the failure to the pull request.

## Same on every CLI

The hook is native git, so it applies identically to Claude Code, Gemini CLI,
GitHub Copilot CLI and Antigravity CLI whenever they run `git push`. There is no
per-CLI script, hook file or wiring (see row 45 of the
[CLI matrix](cli-matrix.md)).

## Interface

| Item | Form |
|---|---|
| Wrapper | `node scripts/ci-pre-push.ts [-- <remote> <url>]` |
| Pushed refs (stdin of the hook) | `CREWRIG_PRE_PUSH_REFS` |
| Base override | `CREWRIG_PRE_PUSH_BASE` |
| Hook management | `node scripts/ci-pre-push.ts hooks install\|uninstall\|status` |
| Entry task | `task ci:pre-push` |

## Add a `ci:<id>` task

Each fast-tier capability `<id>` of `ci/ci-capabilities.yml` has a task
`ci:<id>` in `taskfiles/ci.yml`. The rule is that the task runs **exactly the
capability's command**, so the hook and CI cannot drift:

- Reuse an existing domain task through a colon-anchored call
  (`- task: :lint-markdown`), never an unanchored `- task: lint-markdown`.
  Commands the capability spells out are copied verbatim, with repository paths
  written `{{.REPO_DIR}}/...`.
- Provisioning steps (`npm ci`, `npm install`) are not copied. Replace them with
  a precondition that fails with `Run: task lint-bootstrap`.
- Run `node scripts/check-ci-pre-push-parity.ts`. It normalises both sides
  (expands task calls, strips `{{.REPO_DIR}}/` and `{{.CLI_ARGS}}`, drops
  provisioning) and fails when they differ.
- To put the new task in the fast tier, measure it alone, keep it at or under
  30 s, and add its id and time to `ci/pre-push-tier.json`.

See [`docs/ci-reference-format.md`](ci-reference-format.md) for the capability
file format and [`DEVELOPMENT.md`](../DEVELOPMENT.md) for the Taskfile layout.
