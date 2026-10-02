---
id: "0170"
slug: efficient-test-strays-guard
status: draft
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1445
version: 2.0.0
---

# Efficient Test Strays Guard and Elimination of Full-Suite Redundant Execution

## ADDED

### Why this delta exists

Spec 0170 scoped the `test-wiring` stray scan to the suites a change touches. That
removed the full-suite run, but the scan still executes every changed
`scripts/tests/test-*.sh` end to end, in `test-wiring`, only to count
`command not found` lines, while the capability job that owns the suite runs the
same suite in parallel. The cost is now bimodal and bounded by the slowest changed
suite. Measured on `build.yml` (the 100 most recent runs ending 2026-10-01, 85
successful, `main` at `bcb453a`):

| `test-wiring` population (85 runs) | Runs | `test-wiring` duration |
|---|---|---|
| Path filter false, nothing executed | 42 | 4 to 9 s, median 6 s |
| Path filter true, no changed suite (scan under 3 s) | 20 | 8 to 13 s, median 10 s |
| Path filter true, at least one changed suite scanned | 23 | 15 s to 786 s |

Within the 23 scanning runs the scan step took 5 to 171 s, plus one 776 s run caused
by the pre-issue-1401 full-scan fallback. Excluding that outlier, the scan consumed
908 runner-seconds over 84 runs (10.8 s per run on average). Three suites account
for about three quarters of it (693 of 908 s): `test-model-resolution.sh` (162 to 171 s in
three runs), `test-check-model-mappings.sh` and `test-check-ci-parity.sh`.

`test-wiring` was the longest job of the run in 3 of those 84 runs, by +35 s (a push
to `main`), +9 s and +3 s (pull requests). The pipeline floor when nothing heavy
changes is set by `lint-specs` (median 66 s, maximum 78 s over the 85 runs).

Two facts about the present design were verified rather than assumed:

- The per-suite verdict cache of `scripts/check-test-strays.sh` does not persist its
  verdicts on GitHub Actions. The log of run 36891182067 (push to `main`, 171 s scan)
  shows `Cache hit for: 082014d5...`, a restored cache of 531 bytes, then
  `Cache hit occurred on the primary key ..., not saving cache.` The key
  (`hashFiles('scripts/lib/**', 'scripts/check-test-strays.sh')`) is immutable once
  saved, so markers written by later runs under the same key are discarded. A
  per-suite key would not repair this for the push to `main` that follows a merge,
  because a cache created on a pull-request ref is not readable from `main`
  (documented GitHub behaviour, not tested here).
- The scan runs the suite in `test-wiring`, an environment that provisions none of the
  toolchain the owning job sets up. On the GitLab image of that job (`debian:stable-slim`)
  all 113 suites were run locally with bash 5.2.37 plus only `git`, `jq`, `python3`
  and `curl`: 42 of 113 exited non-zero (24 with status 1, 18 with status 2; 35 of the 42
  show a missing-tool or preflight signature such as `FATAL: yq is required` or
  `node_modules/... is missing`, the other 7 were not root-caused), and
  `test-spec-linter.sh` alone printed `node: command not found` 51 times, which the
  present guard would report as 51 strays in code that is correct. The same 113 suites on
  `node:22-bookworm` with `yq`, `iproute2`, `acl`, `sudo` and an `npm ci` fared better
  (108 of 113 exited 0). Of the five others, `test-e2e-auth-scripts.sh` is the exempt
  suite, `test-mempalace-pin.sh` needs the Python `packaging` module, two passed on a
  re-run, and `test-usage-storage.sh` (`mirror.resolveWing is not a function`) was not
  root-caused. The hook did not change any exit status in the four suites re-run with and
  without it.

### The three directions weighed

| | 1. Detect where the suite already runs | 2. Keep a separate scan, make it cheap | 3. Accept the duplication |
|---|---|---|---|
| What changes | A not-found hook is engaged in every job that runs a suite; `check-test-strays.sh` keeps only the static `bash -n` pass | Fix the verdict cache, or bound the scan | Nothing; record the analysis |
| `test-wiring` duration | 4 to 13 s in every run, independent of any suite | Unchanged for the first run of a changed suite and for every push to `main` | Unchanged |
| Runner-seconds | About 900 s per 84 runs returned, minus at most 2 s per triggered job | A fraction; only re-pushes of a pull request with identical suite content | None |
| Critical path | Removes the +35 / +9 / +3 s cases | Removes none of them | Keeps them |
| Change surface | 31 capabilities and the exhaustive run, 10 workflow files, the cache guard, four suites that need an exemption, one 820-line regression suite rewritten | A cache key and restore scheme that `check-ci-parity` constrains (it compares `actions/cache` inputs with `cache.files`) | None |
| Coverage versus today | Different, not a superset (see the coverage argument) | Equal | Equal |
| Machinery afterwards | Less: the base-ref resolution, merge-base, parallel runner, verdict cache and full-scan fallback of the runtime pass go away | Same or more | Same |
| Main risk | A silently inert detector, unless it fails closed | Little gain for the effort | The cost grows with the slowest changed suite |

**Direction 2 has no cheap form.** A static scan cannot find strays: `bash -n` checks syntax
only, and `shellcheck` does not know which commands exist at run time. A runtime
scan is a suite run, so the only lever is not repeating it. The cache fix reaches only the
second and later pushes of one pull request, never the first run of a changed suite and
never the push to `main`, which are the observed worst cases.

**Break-even for direction 3.** The duplication lengthens the pipeline only when
`scan + about 6 s` exceeds both the floor (about 66 s) and the owning job, that is, when a
changed suite takes more than roughly 60 s on the runner. On the evidence that is
`test-model-resolution.sh` (121 to 180 s in CI) for certain, `test-check-model-mappings.sh`
(47 to 61 s) borderline, and `test-check-ci-parity.sh` (43 s) not. Over the 400 most recent
first-parent commits on `main` (2026-08-09 to 2026-10-01), 125 (31 %) changed at least one
suite; 14 (3.5 %) changed one of those three; 72 (18 %) changed a suite owned by a job whose
p90 duration is at least 50 s, which overstates it because such jobs run many suites. So
the cost bites between 3.5 % and 18 % of changes, and on the critical path in 3 of 84
observed runs. The observation window is biased upward: it holds the CI-speed work on
those very suites (12 % of runs had a `test-wiring` of 30 s or more, against 3.5 % of commits).

**Verdict by the numbers alone.** The cost rarely bites on wall-clock, and direction 3 would
be defensible on latency. This delta recommends direction 1 on structural grounds, not
latency:

- It deletes the duplicated machinery rather than adding to it. The runtime pass has
  been tuned four times (pull requests 949, 995, 998 and 1408) and still carries a cache
  that does not persist and a full-scan fallback that once cost 776 s.
- It runs the check where the suite's toolchain exists, which removes false strays (the 51
  `node` reports above, on the GitLab image) and hollow scans (suites that stop at preflight).
- It ends the habit of rewording preflight messages so they avoid the phrase
  `command not found`. Four suites carry a comment explaining that they do
  (`test-usage-storage.sh`, `test-usage-capture.sh`, `test-usage-record-schema.sh`,
  `test-usage-storage-mirror.sh`).
- It restores an invariant worth having: `test-wiring` takes 4 to 13 s whatever changed.

If the owner weighs latency alone, the right decision is direction 3 with the monitoring
criterion in open question 1, and this delta is replaced by a recorded-decision delta.

### Vocabulary

- **Suite.** A file `scripts/tests/test-*.sh`.
- **Stray.** The attempt, by a bash process, to execute a command name that resolves to no
  function, builtin, keyword, alias or executable, which is the condition under which bash
  calls its not-found handler. Probes (`command -v`, `type`, `which`, `hash`) are not strays:
  verified, none of them reaches the handler.
- **Detector.** The mechanism that records strays while a job runs, and the check that turns
  records into a verdict.
- **Record.** A per-job store, outside the process tree, that every bash process of the job
  can append to.
- **Owning job.** A job whose declared commands execute the suite, by the same wiring
  definition as spec 0076 (the full token `scripts/tests/<name>` in a command position).
- **Exempt invocation.** One invocation inside a suite that deliberately executes a missing
  command and is marked as such (R13).

### Requirements

- **R9.** `scripts/check-test-strays.sh` SHALL execute zero suites at runtime in every
  circumstance: with or without a base ref, with an unresolvable base ref, with a cold or
  warm cache, and when passed a suite explicitly. It SHALL retain the static `bash -n` pass
  over every suite unchanged (requirement 1), SHALL NOT require a base ref or a merge-base,
  and SHALL complete in under two seconds.
- **R10.** Every job that executes a registered suite SHALL detect strays during that
  execution, in the suite's own shell and in every bash process of version 4.0 or later that
  it starts: nested scripts, `bash -c`, subshells, command substitutions, pipeline stages,
  background jobs, functions and `eval`. Detection SHALL NOT depend on whether the stray's
  message is displayed, redirected, captured or discarded, nor on `set -e`, `|| true` or any
  other guard in the suite. This covers the exhaustive run `changeset-coverage`, which
  executes the commands of every gated capability in one job.
- **R11.** A job in which a non-exempt stray was recorded SHALL fail, even when the suite
  that contained it exited zero. The failure SHALL name each distinct stray command and,
  where bash supplies them, the file and line. The job SHALL pass when the record is empty
  and the detector is proven live (R14).
- **R12.** The detector SHALL NOT change what a suite observes: the shell's own not-found
  message (containing the phrase `command not found`), exit status 127 and the
  stdout/stderr split SHALL be preserved. It SHALL rely only on bash builtins, so that it
  works in a suite that strips `PATH`, and it SHALL introduce no external binary beyond
  `bash`, `git` and `grep`.
- **R13.** A suite SHALL be able to mark one invocation, together with every process that
  invocation starts, as exempt. The mark SHALL be local to that invocation, SHALL NOT be
  expressible for a whole suite or a whole job, and SHALL be inert when the detector is not
  engaged. An unmarked stray in the same suite SHALL still fail the job. The change that
  engages the detector SHALL mark the invocations that this delta found to be deliberate
  (see the exemption inventory) in the same diff.
- **R14.** Before a job that carries the detector reports success, it SHALL prove the
  detector is live in that job's environment by executing a sentinel command in a fresh bash
  process and confirming the sentinel was recorded; it SHALL fail, with a message
  distinct from a stray report, when it was not. The sentinel SHALL NOT appear in the R11
  report and SHALL NOT persist beyond the job. This covers a hook path that does not exist
  (bash ignores it silently), an interpreter older than 4.0, an unwritable record and a
  scrubbed environment. The detector's absence SHALL NOT be readable as zero strays.
- **R15.** The classes of stray the detector cannot see SHALL be documented in the
  repository, and a regression test SHALL pin each documented class as undetected, so that
  a change in behaviour is visible. The classes are: interpreters other than bash (`sh`,
  `dash`, `zsh`, and shells started by another runtime), bash older than 4.0 (the macOS
  system bash 3.2), processes started with a scrubbed environment (`env -i`, an unset hook
  variable, `bash -p`, POSIX-mode bash), and commands resolved by another program rather
  than by bash (`env`, `xargs`, `find -exec`, `sudo`, `timeout`).
- **R16.** The engagement of the detector SHALL be declared once, at job scope, in
  `ci/ci-capabilities.yml` for every capability that executes a registered suite; SHALL be
  rendered into the generated GitLab pipeline by `scripts/build-ci.sh`; and SHALL be present
  in the hand-authored GitHub Actions job of every workflow file that executes a registered
  suite. `scripts/check-ci-parity.sh` SHALL fail, naming the capability and the platform,
  when a GitHub Actions job or a generated GitLab job does not exhibit what the reference
  declares. Pipeline-global declarations are excluded (spec 0131 out of scope).
- **R17.** A static check SHALL fail the build when (a) a capability whose commands execute
  a registered suite does not engage the detector, or (b) a registered suite that has an
  owning capability is matched by the pull-request `paths:` set of none of its owners, unless
  an owner declares no `paths:` filter. Paths SHALL be compared with the engines' own glob
  semantics (spec 0147 delta-01, requirement 13). A suite with no owner and a reasoned entry
  in `ci/test-wiring-exemptions.txt` SHALL pass both.
- **R18.** `scripts/ci-cache-guard.sh` SHALL NOT record a pass marker for a guarded command
  during which the detector recorded a non-exempt stray, and SHALL fail that command. The
  cache key of a guarded command SHALL change when the definition of the detector changes,
  so that no marker written before the detector was engaged, or before its definition last
  changed, certifies a later run. On a cache hit the suite is not executed and no stray can
  be recorded; the job SHALL still complete the R14 proof.
- **R19.** The record SHALL live outside the repository's tracked tree and its checkout,
  SHALL be private to one job, SHALL NOT leave any file in the checkout (three suites assert
  a clean `git status --porcelain`), and SHALL tolerate concurrent writers without losing
  or corrupting entries.
- **R20.** At the median over at least five comparable runs, the detector, its R14 proof and
  its verdict step SHALL add at most 2 s to any job.
- **R21.** The implementation SHALL record, in the logbook, the acceptance evidence defined
  in *Acceptance evidence*, including the before and after durations on `ubuntu-latest`.
- **R22.** Documentation that describes the runtime pass or its verdict cache SHALL be
  updated in the same change: `docs/ci-reference-format.md` (the `cache-guard: false`
  example and the paragraph on `check-test-strays.sh` being diff-scoped),
  `docs/cli-matrix.md` (the test-wiring fine-grained cache note), and the header of
  `scripts/check-test-strays.sh`.

### Verified behaviour of the detector

The detector evaluated is a bash `command_not_found_handle` function, loaded in every
non-interactive bash through `BASH_ENV`, appending one line per stray to a file. Throwaway
scripts under the session scratchpad, run on four interpreters: macOS bash 5.3.20 and 3.2.57,
`ubuntu:24.04` bash 5.2.21 (the `ubuntu-latest` shell), `debian:stable-slim` bash 5.2.37 (the
GitLab job image).

| Case | Bash 5.2 / 5.3 | Bash 3.2 |
|---|---|---|
| Top level, function, `if !`, `\|\| true`, `eval`, `command x`, background job | recorded | not recorded |
| `$(...)` with output captured by `2>&1`, pipeline stage, `( ... )` subshell | recorded | not recorded |
| Nested `bash script`, `bash -c`, shebang script, `xargs ... bash -c` | recorded | not recorded (nested script and `bash -c` verified on a pure 3.2 `PATH`) |
| `set -euo pipefail`: step aborts with 127 | recorded, exit 127 | not tested |
| GitHub-shaped step (`bash --noprofile --norc -eo pipefail`) | recorded (Linux) | not tested |
| `command -v`, `type`, `which`, `hash` on a missing name | not recorded (correct) | not recorded |
| `sh -c`, `zsh -c`, `env stray` (the failure is `env`'s) | not recorded | not recorded |
| `env -i` child, `unset BASH_ENV`, `bash --posix`, `bash -p` | not recorded | not applicable |
| Relative `BASH_ENV` after a `cd` in the suite | nested bash not recorded | not applicable |
| `BASH_ENV` naming a file that does not exist | silent, nothing recorded, exit unchanged | not tested |
| `PATH` stripped to a nonexistent directory | recorded, handler needs no external | not applicable |
| 16 processes appending 500 lines each | 8000 lines, 0 malformed (macOS and Linux) | not tested |
| A prefix assignment on one call redirecting the record | honoured, including inside `$(...)` | not applicable |
| An `EXIT` trap in the hook used as the verdict | overridden by a suite's own `trap ... EXIT`: exit 0 | not tested |

The rows on a scrubbed environment, a relative or missing hook path, a stripped `PATH`, the
prefix assignment and the `EXIT` trap ran on macOS bash 5.3.20 only; every other bash 5
row was also run on the two Linux images.

What this fixes in the design:

- Bash 3.2 has no handler (it arrived in bash 4.0): on macOS system bash the detector
  records nothing, in any process. CI runs bash 5.2, so CI is the gate; a local run sees the
  message in its terminal as before. R14 is what stops a mis-provisioned CI job from
  passing silently.
- The hook path must be absolute (R14 catches a relative one), and a missing hook is
  silent. A correct-looking declaration can therefore be inert.
- The verdict cannot ride an `EXIT` trap inside the hook, because suites install their own.
  It must be taken by a party outside the suite's processes: a closing step of the job, or
  the cache guard.
- A one-call prefix assignment is an adequate exemption mechanism (R13); it is the only
  mechanism tested.
- Startup cost: 1000 `bash -c :` took 10.16 s without the hook and 10.93 s with it on macOS,
  about 0.8 ms per bash process.

Compared with the present text match on `command not found`, over four forms of stray run
through the guard's own expression:

| Form of stray | Present guard | Detector |
|---|---|---|
| Message reaches the output | seen | seen |
| `stray 2>/dev/null \|\| true` | missed | seen |
| `out=$(stray 2>&1) \|\| true` | missed | seen |
| `dash` (`sh: 1: x: not found`, no word `command`) | missed | missed |

### Exemption inventory

Run in a tool-complete container (the 113 suites, four at a time), the detector recorded
strays in five suites that the present guard does not report (four to exempt, plus the
guard's own suite, which is rewritten), and in none of the three
suites that would adopt it first (`test-model-resolution.sh`, `test-check-model-mappings.sh`,
`test-check-ci-parity.sh`):

| Suite | Commands recorded | Reading |
|---|---|---|
| `test-usage-capture.sh` | `node` (`hooks/usage-capture.sh:105`) | Deliberate: the case runs with `PATH=/usr/bin:/bin:/usr/sbin:/sbin`, no Node |
| `test-mempalace-doctor.sh` | `curl` (`doctor-mempalace.sh:246`) | `PATH` is built per case; the probe of a missing `curl` appears deliberate |
| `test-setup-mempalace-rc-guard.sh` | `claude` | The harness scripts run against stubs; a missing `claude` appears deliberate |
| `test-mcp-daemon.sh` | `systemctl` (`lib/common.sh:1181`, `1421`) | Depends on the image: absent in `debian:stable-slim`, present on `ubuntu-latest` |
| `test-check-test-strays.sh` | `some-bogus-command` (fixtures) | The guard's own fixtures; removed with the runtime pass (R9), replaced by detector fixtures that run with their own record |

The "appears deliberate" readings were derived from the suites' own `PATH` manipulation;
confirming each is part of the implementation. `systemctl` shows the second effect of
running where the toolchain exists: a verdict can differ per image, which is the correct
signal that the suite probed a tool the image lacks.

### Coverage argument

The question is whether moving the check into the owning jobs loses a stray the scan
would have caught, in particular for a suite changed by a pull request but run only by a
job the path filter skips. Method: every command of `ci/ci-capabilities.yml` containing the
token `scripts/tests/test-*.sh` was mapped to its capability, and the suite's own path
matched against the `pull-request` and `push` `paths:` sets with the engines' glob
semantics (a single `*` does not cross `/`; `**/` matches zero or more levels).

| Population | Today | After |
|---|---|---|
| 111 of 113 suites: exactly one owner whose PR and push triggers match the suite's own path | scanned in `test-wiring` | scanned in the owner, in the toolchain it needs |
| `test-worktree-git-guard.sh`: owned by `test-wiring` and `mempalace`; the `mempalace` triggers do not list it, those of `test-wiring` (`scripts/tests/**`) do | scanned | scanned, as a plain command of `test-wiring` |
| `test-e2e-auth-scripts.sh`: no owner, reasoned exemption in `ci/test-wiring-exemptions.txt` | scanned, though it cannot pass in CI | not scanned. A suite that CI never runs cannot fail CI. Accepted narrowing |
| Unchanged suite run by an owner triggered by a change to `scripts/lib/**` or `artifacts/**` | not scanned, by design (requirement 4) | scanned. Widening: a stray introduced in shared code and reached by a suite is now found |
| Stray whose message is redirected, captured or discarded | not seen | seen. Widening, and the source of the exemption inventory |
| Stray in a process the detector cannot see (R15): `sh`, scrubbed environment, bash older than 4.0 | seen only if the message reaches the output and says `command not found` | not seen. Narrowing. Three suites use `env -i` (`test-e2e-auth-ready.sh`, `test-monorepo-release.sh`, `test-monorepo-release-engine.sh`) |

No suite is changed by a pull request yet run only by a skipped job: the 111 single-owner
suites are matched by their owner on both triggers, and R17 makes that property permanent
rather than a one-off measurement. Coverage is therefore equal for the changed-suite
population, wider on two axes, and narrower on the R15 classes and on the one suite CI never
runs. The relation is not a subset in either direction, and this delta records that rather
than claiming equivalence. The retained static pass and the unchanged `test-wiring`
registration check keep covering every suite, wired or not.

### Wiring and parity

Job-level environment applies uniformly. Verified on a scratch copy of the repository:
a job-scoped `env` entry on `model-resolution` in `ci/ci-capabilities.yml` rendered through
`scripts/build-ci.sh` into a `variables:` entry of the GitLab job; with the GitHub job lacking
it, `scripts/check-ci-parity.sh` failed with `capability 'model-resolution' (github-actions):
requires env variable 'BASH_ENV' but GHA job does not exhibit it (spec 0131)`; with the key
present it passed with a different value, and it also passed with a typo in the value, with
`build-ci.sh --check` clean.

Consequences:

- Presence of the declaration is already guarded on both engines by spec 0131
  (requirement 4). No new parity check, and no delta to spec 0049, is needed for presence:
  spec 0049 governs `command` and `requires`, and the environment check lives in 0131.
- Parity compares keys, not values. The two engines cannot hold equal values (the path is
  `${{ github.workspace }}/...` on one and `$CI_PROJECT_DIR/...` on the other, the precedent
  being `BASE_REF` on `lint-specs`), so a static value check would compare unlike things.
  The guarantee that a value is correct on each engine is the runtime proof of R14, not a
  static rule. Extending spec 0131 to value-shape checks is listed as a follow-up only.
- The carrier is a plan decision. Two shapes satisfy R10 to R20. A job-level hook variable
  plus a closing `command:` entry reuses spec 0131 and leaves the 113 suite command lines
  untouched, and the closing entry is inherited by the exhaustive run if it is declared as a
  command. A per-suite wrapper command puts the verdict inside the cache guard's boundary
  by construction but rewrites every suite command line on both engines. 24 of the 31
  capabilities have no cache and so no guard, which is why a closing entry is needed in the
  first shape for R11.
- Scale: 31 capabilities (all portable) execute 113 suite invocations. 23 live in
  `build.yml`; 8 in their own workflow files (`release-notes`, `release-tests`,
  `usage-attribution`, `usage-capture`, `usage-dashboard`, `usage-pricing`,
  `usage-record-schema`, `usage-storage`). Six capabilities are cache-guarded; `test-wiring`
  opts out with `cache-guard: false`. No Windows or macOS job executes a `.sh` suite.
- The GitLab pipeline is never run on a live GitLab (spec 0048 out of scope). Its evidence
  is therefore the rendered job executed locally in the declared `image:`.

### Scenarios

**Scenario:** a pull request changes one heavy suite and nothing is wrong

```text
Given a pull request that changes only scripts/tests/test-model-resolution.sh
And the suite contains no stray
When the pipeline runs
Then the model-resolution job runs the suite once, with the detector engaged
And the job passes after proving the detector live
And check-test-strays.sh in test-wiring executes no suite
And test-wiring completes in the 4 to 13 s band
```

**Scenario:** a stray hidden by a guard still fails the owning job

```text
Given a throwaway suite whose nested "bash -c" runs "bogus-xyz 2>/dev/null || true"
And the suite exits 0
When its owning job runs on GitHub Actions and, rendered, on GitLab
Then the job fails naming "bogus-xyz" and, where available, the file and line
And test-wiring still passes its static pass
```

**Scenario:** a deliberate probe is exempt, its sibling is not

```text
Given a suite that runs a command removed from PATH inside one marked invocation
And the same suite runs an unmarked misspelt command elsewhere
When its owning job runs
Then the marked invocation is not reported
And the job fails naming only the unmarked command
And a run with the detector not engaged executes the marked invocation unchanged
```

**Scenario:** a syntax error is still rejected in test-wiring

```text
Given a suite with an unbalanced quote
When scripts/check-test-strays.sh runs
Then it exits 1 naming the file before any job executes a suite
```

**Scenario:** an inert detector fails closed

```text
Given a job whose hook path is wrong, or whose interpreter is bash 3.2
When the job reaches its closing step
Then the sentinel is not recorded
And the job fails with a "detector inactive" message distinct from a stray report
```

**Scenario:** a recorded stray never becomes a cached pass

```text
Given a guarded command during which a stray was recorded
When ci-cache-guard.sh finishes the command
Then it records no marker and fails
And a second run of identical content misses the cache and fails again

Given a marker written before the detector was engaged
When the detector definition is part of the cache key
Then the old marker is not honoured and the suite runs under detection
```

**Scenario:** declared engagement is missing from one engine

```text
Given the reference declares the detector for a capability
When the GitHub Actions job, or the generated GitLab job, does not exhibit it
Then scripts/check-ci-parity.sh exits 1 naming the capability and the platform
```

**Scenario:** a new suite-running capability forgets the detector

```text
Given a new capability whose command executes a registered suite
And the capability does not engage the detector
When the static check of R17 runs
Then the build fails naming the capability

Given a registered suite whose owning capability has a paths: set that does not match it
When the static check runs
Then the build fails naming the suite and the owner
```

**Scenario:** a stray reached through shared code is found

```text
Given a change to scripts/lib/common.sh that makes a function call a missing command
And an unchanged suite that reaches that function
When the owning job is triggered by the change to the library
Then the job fails naming the command
```

### Acceptance evidence

R21 requires the following in the implementation logbook. The "before" column is measured;
the "after" column is the implementation's to fill, on `ubuntu-latest`, on the same event
shapes.

| Evidence | Before (measured) | After (to record) |
|---|---|---|
| `test-wiring` on a pull request changing only `test-model-resolution.sh` | 173 to 175 s, scan 162 to 164 s (runs 36889903207, 36892517525) | at most 13 s |
| Same change as a push to `main` | 180 s, scan 171 s, longest job of the run, +35 s over `component-drift` (run 36891182067) | at most 13 s, not the longest job unless the owning job is shorter |
| `test-wiring` with no suite changed | 4 to 9 s filter false, 8 to 13 s filter true | unchanged band |
| Critical path of the run, pull request touching that suite | `model-resolution` 176 to 180 s | `model-resolution` plus at most 2 s |
| Throwaway suite with a hidden stray | not detectable by the present guard | fails GitHub Actions; fails the rendered GitLab job run locally in its declared image |
| Detector overhead | not applicable | at most 2 s per job at the median over five runs |

### Out of scope

- Detecting strays in interpreters other than bash, or in bash older than 4.0 (R15 records
  these as limits); making the macOS system bash detect.
- Changing which jobs execute which suites, or their triggers. Only the detector is added.
- Speeding up any suite.
- A value-equivalence check of the hook path across engines (open follow-up, not a
  requirement).
- Executing the GitLab pipeline on a live GitLab.
- Wiring checks for suites a CI job never runs; those stay under spec 0076.
- Marking exemptions beyond the invocations in the exemption inventory; new ones follow the
  ordinary review of the diff that adds them.

### Open questions

1. **Direction.** Confirm direction 1 on structural grounds, or choose direction 3 on
   latency grounds. Recommended: direction 1. If direction 3: replace this delta with a
   recorded decision stating the break-even above and this monitoring criterion, evaluated
   over 100 consecutive `build.yml` runs: reopen if `test-wiring` is the longest job in 5 %
   or more of runs, or if any single changed suite exceeds 120 s on `ubuntu-latest`.
2. **Rollout shape.** All 31 capabilities and the exhaustive run in one change, or phased
   starting with the three heavy owners. Recommended: one change. A phased rollout keeps the
   runtime pass alive for the capabilities not yet converted, needs a registry that says
   which suites each pass covers, and would need a further delta because R9 is written for
   the end state. The four exemptions are known and the change is mechanical.
3. **Enforcement on first merge.** Enforce from the first merge, or report-only for one
   cycle. Recommended: enforce. The pull request's own CI is the dry run on the real
   runners; a report-only cycle adds a second rollout and a state in which strays pass.

Follow-ups for the orchestrator (not decisions):

- Spec 0171 requirements 1 to 3 describe base-ref resolution for the runtime pass that
  R9 removes; they become vacuous and a delta to 0171 should record it. Spec 0049 needs no
  delta (see *Wiring and parity*).
- Spec 0076 may need a delta if the plan hosts the R17 static check in
  `scripts/check-test-wiring.sh`; the out-of-scope bullet of 0170 about that script is
  relaxed accordingly (see MODIFIED).
- Spec 0131 could gain a value-shape check for job-scoped variables; not needed here.
- Implementation branch naming: a branch `chore/1445-...` carries a ticket number where
  spec 0168 requirement 2 reads a spec id (as spec 0109 delta-04 describes), so that check
  may inspect no file for this delta; the implementation PR should record the
  `approved` to `implemented` transition by hand.

## MODIFIED

Spec 0170 reads as modified below. Requirement 1 is unchanged and restated by R9.

**Intent, items 2 to 4.** The parent says, as its second, third and fourth numbered
points:

> Item 2: Runtime execution for stray command detection (`command not found` check) is
> strictly scoped to the test suites modified or added in the changeset
> (`scripts/tests/test-*.sh`).
>
> Item 3: Changes to shared non-test scripts or libraries under `scripts/` ... SHALL NOT
> trigger runtime execution of unchanged test suites in `check-test-strays.sh`, ...
>
> Item 4: When no test suites under `scripts/tests/` are modified in the changeset,
> `check-test-strays.sh` completes in milliseconds without executing any test suite at runtime.

They are replaced by:

> Item 2: Stray command detection happens once per suite, in the job that already executes
> it, through a detector engaged at job scope (R9 to R20). `check-test-strays.sh` executes
> no suite.
>
> Item 3: Shared scripts and libraries are covered because every job that runs a suite is
> triggered by its own paths and detects during that run.
>
> Item 4: `check-test-strays.sh` completes in under two seconds in every circumstance.

**Requirement 4.** The parent says:

> **4.** Changes to non-test files under `scripts/` (such as `scripts/lib/**` or root-level
> scripts) SHALL NOT trigger runtime execution of unchanged test suites in
> `check-test-strays.sh`.

It is replaced by:

> **4.** `check-test-strays.sh` SHALL NOT execute any suite, whatever changed. Strays
> reachable through shared scripts are found by the owning jobs that a change to those
> scripts triggers (R10, coverage argument).

**Requirement 5.** The parent says:

> **5.** When no test suites under `scripts/tests/` are modified in the changeset (or when
> the diff against merge-base is empty for `scripts/tests/`), `check-test-strays.sh` SHALL
> execute zero test suites at runtime and emit an `OK` confirmation message.

It is replaced by:

> **5.** After a clean static pass, `check-test-strays.sh` SHALL execute zero suites and emit
> an `OK` confirmation message, whether or not any suite changed.

**Requirement 6.** The parent says:

> **6.** When no base ref is provided or when git merge-base cannot be resolved ..., `scripts/check-test-strays.sh` SHALL run static syntax validation on all suites and execute only suites explicitly passed or whose content-addressed cache verdict is missing.

It is replaced by:

> **6.** The presence, absence or resolvability of a base ref SHALL NOT change what
> `check-test-strays.sh` does. The full-scan fallback and its warning are removed.

**Requirement 7.** The parent says:

> **7.** If any executed suite emits a `command not found` error during runtime execution, `scripts/check-test-strays.sh` SHALL fail with exit code 1 naming the failing suite and the error count.

It is replaced by:

> **7.** A stray executed by a suite SHALL fail the job that executes the suite, naming the
> command (R11). The failure is produced by the detector, not by `check-test-strays.sh`.

**Requirement 8.** The parent says:

> **8.** Regression test suite `scripts/tests/test-check-test-strays.sh` SHALL be updated to verify the new changeset-scoped and static validation behavior.

It is replaced by:

> **8.** `scripts/tests/test-check-test-strays.sh` SHALL verify the static pass and that no
> suite is executed (R9). The detector, the R14 proof, the exemption, the R15 limits, the
> cache-guard behaviour (R18) and the R17 static check SHALL each have regression tests,
> whose fixtures that contain deliberate strays run with their own record so that the
> job-level detector never reports them.

**Scenarios.** "changeset modifies a single test suite" and "modified test suite emits a
stray command" are replaced by the first two scenarios of `## ADDED`. "changeset touches
only non-test scripts" and "test suite has a syntax error" are retained.

**Out of scope, bullet 2.** The parent says:

> - Modifying how test suites are executed inside their dedicated functional CI capability jobs.

It is read with one exception: those jobs gain the detector and its closing proof, and the
suite commands, their order and their triggers are unchanged. Bullet 1 (modifying
`scripts/check-test-wiring.sh`) is read with an exception reserved for hosting the R17
static check there, if the plan chooses to; any other change to that script stays out.

## REMOVED

**Requirement 2.** Removed.

> **2.** When a base ref is provided (via `--base-ref`, `$GITHUB_BASE_REF`, or `$CI_MERGE_REQUEST_TARGET_BRANCH_NAME`), `scripts/check-test-strays.sh` SHALL determine the set of modified or added test suites via `git diff --name-only <merge-base> HEAD -- scripts/tests/test-*.sh`.

The script no longer executes suites, so it no longer needs the changed set. The suite
scoping the requirement expressed is replaced by the owning job's own path filter (R17).

**Requirement 3.** Removed.

> **3.** Only the test suites identified in Requirement 2 (the changeset-modified suites) SHALL be executed at runtime to check for stray `command not found` errors.

Replaced by R9 (no suite is executed by the script) and R10 (the owning job detects).
