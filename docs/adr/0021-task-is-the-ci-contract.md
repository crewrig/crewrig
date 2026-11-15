# ADR 0021 — Task is the CI contract

<!-- crewrig-doc: section=architecture-adr nav_order=210 published=true title="ADR 0021 — Task is the CI contract" -->

**Status:** Proposed (issue #1777, epic #1761 WP-C). Supersedes
[ADR-0012](0012-ci-reference-contract.md) in part. Decomposed by
[spec 0280](../../specs/0280-task-ci-contract.md). Amended 2026-10-25 by
[spec 0287](../../specs/0287-staged-reusable-workflows.md) (issue #1828): see
*Amendment: shared stage taxonomy*. Amended again by
[spec 0287 delta-02](../../specs/0287-staged-reusable-workflows.delta-02.md)
(issue #1933): see *Third amendment: the Windows group on spec-only pull
requests*.

## Context

- Goal: every CI job, on every engine, is `checkout`, provision the toolchain, run `task ci:<id>`. The commands live in `taskfiles/ci.yml` and nowhere else.
- Constraints: KISS (no new framework, no new YAML parser); stable task names and new tasks only in `taskfiles/ci.yml` (owner decision on #1764); the GitLab output stays generated and `check-ci-parity` stays green; `cancel-on-failure`, `changeset-coverage` and `path-ownership` keep working; CI green at every step.
- Non-goals: changing what any job verifies, the capability triggers, or the engines supported.

Baseline on `origin/main` (2026-10-24, issue #1777 §1): `.github/workflows/build.yml` 3,758 lines (346 `run:` steps, 24 `windows-*` jobs), `ci/ci-capabilities.yml` 5,189, `.gitlab-ci.yml` (generated) 3,734, total 12,681. Wave 1 added about 300 lines of guards. Parity tooling checks drift between copies of a command; it cannot shrink the surface. Only removing the copies can.

Today the authority is the capability `command:` in `ci/ci-capabilities.yml`; the `ci:<id>` tasks of `taskfiles/ci.yml` (#1763, spec 0279) are a mirror that a parity guard keeps equal to it. The command therefore exists three times (GitHub step, GitLab script, Task), and a checker's own regression suite is bundled into the same command, which is why `ci:pre-push` takes 110 to 135 s under load against a 60 s budget (`docs/pre-push-guard.md`).

## Decision

Invert the authority. The command of a CI job lives only in `taskfiles/ci.yml` as task `ci:<id>`. The capability `command:` shrinks to `task ci:<id>`.

### What remains of ADR-0012, what is superseded

| ADR-0012 clause | Status |
|---|---|
| Capability `id` equals the job key on every engine, with the key-comment fallback for engine-reserved names | Remains |
| Closed neutral trigger vocabulary and portable filters (`branches`, `paths`, `tag-pattern`) | Remains |
| `portability: portable\|specific` mark with an evidence-backed exception | Remains |
| Job-to-capability traceability checked by the parity guard | Remains |
| The reference as the authority for what a job runs (`command:`) | Superseded: authority is `taskfiles/ci.yml` |
| Parity guard direction "task must match the capability command" | Superseded: it checks the capability points at an existing `ci:<id>` task |

### What stays engine-level

Triggers, `paths:`, runtime, OS matrix, required tools, cache keys, history depth, and toolchain provisioning. These are properties of how an engine schedules and prepares a runner, not of what the job does, and Task cannot express them portably.

### Thin engine-file contract

A job in an engine file is exactly three things: check out the repository; provision the toolchain (pinned Task, runtime, the capability's required tools) through the single verified mechanism of that engine; run `task ci:<id>`. An adopter's own engine needs one such file plus the shared Taskfiles.

### Strangler migration and reversibility

No big-bang rewrite. Five ordered slices (spec 0280): split checker self-tests from checks; uniform verified Task provisioning; migrate jobs family by family (22 fast-tier capabilities first, then Linux, then Windows); alert on a red scheduled run; shrink the reference, generator and parity tooling. Each slice merges with CI green and is reversible by reverting its PR: a migrated job's `command:` can be restored from the task body, because the old command text is the task body until the capability is rewritten. Slice 2 precedes slice 3 because every migrated job depends on `task` being present and verified.

## Rejected alternatives

- **Dagger.** Rejected: a new framework and container runtime on every runner and every contributor machine, against the KISS constraint, to solve a problem that a task runner already in the repo solves.
- **`act` or `gitlab-runner exec` as the portability layer.** Rejected: they emulate one engine on another, so we would keep engine syntax as the source and gain only a local approximation of it, without removing a copy.
- **A generated monolith** (one script or one generated pipeline that fans out). Rejected: it moves the surface into generated code that must still be checked for drift, and loses the per-job identity that ADR-0012 traceability relies on.
- **Big-bang rewrite of all jobs.** Rejected: unreviewable, and a red state with no incremental revert on a 24-Windows-job surface.
- **Husky (or any hook framework) for local gating.** Rejected: spec 0279 already delivers a native git hook over `ci:pre-push`; a Node hook framework adds a dependency and does not address CI.
- **Fewer jobs.** Rejected as the primary lever: it trades isolation, per-job paths filtering and failure attribution for lines, and it does not remove the three-copies problem.

## Consequences

- Task becomes a hard dependency of every engine and every job. The floor is 3.54 (spec 0278 R8, raised by delta-01 R21); fail-open provisioning (`sh -c "$(curl ...)"` exits 0 when curl fails, issue #1770) must be replaced by a pinned, verified download plus `task --version` before any job is migrated.
- Per-step visibility in the engine UI drops, since one `run:` step replaces many. Mitigation: `output: group` in Task to fold step output.
- Caching and path filtering remain engine-specific and are not deduplicated by this ADR; the capability reference keeps carrying them.
- Windows jobs run Task, but every command in `taskfiles/ci.yml` must obey the Windows-command rule of spec 0266; this is the last family migrated.
- Checker self-tests are decoupled from checks (slice 1), so `ci:pre-push` time falls and each suite runs only when its own paths change.
- The generator (`scripts/build-ci.ts`) and the parity tooling shrink in slice 5. The shrinkage is a measured success criterion, not an assumption: line counts are reported per slice against the baseline above.

## Devil's advocate

The strongest counter-argument: this ADR deletes duplication by creating a single point of failure and a single point of opacity. If `taskfiles/ci.yml` is wrong, every engine is wrong in the same way, and a contributor debugging a red GitHub job now reads a one-line `run: task ci:x` and must go elsewhere to learn what ran. Meanwhile the engine-level concerns that cause most real CI pain (cache keys, path filters, OS matrix) are exactly the ones left unshared, so the 12,681-line figure may fall less than hoped and the repository would carry both a thinner engine file and an equally large capability reference. The answer is partial, not total: the single point of failure is already the case for the capability `command:` today, the opacity is bounded by `output: group` and by task names that equal capability ids, and the residual size is measured per slice so the bet can be stopped after slice 3 if the numbers do not move. If the slice 3 measurement shows a reduction below a threshold fixed in spec 0280's plan, slice 5 SHALL not start. (Assumption — verify: the threshold value is a PLAN decision.)

## Amendment (2026-10-25): shared stage taxonomy

Issue #1828, [spec 0287](../../specs/0287-staged-reusable-workflows.md) R14 and R15. The Task contract fixes what a job runs; this amendment fixes where a job sits in the pipeline, once, for every engine.

### Stage taxonomy

Six names, in pipeline order. Their meaning follows the owner decisions recorded on #1828.

| Stage | Meaning |
|---|---|
| `gate` | Fast, cheap checks (under 60 s each) whose failure makes the rest of the Linux run pointless: Taskfile and provisioning checks, spec and markdown lint, TypeScript lint, `ratchet`, size guards |
| `modules` | Unit and module suites of the TypeScript code, including the `*-node-24-0` twins of integration jobs |
| `governance` | Repository-governance checks: path ownership, version bumps, test wiring, CI parity, spec-id reservation, feedback routing |
| `extensions` | Component build, extension, setup and docs-index checks |
| `integration` | Slow end-to-end and runtime suites (`setup-oracle`, `e2e`, MemPalace, worktree guard) |
| `windows` | The `windows-*` jobs, which start immediately and are never gated on Linux |

### The `group` field is the single source

The optional `group` scalar of a capability in `ci/capabilities/` (defined in `docs/ci-reference-format.md`) is the only place a job's stage is written. Both engines and the Taskfile split derive from it: the GitHub callee file `_ci-<group>.yml`, the `stage:` of the generated GitLab job, and the `taskfiles/ci/<group>.yml` split of #1827, where the capability's task lives. The reference files of `ci/capabilities/` follow the same group but are a separate split, described in the amendment of 2026-11 below: a task is placed in `taskfiles/ci/<group>.yml` by its capability's `group`, and a capability is placed in a file of `ci/capabilities/` by its `group` and then by the parts rule. A job's group changes only by a delta-spec.

### GitHub model

`build.yml` stays the caller and keeps the triggers, `concurrency` and `permissions`. It holds six `uses:` jobs and no steps, one per group, each pointing to a `workflow_call` file `.github/workflows/_ci-<group>.yml`. The `needs` graph: `modules`, `governance` and `extensions` need `gate`; `integration` needs `gate` (plus the middle three only if the wall-clock rule of spec 0287 R10 holds); `windows` has no `needs` and starts at once. No caller job carries an `if:`, so a skipped dependency can never silently skip a required check. Job keys stay equal to capability ids (contract C2, ADR-0012).

### GitLab model and accepted gap

The generator emits `stages:` in the taxonomy order, `stage: <group>` on every job, and `needs: []` on `windows` jobs only. GitLab stages are sequential barriers, so `modules`, `governance` and `extensions` run one after the other there, whereas GitHub runs them in parallel after `gate`. This is an accepted, documented gap, not a silent asymmetry: GitLab wall-clock is not an objective, and the GitLab output is verified by the generator equality check and lint, not on a live runner.

### Rejected alternatives (this amendment)

- **Leave GitLab unstaged.** Rejected: a silent asymmetry between engines that also loses fail-fast gating on GitLab.
- **Per-job `needs:` lists of the gate jobs on GitLab.** Rejected: about +2,000 generated lines for a wall-clock gain that is not an objective.
- **Merge the middle three groups into one GitLab stage.** Rejected: it breaks the one-group-one-stage identity of the shared field.
- **Matrices for `windows-*` and `*-node-24-0`.** Rejected: a matrix collapses distinct jobs into one job key, which breaks contract C2 (job key equals capability id) and the per-job traceability of ADR-0012.

### Consequence on branch protection

A called workflow's jobs report as `<caller job id> / <job>`. Hosting `ratchet` and `lint-typescript` in `_ci-gate.yml` would rename the required contexts of the `main-protected` and `release-protected` rulesets to `gate / ratchet` and `gate / lint-typescript`. Required status check names are a branch-protection contract that a workflow restructuring must not rename, so those two jobs are the one exception (spec 0287 delta-01 R21): they are top-level jobs with steps in `build.yml`, keep `group: gate` in the reference, and precede every Linux group through `needs: [gate, ratchet, lint-typescript]`. The contexts stay `ratchet` and `lint-typescript`; no ruleset changes (R5).

Rejected alternative: host both jobs in `_ci-gate.yml` and update the rulesets to the `gate / ...` names. It is impossible without admin rights (the executing account holds the maintain role), the owner must not be needed, and it couples a merge to an out-of-band ruleset change.

## Amendment (2026-11): capability reference split by group, per-file limit

This amendment records the implementation of
[`specs/0309-split-ci-capabilities-filter-coverage.md`](../../specs/0309-split-ci-capabilities-filter-coverage.md)
as amended by its
[delta-01](../../specs/0309-split-ci-capabilities-filter-coverage.delta-01.md) and
[delta-02](../../specs/0309-split-ci-capabilities-filter-coverage.delta-02.md)
(issue #2012). The earlier paragraphs of this ADR keep their text; where they
name `ci/ci-capabilities.yml` or measure the CI surfaces by a line total, this
amendment is the current reading.

### Layout and group-to-file rule

The single file `ci/ci-capabilities.yml` (4,450 lines before the split) no
longer exists. The capability reference is the directory `ci/capabilities/`,
one or more files per group, each holding capabilities whose `group` field
names that group, with their content unchanged:

- A group file is named `<group>.yml` when it fits, and `<group>-<part>.yml`
  when the per-file limit requires a split. The six groups are `gate`,
  `modules`, `governance`, `extensions`, `integration` and `windows`.
- Capabilities that carry no `group` (the jobs of the standalone workflows)
  live in `standalone-<part>.yml`; they are never forced into a group file.
- The placement is the parts rule, `ci/capability-parts.json`: per group, an
  ordered list of parts, each a list of id globs. A capability goes to the
  first part whose glob matches its id; the last part of a group is `*`, so a
  new id lands in its first matching part, else the catch-all part. A part
  that holds nothing writes no file. `scripts/ci-split.ts` applies the rule.
- A capability appears in exactly one file. The group of a capability is its
  `group` field, never its file name alone.

This fixes the earlier statement of the `group` paragraph above: the group
still selects `taskfiles/ci/<group>.yml` for the task, and it now also selects
the file family of `ci/capabilities/` for the capability. The reader of the
reference (`scripts/lib/ci-parity/reference-read.ts`) walks the directory in
the byte order of the file names; a stale `ci/ci-capabilities.yml` left beside
the directory fails the checks. The layout, the moved shared header and the
parts rule are described in `docs/ci-reference-format.md`.

### Per-file limit replaces the global line cap

The global line cap of spec 0285 R1 and spec 0287 R13 (the floor of 8,880, the
pin and the hard cap of 9,100, the ratchet test and the committed report) is
retired, with the comment-line count of spec 0285 R2, as specs/0309 R1
supersedes exactly those items. `scripts/tests/ci-shrink-report.test.ts` and
`docs/ci-shrink-report.md` are removed. The success criterion that the
paragraph on consequences above phrases as line counts reported per slice is
replaced by the limit below.

In their place, `scripts/tests/ci-file-limit.test.ts` fails when a
hand-authored CI file has more than **500 lines**. The hand-authored files are
`.github/workflows/build.yml`, every `_ci-*.yml` and every file of
`ci/capabilities/`. Generated files are excluded by their generated-file
marker, not by a name list; `.gitlab-ci.yml` is generated, so it fails when
the marker is absent.

Measurements behind the value, on the tree of this change:

| File | Lines |
|---|---|
| `ci/capabilities/integration.yml` (largest) | 424 |
| `.github/workflows/_ci-governance.yml` | 409 |
| `ci/capabilities/governance-ci.yml` | 389 |
| `ci/capabilities/governance-other.yml` | 380 |
| `ci/capabilities/modules-setup.yml` | 372 |
| every other hand-authored file | 34 to 369 |

The rule of spec 0309 R5 is the largest file times 1.10, rounded up to the next
multiple of 50, bounded to 400 to 500: 424 x 1.10 = 466.4, which rounds up to
500. The limit would reach 550 only from a largest file of 455 lines. The
largest workflow file is `_ci-governance.yml`; each new capability job adds
a few lines to its callee, so the limit is a constant to raise deliberately,
with the reason in the pull request body, never to drift past.

The four reasons for dropping the total:

1. Lines are a poor proxy for the cost of a pull request, which is paid in
   triggered jobs and runner minutes, not in lines of configuration.
2. A generated file was counted twice: once as the reference it came from and
   once as its own output.
3. The cap forced unrelated checks into one job and widened path filters to
   stay under it.
4. The real risk, a test that no job runs after a change, was not measured by
   a line total at all.

### No include split of the generated GitLab file

Spec 0309 R4 allowed one generated `include:` file per group. It is not
applied: generated files are excluded from the limit by their marker, so a
split would add files and a second generated layout to keep equal, for no
benefit the limit measures. `.gitlab-ci.yml` stays one generated file, equal
to the generator output under the existing equality check, with its header
naming `ci/capabilities/`.

### Rejected alternatives (this amendment)

- **Keep one reference file and raise the cap.** Rejected by spec 0309: a
  raised total still bounds nothing a reviewer pays for, and the 4,450-line
  file stays one review surface for every capability change.
- **One file per capability.** Rejected: About 130 files multiply the review surface
  past the benefit of the split, and a group is the unit the callees and the
  taskfiles already share.
- **A limit on the generated output.** Rejected: the generated file is derived
  and cannot be reviewed or shrunk by hand; the marker excludes it.
- **Counting lines only for the reference.** Rejected: the callee workflows
  are hand-authored, and `_ci-governance.yml` is the largest workflow file.
- **A static filter-coverage check over what each test reads.** Rejected after
  measurement by spec 0309 delta-02: it flagged 862 of 873 tests, needed about
  1,000 declarations, a shrink-only baseline and drain pull requests. Delta-02
  replaces it with an unfiltered run of every capability on a push to a
  protected branch, now implemented (second amendment below).

### Superseded items

This amendment and the header of `scripts/tests/ci-file-limit.test.ts` are the
places outside the spec set that narrate the supersession of spec 0285 R1
(the 8,880-line total, its ratchet and its report), spec 0285 R2 (the
comment-line count of the reference) and spec 0287 R13 (the line ratchet,
floor and hard cap, as amended by its delta-01). The wiring of the new
`ci-file-limit` capability follows spec 0309 delta-02 R12(a): its
pull-request trigger carries the path filter and its push trigger carries
none, from its first commit.

## Second amendment: the unfiltered run on a push to a protected branch (spec 0309 delta-02 R6)

Every capability with a `push` trigger on `main` or `release/**` now runs with no path
filter on both engines, whatever the push changed. The push trigger inherits no
capability-level `paths:` (the list is the pull-request filter only), the 14 standalone
workflows lost `on.push.paths`, the generated GitLab push rules lost their `changes:`
lists, and the exemption file `ci/push-main-exemptions.txt` lists the 11 push-less
capabilities as `no-push` and `pages-deploy` as `side-effect`. The wiring test
`scripts/tests/ci-push-unfiltered.test.ts` asserts it offline, and its R7 case asserts that
the job reaching `skill-size-budgets.test.ts` runs on every push to `main` on both engines.
The header of the rewritten `scripts/tests/ci-paths-push-trigger.test.ts` cites delta-02
R1(d), and the pull-request filters are unchanged.

**Trade-off.** A filter gap of the #2009 class is now detected minutes after the merge, as
a red run of `main`, instead of before it; detecting it before the merge is out of scope.
The static check that would have prevented it is rejected (862 of 873 tests flagged).

**Cost.** Measured offline from the reference at the time of this change (135 capabilities,
124 with a push trigger), one push to `main` starts 123 GitHub jobs and 99 GitLab jobs, with
`cancel-in-progress` false for pushes.

**Measured runner minutes.** The first push to `main` after the change (commit `b3227bdd`,
PR #2034) ran green. `Build & Validate` (run 43715184605) created 112 jobs: 108 ran and
succeeded and 4 were skipped. The 108 jobs that ran took 65.4 job-minutes (start to completion, summed
per job; 24 Windows jobs account for 25.0 of them; the longest job took 4.3 minutes). The 15
standalone push workflows of the same commit all succeeded: 15 jobs, 10.2 job-minutes. The
total is about 76 job-minutes for one push to `main`. Like for like, a push before the change
ran about 44 to 52 job-minutes on `Build & Validate` alone (plan v3 measurement, taken with the
path filters active; the standalone workflows were filtered too), so `Build & Validate` costs
about 13 to 21 more job-minutes per push, plus the roughly 10 job-minutes of the standalone
workflows. Sources: `gh run view <id> --json jobs` start and completion
timestamps; billed minutes round each job up and are higher. Not measured: the GitLab
default-branch pipeline, which was not run in this repository for this commit; its 99 jobs
are a count from the generated file, not a measurement.

## Third amendment: the Windows group on spec-only pull requests

Spec [0287 delta-02](../../specs/0287-staged-reusable-workflows.delta-02.md)
(issue #1933, plan v2 approved in review) R22 to R27 and the modified R1 to R4,
R9, R11, R13, R14 and R21. The earlier amendments keep their text; this one
follows their shape.

### Decision

A pull request that changes one or more files, all under `specs/`, does not run
the `windows` group. Three pieces implement it, all in `.github/workflows/build.yml`:

- **`pr-scope`** is a third top-level job, beside `ratchet` and
  `lint-typescript` (R21, R22). It runs `scripts/ci-pr-scope.ts` over
  `git diff --no-renames --name-only HEAD^1 HEAD` and exposes one output,
  `spec-only`, `true` only for a `pull_request` whose list is non-empty and
  entirely under `specs/`. A renamed file counts both paths, so a file moved
  out of `specs/` is not spec-only. Every other case writes `false`. At 3,000
  entries, or when the list cannot be computed, the job fails and never writes
  `false`. It has no `needs`, no `if:`, no `ci-job` and no `cancel-on-failure`
  step, because `cancel-on-failure` would cancel the run and Windows with it.
- **The `pr-scope` capability** in `ci/capabilities/gate-other.yml` is group
  `gate`, `portability: specific`, with an `exception` for engine
  `github-actions` that records this reason and states that a GitLab
  merge-request pipeline has no Windows group to skip. Its `command:` stays its
  own, not `task ci:pr-scope` (D2 below).
- **The `windows` caller job** carries `needs: [pr-scope]` and the only `if:`
  of the file, the condition below. No other caller job and no other top-level
  job carries an `if:` (R4, R9).

```yaml
windows:
  needs: [pr-scope]
  if: ${{ !cancelled() && (github.event_name != 'pull_request' || needs.pr-scope.result != 'success' || needs.pr-scope.outputs.spec-only != 'true') }}
```

The condition fails open (R24). A `pr-scope` that fails, or whose output is not
exactly `true`, runs Windows. `cancelled` is true only when the whole run is
cancelled, and then no job starts, Windows included; that is the intended
outcome, not a silent skip. A `pr-scope` failure stays visible as a failed
check and is not masked with `continue-on-error`.

Why a condition on the run and not a path filter: a path filter decides, per
job, from the paths of the change. This rule decides, per run, from the kind of
the whole change (every path under `specs/`). R26 records it as a GitHub-side
run condition, not a path filter: the 24 `windows-*` capabilities keep no
`paths:`, gain no exclusion form, and no workflow gains `paths:` or
`paths-ignore:`.

### Accepted gap: the reference and the GitHub run disagree

The unfiltered reference still lists the 24 `windows-*` capabilities with their
normal triggers. On a spec-only pull request, GitHub does not run them. This
gap is accepted and not silent: the `windows` caller job is reported as skipped
in the run, `pr-scope` is visible as a check, and the `description` of the
`pr-scope` capability states the gap. A pull request that changes only `specs/`
does not run Windows before merge. The next push to `main` runs them unfiltered
(second amendment above).

Required contexts are not affected (R25). `ratchet` and `lint-typescript` carry
no `if:` and no dependency on `pr-scope`, so they run on every pull request. A
skipped `windows` caller creates no `windows / <job>` context, and no ruleset
requires one. Rulesets are unchanged (R5).

### Decided deviations (owner decisions on #1933)

- **D1, counts of R2 and R3.** The delta text (109 ids; governance 28,
  integration 8) copied delta-01 and was already stale: `R3_COUNTS` in
  `scripts/tests/ci-parity-ci-job.test.ts` pins governance 30 and integration 10,
  set by #1872, #2033 and #2034 without a delta. The pinned counts after adding
  `pr-scope` are 113 ids (110 callee keys plus 3 top-level keys): gate 20 (17 in
  `_ci-gate.yml`, 3 in `build.yml`), modules 15, governance 30, extensions 14,
  integration 10, windows 24. The pull request body states the recount at its
  head.
- **D2, the list of own-command capabilities (R22, spec 0283 R2).**
  `docs/ci-reference-format.md` gains the section *Capabilities that keep their
  own command (spec 0283 R2)*, listing only `claude`, `copilot`, `pages-deploy`
  and `pr-scope`: the `portability: specific` capabilities whose `command:` is
  absent or is not `task ci:<id>`. The other 33 such capabilities are `portable`
  and not yet migrated; they are not exceptions, and listing them would claim
  exceptions that 0283 does not grant. A test pins the list to that set.
- **D3, the line cap of R13.** The 9,100-line cap and its pin were retired by
  spec 0309 R1(c), with their test. The per-file limit of spec 0309 R5 (500 lines
  per hand-authored CI file, see the amendment of 2026-11) applies instead. The
  pull request body reports line counts before and after for `build.yml`,
  `ci/capabilities/gate-other.yml`, the new script and the new tests.
- **D4, fail-open over the literal text of R23.** R23 as written does not read
  `needs.pr-scope.result`. On a `pull_request` whose `pr-scope` failed after
  setting `spec-only` to `true`, its condition evaluates to skip. R24 says that
  case SHALL run Windows, and its single skipping row is `pull_request`,
  `success`, `true`. The owner chose R24, so the condition adds
  `needs.pr-scope.result != 'success'`. The wiring test pins the exact text.
- **D5, the closed `if:` evaluator of spec 0309 R6(c).** The `windows` condition
  uses `cancelled()` and `needs.*`, which R6(c) rejected. The owner chose a
  strict extension of `scripts/lib/ci-push/gha-if.ts`, with no spec pull request
  and no change to the spec text. The evaluator now accepts `cancelled()`,
  `needs.<job>.result` and `needs.<job>.outputs.<name>` only in three-valued
  logic: on a push `cancelled()` is false and every `needs.*` value is unknown. An
  `if:` is accepted only when its result is decided whatever the `needs.*`
  values; any other condition that depends on a `needs.*` value still fails
  closed with `UnsupportedIfError`. The pinned tests are: the D4 condition is
  true on a push; `needs.x.outputs.y == 'true'` alone fails closed; a push-true
  `||` term accepts; an unlisted form still fails closed. Every other form keeps
  its R6(c) result. On a push, `windows` stays unfiltered, as R23 requires.

### Rejected alternatives (this amendment)

The four alternatives that spec 0287 delta-02 R14 names for this record, as the
plan (step 10) requires:

- **A `kind` field in the capability format.** Rejected: it changes specs 0047
  and 0049 for one consumer, and the classification lives in `pr-scope` alone.
- **`paths-ignore: specs/**` on the Windows capabilities.** Rejected: forbidden
  by `docs/ci-reference-format.md` and by spec 0283 R3.
- **A `paths:` filter on the callee jobs.** Rejected: the `windows` capabilities
  have no `paths:` by design.
- **An `if:` on every group.** Rejected: a skipped dependency could then skip a
  required check, which R4 forbids.

### GitLab is unaffected

`.gitlab-ci.yml` gains no `pr-scope` job, no `rules:changes` and no change to a
Windows stage. The 24 `windows-*` capabilities are GitHub-only
(`exception.engine: github-actions`), so the generated GitLab file contains none
of their jobs, and a GitLab merge-request pipeline has no Windows group to skip.
`node scripts/build-ci.ts` must leave the generated file byte-identical.

### Time goal and evidence

The goal set by the owner is a spec-only pull request that completes in under
180 seconds, against a baseline of 296 seconds (110 jobs, 2,662 runner-seconds).
This amendment removes the Windows jobs from such runs. It does not by itself
guarantee the goal: the baseline's last non-Windows job ended at 180 seconds.
The evidence (R24(c), R25 and R27) is recorded in the pull request body: two
probe runs before the merge, and the first real spec-only pull request to `main`
after it, whose merge box is checked by the coordinator. Until that evidence
exists, the time goal is not measured.
