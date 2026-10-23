---
id: "0147"
slug: ci-execution-speed
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1770
version: 2.1.0
---

# CI execution speed

## ADDED

### Why this delta exists

The exhaustive run of requirement 21 of delta-01 (`.github/workflows/changeset-coverage.yml`,
capability `changeset-coverage` of `ci/ci-capabilities.yml`) has been red on `main` since
2026-10-21. The job never installs Task, while the changeset-gated capability
`cli-matrix-fresh` runs `task cli-matrix:check`, so the run dies with
`task: command not found`. Requirement 22 of delta-01 made the failure visible; nothing
prevents the next one.

The cause is structural. Every changeset-gated command is run by one job, so that job needs
the union of what those commands need. Today the union of `requires.tools` over the
changeset-gated capabilities is `jq, yq, task, tesseract`, and `changeset-coverage` declares
only `yq`:

| Tool | Needed by (changeset-gated) | Provisioned in the exhaustive run today |
|---|---|---|
| `yq` | many | yes (hand-written install step) |
| `jq` | `extension-render`, `extension-install`, `mempalace`, `e2e`, `setup`, `frontmatter` | GitHub: preinstalled on `ubuntu-latest`; GitLab: not declared, so not installed |
| `task` | `cli-matrix-fresh`, `check-taskfile-tree` | no |
| `tesseract` | `figure-labels` | no |

`tesseract` is the same class of gap in its quiet form: `scripts/check-figure-labels.ts`
prints `[SKIP] tesseract is not installed` and exits 0, so the exhaustive run reports green
while `figure-labels` checked nothing. A coverage run that skips silently is worse than one
that fails.

This delta states the union rule, provisions the tools on both engines, and adds a mechanical
guard on the pull-request path so that a gated capability that gains a tool, or a gated
command that starts calling one, cannot reach `main` without the exhaustive run being told.
The command-level half of that guarantee already exists: validity rule 6 of `check-ci-parity`
fails a capability whose command invokes `yq`, `jq`, `task` or `markdownlint` without
declaring it. Combined with the union rule below, a gated command that invokes `task` forces
its own capability to declare `task`, which forces `changeset-coverage` to declare it.

### Vocabulary

- **Gated union.** The set of tool names that appear in the `requires.tools` of at least one
  capability with `changeset-gated: true` in `ci/ci-capabilities.yml`, read at check time.
- **Coverage-tools guard.** The test introduced by requirement 28.

### Requirements

- **R25.** The capability `changeset-coverage` SHALL declare in its `requires.tools` every
  tool of the gated union. The declaration is the contract: the job that runs the commands
  of every changeset-gated capability needs what every one of them needs (extends
  requirement 21 of delta-01).
- **R26.** The exhaustive run SHALL provision each tool of the gated union on **both
  engines**, so that no gated command runs against a missing tool:
  - On GitHub Actions, `.github/workflows/changeset-coverage.yml` SHALL gain an install
    step for each tool that `ubuntu-latest` does not provide. Today that is `task`, with the
    command already used by the `lint-specs` job of `build.yml`, and `tesseract`, with the
    command already used by the figure-labels job of `build.yml`. `yq` keeps its existing
    step. `jq` is preinstalled on `ubuntu-latest` and needs no step.
  - On GitLab CI, `.gitlab-ci.yml` SHALL be **regenerated** with
    `node scripts/build-ci.ts`, which installs each declared tool from the recipes of
    `scripts/lib/build-ci/tools.ts`. It SHALL NOT be edited by hand.
  - The two engines SHALL keep agreeing as required by requirement 9 of the parent
    (`check-ci-parity`).
- **R27.** A tool of the gated union SHALL NOT be satisfied by a silent skip. When an
  install step of requirement 26 fails, the exhaustive run SHALL fail at that step; the
  run SHALL NOT continue against the missing tool and report a pass because the check
  skipped itself. This delta does not change `scripts/check-figure-labels.ts`; it removes
  the condition (tesseract absent) that triggers its skip in the exhaustive run.
- **R28.** A **coverage-tools guard** SHALL run on every pull request targeting `main` or
  `release/**` and every push to `main` and `release/**`, with **no `paths:` filter**, so
  that it cannot be skipped by the mechanism it polices (the reasoning of requirement 11 of
  delta-01). It SHALL fail when the gated union contains a tool that is absent from the
  `requires.tools` of `changeset-coverage` (requirement 25). A tool that a runtime declared
  by `changeset-coverage` already provides is satisfied without a `requires.tools` entry:
  `python3` is provided by a `python@*` runtime, the analogous exemption `check-ci-parity` applies
  to the GitHub install step. A gated **command** that invokes `yq`, `jq`, `task` or
  `markdownlint` is covered transitively: validity rule 6 of `check-ci-parity` requires its
  own capability to declare the tool, and this requirement then requires `changeset-coverage`
  to declare it. A tool outside that probe list (for example `tesseract`) is covered only
  through the `requires.tools` of the capability that uses it, which is the contract of the
  reference. The guard
  SHALL NOT define a second, different notion of "invokes a tool".
- **R29.** The guard SHALL read `ci/ci-capabilities.yml` **at check time** and SHALL NOT
  embed a copy of the gated union, of the capability list, or of any command or tool list.
- **R30.** Each finding line of the guard SHALL name **the capability** and **the missing
  tool**, in the form
  `ci-changeset-coverage-tools: <capability-id> needs <tool> but changeset-coverage does not require it`
  (`<capability-id>` is the gated capability that declares the tool). The guard SHALL exit
  non-zero when it prints at least one finding, and SHALL exit zero and print the number of
  gated capabilities and tools evaluated when it prints none.
- **R31.** The guard SHALL be a new test file,
  `scripts/tests/ci-changeset-coverage-tools.test.ts`, run by the existing capability
  `changeset-coverage-test`. That capability already runs on every pull request to `main` or
  `release/**` and every push, is never path-filtered and is not changeset-gated
  (requirement 23 of delta-01), so **no new job and no new capability** is introduced, on
  either engine. The command is added to the `command` list of the capability in
  `ci/ci-capabilities.yml`, to the matching hand-written job `changeset-coverage-test` of
  `.github/workflows/build.yml` (one step per declared command, so that `check-ci-parity`
  keeps the engines in agreement, requirement 9 of the parent), and `.gitlab-ci.yml` SHALL be
  regenerated, not edited. The test SHALL include a fixture-driven case per scenario below,
  each built from a temporary copy of a reference document, never by mutating the real
  `ci/ci-capabilities.yml`.
- **R32.** The merge of the implementation pull request SHALL be preceded by a green
  `workflow_dispatch` run of the **Exhaustive Run** workflow on the implementation branch,
  linked in the pull request body. If that run reveals any failure other than the missing
  tools of requirements 25 and 26 (a pre-existing red check that the run had been masking),
  the implementer SHALL report it on the logbook issue and to the maintainers **before**
  widening the scope of the change to fix it. This delta does not authorize fixes to
  unrelated checks.

### Alternatives considered

- **A runtime pre-check inside `scripts/lib/ci-changeset-coverage/entry.ts`** (before running
  the first command, verify that each required tool is on `PATH` and exit 2 with a clear
  message, as it already does for `yq`). **Rejected for this delta, and not wanted in
  addition.** It runs only in the daily run, so it turns an obscure `command not found` into a
  clear one *after* `main` is already red; the guard turns it into a pull-request failure
  *before* merge. It also duplicates the reference's own `requires.tools` as a second
  hand-kept list. The `yq` pre-check that exists today is a historical artifact of the shell
  script and is left as is.
- **A new capability or job for the guard.** Rejected: `changeset-coverage-test` already has
  exactly the required triggers (every pull request and push, no filter) and the guard is a
  node test of the same family. A new job costs a runner on both engines for a seconds-long
  check.
- **A text assertion on `changeset-coverage.yml`** (fail when an install step is missing for a
  declared tool). **Not needed**: `check-ci-parity` already fails when a declared
  `requires.tools` entry (other than `jq`, `git`, `diff`) has no install step in the GitHub job
  attributed to the capability, and it attributes `changeset-coverage.yml`. Once requirement
  25 lands, the GitHub install steps of requirement 26 are mechanically enforced; the dispatch
  run of requirement 32 proves the run itself, not the presence of the steps.
- **Extending `check-ci-parity` with the union rule** (a new validity rule instead of a new
  test). Considered: it would keep one reader of the reference and reuse the existing
  fixtures. **Not chosen for this delta**: `check-ci-parity` already hosts reference-validity
  rules (validity rule 6 is the same kind of consistency rule), so it is a legitimate home.
  A small dedicated test with its own fixtures keeps the regression scenarios readable and
  leaves the parity harness, which two other tickets edit, untouched. The implementer MAY
  revisit this in the plan if the harness turns out to be the cheaper home, since the
  observable contract (requirements 28 to 30) is unchanged.
- **A second, command-level rule** (a gated command invoking `task` must be matched by
  `changeset-coverage`). **Rejected**: validity rule 6 of `check-ci-parity` already ties every
  command to its capability's declared tools, so a second definition of "invokes a tool"
  would only add a grammar to maintain; the union rule closes the chain.

### Scenarios

**Scenario:** the exhaustive run provisions Task

Given `cli-matrix-fresh` is changeset-gated and runs `task cli-matrix:check`
And `changeset-coverage` declares `task` in `requires.tools`
When the Exhaustive Run is dispatched on the implementation branch
Then the run installs Task before the first gated command
And `task cli-matrix:check` runs and passes
And the run ends green

**Scenario:** the exhaustive run does not skip figure-labels silently

Given `figure-labels` is changeset-gated and requires `tesseract`
When the Exhaustive Run executes the `figure-labels` command
Then `tesseract` is installed
And the log does not contain `[SKIP] tesseract is not installed`

**Scenario:** the guard passes on a consistent reference

Given a reference in which `changeset-coverage` declares every tool of the gated union
When the coverage-tools guard runs
Then it exits zero
And it prints the number of gated capabilities and tools evaluated

**Scenario:** removing `task` from the exhaustive run fails the guard (regression)

Given a copy of the reference in which `task` is removed from the `requires.tools` of
`changeset-coverage`
When the coverage-tools guard runs against it
Then it fails
And it prints `ci-changeset-coverage-tools: cli-matrix-fresh needs task but changeset-coverage does not require it`
And it prints the same finding for `check-taskfile-tree`

**Scenario:** a gated capability gains a new tool

Given a copy of the reference in which a changeset-gated capability adds `tesseract` to its
`requires.tools`
And `changeset-coverage` does not declare `tesseract`
When the coverage-tools guard runs against it
Then it fails and names that capability and `tesseract`

**Scenario:** a gated command that invokes `task` is covered transitively

Given a copy of the reference in which a changeset-gated capability has the command
`task docs:build`, declares `task` in its own `requires.tools`, and `changeset-coverage` does
not declare `task`
When the coverage-tools guard runs against it
Then it fails and names that capability and `task`

**Scenario:** a tool provided by a declared runtime needs no `requires.tools` entry

Given a changeset-gated capability that declares `python3` in `requires.tools`
And `changeset-coverage` declares the runtime `python@3.12` and no `python3` in `requires.tools`
When the coverage-tools guard runs
Then it reports no finding for `python3`

**Scenario:** the guard reads the live reference

Given the guard test is run twice against two different reference documents
When the first document lacks `jq` in `changeset-coverage` and the second declares it
Then the first run fails naming `jq` and the second run does not
And neither result depends on any list embedded in the guard

**Scenario:** the guard cannot be skipped

Given a pull request targeting `main` that changes only `docs/`
When the pipeline runs on either engine
Then `changeset-coverage-test` runs, and with it the coverage-tools guard

**Scenario:** an install step fails

Given the `tesseract` install step of the exhaustive run fails
When the Exhaustive Run executes
Then the run fails at that step
And no gated command runs against the missing tool

**Scenario:** the dispatch run reveals another pre-existing failure

Given the dispatched Exhaustive Run is red for a check other than a missing tool
When the implementer reads the result
Then the failure is reported on the logbook issue before any fix is attempted
And requirement 32's green run is still required before merge

### Out of scope

- The `task ci:<id>` migration of epic #1761 and any derivation of
  `.github/workflows/changeset-coverage.yml` from the reference.
- Hand edits of `.gitlab-ci.yml` (the file is regenerated, requirement 26 and 31).
- A runtime pre-check in `scripts/lib/ci-changeset-coverage/entry.ts` (see *Alternatives
  considered*).
- Changing `scripts/check-figure-labels.ts` or any other check that skips itself when its
  tool is absent, and fixing any failure of an unrelated check revealed by the dispatch run
  (requirement 32).
- Checking the install steps of the hand-written GitHub workflow against `requires.tools`.
- Changing the schedule, the triggers or the visibility rules of the exhaustive run
  (requirements 21 and 22 of delta-01).

## MODIFIED

**Requirement 21 of delta-01.** Delta-01 says:

> **R21.** `scripts/ci-changeset-coverage.sh` SHALL be retained, repurposed as an
> **exhaustive run**: it SHALL execute the commands of every changeset-gated capability
> regardless of what changed, and SHALL compute no diff and resolve no base ref. [...]

It is read with one added sentence:

> The job that performs the exhaustive run SHALL have every tool those commands need
> (requirements 25 to 27 of delta-02), on both engines; a command that cannot start because
> its tool is missing is a failure of the run, not a skipped command.

The execution contract is unchanged: this records in the normative text that "execute the
commands of every changeset-gated capability" includes providing their dependencies.

## REMOVED

None.
