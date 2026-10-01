---
id: "0109"
slug: spec-status-invariant-on-main
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1441
version: 3.0.0
---

# 0109 — spec-status-invariant-on-main (delta-04)

Spec 0109 left one question open: which status a delta-spec carries, and
whether the invariant of Requirement 1 reaches it. This delta answers it. A
delta-spec follows the same lifecycle table as any other spec, the linter
enforces that on delta-specs as it already does on non-delta specs, and the
delta-specs that merged while recorded as `draft` are corrected.

The question was left open for want of a convention: at `860adb0` the 37
delta-specs on `main` read 30 `draft`, 5 `approved`, 2 `implemented`. Since
then, more delta-specs have merged recorded as `draft`, and the leaving-open has
cost something measurable. Measured on 2026-10-01:

| Branch, commit | Delta-specs | `draft` | `approved` | `implemented` |
|---|---|---|---|---|
| `main` at `923e5510` | 90 | 40 | 25 | 25 |
| `release/1231-ts-migration` at `5479fd9e` | 93 | 43 | 26 | 24 |

Those are 43 distinct files: the 40 on `main` are also on the release branch,
which adds three of its own. Every one has merged, so every one is a merged
spec recorded as never landed. That is the exact misinformation Requirement 1
removed for non-delta specs. The release branch shows the consequence
(issue #1441). In the spec 0243 family, nothing in `status` says which parts of the
usage-capture migration are in force there:

| File on the release branch | `status` | What has merged there |
|---|---|---|
| `specs/0243-usage-capture-hooks-typescript.md` | `approved` | spec-PR #1386; implementation PR #1391 (`feat/1326-…`) |
| `…0243….delta-01.md` | `draft` | spec-PR #1390; implemented by #1391 |
| `…0243….delta-02.md` | `draft` | spec-PR #1393; implemented by #1391 |
| `…0243….delta-03.md` | `draft` | spec-PR #1430; implemented by #1436 (`feat/1392-…`) |

The parent's lag has a second cause, and it is independent of the delta
exemption. The implementation-PR check of spec 0168 Requirement 2 reads the
number in the branch name as a **spec id** and inspects
`specs/<NNNN>-*.md`. `feat/1326-…` implements spec `0243`, so that check
inspected no file. `feat/1392-…` implements `0243.delta-03`, and it also
escaped. Both PRs merged green while the files they implemented did not record
it. Branch numbering in this repository is not uniform. Of the 98
merged PRs since 2026-09-01 whose implementation-prefixed branch carries a
four-digit number, 89 carry a ticket number (≥ 1000) and 9 carry a spec id (`feat/0209-usage-pricing`,
`feat/0239-usage-drawer-inventory`, …). A check that reads only one convention
misses the other, and a check that reads the number naively as both conflates
them. PR #1187, `feat/0209-usage-pricing`, implements spec `0209`, not
issue #209, whose delta is `0002.delta-04`. This delta therefore resolves the number
to a ticket before it matches anything (Requirement 20).

**Scope relative to issue #1441.** The issue scoped itself to the release
branch and deferred `main`. The owner widened the scope to the full convention
on both branches. This delta follows that decision. Its normative change and
the `main` corrections flow through `main`, since they are not part of
epic #1231 (`specs/0215-shell-to-typescript-migration.delta-04.md` R27, last
sentence). Only the release-side corrections of Requirement 25 target
`release/1231-ts-migration`.

The version bump is **MAJOR** (`2.1.0` → `3.0.0`). Requirements 1 and 2 are
modified so that they cover delta-specs, and the scenario exempting
delta-specs is replaced by its opposite. An implementation that conforms to
the merged requirements exempts delta-specs. Under this delta, the shipped
linter becomes non-conforming. That is a breaking normative change under
`docs/spec-format.md` → *Delta-spec convention → Versioning*.

## ADDED

**Requirements.**

1. **Requirement 17 — a delta-spec follows the lifecycle table.** A delta-spec
   SHALL carry its own `status`, governed by the table in
   `docs/spec-format.md` → *Lifecycle states*. That table applies to a
   delta-spec exactly as it applies to a non-delta spec:
   - `draft` — the delta-spec exists only on its spec branch.
   - `approved` — the delta-spec's own spec-PR has merged. That PR's squash
     commit already carries the status, recorded by the merge mechanic of
     *Recording a status transition*, with no separate transition PR.
   - `implemented` — the implementation PR for the delta-spec's
     `related-issue` has merged, and its own commit carries the status.
   - `archived` and `superseded` — as the table defines them.

   A delta-spec's status and its parent's status are independent. Neither one
   is derived from the other, and neither one constrains the other. A
   delta-spec whose `related-issue` equals its parent's reaches `implemented`
   through the same implementation PR as the parent. For a row of epic #1231,
   both triggers read with `release/1231-ts-migration` in place of `main`, per
   `specs/0215-shell-to-typescript-migration.delta-04.md` R29 and R38.
2. **Requirement 18 — the permitted path for an unmerged delta-spec.** A
   delta-spec SHALL carry `status: draft` only while it is absent from the
   base branch. That means while its spec-PR is open, or after that spec-PR
   closed without merging, in which case the file never reaches the base
   branch. This is the same discriminator Requirement 2 applies to a
   non-delta spec. No other path is permitted. A delta-spec present on a base
   branch and recorded as `draft` is a violation, whatever the reason it
   merged that way. The merge mechanic of `docs/spec-format.md` → *Recording a
   status transition* applies to a delta spec-PR unchanged:
   - the frontmatter edit to `approved` is a new commit;
   - it is made after the approval event and before
     `bash scripts/merge-spec-pr.sh`;
   - that script already resolves `spec/<NNNN>-<slug>-delta-<NN>` to the
     delta file and refuses `draft`.
3. **Requirement 19 — a delta spec-PR is checked like any spec-PR.** The
   spec-PR check that spec 0168 Requirement 1 introduced SHALL also cover
   delta-specs. A change that adds a delta-spec carrying `status: draft`
   SHALL fail, and the failure SHALL name the file. This is the CI
   counterpart of the refusal `scripts/merge-spec-pr.sh` already applies
   locally. Without it, a delta merged by a direct `gh pr merge` is caught
   only by the base branch's own build, after the merge. That is the failure
   mode delta-02 measured, which left the repository blocked for 10 h 28.
4. **Requirement 20 — the implementation-PR check resolves the branch to a
   ticket, then checks everything that ticket implements.** On a branch
   matching `(feat|fix|refactor|perf|chore)/<NNNN>-*`, the linter SHALL do the
   following.
   - It SHALL derive the ticket number `T` from `<NNNN>`:
     - when a non-delta spec with id `<NNNN>` exists in the tree under test,
       `T` is that spec's `related-issue`, because the branch is named after a
       spec id;
     - otherwise, `T` is `<NNNN>` read as an integer, because the branch is
       named after a ticket.
   - It SHALL fail on every spec and every delta-spec whose `related-issue`
     equals `T` and whose status is `draft` or `approved`, naming each one.
     A matched file recorded `implemented`, `archived` or `superseded` SHALL
     NOT fail. `archived` and `superseded` are terminal states, and the
     prohibition on status regressions forbids moving them back. Demanding
     `implemented` of them would block every later branch of that ticket
     until someone recorded a false status.

   This set contains the file spec 0168 Requirement 2 already checks, the spec
   whose id is `<NNNN>`, so that requirement stays satisfied and is widened,
   not replaced. The derivation reads only the tree under test and needs no
   forge access, as Requirement 3 obliges. Delta-specs are spec 0168's "own
   convention", deferred in that spec's *Out of scope*. This requirement and
   Requirement 19 are that convention.
5. **Requirement 21 — a sync of `main` into a release branch is not an
   implementation PR.** A branch whose name matches
   `chore/<NNNN>-sync-main*` SHALL NOT trigger the check of Requirement 20.
   That is the form `specs/0215-shell-to-typescript-migration.delta-04.md`
   R31 prescribes for its sync PRs, and every one measured uses it: `chore/1231-sync-main-20261001` (#1425,
   #1434), `chore/1231-sync-main-into-release` (#1399) and
   `chore/1231-sync-main-into-release-2` (#1411). Their number names the epic,
   and the epic's own specs (`0215`, `0215.delta-01`, `0215.delta-04`, all
   `related-issue: 1231`) are legitimately not `implemented` until the final
   merge of R37. Without this exclusion, Requirement 20 would fail every sync
   PR. The exclusion applies to that one name form, not to a branch, a base
   ref or an epic. Another prefix carrying the same infix, such as
   `feat/1500-sync-main-cleanup`, is an ordinary implementation branch and is
   checked. Every other check of this spec runs on a sync PR unchanged.
6. **Requirement 22 — the null cases of the implementation-PR check.** The
   check has three null cases, each with a fixed outcome:
   - **The branch name does not match the implementation form**, including a
     branch that cannot be resolved: the check does not run. This is
     unchanged. It covers spec branches, the base branch's own build and a
     release branch's final-merge head.
   - **The branch matches, but no file in the tree under test has
     `related-issue` equal to `T`:** the linter SHALL print a non-blocking
     notice on stderr. The notice names `T` and states that no spec or
     delta-spec was checked for `status: implemented`. The exit status is
     unaffected. A `trivial` ticket has no spec by design (ADR-0010 →
     *Complexity tiers*), so failing it would be wrong. Staying silent would
     let a missing spec look identical to a checked one.
   - **A matched file carries `status: draft`:** it fails under Requirement
     20, as an `approved` one does. Requirements 2 and 19 may name it as
     well.
7. **Requirement 23 — how to determine the status of a merged delta-spec.**
   The status a merged delta-spec `D` truly carries on a branch `B` SHALL be
   determined from evidence, by the rule below. The rule SHALL never record
   more than the evidence shows.
   - **Evidence is reachability, not base ref.** Whether a PR counts for
     `B` is decided by the commit graph of `B`, never by the PR's base ref.
     A release branch holds `main`'s history through its fork point and
     through every sync merge of R31. An implementation that merged into
     `main` is therefore an implementation present on the release branch,
     even though its PR never targeted that branch. The sources are:
     - the forge's merged-PR record, for every base:
       `gh pr list --state merged --json number,headRefName,mergeCommit,closingIssuesReferences`;
     - the commit `C_D` that introduced `D`:
       `git log --diff-filter=A --format=%H -1 <B> -- <D>`. That is the
       squash commit of `D`'s own spec-PR. Because history is followed
       through merges, it is the same commit on every branch that contains
       `D`, however `D` arrived there.
   - **Implementation PR for `N` on `B`** (`N` = `D`'s `related-issue`). This
     is a merged PR that meets four conditions:
     - its merge commit `M` is reachable from `B`'s head
       (`git merge-base --is-ancestor <M> <B>`), whatever the PR's base;
     - its head branch is not a `spec/` branch;
     - its head branch is not a sync branch under Requirement 21;
     - either `N` appears in its `closingIssuesReferences`, or its head branch
       resolves to `T = N` under Requirement 20.

     The closing-reference arm covers older branches that the
     implementation-PR form does not match (`docs/0026-…`, unpadded
     `fix/193-…`). GitHub populates that arm only for PRs into the default
     branch: it is empty for #1391 and #1436, measured. So for a PR into the
     release branch, the branch-name arm is the only arm.
   - **Rule:**
     - `implemented` — some implementation PR for `N` on `B` has a merge
       commit `M` that descends from `C_D` (`git merge-base --is-ancestor
       <C_D> <M>`), meaning the implementation merged with `D` already in
       its history;
     - otherwise, `archived` — issue `N` is closed as not planned or as a
       duplicate;
     - otherwise, `approved` — `D`'s presence on `B` proves its spec-PR
       merged.
   - **Ambiguity resolves to `approved`.** Two cases are ambiguous:
     - no implementation PR for `N` on `B` descends from `C_D`, but at least
       one exists. That PR merged before `D`, or on a line of history
       parallel to it, so `D` is an amendment that no merged implementation
       is known to carry;
     - issue `N` is closed as completed, but no implementation PR for `N` on
       `B` is found.

     In both cases `D` SHALL be recorded `approved`, and the correction PR
     body SHALL name it with the reason. `approved` is true of every merged
     delta-spec. `implemented` is a stronger claim, and this rule never makes
     it without evidence.
   - **The `implemented` / `approved` choice depends only on the commit
     graph, so it agrees across branches and never regresses.** That choice
     reads only `C_D`, the merge commits reachable from `B`, and the forge's
     PR record, which is the same for every branch. Two consequences follow:
     - two branches whose heads reach the same implementation commits for
       `N` give `D` the same choice;
     - a merge only adds reachable commits, so a file that either parent
       gives `implemented` is also `implemented` on the merge result.

     The issue-state arms are not graph functions: the `archived` arm, and
     the closed-as-completed ambiguity arm. An issue can be reopened, which
     would turn `archived` back into `approved`. These arms are therefore
     evaluated once, at correction time (Requirements 24 and 25). That is
     consistent with the parent spec's out-of-scope rule that a correction
     records the state at correction time, not a timeline. A later change
     of issue state does not reopen a recorded status.
   - **A reachable implementation beats `archived`.** `archived` means
     "closed without implementation", so when an implementation PR for `N`
     on `B` descends from `C_D`, the rule gives `implemented`, whatever the
     state of issue `N`. The rule's order already says so, since the
     `implemented` arm is evaluated first.
   - **Conflict resolution.** When a sync of R31, or the final merge of R37,
     meets a conflict on a `status` line, the conflict SHALL resolve as
     follows:
     - between `approved` and `implemented`, to `implemented`. That is the
       graph-determined choice on the merge result, and never a regression;
     - when one side is `archived`, to `implemented` if the merge result
       reaches an implementation PR for `N` that descends from `C_D`, per
       the precedence above; otherwise, to `archived`, the value recorded at
       correction time;
     - any other pair, including one involving `superseded`, is outside this
       rule. It SHALL be resolved by hand, and named in the merging PR's
       body, without regressing either side.
   - **Measured.** Applied at `main` @ `923e5510` and at release @
     `5479fd9e`, the rule gives the 40 files of Appendix A the same status
     on both branches, with the same evidence PRs. Applied on the release
     branch, `0001-spec-format-self.delta-01.md` is `implemented` through
     #197, whose base is `main`. The 0243 family is `implemented` on the
     release branch only, because #1391 and #1436 are not reachable from
     `main`.
8. **Requirement 24 — corrections on `main`.** Every delta-spec on `main` that
   carries `status: draft` when this delta is implemented SHALL be corrected
   to the status Requirement 23 determines on `main`. The set is derived at
   implementation time, per Requirement 3. Appendix A is the measurement at
   `923e5510`: it is a check of the rule, not its input. A file that has
   merged since then is in scope, and a file corrected since then is not.
   Each correction is metadata-only, in the sense of Requirement 5 as
   replaced by delta-01. These corrections, the linter changes of
   Requirements 2, 19, 20, 21 and 22, and the documentation of Requirement 28
   SHALL land in a single change, for the reason Requirement 6 gives.
9. **Requirement 25 — corrections on the release branch.** On
   `release/1231-ts-migration`, a spec or delta-spec SHALL be corrected,
   metadata-only, in a PR that targets that branch, when two conditions
   hold: the status it records there is below the one Requirement 23
   determines there, and that determination depends on a commit not
   reachable from `main`. Those are files that are present only on the
   release branch, or that are implemented only by a release-branch
   merge. At `5479fd9e`, the set is the 0243 family of Appendix B:
   - `specs/0243-usage-capture-hooks-typescript.md`: `approved` →
     `implemented`;
   - its `delta-01`, `delta-02` and `delta-03`: `draft` → `implemented`.

   The set is re-derived when that PR is opened. Every other file is
   corrected on `main` under Requirement 24 and reaches the release branch
   through the next sync. Because Requirement 23 gives it the same status on
   both branches, the sync carries the release branch's correct value. No
   file is corrected on both branches, so the sync meets no conflict on any
   of them.
10. **Requirement 26 — ordering across the two branches.** The release branch
    SHALL already be correct when the linter change reaches it. It SHALL
    never be exempted to make up for not being correct. Concretely:
    - the release-side PR of Requirement 25 SHALL merge before the `main`
      change of Requirement 24 merges, so that the first sync to carry the
      linter finds the release-only files already correct;
    - a residual can remain: a release-only spec or delta-spec that merged
      recorded as `draft` after that PR. The first sync PR that carries the
      linter change SHALL then carry that residual's correction, determined
      by Requirement 23 on the sync's merge result, and SHALL NOT merge until
      the new linter passes on its head;
    - after the final merge of R37, `main` reaches every commit both
      branches reached. Any conflict on a `status` line in that merge is
      resolved by Requirement 23's *Conflict resolution* clause, so no file
      regresses on `main`;
    - after that first sync, Requirements 2 and 19 apply on the release branch
      as on `main`, so no further residual can arise unseen.
11. **Requirement 27 — the extension is covered.** The spec linter's test
    suite SHALL cover each behaviour below with at least one case. Each case
    SHALL fail when the behaviour it covers is removed. The behaviours are:
    - a delta-spec on the base branch carrying `draft` fails a change that
      modifies it, fails a run with no change, and only warns a bystander;
    - a change adding a delta-spec carrying `draft` fails;
    - a ticket-numbered implementation branch fails on a non-`implemented`
      delta-spec whose `related-issue` matches;
    - a spec-id-numbered branch resolves to its spec's `related-issue`;
    - a sync branch `chore/<NNNN>-sync-main*` is not checked, and the same
      infix under another prefix is;
    - a matched `archived` or `superseded` file does not fail, while a
      matched `approved` one does;
    - a ticket-numbered implementation branch that matches no file prints the
      notice and exits zero.

    This extends Requirements 8 and 13.
12. **Requirement 28 — the convention is documented.** `docs/spec-format.md`
    SHALL make the following changes:
    - state Requirement 17 under *Lifecycle states*;
    - remove the delta-spec exemption from *No spec on `main` is a draft*,
      and from its list of enforced checks;
    - describe the implementation-PR check as Requirement 20 defines it,
      including the ticket resolution, the sync exclusion of Requirement 21
      and the notice of Requirement 22;
    - cite this delta as the contract.

    This extends Requirements 7 and 12.

**Scenarios.**

*Scenario:* a merged delta-spec recorded as draft fails the change that
touches it

```text
Given a delta-spec present on the base branch carrying status: draft
And   a change under test that modifies that delta-spec
When  the spec linter runs
Then  it reports a violation naming that file and exits non-zero
```

*Scenario:* a bystander is warned, and the base branch's own build fails

```text
Given a delta-spec present on the base branch carrying status: draft
When  the spec linter runs on a change that does not modify it
Then  it names that file as a non-blocking finding and exits zero
When  the spec linter runs on a tree with no change relative to the base ref
Then  it reports a violation naming that file and exits non-zero
```

*Scenario:* a delta spec-PR still recorded as draft is rejected

```text
Given a change that adds specs/0243-usage-capture-hooks-typescript.delta-03.md
      carrying status: draft, absent from the base branch
When  the spec linter runs
Then  it reports a failure naming that file
And   recording status: approved makes the same change pass
```

*Scenario:* an implementation branch named after its ticket checks the
delta-spec it implements

```text
Given an implementation branch feat/1392-agy-guarded-cmd-form
And   no non-delta spec with id 1392
And   specs/0243-usage-capture-hooks-typescript.delta-03.md with
      related-issue: 1392 carrying status: draft
When  the spec linter runs
Then  it reports a failure naming that delta-spec and exits non-zero
And   recording status: implemented makes the same change pass
```

*Scenario:* an implementation branch named after its ticket checks a parent
whose id differs from the ticket

```text
Given an implementation branch feat/1326-usage-capture-hooks-typescript
And   specs/0243-usage-capture-hooks-typescript.md, delta-01 and delta-02,
      each with related-issue: 1326 and status: approved or draft
When  the spec linter runs
Then  it reports a failure naming all three files
```

*Scenario:* an implementation branch named after a spec id resolves to that
spec's ticket

```text
Given an implementation branch feat/0209-usage-pricing
And   a non-delta spec 0209 whose related-issue is not 209
And   specs/0002-spec-author-skill.delta-04.md with related-issue: 209
When  the spec linter runs
Then  it checks spec 0209 and every file whose related-issue equals spec
      0209's related-issue
And   it does not check specs/0002-spec-author-skill.delta-04.md
```

*Scenario:* a sync of main into the release branch is not an implementation PR

```text
Given a branch chore/1231-sync-main-20261001
And   specs whose related-issue is 1231 carrying status: approved
When  the spec linter runs
Then  it reports no implementation-PR status violation
And   every other check runs unchanged
```

*Scenario:* an implementation branch with no matching spec is noticed, not
failed

```text
Given an implementation branch fix/1500-typo
And   no spec or delta-spec whose related-issue is 1500
When  the spec linter runs
Then  it prints a notice naming 1500 and stating that nothing was checked
And   it exits zero
```

*Scenario:* an amendment that post-dates its ticket's implementation is not
claimed implemented

```text
Given specs/0013-layer-taxonomy-boundary-contract.delta-03.md on main,
      related-issue: 227, first present on main after PR #234 merged
And   no other implementation PR for 227
When  its status is determined per Requirement 23
Then  it is recorded approved, and the correction PR names it as ambiguous
```

*Scenario:* the release branch is correct before the linter reaches it

```text
Given the release-side correction PR of Requirement 25 has merged
And   a release-only delta-spec merged afterwards carrying status: draft
When  the first sync PR carrying the linter change is opened
Then  it carries that delta-spec's correction
And   it does not merge until the new linter passes on its head
```

*Scenario:* an implementation that merged into main counts on the release
branch

```text
Given specs/0001-spec-format-self.delta-01.md on main and on the release branch
And   its implementation PR #197 merged into main, after the delta was
      introduced
And   the release branch reaches #197's merge commit through its fork point
When  its status is determined per Requirement 23 on each branch
Then  it is implemented on both, through #197
```

*Scenario:* no status regresses across the final merge

```text
Given a delta-spec determined implemented on main per Requirement 23
And   the release branch, which reaches the same implementation commit,
      also records it implemented
And   the 0243 family recorded implemented on the release branch only
When  the final merge of R37 brings the release branch into main
Then  every file recorded implemented on either branch reads implemented
      on main
And   any conflict on a status line is resolved by Requirement 23's
      Conflict resolution clause, with no regression
```

*Scenario:* a terminal status sharing the ticket does not block

```text
Given an implementation branch feat/1500-follow-up
And   a delta-spec with related-issue: 1500 carrying status: archived
And   a spec with related-issue: 1500 carrying status: implemented
When  the spec linter runs
Then  it reports no implementation-PR status violation
```

*Scenario:* the sync exclusion is limited to the chore form

```text
Given a branch feat/1500-sync-main-cleanup
And   a spec with related-issue: 1500 carrying status: approved
When  the spec linter runs
Then  it reports a failure naming that spec
```

**Out of scope,** extending the parent spec's list:

- **Delta-specs and non-delta specs recorded `approved` whose implementation
  has merged.** The 0243 parent on the release branch is the one in scope,
  because it is part of #1441's measured case. On `main`, files such as
  `specs/0033-curator-empty-suggestion-tolerance.md` still read `approved`.
  This is incomplete but not false, which is why this spec's invariant is
  about `draft`. Raising them is another ticket's job. Requirement 20 raises
  them one at a time, as their tickets' branches next run the check.
- **The collision a ticket-numbered branch would meet if a spec id ever
  equalled its number.** At authoring time, the highest spec id is `0245`,
  and every ticket-numbered branch since 2026-09-01 carries a number of 1000
  or more. A spec id that equals a live ticket number is therefore years
  away, at current rates. Requirement 20 resolves such a branch as a spec-id
  branch, and the fix belongs in a branch-naming convention, not in this
  check.
- **Implementation PRs on prefixes outside `(feat|fix|refactor|perf|chore)`**,
  such as `docs/0026-…`. The check of Requirement 20 keeps spec 0168's prefix
  set. Requirement 23 still counts such a PR as implementation evidence,
  through its closing reference.
- **A ticket implemented across several PRs.** As with spec 0168 Requirement
  2, the first PR that runs the check records `implemented`. Whether that is
  premature is a decomposition question, not a status-check question.
- **Statuses of epic #1231's own specs.** `0215`, `0215.delta-01` and
  `0215.delta-04` reach `implemented` only through R37's final merge.
  Requirement 23 records them `approved` until then.

### Appendix A — `main` at `923e5510`: the 40 delta-specs recorded as `draft`

The determination is Requirement 23's, made on 2026-10-01. 31 files
determine to `implemented` and 9 to `approved`. The determination is
identical when the rule is applied on the release branch.

| File (`specs/…`) | `related-issue` | Determined | Evidence |
|---|---|---|---|
| `0001-spec-format-self.delta-01.md` | 195 | `implemented` | #197 |
| `0002-spec-author-skill.delta-01.md` | 198 | `approved` | no implementation PR found |
| `0002-spec-author-skill.delta-02.md` | 193 | `implemented` | #205 |
| `0002-spec-author-skill.delta-03.md` | 194 | `implemented` | #207 |
| `0002-spec-author-skill.delta-04.md` | 209 | `implemented` | #213 (not #1187, see Requirement 20) |
| `0005-retroactive-routing-engine.delta-01.md` | 288 | `implemented` | #291 |
| `0005-retroactive-routing-engine.delta-02.md` | 885 | `implemented` | #962 |
| `0006-interaction-modes-and-sizing.delta-01.md` | 288 | `implemented` | #291 |
| `0007-build-install-spec-author.delta-01.md` | 174 | `implemented` | #190 |
| `0012-core-framework-separation.delta-01.md` | 224 | `approved` | no implementation PR found |
| `0012-core-framework-separation.delta-02.md` | 224 | `approved` | no implementation PR found |
| `0012-core-framework-separation.delta-03.md` | 224 | `approved` | no implementation PR found |
| `0012-core-framework-separation.delta-04.md` | 224 | `approved` | no implementation PR found |
| `0013-layer-taxonomy-boundary-contract.delta-01.md` | 227 | `implemented` | #234 |
| `0013-layer-taxonomy-boundary-contract.delta-02.md` | 227 | `implemented` | #234 |
| `0013-layer-taxonomy-boundary-contract.delta-03.md` | 227 | `approved` | #234 precedes the delta |
| `0013-layer-taxonomy-boundary-contract.delta-04.md` | 227 | `approved` | #234 precedes the delta |
| `0017-adoption-guide.delta-01.md` | 231 | `implemented` | #254 |
| `0018-assembly-verification.delta-01.md` | 232 | `implemented` | #257 |
| `0026-reconcile-rule4-modes.delta-01.md` | 281 | `implemented` | #287 |
| `0026-reconcile-rule4-modes.delta-02.md` | 281 | `implemented` | #287 |
| `0061-antigravity-gemini-md-concat.delta-01.md` | 478 | `implemented` | #480 |
| `0066-idea-convergence-stage.delta-01.md` | 1262 | `implemented` | #1297 |
| `0069-mempalace-wakeup-parity.delta-01.md` | 415 | `implemented` | #514, #515 |
| `0080-configurable-validation-backend.delta-01.md` | 557 | `implemented` | #560 |
| `0082-mempalace-3-6-support.delta-01.md` | 566 | `implemented` | #572 |
| `0082-mempalace-3-6-support.delta-02.md` | 566 | `implemented` | #572 |
| `0088-http-wrapper-pool-bound.delta-01.md` | 588 | `implemented` | #614 |
| `0101-spec-pr-inline-approval.delta-01.md` | 662 | `implemented` | #687 |
| `0102-solo-merge-classifier-workaround.delta-01.md` | 636 | `implemented` | #667 |
| `0103-mempalace-write-lock-fallback.delta-01.md` | 637 | `implemented` | #669 |
| `0105-forge-agnostic-curator-apply.delta-01.md` | 671 | `implemented` | #686 |
| `0105-forge-agnostic-curator-apply.delta-02.md` | 1273 | `implemented` | #1303 |
| `0112-spec-id-reservation.delta-01.md` | 726 | `implemented` | #734 |
| `0112-spec-id-reservation.delta-02.md` | 1265 | `implemented` | #1308 |
| `0215-shell-to-typescript-migration.delta-01.md` | 1231 | `approved` | epic open; R37 |
| `0215-shell-to-typescript-migration.delta-02.md` | 1324 | `implemented` | #1380 |
| `0215-shell-to-typescript-migration.delta-03.md` | 1324 | `implemented` | #1380 |
| `0215-shell-to-typescript-migration.delta-04.md` | 1231 | `approved` | epic open; R37 |
| `0240-runtime-foundations-shared-ts-modules.delta-01.md` | 1324 | `implemented` | #1380 |

### Appendix B — `release/1231-ts-migration` at `5479fd9e`: release-only files

| File (`specs/…`) | `related-issue` | Recorded | Determined | Evidence |
|---|---|---|---|---|
| `0243-usage-capture-hooks-typescript.md` | 1326 | `approved` | `implemented` | #1391 (`feat/1326-…`), after #1386 |
| `0243-usage-capture-hooks-typescript.delta-01.md` | 1326 | `draft` | `implemented` | #1391, after #1390 |
| `0243-usage-capture-hooks-typescript.delta-02.md` | 1326 | `draft` | `implemented` | #1391, after #1393 |
| `0243-usage-capture-hooks-typescript.delta-03.md` | 1392 | `draft` | `implemented` | #1436 (`feat/1392-…`), after #1430 |

The 40 files of Appendix A are also present on the release branch, recorded as
`draft`. They are corrected on `main` under Requirement 24 and reach the
release branch through the sync, which Requirement 23 shows carries the
correct value there.

## MODIFIED

1. **Requirement 1 is replaced** so that the invariant covers delta-specs.

   - Original R1:

     > **R1.** No spec file present on `main` other than a delta-spec SHALL
     > carry `status: draft`. A spec reaches `main` only by its own merged
     > pull request, which is the trigger `docs/spec-format.md` assigns to
     > `approved`, so `draft` on `main` is a contradiction rather than a
     > lagging value.

   - Replacement R1:

     > **R1.** No spec file present on `main`, delta-specs included, SHALL
     > carry `status: draft`. A spec or delta-spec reaches `main` only by its
     > own merged pull request, which is the trigger `docs/spec-format.md`
     > assigns to `approved`, so `draft` on `main` is a contradiction rather
     > than a lagging value. For a row of epic #1231, the invariant holds on
     > `release/1231-ts-migration` in the same terms
     > (`specs/0215-shell-to-typescript-migration.delta-04.md` R29, R38).

2. **Requirement 2, as replaced by delta-02, is replaced** so that it
   identifies delta-specs. Its attribution semantics are unchanged:
   Requirements 9 to 11 apply to a delta-spec offender exactly as to a
   non-delta one.

   - Original R2 (delta-02):

     > **R2.** The spec linter SHALL identify every non-delta spec that is
     > present on the base branch of the change under test and carries
     > `status: draft`, and SHALL name every such file. Presence on the base
     > branch is the discriminator for *identifying* an offender: a spec being
     > introduced by the change under test is legitimately `draft` up until the
     > frontmatter edit its own merge mechanic prescribes, and SHALL NOT be
     > identified. Whether an identified offender **fails** the run is decided by
     > whether the change under test modifies that file: it SHALL fail when the
     > change modifies it, and SHALL be reported per Requirement 9 or Requirement
     > 10 when it does not.

   - Replacement R2:

     > **R2.** The spec linter SHALL identify every spec and every delta-spec
     > that is present on the base branch of the change under test and carries
     > `status: draft`, and SHALL name every such file. Presence on the base
     > branch is the discriminator for *identifying* an offender: a spec or
     > delta-spec being introduced by the change under test is legitimately
     > `draft` up until the frontmatter edit its own merge mechanic
     > prescribes, and SHALL NOT be identified. Whether an identified offender
     > **fails** the run is decided by whether the change under test modifies
     > that file: it SHALL fail when the change modifies it, and SHALL be
     > reported per Requirement 9 or Requirement 10 when it does not.

3. **The scenario "a delta-spec carrying draft is not rejected" is replaced**
   by its opposite.

   - Original scenario:

     ```text
     Given a delta-spec present on the base branch carrying status: draft
     When  the spec linter runs
     Then  it reports no violation for that file
     ```

   - Replacement scenario:

     ```text
     Given a delta-spec present on the base branch carrying status: draft
     And   the change under test modifies that delta-spec
     When  the spec linter runs
     Then  it reports a violation naming that file and exits non-zero
     ```

Requirements 3 to 8 of spec 0109 remain in force, as do Requirement 5 as
replaced by delta-01, Requirements 9 to 13 of delta-02 and Requirements 14 to
16 of delta-03. Requirement 4 keeps its own scope, the non-delta corrections
at `860adb0`. Requirement 24 is the delta-spec counterpart and does not
reopen it. Spec 0168's requirements remain in force: Requirements 19 and 20
widen what its Requirements 1 and 2 inspect, without changing their outcome
for any file they already inspected.

## REMOVED

1. **The out-of-scope item on delta-spec status is removed**, because this
   delta settles it. Requirement 17 states the convention, Requirements 1, 2,
   19 and 20 enforce it, and Requirements 23 to 26 correct the corpus.

   - Original item:

     > **What status a delta-spec should carry, and whether the invariant of
     > requirement 1 should extend to delta-specs.** Deliberately unresolved
     > rather than decided here. The corpus does not support a convention:
     > measured on `main` at `860adb0`, the 37 delta-specs are **30 `draft`, 5
     > `approved`, 2 `implemented`**. […] Requirement 2 therefore exempts
     > delta-specs so this spec does not codify a guess, and the question is
     > left for its own ticket with the measurement above as its starting
     > evidence.

   The two arguments that item weighed are settled as follows. A delta
   amends its parent, but it has its own spec-PR, its own `related-issue` and
   often its own implementation PR. So it does have a lifecycle of its own,
   and #1441 shows that readers depend on it. A merged delta recorded as
   `draft` misinforms a reader exactly as a merged parent does, which was the
   argument that item left unanswered.
