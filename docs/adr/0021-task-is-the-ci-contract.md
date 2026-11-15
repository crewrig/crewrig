# ADR 0021 — Task is the CI contract

<!-- crewrig-doc: section=architecture-adr nav_order=210 published=true title="ADR 0021 — Task is the CI contract" -->

**Status:** Proposed (issue #1777, epic #1761 WP-C). Supersedes
[ADR-0012](0012-ci-reference-contract.md) in part. Decomposed by
[spec 0280](../../specs/0280-task-ci-contract.md). Amended 2026-10-25 by
[spec 0287](../../specs/0287-staged-reusable-workflows.md) (issue #1828): see
*Amendment: shared stage taxonomy*.

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
  protected branch, which is **planned** for a later pull request of the same
  issue and is not in force with this change; until then the push triggers
  keep the path filters they have.

### Superseded items

This amendment and the header of `scripts/tests/ci-file-limit.test.ts` are the
places outside the spec set that narrate the supersession of spec 0285 R1
(the 8,880-line total, its ratchet and its report), spec 0285 R2 (the
comment-line count of the reference) and spec 0287 R13 (the line ratchet,
floor and hard cap, as amended by its delta-01). The wiring of the new
`ci-file-limit` capability follows spec 0309 delta-02 R12(a): its
pull-request trigger carries the path filter and its push trigger carries
none, from its first commit.
