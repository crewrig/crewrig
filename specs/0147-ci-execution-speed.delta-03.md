---
id: "0147"
slug: ci-execution-speed
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1825
version: 2.2.0
---

# CI execution speed

## ADDED

### Why this delta exists

The exhaustive run of requirement 21 of delta-01 (`.github/workflows/changeset-coverage.yml`,
capability `changeset-coverage` of `ci/ci-capabilities.yml`) has failed on every scheduled run
since 2026-10-24 (runs 40076902710 to 42805822807; alert issue #1825).

The trigger is #1798 (slice 3, first pull request of #1780). It moved the dependency install of
migrated capabilities out of their `command:` list and into the declarative `requires.install`
field, whose values the `ci-job` action (`.github/actions/ci-job/action.yml`, input `install`) and
the GitLab generator (`installLines` in `scripts/lib/build-ci/tools.ts`) both turn into one
provisioning line:

| `requires.install` | Provisioning line |
|---|---|
| `ci` | `npm ci` |
| `install` | `npm install` |
| `omit-dev` | `npm ci --omit=dev --workspaces=false` |
| `none`, or omitted | none |

An omitted key means `none`, not the action's own `omit-dev` default: `docs/ci-reference-format.md`
says so, and `check-ci-parity` fails a `ci-job` step whose `install` input differs from the
reference value read that way. A capability not yet migrated to `task ci:<id>` keeps its
provisioning line as the first entry of its `command:` list and omits the key.

`scripts/ci-changeset-coverage.ts` runs only the `command:` entries of each changeset-gated
capability. A migrated capability's `command:` is the single entry `task ci:<id>`, so its
`requires.install` is never run. `changeset-coverage` itself runs
`npm ci --omit=dev --workspaces=false`, so the run has no dev dependencies (`semver`,
`typescript`, `oxlint`, `oxfmt`). Four changeset-gated capabilities need them:

| Capability | `requires.install` | Observed failure |
|---|---|---|
| `lint-specs-selftest` | `install` | 73 tests fail with `Missing dependency 'semver'` |
| `path-ownership-selftest` | `ci` | precondition `check-tool-binaries.ts tsc` not met |
| `host-safety-selftest` | `ci` | precondition `check-tool-binaries.ts tsc` not met |
| `lint-typescript-selftest` | `ci` | precondition `check-tool-binaries.ts tsc oxlint oxfmt` not met |

The other 39 changeset-gated capabilities declare `omit-dev` (29) or omit the key (10).

This is the regression class of #1770 (delta-02) on a dimension the delta-02 guard does not see.
The coverage-tools guard (`scripts/lib/ci-changeset-coverage/tools.ts`,
`scripts/tests/ci-changeset-coverage-tools.test.ts`) compares `requires.tools` only, so the
change to `requires.install` reached `main` without a pull-request failure. This delta applies the
union rule of requirement 25 to dependency installs and extends the guard to enforce it.

### Vocabulary

- **Install rank.** A total preorder over the values of `requires.install`:
  `none` < `omit-dev` < `install` = `ci`. `install` and `ci` share the top rank because both
  install the full dependency tree, dev dependencies included, from the same `package.json` and
  `package-lock.json`. `npm ci` provides every package `npm install` would, and also fails when the
  manifest and the lockfile disagree, so it is never weaker. An omitted key ranks as `none`.
- **Gated install.** The highest install rank among the `requires.install` values of the
  capabilities with `changeset-gated: true` in `ci/ci-capabilities.yml`, read at check time.
- **Performed install.** The install in effect when the coverage script starts. It is the
  **last** entry of `changeset-coverage`'s `command:` list that is exactly one of the provisioning
  lines in the table above, because a later install replaces the tree an earlier one produced.
  When that list holds no provisioning line, it is the `requires.install` of `changeset-coverage`
  (which runs before its commands), or `none` when that key is omitted.

### Requirements

- **R33.** The performed install of `changeset-coverage` SHALL rank at least as high as the gated
  install, because the job that runs every changeset-gated command needs every dependency those
  commands need (requirement 25 applied to installs). With the reference as it is today, it
  SHALL therefore be a full install (`ci` rank). When every gated capability declares
  `omit-dev`, `none` or no key, a lower performed install is permitted; this delta does not
  require lowering it.
- **R34.** `changeset-coverage` SHALL express its full install as a `command:` entry, the way the
  reference format prescribes for a capability not migrated to `task ci:<id>`. It SHALL NOT gain
  a `requires.install` key. On `check-ci-parity`'s GitHub arm, an install step that matches no
  `command:` entry fails a hand-written job as a divergent business step (R3 of that check), and
  the `requires.install` key is defined for migrated capabilities only. Concretely:
  - In `ci/ci-capabilities.yml`, the first `command:` entry of `changeset-coverage` SHALL be
    `npm ci`, replacing `npm ci --omit=dev --workspaces=false`. The other entries stay as they
    are. This is the line the `ci-job` action and the GitLab generator emit for `install: ci`.
  - In `.github/workflows/changeset-coverage.yml`, the matching step of the
    `changeset-coverage` job SHALL run `npm ci`, and its name SHALL no longer say "production".
  - On GitLab CI, `.gitlab-ci.yml` SHALL be **regenerated** with `node scripts/build-ci.ts` and
    SHALL NOT be edited by hand.
  - The two engines SHALL keep agreeing as required by requirement 9 of the parent
    (`check-ci-parity`).
- **R35.** The coverage-tools guard of requirement 28 SHALL also fail when a changeset-gated
  capability's `requires.install` ranks higher than the performed install of
  `changeset-coverage`. It SHALL read both from `ci/ci-capabilities.yml` at check time
  (requirement 29) and SHALL embed no list of capabilities or install values taken from the
  reference. It SHALL recognise a provisioning line in `changeset-coverage`'s `command:` through
  the same value-to-line mapping that the GitLab generator uses (`installLines`), not through a
  second, hand-kept list of lines. A changeset-gated capability that omits `requires.install`
  ranks as `none` and never yields an install finding. A provisioning line inside a gated
  capability's own `command:` is run by the exhaustive run itself and SHALL NOT be counted as a
  requirement on `changeset-coverage`.
- **R36.** Each install finding line of the guard SHALL name **the capability**, **its
  `requires.install` value** and **the performed install**, in the form
  `ci-changeset-coverage-tools: <capability-id> needs requires.install <value> but changeset-coverage installs only <performed>`.
  `<performed>` is the `requires.install` value matching the performed install's provisioning
  line, or `none` when `changeset-coverage` performs no install. A `requires.install` value
  outside `ci`, `install`, `omit-dev` and `none` SHALL rank above every known value, so it always
  yields a finding of this form and the guard fails closed. Install findings follow tool findings
  and appear in reference order, one per capability. The exit-code contract of requirement 30 is
  unchanged: the guard exits non-zero when it prints at least one finding of either kind, and
  exits zero otherwise.
- **R37.** The install half of the guard SHALL be tested in the existing
  `scripts/tests/ci-changeset-coverage-tools.test.ts`, run by the existing capability
  `changeset-coverage-test`. **No new test file, job or capability** SHALL be introduced, on
  either engine. Each case SHALL build a temporary copy of a reference document and SHALL NOT
  mutate the real `ci/ci-capabilities.yml`. The test SHALL include one case per install scenario
  below, and at least these:
  - the real reference, after requirement 34, yields no install finding;
  - changing `changeset-coverage`'s first `command:` entry back to
    `npm ci --omit=dev --workspaces=false` yields exactly four install findings, in reference
    order, naming `path-ownership-selftest`, `host-safety-selftest`,
    `lint-typescript-selftest` (each `ci`) and `lint-specs-selftest` (`install`), each with
    `omit-dev` as the performed install;
  - appending `npm ci --omit=dev --workspaces=false` after `changeset-coverage`'s `npm ci` entry
    yields the same four findings, because the last provisioning line is the performed install;
  - removing every provisioning line from `changeset-coverage` names the same four capabilities
    with `none` as the performed install;
  - a gated capability with `install` is satisfied by a performed `ci`, and one with `ci` by a
    performed `install`, so the two values rank equal;
  - a gated capability whose `requires.install` key is removed yields no install finding, even
    when `changeset-coverage` performs no install;
  - when `changeset-coverage`'s `command:` holds no provisioning line, its own
    `requires.install` key is the performed install, so the guard keeps working after a future
    migration of that capability;
  - an unknown `requires.install` value on a gated capability yields a finding;
  - two different documents given to the guard yield different install results, which proves it
    reads the document it is given.
- **R38.** The merge of the implementation pull request SHALL be preceded by a green
  `workflow_dispatch` run of the **Exhaustive Run** workflow on the implementation branch,
  linked in the pull request body. If that run reveals a failure other than the missing
  dependencies of the four capabilities above, the implementer SHALL report it on the logbook
  issue #1825, and to the maintainers, **before** widening the change to fix it. This delta does
  not authorize fixes to unrelated checks (the rule of requirement 32).

### Alternatives considered

- **Per-capability install inside `scripts/ci-changeset-coverage.ts`.** The script would run
  each gated capability's `requires.install` line before its commands. **Rejected.** It repeats
  npm installs (33 per run with today's reference, 32 of them an `npm ci` that first deletes
  `node_modules`), which lengthens the run and adds no coverage. One full install already satisfies every capability.
  An `omit-dev` install after a full one would also delete the dev dependencies that later
  capabilities need, so execution order would start to matter.
- **Install-only fix, without extending the guard.** Change `npm ci --omit=dev` to `npm ci` and
  stop there. **Rejected.** It repairs today's run, but the next gated capability that raises its
  `requires.install`, or the next edit that weakens `changeset-coverage`, breaks the scheduled
  run again with no pull-request failure. That is how #1798 broke it after #1770 had been fixed.
- **A `requires.install: ci` key on `changeset-coverage` instead of a `command:` entry.**
  **Rejected for this delta.** The hand-written GitHub job would then have an `npm ci` step that
  matches no `command:` entry, so `check-ci-parity` would fail it. The reference format also
  reserves the key for migrated capabilities. Requirement 35 still reads the key, so a later
  migration of `changeset-coverage` to `task ci:changeset-coverage` keeps the guard valid.
- **Ranking `install` above `ci`, or apart from it.** **Rejected.** Both produce the full
  dependency tree from the lockfile. Ranking them apart would force `changeset-coverage` to run
  both commands, for nothing.

### Scenarios

**Scenario:** the exhaustive run has the dev dependencies

Given `changeset-coverage` runs `npm ci` as its first `command:` entry
When the Exhaustive Run is dispatched on the implementation branch
Then `task ci:lint-specs-selftest` runs without `Missing dependency 'semver'`
And the `check-tool-binaries.ts tsc oxlint oxfmt` precondition of `lint-typescript-selftest` is met
And the run ends green

**Scenario:** the guard passes on the corrected reference

Given the real reference after requirement 34
When the coverage-tools guard runs
Then it prints no install finding
And it exits zero

**Scenario:** reverting to the production install fails the guard (regression)

Given a copy of the reference in which the first `command:` entry of `changeset-coverage` is
`npm ci --omit=dev --workspaces=false`
When the coverage-tools guard runs against it
Then it fails
And it prints `ci-changeset-coverage-tools: lint-specs-selftest needs requires.install install but changeset-coverage installs only omit-dev`
And it prints the same form for `path-ownership-selftest`, `host-safety-selftest` and
`lint-typescript-selftest`, each with `ci`

**Scenario:** a later production install downgrades the run (regression)

Given a copy of the reference in which `changeset-coverage` runs `npm ci` and then
`npm ci --omit=dev --workspaces=false` before the coverage script
When the coverage-tools guard runs against it
Then it fails and names the four capabilities with `omit-dev` as the performed install

**Scenario:** a gated capability raises its install

Given a copy of the reference in which a changeset-gated capability changes `requires.install`
from `omit-dev` to `ci`
And `changeset-coverage` performs only `npm ci --omit=dev --workspaces=false`
When the coverage-tools guard runs against it
Then it fails and names that capability, `ci` and `omit-dev`

**Scenario:** `ci` and `install` rank equal

Given a changeset-gated capability declares `requires.install: install`
And `changeset-coverage` runs `npm ci`
When the coverage-tools guard runs
Then it reports no install finding for that capability

**Scenario:** an omitted key ranks as none

Given a changeset-gated capability that omits `requires.install`
And `changeset-coverage` performs no install
When the coverage-tools guard runs
Then it reports no install finding for that capability

**Scenario:** an unknown install value fails closed

Given a copy of the reference in which a changeset-gated capability declares
`requires.install: full`
When the coverage-tools guard runs against it
Then it fails and names that capability and `full`

**Scenario:** a future migration of `changeset-coverage` keeps the guard valid

Given a copy of the reference in which `changeset-coverage` has no provisioning line in
`command:` and declares `requires.install: ci`
When the coverage-tools guard runs against it
Then it reports no install finding

**Scenario:** the engines still agree

Given the implementation branch, with `.gitlab-ci.yml` regenerated by `node scripts/build-ci.ts`
When `check-ci-parity` runs
Then it reports no divergence for `changeset-coverage`

**Scenario:** the dispatch run reveals another pre-existing failure

Given the dispatched Exhaustive Run is red for a check that does not depend on the dev dependencies
When the implementer reads the result
Then the failure is reported on issue #1825 before any fix is attempted
And requirement 38's green run is still required before merge

### Out of scope

- Migrating `changeset-coverage` to `task ci:changeset-coverage` or deriving
  `.github/workflows/changeset-coverage.yml` from the reference (epic #1761).
- The `alert` job of `.github/workflows/changeset-coverage.yml` (capability
  `alert-scheduled-failure`), whose production install is sufficient for its own command.
- Weakening the `requires.install` of any gated capability so that a production install would
  suffice. The values are the capabilities' own contract, checked on their own jobs.
- Detecting a provisioning line inside a gated capability's own `command:` that would downgrade
  the run's install (for example `npm ci --omit=dev` in the middle of the run). No changeset-gated
  capability has a provisioning line in its `command:` today, and migrated capabilities cannot
  have one (spec 0283 requirement 1).
- Hand edits of `.gitlab-ci.yml` (requirement 34).
- Fixing any unrelated check that the dispatch run reveals (requirement 38).
- Changing the schedule, the triggers, the alerting or the visibility rules of the exhaustive run.

## MODIFIED

**Requirement 28 of delta-02.** Delta-02 says:

> **R28.** A **coverage-tools guard** SHALL run on every pull request targeting `main` or
> `release/**` [...]. It SHALL fail when the gated union contains a tool that is absent from the
> `requires.tools` of `changeset-coverage` (requirement 25). [...]

It is read with one added sentence after the second:

> It SHALL also fail when a changeset-gated capability's `requires.install` ranks above the
> performed install of `changeset-coverage` (requirements 33, 35 and 36 of delta-03).

The triggers, the absence of a `paths:` filter and the tool rule are unchanged.

**Requirement 21 of delta-01, as read by delta-02.** Delta-02 added this sentence:

> The job that performs the exhaustive run SHALL have every tool those commands need
> (requirements 25 to 27 of delta-02), on both engines; a command that cannot start because
> its tool is missing is a failure of the run, not a skipped command.

It is replaced by:

> The job that performs the exhaustive run SHALL have every tool and every dependency install
> those commands need (requirements 25 to 27 of delta-02 and 33 to 34 of delta-03), on both
> engines; a command that cannot start because its tool or dependency is missing is a failure
> of the run, not a skipped command.

## REMOVED

None.
