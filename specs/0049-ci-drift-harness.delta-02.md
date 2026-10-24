---
id: "0049"
slug: ci-drift-harness
status: draft
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1780
version: 1.2.0
---

# CI drift harness

## ADDED

### Why this delta exists

Delta-01 compares the `paths` of a reference trigger with the GitHub-side filter of the job (concern 6 of the harness). It assumes two things that the CI task contract (`specs/0283-ci-jobs-run-task.md`, slice 3 of #1777) changes:

- A trigger that declares no `paths` means an unfiltered event (delta-01 R15). Spec 0283 R3 adds an optional capability-level `paths:` that a `pull-request` or `push` trigger with no `paths` of its own inherits. Read literally, R15 would report such a trigger as unfiltered, and the harness would fail on every migrated capability.
- The GitHub-side filter is a list in the workflow (an in-job `dorny/paths-filter` step or a dedicated-workflow `paths`) that R12 to R20 compare with the reference. Spec 0283 R5 and R6 replace that list, for a migrated job, with the composite action `.github/actions/ci-job` and a runtime gate that reads the capability's paths itself. There is then no list on the GitHub side to compare, and the comparison would fail closed under R17 (a job with no determinable filter).

This delta amends minimally. It defines the effective path set of a trigger (R25), makes R12 to R20 compare effective sets (R26), and replaces concern 6 for a job that uses `ci-job` (R27 and R28). A job that still carries a `dorny/paths-filter` filter keeps R12 to R20 unchanged against the effective set (R29), so the harness is green at every intermediate merge of the migration, including the shadow period of spec 0283 R6 where the gate runs beside the authoritative filter. The GitLab arm is untouched: 0049 does not compare GitLab path lists, it composes the generator's verification mode (parent requirement 5), and the generator's handling of the inherited paths belongs to spec 0283 R4.

### Vocabulary

- **Effective path set of a trigger.** For a `pull-request` or `push` trigger of a capability, the set of textual glob entries of: the trigger's own `paths` when it declares one; otherwise the capability-level `paths` when the capability declares one; otherwise none (the event is unfiltered). The rule is the one of spec 0283 R3; the trigger-level list wins and is never merged with the capability-level list.
- **Migrated job.** A GitHub Actions job attributed to a capability whose steps include `uses: ./.github/actions/ci-job`.
- **Glob engine.** `scripts/lib/glob-engine.ts`, the matcher the runtime path gate and the path-ownership check share.

### Requirements

The requirements extend the cumulative list (R25 onwards; R12 to R24 are delta-01's).

**R25 (effective path set).** Wherever delta-01 speaks of a trigger's `paths`, "reference path set" or "unfiltered", the harness SHALL use the effective path set of the trigger as defined in the Vocabulary. A trigger with neither its own nor an inherited `paths` is an unfiltered event, as delta-01 R15 says. A capability that declares a capability-level `paths` and whose `pull-request` or `push` trigger declares none has, for that trigger, a path-bearing comparable trigger for R12.

**R26 (R12 to R20 compare effective sets).** The reference path set of R12 to R20 SHALL be the effective path set of R25. Set equality (R13), per-event matching and the event-agnostic in-job rule (R14), the absent and unfiltered event handling (R15), the failure message (R18) and the self-test classes (R21) apply to effective sets without other change. In particular R14's rule that an in-job filter faces every comparable trigger compares the filter with each trigger's effective set, so two triggers inheriting the same capability-level list agree with one in-job filter.

**R27 (concern 6 for a migrated job).** For a migrated job there is no GitHub-side filter list: R12 to R18 do not apply to it, and the comparison of delta-01 is replaced by two checks.

- **(a) Id binding.** The job's `ci-job` step SHALL carry `with: id: <capability id>` where the capability is the one the job is attributed to. Any other value, a missing `id`, or an expression that is not a literal, SHALL fail with a non-zero result naming the job, the declared `id` and the capability identifier.
- **(b) Supported globs.** Every entry of every effective path set of the capability SHALL be a glob that `scripts/lib/glob-engine.ts` supports. The harness SHALL fail closed with a non-zero result naming the capability, the trigger kind and the entry for an entry the engine rejects, so an unsupported glob is a hard error at review time and never a runtime surprise (spec 0283 R6).

R27 SHALL NOT report a divergence for the absence of a workflow-level `paths` or of a path-filter step on a migrated job, and SHALL NOT compare `branches`, `tag-pattern` or cache-key lists (R19 holds).

**R28 (migrated job and workflow-level paths).** A migrated job held by a workflow that also declares `paths` under a comparable event is an undeterminable-filter case: the harness SHALL fail closed naming the job and the cause, because the gate's decision and the workflow's would be conjoined (the analogue of R17's last case). The check is skipped under R20 when the repository holds no GitHub workflow artifacts, like every GitHub-arm check.

**R29 (unmigrated and shadow jobs keep R12 to R20).** A job that carries a `dorny/paths-filter` filter (an in-job filter) or a dedicated-workflow filter SHALL be compared under R12 to R20 and R26, against the effective path set. A job that carries both a `ci-job` step and an in-job filter, the shape of the shadow period of spec 0283 R6, SHALL satisfy R27 and R12 to R20 together: the filter, still authoritative, is compared with the effective set, and the `id` binding and glob support are checked as well. When the filter is removed in the later PR of spec 0283 R9, only R27 remains for that job, with no change to the harness.

**R30 (self-test, mkdtemp fixtures).** The harness's automated self-test (parent requirement 10, delta-01 R21) SHALL add, on `mkdtemp` fixture repositories only, the verdicts listed below, each asserting the exit status and that the message names the capability or job.

1. A capability-level `paths` with triggers declaring none, facing an in-job filter equal to it: passing.
2. The same, with the filter missing one entry: failing, naming the entry as reference-only.
3. A trigger-level `paths` that differs from the capability-level list: the trigger-level list is the effective set, and the filter is compared with it (passing when equal, failing otherwise).
4. A migrated job with the correct `id`: passing, with no filter list present.
5. A migrated job whose `id` names another capability, has no `id`, or has a non-literal `id`: failing.
6. A migrated capability whose effective set carries an entry the glob engine rejects: failing, in both the capability-level and trigger-level forms.
7. A migrated job in a workflow that declares `on.pull_request.paths`: failing (R28).
8. A job carrying both `ci-job` and an equal in-job filter: passing; with an unequal filter: failing (R29).
9. A capability with neither own nor inherited `paths` and no filter: passing (agreement by absence).

The delta-01 fixtures keep their verdicts, since a capability without a capability-level `paths` has an effective set equal to its trigger's own list.

**R31 (documentation).** The implementation change SHALL extend the section of `docs/ci-reference-format.md` that R23 of delta-01 writes with the effective-set rule and the concern 6 behaviour for a migrated job. This spec-PR does not edit that document.

**R32 (no regression on the repository).** The implementation SHALL pass the harness on its own tree with no baseline file and no allow-list at every intermediate merge of spec 0283's PR plan (delta-01 R24 extends to each of them).

### Acceptance

The self-test cases of R30 pass, and the delta-01 self-test cases still pass unchanged. On a `mkdtemp` fixture repository holding a migrated capability whose triggers inherit the capability-level `paths` and whose job is a checkout plus `ci-job` with its own `id`, `task ci-parity` (the harness) exits 0; changing the `id`, adding an unsupported glob, or adding `on.pull_request.paths` to the workflow makes it exit non-zero with a message naming the job or capability. `CREWRIG_PR_DRAFT=true task spec:lint` and `task lint-markdown` pass on this file.

### Scenarios

**Scenario:** triggers inheriting a capability-level list match the unmigrated filter

```text
Given a capability with a capability-level `paths` {A, B} and a pull-request
      and a push trigger that declare no `paths`
And   its GitHub job still carries a `dorny/paths-filter` filter {A, B}
When the harness runs
Then it reports no path-filter divergence
```

**Scenario:** a migrated job is bound to its own capability

```text
Given a job that is a checkout plus `uses: ./.github/actions/ci-job`
      with `id: lint-specs`, attributed to the capability `lint-specs`
And   no filter list on the GitHub side
When the harness runs
Then concern 6 passes for that job

Given the same job with `id: lint-markdown`
When the harness runs
Then it fails naming the job, `lint-markdown` and `lint-specs`
```

**Scenario:** an unsupported glob is rejected at review time

```text
Given a migrated capability whose capability-level `paths` contains an entry
      that scripts/lib/glob-engine.ts does not support
When the harness runs
Then it fails closed naming the capability, the trigger kind and the entry,
     before any runtime gate could run
```

### Alternatives considered

- **Keep delta-01 unchanged and make the capability list its triggers' paths again in the reference.** Rejected: it defeats the single path set of spec 0283 R3 and keeps the duplicated lines the slice exists to remove.
- **Compare a generated filter list against the effective set for a migrated job.** Rejected: spec 0283 rejects a generated filters file as a fourth uncounted surface, and the gate reads the same reference the harness reads, so there is nothing on the GitHub side left to drift.
- **Replace concern 6 by `id` binding only.** Rejected: an unsupported glob would be silently accepted by the checker and surface only at runtime; spec 0283 R6 requires it to be a review-time hard error.

## MODIFIED

Delta-01 R12 to R20 keep their text. R25 to R29 change how they read, as follows, and nothing else.

- **Delta-01 R15, first sentence.** Original: "A comparable trigger that declares no `paths` means an unfiltered event." Replacement: "A comparable trigger whose effective path set (delta-02 R25) is empty, that is one that declares no `paths` and whose capability declares no capability-level `paths`, means an unfiltered event."
- **Delta-01 R12 to R14, R16 to R18, R21.** Wherever they say "the reference path set" or "the reference `paths`", they mean the effective path set of R25 (R26). No other word changes.
- **Delta-01 R12 to R18, for a migrated job.** They do not apply to a job that uses `ci-job` and carries no filter; R27 and R28 replace them for that job. For a job that carries a filter they apply in full (R29).
- **Delta-01 Vocabulary, "Unfiltered event".** Reads "an event for which the effective path set of the reference trigger is empty, or for which the GitHub side declares the event with no filter."

R1 to R11 and R19 to R24 are unchanged, and the GitLab arm (parent requirement 5) is not amended.

## REMOVED

_None._
