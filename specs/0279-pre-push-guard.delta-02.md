---
id: "0279"
slug: pre-push-guard
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1783
version: 1.2.0
---

# Pre-push guard

Delta-02 closes a defect of the hook shipped by this spec: git exports repository-location variables (`GIT_DIR`, `GIT_EXEC_PATH`, `GIT_PREFIX`) to a `pre-push` hook, the hook and the wrapper pass the whole environment on, and every concurrent `ci:<id>` task therefore inherits them. From a linked worktree, `GIT_DIR` is the worktree's gitdir (`<repo>/.git/worktrees/<wt>`, with no `GIT_WORK_TREE`), so a test fixture that runs `git init`, `git config` or `git checkout` in a `mkdtemp` directory acts on the real repository instead: `core.bare` becomes `true`, `user.name=Test`, `user.email` and `commit.gpgsign=false` land in the shared `.git/config`, and the linked worktree's `HEAD` moves. Afterwards every git command of the checkout fails with `this operation must be run in a work tree`. The cause was reproduced in a sacrificial `mkdtemp` repository (issue #1783, logbook). The fix is a scrub of every `GIT_*` variable at the hook and wrapper boundary, with the shared test helpers scrubbing too as defence in depth. Because R14 says the hook does exactly six things and no other, the scrub is a delta of this spec: one new requirement (R21) and a wording change of duty (4) of R14. Every other requirement is unchanged.

## ADDED

### Requirements

- **R21 (environment scrub at the hook and wrapper boundary).** No `GIT_*` variable SHALL reach a `ci:<id>` task or a test fixture through the pre-push path.
  - **(a) Hook.** After resolving the toplevel (duty (2) of R14, which runs with the environment git gave the hook), the hook SHALL pass to `task` an environment from which every variable whose name starts with `GIT_` has been removed (the match is case-sensitive on POSIX and case-insensitive on `win32`, where environment names are case-insensitive, as `taskEnv` already treats `Path`; the hook's inline loop and the shared function of (b) apply the same rule). Every other variable is kept, `PWD` and `CREWRIG_PRE_PUSH_REFS` included. The toplevel is computed before the scrub, so duty (2) still sees the variables git set. The scrub is part of duty (4) of R14, not a seventh duty: the hook still does exactly six things, in the same order, within the 45-line cap of R14.
  - **(b) Wrapper and runner.** `scripts/ci-pre-push.ts` and `taskEnv` of `scripts/lib/ci-pre-push/run.ts` SHALL remove every `GIT_*` variable from the environment of every spawned `task ci:<id>`, whoever started the wrapper, so that a manual `task ci:pre-push` run from inside a hook, an alias or a script that inherited `GIT_*` is safe too. `BASE_REF`, `CREWRIG_PR_DRAFT`, `PWD` and the `PATH` handling of R8(e) and R12 are unchanged. The removal is one shared pure function in `scripts/lib/` (name chosen by the PLAN), used by `taskEnv`; the hook, being dependency-free plain JavaScript under R14, carries its own inline equivalent of a few lines, kept under the 45-line cap.
  - **(c) Defence in depth.** Every shared test helper that builds a child environment for git-backed fixtures SHALL remove the inherited `GIT_*` variables before it applies its own explicit hermetic values (`GIT_CONFIG_GLOBAL`, `GIT_CONFIG_NOSYSTEM`, `GIT_AUTHOR_*`, `GIT_COMMITTER_*` and the like), so a test file run directly from a hook-like context cannot reach the real repository either. The first two are `childEnv` of `scripts/tests/lib/governance-sandbox.ts` and `gitEnv` of `scripts/tests/lib/governance-git-fixture.ts`; the PLAN lists the others by searching `scripts/tests/lib/` for helpers that spawn git or derive their environment from `process.env`, and names each one it changes. A unit test per changed helper, run with a polluted parent environment (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_PREFIX`), asserts that the environment the helper returns carries none of the inherited values (only the hermetic `GIT_*` values the helper sets itself). These unit tests live in the test file of (d) (or in a sibling file the PLAN names) and, like the tests of (d), are wired in CI per R16 in the `check-taskfile-tree` capability, so they run whichever capability consumes the helper.
  - **(d) Regression tests**, committed and wired in CI per R16:
    1. The real `.githooks/pre-push` runs through a real `git push` from a linked worktree of a sacrificial `mkdtemp` repository to a `mkdtemp` bare remote, the hook enabled by `core.hooksPath` in that sacrificial repository only. A fake `task` (the technique of `scripts/tests/ci-pre-push-hook.test.ts`) performs the fixture-style git mutations (`git init`, `git config user.name`, `git checkout -b`) in its own `mkdtemp` directory, with the environment it received. The push targets the bare remote by its path (`git push <path> <branch>`, no `-u`), so git writes no `refs/remotes/**` entry and no tracking configuration, and the assertion is satisfiable by a correct implementation. The test asserts that the sacrificial repository's `.git/config`, every `HEAD`, its refs (`git for-each-ref`) and the output of `git worktree list` are byte-identical before and after the push.
    2. A unit test proves that the child environment of every task spawned by `runTasks` (through `taskEnv`) contains no `GIT_*` variable, including when the parent environment carries `GIT_DIR`, `GIT_INDEX_FILE`, `GIT_WORK_TREE`, `GIT_EXEC_PATH` and `GIT_PREFIX`, and that `BASE_REF`, `PWD`, `PATH` and the `CREWRIG_PR_DRAFT` rule of R12 are unchanged.
    3. Mutation proof: with the scrub removed from a copy of the hook, test (1) fails; with the scrub removed from `taskEnv`, test (2) fails. The mutation runs only in the sacrificial repository, so any damage is confined to `mkdtemp` paths.

    Every git operation of these tests runs in a `mkdtemp` repository, with `HOME` and `GIT_CONFIG_GLOBAL` pointed at `mkdtemp` paths and the `GIT_*` variables scrubbed from the child environment. No test removes or restores a path it did not create with `mkdtemp` (`scripts/check-host-safety.ts`), and no test enables the hook in the real repository.
  - **(e) Documentation.** `docs/pre-push-guard.md` SHALL name the failure mode (a hook-time `GIT_DIR` leaking into a task that runs git in a temporary directory) and give the exact repair commands for a shared config that was already damaged, run in the damaged checkout: `git config --local core.bare false`; `git config --local --unset user.name`; `git config --local --unset user.email`; `git config --local --unset commit.gpgsign`; and `git symbolic-ref HEAD refs/heads/<ticket-branch>` in the damaged worktree. `core.hooksPath` stays as the user wants it.
  - **Tier.** `small` is deliberate: every edit is a mechanical removal of environment keys (one few-line loop in the hook, one pure function, a call in `taskEnv`, one call per helper), the new tests (the three of (d) and the per-helper unit tests of (c)) live in one new test file, or in one sibling file the PLAN names, and the CI wiring extends the existing `check-taskfile-tree` capability with that test path; there is no new capability, no new contract and no design choice left open beyond the helper list, which the PLAN closes by search.
  - **Deliberate consequence.** Removing `GIT_CONFIG_GLOBAL`, `GIT_SSH_COMMAND` and similar variables from task environments is intended. No `ci:<id>` task pushes or fetches, and the fixtures that need git configuration set their own hermetic values (R21(c)). The scrub is a blanket prefix rule, not a list, so that a `GIT_*` variable added by a future git version is covered too. A search of `scripts/`, `taskfiles/` and `ci/` outside the tests finds `GIT_*` readers only in code the fast tier does not run on a changeset (the release and spec-id reservation identity fallbacks, `usage-store/ledger.js`, the TLS detection lists and the GitLab `GIT_DEPTH` renderer), and the tests of that code set their own values.

### Acceptance

The three tests of R21(d) pass in CI, and so do the per-helper unit tests of R21(c). The mutation proof fails as stated: removing the scrub from a copy of the hook fails test (1), and removing it from `taskEnv` fails test (2). `task test-wiring`, `scripts/check-path-ownership.ts` and `scripts/check-ci-parity.ts` pass (R16), and the documentation passes `task lint-markdown` and `markdown-links`.

### Scenarios

**Scenario:** a push from a linked worktree leaves the repository untouched

Given a linked worktree of a repository whose `core.hooksPath` is `.githooks`, and a `ci:<id>` task that runs git commands in a temporary directory
When `git push` runs the hook
Then the repository's `.git/config`, every `HEAD`, its refs and its worktree list are unchanged after the push

**Scenario:** a manual run from a hook-like environment is safe

Given a shell whose environment carries `GIT_DIR` and `GIT_PREFIX`, as inside a hook or an alias
When a developer runs `task ci:pre-push`
Then every spawned `ci:<id>` task sees no variable whose name starts with `GIT_`

### Alternatives considered

- **Scrub only in the test helpers.** Rejected: the repository holds about 380 fixtures, and any task or future fixture that builds its own environment reopens the hole. The hook and wrapper boundary is the single choke point; the helpers are kept as a second layer (R21(c)), not as the fix.
- **Scrub only at the boundary.** Rejected as the sole measure: a developer who runs a test file directly from a hook-like context, or a helper that re-derives its environment from `process.env`, stays exposed. Hence R21(c).
- **An allowlist of the few `GIT_*` variables to keep.** Rejected: no task needs any of them, and an allowlist drifts as git adds variables, so the prefix rule trades a hypothetical future need for a guarantee that does not rot.
- **Set `GIT_DIR` explicitly to the right value in fixtures.** Rejected: a fixture must never see the real repository at all, and a correct-looking `GIT_DIR` still points git at the wrong place for any fixture that creates its own repository.
- **`env -u GIT_DIR ...` in the hook through `/usr/bin/env`.** Rejected: not portable to Git for Windows, which R14 requires, and it names variables one by one instead of the whole prefix.

## MODIFIED

Only duty (4) of R14 changes. The rest of R14 is verbatim: the hook is still `.githooks/pre-push`, still at most 45 lines of dependency-free plain JavaScript, and still does exactly six things in the same order.

Duty (4). Original:

> (4) run `task ci:pre-push -- <remote> <url>` with that directory as the working directory and `CREWRIG_PRE_PUSH_REFS` set from stdin,

Replacement:

> (4) run `task ci:pre-push -- <remote> <url>` with that directory as the working directory, with `CREWRIG_PRE_PUSH_REFS` set from stdin, and with an environment that is the hook's own environment from which every variable whose name starts with `GIT_` has been removed (R21),

Consequential, wording only: none. R8(e) (the wrapper sets `BASE_REF` in the environment of every spawned task), R12 (`CREWRIG_PR_DRAFT=true` for `ci:lint-specs` only) and R18 (the hook resolves the toplevel at run time from the working directory git gives it) hold as written, because the toplevel is resolved before the scrub and `BASE_REF` and `CREWRIG_PR_DRAFT` are set by the wrapper after it. R1 to R13, R15 to R20 are unchanged.

## REMOVED

Nothing is removed.
