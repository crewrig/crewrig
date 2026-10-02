---
id: "0170"
slug: efficient-test-strays-guard
status: implemented
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1445
version: 2.0.0
---

# Efficient Test Strays Guard and Elimination of Full-Suite Redundant Execution

## ADDED

### What the owner must decide

`scripts/check-test-strays.sh` still executes every changed `scripts/tests/test-*.sh` in
`test-wiring` only to count `command not found` lines, while the owning job runs the same
suite in parallel. Measurements (85 `build.yml` runs, `main` at `bcb453a`) are in the
issue #1445 logbook, comments
[5947168992](https://github.com/crewrig/crewrig/issues/1445#issuecomment-5947168992) and
[5947651446](https://github.com/crewrig/crewrig/issues/1445#issuecomment-5947651446); this delta does not
repeat them. The facts that decide the question:

- `test-wiring` was the longest job in 3 of 84 runs (+35 s on a push to `main`, +9 s and
  +3 s on pull requests). The scan costs about 900 runner-seconds over the 84 runs, three
  quarters of it from `test-model-resolution.sh`, `test-check-model-mappings.sh` and
  `test-check-ci-parity.sh`.
- The duplication lengthens the pipeline only when a changed suite takes more than about
  60 s (floor: `lint-specs`, median 66 s). Over the last 400 commits on `main`, 31 % change
  a suite, 3.5 % to 18 % change one that can exceed that.

| Option | What changes | Cost | Gain |
|---|---|---|---|
| **3. Accept** | Nothing; this delta becomes a recorded decision with a reopen criterion | None | None |
| **1. Hook** | A bash not-found hook (`command_not_found_handle` via `BASH_ENV`) records strays in the owning job; verdict from a closing step | Hook, liveness proof, exemption list for 4 suites, closing step, cache-guard change, bash 4.0 floor | Also sees strays whose message is discarded |
| **1b. Output scan** | The owning job runs each suite command through a wrapper that tees its combined output and greps it for `command not found` | 113 command lines rewritten on both engines; no new mechanism | Same coverage as today's runtime pass |

Direction 2 (a cheap separate scan) has no form worth specifying: a static scan cannot find
strays, and the verdict cache of the runtime pass never persists on GitHub (see facts).

**Direction 1 against 1b.** Both remove the second execution, return `test-wiring` to
4 to 13 s, and delete the runtime pass (base-ref resolution, parallel runner, verdict cache,
full-scan fallback).

- Coverage: 1b equals today's pass (it also sees `sh`, `env -i` children and nested scripts
  whenever the message reaches the output). The hook sees strays hidden by `2>/dev/null` or
  `$(... 2>&1)` but not `sh`, `env -i`, `bash` older than 4.0 or programs that resolve the
  command themselves. 66 of 113 suites contain `2>/dev/null` and 50 an `$(... 2>&1)`
  capture, so the exposure is wide, yet run over all 113 suites the hook found strays in 4
  suites (plus the guard's own fixtures) and the text match in none, and the 4 were deliberate probes or image-dependent: no
  real bug is known to be missed.
- Cost: 1b needs no exemption list, no liveness proof, no closing step and no cache-guard
  change. Its verdict is the wrapper's exit status, so a stray leaves no cache marker by
  construction (verified).
- Weaknesses of 1b: a suite that swallows stderr hides the stray (as today); the phrase in
  legitimate output is a false positive (as today, hence four suites reword their preflight
  messages); output is tee'd (all 113 suites together print 396 KB, the largest 41 KB).
- Recommendation: **1b, per-command wrapper form**, if the owner removes the duplication
  at all. The hook buys coverage no known stray needs at the price of five mechanisms. On
  latency alone, option 3 is defensible and stays first-class (open question 1).

### Verified facts the PLAN needs

- **Cache never persists.** In run 36891182067 the log shows `Cache hit occurred on the
  primary key ..., not saving cache`: the key `hashFiles('scripts/lib/**',
  'scripts/check-test-strays.sh')` is immutable once saved, so per-suite markers written
  later are lost. A cache created on a pull-request ref is not readable from `main`
  (documented, not tested).
- **Toolchain fidelity.** `test-wiring` provisions none of the suites' toolchain. On the
  GitLab image (`debian:stable-slim`, bash 5.2.37) 42 of 113 suites exit non-zero and
  `test-spec-linter.sh` alone prints `node: command not found` 51 times.
- **Hook detection (bash 5.2.21 `ubuntu-latest`, 5.2.37 GitLab image, macOS 5.3.20).** Fires
  in the suite's shell, nested `bash script`, `bash -c`, subshells, `$(...)`, pipelines,
  `eval`, background jobs, `|| true` and `set -e`, whatever happens to the message. Does not
  fire for `command -v`, `type`, `which`, `hash`. Misses `sh`, `zsh`, `env stray`, `env -i`
  children, an unset `BASH_ENV`, `bash -p`, `--posix`. macOS system bash 3.2 records
  nothing (the handler arrived in bash 4.0). A relative or missing `BASH_ENV` path is
  silent, so the hook can be inert. An `EXIT` trap cannot carry the verdict (suites install
  their own). A record-only handler removes bash's own message: the handler must print
  `<source>: line <N>: <command>: command not found` itself, which `BASH_SOURCE[1]` and
  `BASH_LINENO[0]` reproduce. Concurrent appends from 16 processes stayed intact on macOS
  and Linux; the startup cost is about 0.8 ms per bash. A one-call prefix assignment
  redirecting the record works as a per-invocation exemption.
- **Hook strays found** (tool-complete container, 113 suites): `test-usage-capture.sh`
  (`node`), `test-mempalace-doctor.sh` (`curl`), `test-setup-mempalace-rc-guard.sh`
  (`claude`), `test-mcp-daemon.sh` (`systemctl`, absent in that image) and the guard's own
  fixtures. "Deliberate" is inferred from the suites' `PATH` handling, not confirmed.
- **Output-scan carrier (prototype).** A wrapper that tees combined output and greps it
  preserves the command's exit status (0, 3, a failing line under `bash -eo pipefail`),
  fails a visible stray, and misses `2>/dev/null || true` and `$(... 2>&1)` as the present
  guard does. Declared as a reference command (`bash scripts/stray-scan.sh -- bash
  scripts/tests/<suite>`), `build-ci.sh` derives it into GitLab and composes it with
  `ci-cache-guard.sh`; `check-ci-parity.sh` fails when the GitHub step does not match
  (requirement 3 of spec 0049); `check-test-wiring.sh` still recognises the suite. A job-level
  `defaults.run.shell` wrapper is **not** parity-visible (a job adding it passes parity
  untouched), would also wrap provisioning steps, and is untested on Actions: not
  recommended. The wrapper would run the suite under `LC_ALL=C` to match today's pass, which
  is a change of the suite's environment to settle in the plan.
- **Parity.** A job-scoped `env` declaration reaches GitLab `variables:` and its presence is
  enforced on GitHub by spec 0131 requirement 4; values are not compared (a typo'd value
  passes). Spec 0049 needs no delta for either carrier. With the hook, a record-only pass
  leaves a cache pass marker (verified), hence requirement 11.
- **Coverage population.** All 113 suites mapped to their capabilities with engine glob
  semantics: 111 have one owner whose pull-request and push `paths:` match the suite's own
  path; `test-worktree-git-guard.sh` is also run directly by `test-wiring`;
  `test-e2e-auth-scripts.sh` has no owner (reasoned exemption) and stops being scanned
  (accepted). No suite is changed by a pull request yet run only by a skipped job. Strays
  reached through unchanged shared code are found whenever the owner is triggered. 31
  capabilities execute suites (24 without a cache) in 10 workflow files; no Windows or macOS
  job runs a `.sh` suite.

### Requirements

The mechanism is the PLAN's choice between the hook and the output scan; the requirements
hold for either, and a requirement that applies to one carrier only says so.

- **R9.** `scripts/check-test-strays.sh` SHALL execute zero suites at runtime in every
  circumstance (with or without a base ref, cold or warm cache, suite passed explicitly),
  SHALL keep the static `bash -n` pass over every suite unchanged (requirement 1), SHALL NOT
  require a base ref or merge-base, and SHALL complete in under two seconds.
- **R10.** Each registered suite command SHALL be checked for strays by the job that
  executes it, on every engine, including the exhaustive run `changeset-coverage`. The
  window is that suite command: a stray raised by any other command of the job
  (provisioning, setup, other checks) SHALL NOT fail the job, and a reported stray SHALL be
  attributed to the suite command that raised it.
- **R11.** A suite command in which a stray occurs SHALL fail its job even when the suite
  exits zero, naming the stray command and, where available, the file and line. A guarded
  command that raised a stray SHALL NOT leave a pass marker in `scripts/ci-cache-guard.sh`,
  and no marker written before the check was engaged, or before its definition last changed,
  SHALL certify a later run.
- **R12.** The check SHALL NOT change what a suite observes: the shell's not-found
  message (the phrase `command not found`, written to the same stream), exit status 127
  and the exit status of a clean run are preserved. It SHALL need no external binary beyond
  `bash`, `git` and `grep`, and SHALL leave no file in the checkout (three suites assert a
  clean `git status --porcelain`).
- **R13.** A carrier that can be silently inert (the hook) SHALL prove itself live in every
  job where at least one registered suite command ran, failing with a message distinct
  from a stray report; an inert check SHALL NOT read as zero strays. A job where no suite
  command ran (path filter false, all served from cache) SHALL pay nothing for the proof.
- **R14.** The classes of stray the chosen carrier cannot see SHALL be documented, and a
  regression test SHALL pin each as undetected.
- **R15.** A carrier that sees strays the suite hides (the hook) SHALL provide a
  per-invocation exemption, inert when the check is not engaged, recorded in an allowlist
  with a reason per entry (stale and reasonless entries fail, as in spec 0147 delta-01
  requirement 16); a mark covering a whole suite entry is therefore reviewable and rejected.
  The change SHALL mark the known deliberate probes. A stray the implementation's own CI
  reveals that is not on the list SHALL be fixed or marked in that same change.
- **R16.** The check SHALL be declared once in `ci/ci-capabilities.yml`, derived into the
  GitLab pipeline by `scripts/build-ci.sh`, and present in the hand-authored GitHub Actions
  job of every workflow file that executes a suite; `scripts/check-ci-parity.sh` SHALL fail,
  naming capability and platform, when either engine does not exhibit it.
- **R17.** A static check SHALL fail the build when (a) a capability whose commands execute
  a registered suite does not engage the check, or (b) a suite with an owning capability is
  matched by the pull-request `paths:` of none of its owners (unless an owner has no
  `paths:` filter). A suite with no owner and a reasoned entry in
  `ci/test-wiring-exemptions.txt` passes both.
- **R18.** At the median over five comparable runs the check SHALL add at most 2 s to a job
  in which a suite command ran.
- **R19.** The implementation SHALL record the acceptance evidence below, and SHALL update
  every statement that describes the runtime pass or its cache. Known instances:
  `docs/ci-reference-format.md` (the `cache-guard: false` example and the diff-scoped
  paragraph), `docs/cli-matrix.md` (test-wiring cache note), the header of
  `scripts/check-test-strays.sh`, lines 23 to 29 of `scripts/ci-changeset-coverage.sh`, the
  `test-wiring` entry of `ci/ci-capabilities.yml` (name, `cache:`, `history-depth`, the
  `base-ref-resolve.sh` path) and the preflight comments in `test-usage-storage.sh`,
  `test-usage-capture.sh` and `test-usage-record-schema.sh`.

### Scenarios

**Scenario:** a pull request changes one heavy suite, clean

```text
Given a pull request changing only scripts/tests/test-model-resolution.sh, no stray
When the pipeline runs
Then the owning job runs the suite once, checked for strays, and passes
And check-test-strays.sh in test-wiring executes no suite
And test-wiring completes in the 4 to 13 s band
And a job whose path filter skips it runs no suite, no proof and no wrapper
```

**Scenario:** a visible stray in a throwaway suite fails the owning job

```text
Given a throwaway suite whose nested "bash -c" runs "bogus-xyz" and which exits 0
When its owning job runs on GitHub Actions and, rendered, on GitLab
Then the job fails naming "bogus-xyz" and the suite command
And a later identical run is not served from a cache marker
```

**Scenario:** a stray in a provisioning step does not fail the job

```text
Given a job whose setup command runs a missing command and whose suite is clean
When the job runs
Then the stray is not attributed to the suite and the job is not failed by this check
```

**Scenario:** a syntax error is still rejected in test-wiring

```text
Given a suite with an unbalanced quote
When check-test-strays.sh runs
Then it exits 1 naming the file, before any suite executes
```

**Scenario:** the check is missing on one engine or one capability

```text
Given the reference declares the check for a capability
When the GitHub job or the generated GitLab job does not exhibit it
Then check-ci-parity.sh exits 1 naming the capability and the platform

Given a new capability executing a registered suite without the check
When the static check of R17 runs
Then the build fails naming the capability
```

**Scenario:** hook only. A deliberate probe is exempt, its sibling is not; an inert hook fails

```text
Given a marked invocation of a missing command and an unmarked misspelt one in a suite
When the owning job runs
Then only the unmarked command fails the job

Given a hook path that does not exist
When the job reaches its closing proof
Then it fails with a "detector inactive" message
```

### Acceptance evidence

Before, from the logbook: `test-wiring` 173 to 180 s with a 162 to 171 s scan for a change to
`test-model-resolution.sh` (runs 36889903207, 36892517525, 36891182067, the last the longest
job of the run by +35 s); 4 to 13 s with no changed suite. After, recorded by the
implementation on `ubuntu-latest` on the same event shapes: `test-wiring` at most 13 s;
critical path no longer than the owning job plus 2 s; a throwaway suite with a stray fails
GitHub Actions and the rendered GitLab job run locally in its declared image (the GitLab
pipeline is never run live, spec 0048).

### Out of scope

- Detection beyond the chosen carrier's declared limits; changing which jobs run which
  suites or their triggers; speeding up any suite; value checks of job variables across
  engines; running GitLab live.

### Open questions

1. **Direction.** Hook (1), output scan (1b) or accept (3)? Recommended: 1b, if the
   duplication is to be removed; 3 if only latency is weighed. If 3, this delta becomes a
   recorded decision with this reopen criterion over 100 consecutive `build.yml` runs:
   `test-wiring` is the longest job in 5 % or more of runs, or any changed suite exceeds
   120 s on `ubuntu-latest`.
2. **Rollout shape.** All 31 capabilities and the exhaustive run in one change, or phased
   from the three heavy owners. Recommended: one change; a phased rollout needs a registry
   of which pass covers which suite and a further delta, and the tier (`standard`) is to
   be revisited before merge if chosen.
3. **Enforcement on first merge.** Enforce immediately or report-only for one cycle.
   Recommended: enforce; the pull request's own CI is the dry run and R15 requires fixing or
   marking any stray it reveals.

Follow-ups for the orchestrator, not decisions: a delta to spec 0171 (its requirements 1 to
3 become vacuous); a delta to spec 0076 only if the R17 check is hosted in
`check-test-wiring.sh`; the implementation branch `chore/1445-...` carries a ticket number
where spec 0168 reads a spec id, so the `implemented` status should be recorded by hand.

## MODIFIED

Requirement 1 is unchanged and restated by R9.

- **Intent, items 2 to 4** (changeset-scoped runtime execution) are replaced by: stray
  detection happens once per suite, in the job that already executes it (R10);
  `check-test-strays.sh` executes no suite and completes in under two seconds.
- **Requirements 4, 5, 6** (no runtime execution of unchanged suites; zero suites and `OK`
  when none changed; base-ref fallback) become: the script SHALL NOT execute any suite,
  whatever changed, SHALL emit `OK` after a clean static pass, and a base ref's presence,
  absence or resolvability changes nothing; the full-scan fallback and its warning are
  removed. Strays reached through shared scripts are found by the owning jobs.
- **Requirement 7** (a stray fails `check-test-strays.sh`) becomes: a stray fails the job that
  executes the suite (R11).
- **Requirement 8** becomes: `scripts/tests/test-check-test-strays.sh` verifies the static
  pass and that no suite is executed; the chosen carrier, R13 to R15 and R17 each have
  regression tests whose deliberate-stray fixtures use their own record.
- **Scenarios** "changeset modifies a single test suite" and "modified test suite emits a
  stray command" are replaced by the first two scenarios above; the other two are kept.
- **Out of scope** bullet 2 gains one exception: those jobs gain the check, otherwise
  unchanged; bullet 1 is relaxed only if the plan hosts R17 in `check-test-wiring.sh`.

## REMOVED

- **Requirement 2** (determine the changed suites via `git diff --name-only <merge-base> HEAD
  -- scripts/tests/test-*.sh`): the script no longer executes suites, so it no longer needs
  the changed set; scoping is the owning job's own path filter (R17).
- **Requirement 3** (only the suites of requirement 2 are executed at runtime): replaced by
  R9 and R10.
