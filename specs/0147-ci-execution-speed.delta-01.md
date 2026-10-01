---
id: "0147"
slug: ci-execution-speed
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1405
version: 2.0.0
---

# CI execution speed

## ADDED

### Why this delta exists

Requirement 5 of the parent spec turns any changed file that falls outside
every changeset-gated `paths:` set into a full serial run of every
changeset-gated check (about 40 minutes). Measured on `main` at `1e6d886`
with the matching logic of `scripts/ci-changeset-coverage.sh` (the union of
the `paths:` of the `changeset-gated: true` capabilities, applied with bash
`[[ == ]]` glob semantics to the 1,496 tracked files), **191 files are
unmapped**, among them `package.json`, `package-lock.json`, `tsconfig.json`,
`renovate.json`, 50 top-level `scripts/*` files, 10 `hooks/*` files and 16
`.github/workflows/*` files. The TypeScript migration keeps adding files in
those places, so the fail-safe fires on nearly every implementation pull
request and dominates the pipeline's critical path.

The fail-safe answers a question that is static: "does every file have a
declared owner?". It answers it at run time, per pull request, by paying for
the whole suite. This delta answers it at authoring time, in seconds, and
makes the answer reviewable.

### Vocabulary

- **Owner.** A capability of `ci/ci-capabilities.yml` with a `pull-request`
  trigger entry that declares a `paths:` set, because ownership means "a check
  runs on the pull request when this file changes". A file is *owned* when it
  matches at least one glob of at least one such set, whether or not the
  capability carries `changeset-gated: true`. A `paths:` set on a `push`-only
  trigger (for example `pages-deploy`, which deploys `communication/**` after
  merge) confers no ownership. A capability with no `paths:` filter runs on
  every change and declares ownership of nothing.
- **Exemption.** An entry of the exemption list (requirement 14) that declares
  a tracked file as deliberately having no owner.
- **Tracked file.** A path returned by `git ls-files` on the checked-out tree.

### Requirements

- **R11.** The pipeline SHALL include a **path-ownership check** that runs on every
  change, on both engines, with no `paths:` filter, so that it can never be
  skipped by the very mechanism it polices. It SHALL complete in seconds,
  so that it adds nothing material to the two-minute critical path of
  requirement 1.
- **R12.** The path-ownership check SHALL evaluate **every tracked file**, not the
  files of a diff. It SHALL NOT depend on a base ref, a merge-base or any
  CI-provided revision variable.
- **R13.** The path-ownership check SHALL read ownership from the `paths:` sets
  declared in `ci/ci-capabilities.yml` at check time and SHALL NOT embed a
  copy of them. Ownership SHALL be decided with the semantics of the engines'
  own path filters, because those decide whether a job runs: a single `*`
  does not cross `/`, and `**/` matches any number of directory levels,
  including none. The shell semantics of `scripts/ci-changeset-coverage.sh`
  (bash `[[ == ]]`, where a single `*` crosses `/` and `**/` requires a
  slash) SHALL NOT decide ownership, so that a file is never "owned" by a
  job the engine would not trigger, and never "unowned" when it would. No
  existing glob owns a file under the shell semantics that the engines would
  not match; four root-level files that `**/*.md` reaches at the engines
  (`AGENTS.org.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `DEVELOPMENT.md`) are
  owned here although the shell script reports them unowned.
- **R14.** Files that no check exercises SHALL be declared in a dedicated exemption
  list, `ci/path-ownership-exemptions.txt`, one entry per line in the form
  `<glob><TAB><reason>`; blank lines and lines starting with `#` are
  ignored. The list is a plain text file in the style of
  `ci/test-wiring-exemptions.txt` (spec 0076) and SHALL NOT extend the
  schema of `ci/ci-capabilities.yml`.
- **R15.** The path-ownership check SHALL **fail** when a tracked file is neither
  owned nor exempt. Its message SHALL list each such file and name the two
  permitted remedies: add the file to the `paths:` of the capability whose
  checks exercise it, or add a reasoned entry to the exemption list.
- **R16.** The path-ownership check SHALL **fail** on a hygiene violation of the
  exemption list: an entry with an empty reason, or an entry whose glob
  matches no tracked file (a stale entry). An entry whose every match is
  also owned is redundant; the check SHALL report it without failing.
- **R17.** An exemption SHALL be used only for a file that no check exercises, or
  that a capability with no `paths:` filter exercises on every change (the
  reason then names that capability). An exemption SHALL NOT be used to
  silence a file that a capability with a `paths:` filter exercises; the
  file belongs in that capability's `paths:` instead. Approval of exemption
  entries is the ordinary pull-request review of the diff that adds them.
- **R18.** When no tracked file is unowned and the exemption list is clean, the
  path-ownership check SHALL exit zero and print the number of files
  evaluated, owned and exempt.
- **R19.** The change that introduces the path-ownership check SHALL make it pass on
  its own tree **with no baseline file and no ratchet**: every file that is
  unowned today (109 files on `main` at `1e6d886` once non-gated
  `paths:` on pull-request triggers count as ownership; see the measurement below) SHALL receive an
  owner or a reasoned exemption in that same change. Where a file is
  assigned to an owner, the owner SHALL be a capability whose checks
  actually exercise the file, not a nominal one.
- **R20.** The path-ownership check SHALL be declared as a capability in
  `ci/ci-capabilities.yml` and SHALL run identically on GitHub Actions and
  on the generated GitLab pipeline, preserving the symmetry contract of
  requirement 9.
- **R21.** `scripts/ci-changeset-coverage.sh` SHALL be retained, repurposed as
  an **exhaustive run**: it SHALL execute the commands of every
  changeset-gated capability regardless of what changed, and SHALL compute
  no diff and resolve no base ref. The run SHALL be declared with the neutral
  trigger kinds `scheduled` (daily, on the default branch `main`) and
  `manual` (requirement 8, for any branch including `release/**`), on both
  engines. It SHALL NOT run on the critical path of a pull request.
- **R22.** A failure of the exhaustive run SHALL be visible as a failed
  pipeline on the ref it ran against; it SHALL NOT be reported only in a log.
  The repository-side definition of a schedule that the engines keep outside
  the pipeline file (for example a GitLab pipeline schedule) is an
  operational prerequisite of requirement 21 and SHALL be named in the plan.
- **R23.** No check performed on a pull request before this delta SHALL be
  removed, renamed or made unreachable, with **one enumerated exception**: the
  pull-request-time full-suite branch of `changeset-coverage` (the
  fail-safe of the parent's requirement 5), which requirements 11 to 18
  replace. The regression test of the repurposed script
  (`scripts/tests/ci-changeset-coverage.test.ts`) SHALL stay on the pull
  request path. Every other check SHALL keep at least one trigger that runs
  it before merge (a `paths:` filter it is already gated by, or no filter at
  all). Every changeset-gated command SHALL be executed by the exhaustive run
  of requirement 21; a capability that is path-filtered but not gated
  keeps its present triggers and is not re-run by that run.
- **R24.** The exemption list is a core-layer path under `ci/`
  (`docs/layers.md`, strict sync). The implementation SHALL register it in
  `docs/layers.md` and `.crewrig/core-paths.txt` in the same change, and
  SHALL give an adopting organization an overlay exemption file under the
  carved-out `ci/org/` subtree, `ci/org/path-ownership-exemptions.txt`,
  read in addition to the core list with the same format and hygiene rules
  (requirements 14 to 17). The overlay file being absent SHALL NOT be an error.

### Measurement (current `main`)

Method: for each tracked file at `1e6d886` (1,496 files), test the glob sets
of `ci/ci-capabilities.yml`, under the shell glob semantics for the first row
(the present script) and the engine glob semantics for the other two
(requirement 13).

| Ownership definition | Unowned files |
|---|---|
| Union of `paths:` of `changeset-gated` capabilities only, shell glob semantics (the present fail-safe) | 191 |
| Same union, engine glob semantics (requirement 13) | 187 |
| Union of `paths:` of every capability with a `pull-request` trigger that declares them, engine glob semantics (this delta) | 109 |

The 109 are not 109 decisions. 52 are generated copies of the skill trees
(`.agents/`, `.claude/`, `.gemini/`, `.github/` `skills/**`), 10 sit at the
repository root, 14 are `.github/workflows/*`, 13 are `config/*`, 7 are
`docker/e2e/*`, 5 are `ci/*` and 8 are miscellaneous. They collapse into
about fifteen globs. 78 of the 187 files are already owned by a non-gated
capability (for example `scripts/**` and `hooks/**` by `grep-anti-patterns`,
and `package.json` by the usage and release capabilities), which is why the
two figures differ. The release branch `release/1231-ts-migration` carried
194 files on 2026-09-30; the figure moves with every merge, so the
implementation SHALL re-measure rather than reuse a number from this spec.

### Coverage argument (requirement 10)

Requirement 10 states that the optimization "SHALL NOT reduce the effective
coverage of the checks currently performed". This delta reads *coverage* as
the set of checks that run and the files they examine, and *effective* as
what actually executes before merge. It does not read coverage as the
redundancy of running checks on files they do not exercise. The reading is
argued, not assumed, over the three populations of pull request:

1. **Every changed file is already owned by a gated capability.** The
   fail-safe is already a fast no-op (population 1 is today's, unchanged). After this delta the pipeline behaves
   identically. No change.
2. **A changed file is new.** Today the fail-safe fires, the full suite runs,
   and the file stays unowned: the next pull request that touches it pays
   again. After this delta the path-ownership check fails the pull request
   until the author declares the file's owner in the same change. This is a
   *stronger* guarantee than today's: ownership becomes a property of every
   merged tree instead of a cost paid on every touch.
3. **A changed file is unowned today but exists** (the 191). Today the
   whole suite runs. After this delta only its declared owners run, plus
   every capability with no `paths:` filter (`lint-markdown`, `ratchet`,
   `lint-typescript` and the rest of the always-run set), which is unchanged.
   This is a **real narrowing** of pre-merge redundancy for those files, and
   this delta states it as such.

The narrowing is bounded by three things. First, requirement 19 requires each
assignment to name an owner that exercises the file, and the assignment is
reviewed in the implementation pull request. Second, requirement 21 keeps every
changeset-gated command running daily on `main` and on demand on any branch,
so a dependency that no `paths:` set declares (a check that reads a file
nobody listed) is caught on `main` within a day instead of never; today's
fail-safe cannot catch that case for an already owned file either, so the
blind spot is not new. The net does not re-run the path-filtered capabilities
that are not gated (`grep-anti-patterns`, `release-tests`, `usage-*`, ...);
they keep their pre-merge triggers, and a file owned only by one of them
(for example `scripts/**` by `grep-anti-patterns`) is netted for the gated
checks only. A scheduled run on `release/**` is not expressible in the
present trigger vocabulary and is left to a manual run there (see
*Out of scope*). Third, requirement 23 forbids removing or unscheduling any
check apart from its one enumerated exception. The residual risk is the
shift, for previously unowned files, of the safety net from before merge to
after merge, and it is accepted explicitly: it is the price of
removing a 40-minute serial run from the critical path of nearly every
implementation pull request.

### Scenarios

**Scenario:** a new file is added without an owner

Given a pull request that adds `config/launchd/com.example.new.plist`, which
matches no `paths:` glob of any capability with a `pull-request` trigger and
no exemption
When the pipeline runs
Then the path-ownership check fails within seconds
And its message names `config/launchd/com.example.new.plist` and the two
remedies
(extend a capability's `paths:` or add a reasoned exemption)
And no full suite is started on the pull request

**Scenario:** the author declares the owner in the same pull request

Given the same pull request, amended to add a glob covering that file to the
`paths:` of the capability that exercises it
When the pipeline runs
Then the path-ownership check passes
And the owning capability's focused job runs on the pull request

**Scenario:** every file is owned or exempt

Given a tree in which every tracked file matches a `paths:` glob or an
exemption and the exemption list has no hygiene violation
When the path-ownership check runs
Then it exits zero
And it prints the count of files evaluated, owned and exempt

**Scenario:** an exemption has no reason

Given an entry `LICENSE<TAB>` with an empty reason
When the path-ownership check runs
Then it fails and names the entry

**Scenario:** an exemption has become stale

Given an entry whose glob matches no tracked file after a file was deleted
When the path-ownership check runs
Then it fails and names the entry

**Scenario:** an exemption silences a file a filtered capability exercises

Given a reviewer finds `scripts/foo.sh` exempted although a capability with a
`paths:` filter runs it
When the pull request is reviewed
Then the review rejects the entry and the file moves into that capability's
`paths:` (requirement 17)

**Scenario:** a single `*` does not own a nested file

Given a capability whose `paths:` holds `docs/*.md` and a tracked file
`docs/nested/page.md` that no other glob reaches
When the path-ownership check runs
Then the file counts as unowned
And the failure lists it with the two remedies, because the engines would not
trigger the job for that file

**Scenario:** a `**/` glob owns a root-level file

Given a capability whose `paths:` holds `**/package.json` and the tracked file
`package.json` at the repository root
When the path-ownership check runs
Then the file counts as owned, as the engines would trigger the job

**Scenario:** an adopter's own file is exempted in the overlay

Given an adopting organization's file `AGENTS.org.md` and an entry for it in
`ci/org/path-ownership-exemptions.txt`
When the path-ownership check runs
Then the file counts as exempt
And no edit to the upstream-owned `ci/path-ownership-exemptions.txt` is needed

**Scenario:** the exhaustive run catches an undeclared dependency

Given a changeset-gated check that reads a file no capability's `paths:` lists
And a change to that file that the focused jobs did not run the check on
When the daily exhaustive run executes on `main`
Then the check runs and fails
And the pipeline on `main` is visibly failed

**Scenario:** the exhaustive run is triggered manually

Given a maintainer on a `release/**` branch
When they trigger the exhaustive run by hand
Then every changeset-gated command runs without any diff or base-ref
resolution

**Scenario:** the retained regression test stays on the pull request path

Given a pull request that changes `scripts/ci-changeset-coverage.sh`
When the pipeline runs
Then `scripts/tests/ci-changeset-coverage.test.ts` runs before merge
And the full suite is not started by the pull request

### Out of scope

- Sharding or deduplicating the exhaustive run. Issue #1406 part 2 (sharding)
  is unnecessary once this delta lands; part 1 (skipping a group whose
  focused job already ran) is independent and unaffected.
- Any extension of the CI reference format, `check-ci-parity.sh` or
  `build-ci.sh` (specs 0047 to 0049), including an `owns:` field for
  capabilities without `paths:`, and a branch filter or cadence attribute on
  the `scheduled` trigger kind. Consequently the exhaustive run is scheduled
  on the default branch only; a scheduled run on `release/**` is deferred to
  a follow-up ticket that would carry that extension.
- A `CODEOWNERS` file or any approval mechanism other than ordinary pull-request
  review.
- Deciding which capability should own a given file beyond the principle of
  requirements 19 and 23. The assignment belongs to the plan and to the
  implementation review.
- Verifying that a file mapped to an owner is actually exercised by that
  owner. Neither the fail-safe nor this delta checks it.
- Changing the focused/gated decomposition, the cache keys (requirements 6
  and 7) or the release workflows.

## MODIFIED

**Requirement 5.** The parent says:

> **5.** When the path mapping for a focused job cannot be determined for a
> changed file, the job SHALL run (fail-safe).

It is replaced by:

> **5.** A tracked file whose mapping to a focused job cannot be determined
> SHALL NOT reach a mergeable state: the path-ownership check (requirements
> 11 to 18) SHALL fail the change with an actionable message. The pipeline
> SHALL NOT answer an undetermined mapping by running every focused check on
> the pull request. The fail-safe moves from run time to authoring time.

This is a contract change, not a reformulation: the parent's *the job SHALL
run* becomes *the change SHALL NOT merge until the mapping is declared*.

**Scenario "ambiguous path mapping".** The parent says:

> Given a changed file whose mapping to a focused job cannot be determined
> When the pipeline evaluates whether to run that job
> Then the job runs, even though it may be unnecessary

It is replaced by:

> Given a changed file whose mapping to a focused job cannot be determined
> When the pipeline evaluates the change
> Then the path-ownership check fails
> And the file is named with the two permitted remedies
> And no full suite is started on the pull request

**Requirement 10.** The parent says:

> **10.** The optimization SHALL NOT reduce the effective coverage of the
> checks currently performed.

It is replaced by:

> **10.** The optimization SHALL NOT remove, rename or unschedule any check
> currently performed, except the pull-request-time full-suite branch of the
> fail-safe that requirements 11 to 18 replace (requirement 23). It SHALL NOT
> narrow the set of files a check examines. Running a check on a file that no
> `paths:` set declares it exercises is redundancy, not coverage; the only
> narrowing of such redundancy is the one stated in the *Coverage argument
> (requirement 10)* (population 3), and it is bounded by requirements 19, 21
> and 23.

The amendment records in the normative text the reading that the coverage
argument already argues, so that the text and the decision agree.

**Out of scope bullets.** The parent says:

> - Reordering, renaming, or removing existing checks — only their scheduling,
>   grouping, and caching change.
> - Adding new checks or new coverage.
> - Reducing the number of checks performed.

They are read with one added exception each, so that the corpus stays
consistent with requirements 11 and 23:

> - Reordering, renaming, or removing existing checks — only their scheduling,
>   grouping, and caching change. The one exception is the pull-request-time
>   full-suite branch of the fail-safe, which is replaced (requirement 23).
> - Adding new checks or new coverage. The one exception is the path-ownership
>   check (requirement 11), which guards the pipeline's own path mapping and
>   adds no coverage of product behavior.
> - Reducing the number of checks performed. No check is removed. The
>   pull-request-time full-suite branch of the fail-safe (the one enumerated
>   exception of requirement 23) is replaced, and the checks it re-ran still
>   run, on their own triggers and in the exhaustive run.

## REMOVED

None. Requirement 5 and its scenario are replaced under `## MODIFIED`.
