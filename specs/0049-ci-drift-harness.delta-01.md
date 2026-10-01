---
id: "0049"
slug: ci-drift-harness
status: implemented
complexity: small
interaction-mode: INTERMEDIATE
related-issue: 1422
version: 1.1.0
---

# CI drift harness

## ADDED

### Why this delta exists

The harness compares each portable capability with its GitHub Actions job on
three axes: the business steps (parent requirement 3), the runtime
provisioning and execution requirements (parent requirement 4) and the cache
keys. It does not compare the capability's `paths:` with the trigger filter
that GitHub actually applies to the job. The two can therefore drift apart
without any check noticing.

The path-ownership check of spec 0147 delta-01 (requirements 11 to 19) reads
ownership from the `paths:` of `ci/ci-capabilities.yml`. A glob added there
and forgotten on the GitHub side makes ownership pass while the owning job
never starts: the file is declared owned, and nothing exercises it before
merge. `docs/ci-reference-format.md` records this under "Known limitation:
GitHub path filters are not compared" and points to issue #1422. The gap was
raised as finding `v1-F5` of seat `plan/1405` (risk 1 of PLAN v2).

Why the owner is spec 0049 and not 0047 or 0048:

- Spec 0047 already admits `paths` as a normalized trigger filter (the
  reference side of the contract exists), so the reference format does not
  change.
- Spec 0048 owns GitLab derivation. The GitLab arm is already composed from
  the generator's verification mode (parent requirement 5), so it cannot
  drift from the reference by construction and needs nothing here.
- The missing guarantee is in the harness's conformance check of the GitHub
  arm (parent requirements 1, 3 and 4). One delta on this spec suffices.

The gap is not only theoretical. Measured on `main` at `6aab134` with the
rules below (R12 to R18) applied to every portable capability that declares
`paths`, one mismatch exists today: the `usage-pricing` workflow filters
`scripts/lib/usage-dashboard/**` and `scripts/usage-dashboard.sh` on both
`pull_request` and `push`, and the reference `paths` of `usage-pricing` list
neither. Every other compared pair is equal. The figure is a point-in-time
record; R24 makes the implementation re-measure it.

The first bullet of `### Out of scope` in
`specs/0147-ci-execution-speed.delta-01.md` ("Any extension of the CI
reference format, `check-ci-parity.sh` or `build-ci.sh` (specs 0047 to
0049), including an `owns:` field for capabilities without `paths:` ...")
is scoped to that delta's own out-of-scope list. It bounds that delta, not
this ticket, and does not prevent extending the harness here. This delta
still adds no field to the reference format and does not touch the GitLab
arm or the generator.

### Vocabulary

- **Reference path set.** The set of textual glob entries of one `paths`
  list of a trigger of a capability in `ci/ci-capabilities.yml`.
- **GitHub-side filter.** The path list that GitHub Actions applies to the
  job attributed to a capability, to decide whether that job runs or does its
  work. It takes one of two shapes:
  - **In-job filter.** A path-filter step (a `dorny/paths-filter` step)
    inside the attributed job, whose output gates the job's later steps.
    Its list applies whatever the triggering event, so it cannot
    distinguish a pull request from a push. The wiring that consumes its
    output is not compared (see Out of scope).
  - **Dedicated-workflow filter.** The `paths` list under an event key
    (`pull_request`, `push`) of the `on:` block of a workflow file that holds
    the attributed job. It is per event.
- **Unfiltered event.** An event for which the reference trigger declares no
  `paths`, or for which the GitHub side declares the event with no filter.
- **Absent event.** A comparable event that one side does not declare at all:
  the capability has no trigger of that kind in the reference, or the
  workflow holding the job has no such event key under `on:`. An absent event
  carries the empty path set for the comparison (R15).
- **Comparable events.** Reference triggers of kind `pull-request` and
  `push` are the only ones compared, matched respectively with the
  `pull_request` and `push` events of GitHub Actions.

### Requirements

The requirements extend the parent's `## Requirements` list (cumulative
numbering R12 to R24).

**R12.** For every portable capability that declares a comparable trigger
carrying `paths`, or whose attributed GitHub Actions job carries a
GitHub-side filter, the harness SHALL compare the reference path set with the
GitHub-side filter path set, covering both shapes (in-job filter and
dedicated-workflow filter). A portable capability that has neither a
path-bearing comparable trigger nor a GitHub-side filter agrees by absence
and SHALL produce no divergence.

**R13.** The comparison SHALL be a set equality on the decoded textual glob
entries: order of entries, repetition of an entry and the YAML quoting
around an entry SHALL NOT matter. The harness SHALL NOT normalize globs or
judge semantic equivalence: two spellings that match the same files (for
example `dir/**` and `dir/**/*`) are a divergence, because the
path-ownership check and the engine each decide on the spelling.

**R14.** For a dedicated-workflow filter, the harness SHALL compare the
`pull-request` trigger's reference path set with the `pull_request` filter
and the `push` trigger's reference path set with the `push` filter,
separately. For an in-job filter, which cannot distinguish events, the
harness SHALL compare its single list with the reference path set of every
comparable trigger of the capability; a capability whose comparable triggers
do not all declare the same path set cannot match its in-job filter and SHALL
be reported as a divergence.

**R15.** A comparable trigger that declares no `paths` means an unfiltered
event. The harness SHALL report a divergence when the GitHub side filters an
event that the reference leaves unfiltered, and when the GitHub side leaves
an event unfiltered while the reference declares `paths` for it. An event
unfiltered on both sides agrees. An absent event carries the empty path set:
it is a divergence when the other side declares `paths` for that event (a
workflow filtering `push` for a capability with no `push` trigger, or a
reference `push` trigger with `paths` for a workflow with no `push` event), and
it agrees with an absent or unfiltered event on the other side, because
whether an event is declared at all, without a filter, is trigger-set
conformance and not a path comparison (see Out of scope).

**R16.** A GitHub-side entry that is a negation (a leading `!`), and any
exclusion construct of the GitHub-side filter (an ignore list), cannot be
expressed in the reference. The harness SHALL report such an entry as a
divergence that names it, and SHALL NOT ignore it silently or skip the
capability because of it.

**R17.** The harness SHALL fail closed when the GitHub-side filter of the
attributed job cannot be determined unambiguously. The undeterminable cases
include: the job carries several path-filter steps; a path-filter step
defines several named filters, or only a filter whose name is not the
capability identifier; a filter's list cannot be read; and the job carries an
in-job filter while the workflow that holds it also declares `paths` under a
comparable event, so that the effective filter is the conjunction of two
lists and equals neither. The harness SHALL report the capability and the
cause instead of skipping the capability or treating the filter as
unfiltered.

**R18.** For each mismatch, the failure message SHALL name the capability
identifier, the GitHub platform and the event (or "in-job filter" for the
in-job shape, together with the reference trigger kind compared). It SHALL
list, as two clearly labelled lists, the entries present only in the
reference and the entries present only on the GitHub side, either of which
MAY be empty. The harness SHALL exit non-zero on any mismatch (parent
requirement 9). A capability whose path sets match SHALL produce no output
beyond the harness's existing success reporting.

**R19.** The comparison SHALL cover only the `paths` of the `pull-request`
and `push` triggers. It SHALL NOT compare `branches` or `tag-pattern`
filters or the cache-key lists, which keep their present treatment
(parent requirement 4 and the existing cache-key check), and SHALL NOT
change the verdict of any existing check.

**R20.** Like every GitHub-arm check of the harness, the comparison SHALL be
skipped, without failure and without a reported divergence, when the
repository holds no GitHub Actions workflow artifacts (parent requirement 11,
last sentence).

**R21.** The harness's automated self-test (parent requirement 10) SHALL
assert the passing verdict on matching path sets and a fail-closed verdict
for each of these classes, in both GitHub-side shapes where the class applies:

- an entry present only in the reference;
- an entry present only on the GitHub side;
- reordered, repeated or differently quoted entries that are equal as sets
  (passing verdict);
- a different spelling of a glob that matches the same files;
- an event-specific mismatch on a dedicated workflow (`pull_request` and
  `push` differ);
- a negation or exclusion on the GitHub side;
- an in-job filter facing reference triggers that declare different path
  sets;
- a filtered event facing an unfiltered one, in either direction;
- an event declared with `paths` on one side and absent on the other, in
  both directions, and an event absent on one side facing an unfiltered event
  on the other (passing verdict);
- a GitHub-side filter that cannot be determined unambiguously, for each
  undeterminable case listed in R17.

**R22.** The comparison SHALL NOT increase the harness's wall-clock time
materially, neither for a run on the repository nor for its self-test (about
33 s today on `main`). The plan SHALL state the bound it verifies; the
mechanism is left to the plan.

**R23.** The implementation change SHALL replace the "Known limitation:
GitHub path filters are not compared" subsection of
`docs/ci-reference-format.md` with a description of the guarantee of R12 to
R20, and SHALL leave no statement in the documentation claiming that GitHub
path filters are not compared. The guidance that the cache-key lists are
mirrored by hand stays, as R19 leaves them unchanged. This spec-PR does not
edit that document.

**R24.** The implementation change SHALL pass the new comparison on its own
tree with no baseline file and no allow-list: every mismatch that the
comparison reveals on the tree at implementation time SHALL be resolved in
that same change, by correcting the reference `paths` or the GitHub-side
filter, whichever the capability's checks actually require. The
implementation SHALL re-measure rather than reuse a figure from this spec.

### Scenarios

R22 (a timing bound) and R23 (a documentation edit) have no scenario: neither
is an observable behaviour of a run. The plan states how each is verified.

**Scenario:** matching sets in both shapes pass

```text
Given a portable capability whose GitHub job has an in-job filter equal to
      the reference path set of every comparable trigger of the capability
And   a portable capability held by a dedicated workflow whose
      `pull_request` and `push` filters equal the reference path sets of its
      `pull-request` and `push` triggers
When the harness runs
Then it reports no path-filter divergence for either capability
And  its exit status is unaffected by the comparison
```

**Scenario:** reordered, repeated or requoted entries still match

```text
Given a reference path set {A, B} and a GitHub-side filter listing B, A, B
      with some entries quoted and others bare
When the harness runs
Then it reports no divergence, because the sets are equal
```

**Scenario:** a glob forgotten in an in-job filter is rejected

```text
Given a glob was added to the `paths` of a portable capability in the
      reference and not to the in-job filter of its GitHub job
When the harness runs
Then it fails with a non-zero result naming the capability, the GitHub
     platform and "in-job filter"
And  the entry appears under the reference-only list and the GitHub-only
     list is empty
```

**Scenario:** a glob forgotten in a dedicated workflow is rejected

```text
Given a glob was added to the `pull-request` trigger `paths` of a portable
      capability in the reference and not to `on.pull_request.paths` of the
      workflow that holds its job
When the harness runs
Then it fails with a non-zero result naming the capability, the GitHub
     platform and the `pull_request` event
And  the entry appears under the reference-only list
```

**Scenario:** an entry present only on the GitHub side is rejected

```text
Given a glob exists in a GitHub-side filter that the reference path set of
      the capability does not list
When the harness runs
Then it fails with a non-zero result, and the entry appears under the
     GitHub-only list
```

**Scenario:** a different spelling of an equivalent glob is rejected

```text
Given the reference lists `dir/**` and the GitHub-side filter lists
      `dir/**/*` for the same capability
When the harness runs
Then it fails with a non-zero result, listing `dir/**` as reference-only and
     `dir/**/*` as GitHub-only
```

**Scenario:** a negation on the GitHub side is rejected

```text
Given a GitHub-side filter that contains an entry with a leading `!`, or an
      ignore list, for a portable capability
When the harness runs
Then it fails with a non-zero result naming the capability, the GitHub
     platform and the negated or excluded entry
And  it does not skip the capability
```

**Scenario:** an event-specific mismatch on a dedicated workflow is rejected

```text
Given a portable capability whose `pull-request` and `push` triggers declare
      the same paths in the reference, held by a workflow whose
      `on.push.paths` lacks one of them
When the harness runs
Then it fails with a non-zero result naming the capability, the GitHub
     platform and the `push` event
And  the `pull_request` event produces no divergence
```

**Scenario:** an in-job filter cannot match differing per-event sets

```text
Given a portable capability, filtered by an in-job filter, whose
      `pull-request` and `push` triggers declare different path sets
When the harness runs
Then it fails with a non-zero result naming the capability and "in-job
     filter", because a single event-agnostic list cannot equal both sets
```

**Scenario:** a filtered event facing an unfiltered one is rejected

```text
Given a portable capability whose reference trigger declares no `paths`
      while its GitHub-side filter lists globs
When the harness runs
Then it fails with a non-zero result, and the globs appear under the
     GitHub-only list
And  the reverse case (reference lists globs, GitHub side has no filter)
     fails with the globs under the reference-only list
```

**Scenario:** an event declared with paths on one side only is rejected

```text
Given a portable capability whose reference has no `push` trigger
And   the workflow that holds its job declares `on.push.paths`
When the harness runs
Then it fails with a non-zero result naming the capability, the GitHub
     platform and the `push` event
And  the entries appear under the GitHub-only list, the reference-only list
     being empty
And  the reverse case (a reference `push` trigger with `paths`, a workflow
     with no `push` event) fails with the entries under the reference-only
     list
```

**Scenario:** an event declared without paths on one side only is not compared

```text
Given a portable capability whose reference has a `push` trigger without
      `paths`
And   the workflow that holds its job has no `push` event under `on:`
When the harness runs
Then the path-filter comparison reports no divergence for that capability,
     because whether the event is declared at all is not a path comparison
```

**Scenario:** a capability with no filter on either side agrees by absence

```text
Given a portable capability whose comparable triggers declare no `paths`
And   whose attributed GitHub job carries no filter of either shape
When the harness runs
Then the path-filter comparison reports no divergence for that capability
     and prints nothing for it
```

**Scenario:** an undeterminable GitHub-side filter fails closed

```text
Given the job attributed to a portable capability carries two path-filter
      steps
When the harness runs
Then it fails with a non-zero result naming the capability and the cause,
     and does not treat the capability as unfiltered
```

**Scenario:** a path-filter step with several named filters fails closed

```text
Given the path-filter step of a portable capability's job defines two named
      filters, or only a filter whose name is not the capability identifier
When the harness runs
Then it fails with a non-zero result naming the capability and the cause,
     and does not pick a list on its own
```

**Scenario:** an unreadable filter list fails closed

```text
Given the path-filter list of a portable capability's job cannot be read
      (for example it is not a list of strings)
When the harness runs
Then it fails with a non-zero result naming the capability and the cause,
     and does not treat the capability as unfiltered
```

**Scenario:** an in-job filter combined with a workflow-level paths list fails closed

```text
Given the job of a portable capability has an in-job filter
And   the workflow that holds it also declares `on.pull_request.paths`
When the harness runs
Then it fails with a non-zero result naming the capability and the cause,
     because the effective filter is the conjunction of two lists
```

**Scenario:** the failure message names the capability, the platform and the event

```text
Given a mismatch on a portable capability, with one entry only in the
      reference and two entries only on the GitHub side
When the harness runs
Then the message names the capability identifier, the GitHub platform and the
     event (or "in-job filter" with the reference trigger kind compared)
And  it shows a reference-only list with one entry and a GitHub-only list
     with two entries, each clearly labelled
```

**Scenario:** branch and tag filters are not compared

```text
Given a capability whose `branches` or `tag-pattern` differ between the
      reference and the GitHub workflow, and whose path sets are equal
When the harness runs
Then the path-filter comparison reports no divergence
```

**Scenario:** the tree that introduces the comparison passes it

```text
Given the comparison reveals a mismatch on the tree at implementation time
When the implementation change is ready for review
Then that change has corrected the reference `paths` or the GitHub-side
     filter so the harness passes on its own tree, with no baseline file and
     no allow-list
```

**Scenario:** an adopter repository has no GitHub workflow artifacts

```text
Given an adopter repository that holds the reference but no GitHub Actions
      workflow files
When the harness runs
Then the path-filter comparison is skipped like every GitHub-arm check, and
     no divergence is reported for its absence
```

### Out of scope

- The `branches` and `tag-pattern` filters, and the `scheduled` and `manual`
  trigger kinds. A comparison of them, if ever wanted, is a separate ticket
  (R19).
- Trigger-set conformance beyond `paths`: whether the GitHub workflow
  declares an event, without a path filter, for which the reference declares
  no trigger of the matching kind, or the reverse. This delta compares path
  lists on the comparable events only; an event declared on one side only is
  a divergence solely when it carries `paths` there (R15).
- The wiring of the in-job filter: whether each business step of the job is
  gated by a condition that consumes the filter's output. A filter whose
  output nothing consumes passes this comparison. If that wiring is wanted as
  a guarantee, it is a separate ticket.
- The GitLab arm. It is composed from the generator's verification mode
  (parent requirement 5) and is unchanged.
- Any change to the CI reference format, including a new field, and any
  change to `scripts/build-ci.sh`. The `### Out of scope` bullet of spec 0147
  delta-01 cited above does not apply to this ticket, but this delta
  introduces no such extension.
- The comparison of the cache-key lists (`hashFiles(...)` and key-file
  lists), which keep their present treatment (R19).
- Glob-semantic equivalence: a judgement that two different spellings select
  the same files (R13).
- Deciding, in this spec, which side of an existing mismatch is right. R24
  requires the implementation change to resolve each one; which side to
  correct belongs to the plan and to the implementation review.
- The checker's language and form. The harness is the bash script
  `scripts/check-ci-parity.sh` today and may be its TypeScript port (spec
  0215 sub-spec I2, issue #1339); the requirements bind whichever form is the
  harness at the time.
- The edit of `docs/ci-reference-format.md`, which is part of the
  implementation change (R23), not of this spec-PR.

### Open questions

- None. The qualification decisions are resolved: set equality on decoded
  textual entries (R13); per-event matching for dedicated workflows and
  event-agnostic matching for in-job filters (R14); absent events carry the
  empty path set (R15); fail-closed handling of negations and of
  undeterminable filters (R16, R17); the tree passes on delivery (R24).

## MODIFIED

_None. This delta is purely additive: it leaves every parent requirement
text untouched. Parent requirement 1's "divergence between the reference and
the GitHub Actions pipeline" now also covers the trigger path filters of
portable capabilities, which R12 to R20 make explicit._

## REMOVED

_None._
