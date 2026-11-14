---
id: "0309"
slug: split-ci-capabilities-filter-coverage
status: draft
complexity: standard
interaction-mode: AUTO
related-issue: 2012
version: 2.0.0
---

# Split the CI capability reference and check filter coverage

## ADDED

Delta-02 builds on delta-01 (merged at c8010740) and follows the owner decision logged on #2012 (`https://github.com/crewrig/crewrig/issues/2012#issuecomment-6885492532`), taken after plan v2 was rejected (`https://github.com/crewrig/crewrig/issues/2012#issuecomment-6885463383`) because the static filter-coverage check flagged 862 of 873 tests and would have needed about 1,000 declarations. It replaces that check with an unfiltered run on the protected branches. The version is MAJOR because it removes requirements (R6 as approved and as amended by delta-01, R8, R14); no implementation of them is in flight, since R11 holds the implementation branch back. R1 to R5, R9 to R11 and R13 stay as approved or as amended by delta-01, except for the edits that the removal forces and that MODIFIED lists.

**R6 (every capability runs unfiltered on a push to a protected branch).** On every push to `main` and to a `release/**` branch (the branches of today's `push` triggers), every capability that has a `push` trigger naming that branch SHALL run with no path filter, on both engines, whatever files the push changed. On GitHub: the `push` trigger of `build.yml` lists `main` and `release/**` and carries no `paths:` and no `paths-ignore:`, and the runtime path gate decides to run every such capability for a push to those branches, including when the diff would match no pattern (the existing fail-open on an uncomputable diff is unchanged). On GitLab: a branch pipeline is created for a push to the default branch (`main`) and to the release branches, and in it every job of the generated output that belongs to such a capability is matched by a rule that has no `changes:` clause and whose `when` is not `never`. Pull requests and merge requests are not changed: their per-event path filters and the gate's pull-request decision stay as R3, R12(e) and the parity guard define them, no filter is added, removed or widened for them, and events other than a push to those branches (tags, schedules, manual runs, merge requests) behave as before. The reference SHALL be able to express an unfiltered `push` trigger beside a filtered `pull-request` trigger of the same capability, and the generator, the runtime gate and the parity guard SHALL read the same meaning from it (the inheritance of a capability-level `paths:` by a trigger with none, 0283 R3, must therefore not hand a filter to such a push trigger); the form, for example moving the capability-level `paths:` to the pull-request trigger or an explicit unfiltered marker, is the PLAN's choice and SHALL be documented in `docs/ci-reference-format.md`. A capability with no `push` trigger on those branches (pull-request-only, scheduled, tag- or release-only, engine-specific) is not forced to run; it SHALL be listed with a non-empty reason in a committed exemption list (suggested `ci/push-main-exemptions.txt`) and printed by the test below. The trade-off is accepted: a filter gap of the #2009 class is detected minutes after the merge, as a red run of `main`, instead of before it; detecting such a gap before the merge is out of scope.

**R6 wiring test (decidable, fail closed).** A test SHALL assert R6 offline from committed files only, with no CI run, through the shared reader of R3, the existing gate decision function and a closed evaluator of the GitLab rule conditions. It SHALL fail naming the capability or job and the engine in each of these cases: (a) in the reference, the effective `push` path set on `main` of a capability that has such a trigger is not empty; (b) on GitHub, the `push` trigger of `build.yml` lacks `main` or `release/**`, or carries `paths:` or `paths-ignore:`, or the gate decision for a push to `main` with a change set that no filter pattern of the reference matches (a synthetic file name chosen so that none matches) is not run, for any capability of (a)'s set; or a job that runs such a capability carries a job-level `if:` that can skip it on a push and is not in the exemption list; (c) on GitLab, the workflow rules do not create a pipeline for a push to `main` and to a `release/` branch with no open merge request, or the first rule of a job that is true in that context carries `changes:` or `exists:` or `when: never`; a job with no rules passes; (d) a rule condition, `extends` or include that the evaluator cannot resolve fails closed, naming the job, never passes; (e) a capability with neither an unfiltered `push` trigger on `main` nor an entry in the exemption list, an entry for a capability that does not exist, and an entry for a capability that has an unfiltered `push` trigger (stale); (f) the control for (b) and (c): for every capability with a `pull-request` path filter, a pull-request event with that same synthetic change set is not run on GitHub, and the GitLab merge-request rules still carry `changes:`, so removing the filters from pull requests also fails. The test SHALL be wired per R12 and its own path filter SHALL cover the files it reads (the reference, the workflow files, `.gitlab-ci.yml`, the gate and the rule evaluator and their libraries). Acceptance: the test passes on the real tree after the change; a fixture for each of (a) to (f) fails with the named message, and the fixed fixture passes.

**R8 (moved to #1933).** The per-pull-request-kind report of the approved spec, with its kind definitions and shared computation, is no longer part of this spec and SHALL be specified and delivered under ticket #1933, which owns it.

**Scenario:** A push to main runs every job whatever it changed (R6)

Given a push to `main` whose only changed file is under `docs/` and matches the path filter of no capability
When the wiring test evaluates the gate decision on GitHub and the rules on GitLab
Then every capability with a `push` trigger on `main` is run on both engines, and the test passes.

**Scenario:** Pull requests are still filtered (R6)

Given the same change set as a pull request or merge request
When the wiring test runs its control
Then every capability with a pull-request path filter is not run on GitHub and the GitLab merge-request rules still carry `changes:`; a tree in which those filters were removed fails the test.

**Scenario:** A push trigger keeps a path filter (R6)

Given a fixture reference in which a capability has a `paths:` list on its `push` trigger, or a generated GitLab rule for a push to `main` carries `changes:`
When the wiring test runs
Then it fails naming the capability or job and the engine, and with the filter removed the fixture passes.

**Scenario:** A rule the evaluator cannot decide fails closed (R6)

Given a generated GitLab rule whose condition uses a variable or operator the evaluator does not know
When the wiring test runs
Then it fails naming the job and does not treat the rule as passing.

**Scenario:** A capability escapes through a missing push trigger (R6)

Given a capability with no `push` trigger on `main` and no entry in the exemption list, or an entry for a capability that has gained an unfiltered push trigger
When the wiring test runs
Then it fails naming the capability, the first as unlisted and the second as stale.

**Scenario:** The state of #2009 is run on main (R7)

Given a fixture reference where the job that runs `skill-size-budgets.test.ts` has a push path filter that does not cover `SKILL.md`
When the wiring test runs
Then it fails naming that job, and with the push filter removed the same fixture passes; on the real tree the job that runs the test resolves by name, runs on a push to `main` on both engines, and a tree where no job runs the test fails.

**Scenario:** The supersession of the push filter is discoverable (R1)

Given the implementation has merged and a reader holds the effective view of spec 0283
When the reader searches the repository for the rule that a push is filtered like a pull request
Then the header of the rewritten push-trigger test and the ADR-0021 amendment cite `specs/0309-split-ci-capabilities-filter-coverage.delta-02.md` and the superseded clauses, and spec 0283 is unchanged.

## MODIFIED

**Intent, two clauses.** Original: "and a test can no longer sit in a job whose path filter never fires for the files that test reads. The CI capability reference is kept as one file per group, hand-authored CI files stay under a per-file size limit in place of a repository-wide line total, a fail-closed check proves that every test is run by at least one job whose path filter covers the test's inputs, and a report shows which jobs each kind of pull request triggers."

Replacement: "and a filter gap, a test that sits in a job whose path filter never fires for the files that test reads, no longer goes unnoticed on the protected branches. The CI capability reference is kept as one file per group, hand-authored CI files stay under a per-file size limit in place of a repository-wide line total, and every capability runs without path filters on a push to `main` and to a release branch, on both engines, as a wiring test proves. The trade-off is stated plainly: a filter gap of the #2009 class is detected minutes after the merge, as a red run of `main`, instead of before it, because per-pull-request path filters stay as they are; detecting a gap before the merge, by a static analysis of what each test reads, was measured on the tree and rejected as disproportionate (862 of 873 tests flagged, about 1,000 declarations), and is out of scope. Every push to a protected branch then costs a full run, a cost the owner accepts."

**R1, item list.** Original: "(c) 0287 R13, the line ratchet over `build.yml`, every `_ci-*.yml`, `ci/ci-capabilities.yml` and `.gitlab-ci.yml`, the floor of 8,880, the pin rules, and the hard cap of 9,100, in the form amended by delta-01 of 0287 (the re-measure clause)."

Replacement: the same item (c), followed by "(d) 0283 R6, the clause that the gate's semantics for a `push` equal the filter of that event, and 0283 R3, the inheritance of a capability-level `paths:` by a `push` trigger with none, in both cases only for a push to `main` or a `release/**` branch (every other event and the pull-request semantics of those clauses stay in force), and the invariant of `scripts/tests/ci-paths-push-trigger.test.ts` that the `pull-request` and `push` path sets of every job are identical, which the implementation rewrites to the reverse for those branches." The sentence "the header of the replacement test (R5) and the ADR amendment (R9) each cite" gains the header of the rewritten push-trigger test, and each cites this delta and the superseded clauses of (d) as well. Specs 0283, 0285 and 0287 and their deltas are not edited.

**R4, symmetry sentence.** Original: "The per-file limit (R5) and the filter-coverage check (R6) SHALL apply to the GitHub and the GitLab engine alike; no check is added or relaxed for one engine only".

Replacement: "The per-file limit (R5) and the wiring test (R6) SHALL apply to the GitHub and the GitLab engine alike; no check is added or relaxed for one engine only".

**R6, replaced.** Original (first sentence; the rest of R6, through its Acceptance, is replaced, as is its version in delta-01): "A check SHALL fail unless every test file under `scripts/tests/` is run by at least one job whose path filter covers the inputs that test reads."

Replacement: R6 and its wiring test as in ADDED. The orphan check of `scripts/check-test-wiring.ts` (spec 0076) stays as it is and is the only check that every test is run by some job.

**R7, replaced.** Original: "The implementation SHALL include a regression test, run in CI, that reproduces the state of pull request #2009: a job that runs `scripts/tests/skill-size-budgets.test.ts` and whose path filter does not cover the skill sources that test reads (`SKILL.md` files under the skill directories), so that a change touching only a `SKILL.md` triggers no job that runs the test. The check of R6 SHALL fail on that fixture, naming `skill-size-budgets.test.ts` and an uncovered `SKILL.md` input."

Replacement: "The implementation SHALL include a regression test, run in CI, for the state of pull request #2009: the job that runs `scripts/tests/skill-size-budgets.test.ts` is run on a push to `main` on both engines regardless of its path filter, asserted by the wiring test of R6, on a fixture where its push filter does not cover `SKILL.md` (fails, naming the job and the engine), on the fixed fixture (passes), and on the real tree, where the job that runs the test is found by the `ci:<id>` command that names it and a tree with no such job fails. The regression is the run on `main`, not a pre-merge detection, which is out of scope. Acceptance: the fixture is verified failing before the R6 change is enabled, and passing after."

**R9, rationale and alternatives.** Original: "the replacement of the global line cap by the per-file limit and the filter-coverage check, with the reason (lines are a poor proxy for the cost of a pull request, which is paid in triggered jobs; a generated file was counted twice; the cap forced unrelated checks into one job and widened path filters; the real risk, an unrun test, was not measured)" and "the rejected alternatives (keep one file and raise the cap; one file per capability, which multiplies files past the review benefit; a limit on the generated output; counting lines only for the reference)".

Replacement: "the replacement of the global line cap by the per-file limit and the unfiltered run on push to the protected branches, with the reason (the same, ending: the real risk, an unrun test, was not measured and is now bounded by a run of every capability on `main`)" and the rejected alternatives gain "a static filter-coverage check over what each test reads, rejected after measurement (862 of 873 tests flagged, about 1,000 declarations, a shrink-only baseline and drain pull requests)". The amendment also records the trade-off of the Intent and the rewritten push-trigger invariant of R1(d).

**R10, last clause.** Original: "and its role passes to the per-kind report of R8 and to the measurements in the ADR amendment (R9)".

Replacement: "and its role passes to the measurements in the ADR amendment (R9) and, for the per-kind view of triggered jobs, to ticket #1933 (R8)".

**R12, lead and (a), (c), (d).** Permitted changes are now (a), (b), (d), (e) as amended by delta-01, plus (f), and only these.

Original (a), as replaced by delta-01: "(a) the new jobs the spec requires, each running only the checks and tests this spec adds: one for the filter-coverage check (R6) and, as the PLAN needs, the ones for the per-file limit test, the per-kind report, the shared reader and reference-directory tests, and the self-tests of the checks; no existing job gains or loses a command or a test through them;"

Replacement (a): "(a) the new jobs the spec requires, each running only the checks and tests this spec adds: one for the wiring test of R6 and, as the PLAN needs, the ones for the per-file limit test and the shared reader and reference-directory tests; no existing job gains or loses a command or a test through them. Interaction with R6: a job added under (a) is itself a capability, so it SHALL have an unfiltered `push` trigger on `main` and `release/**` from its first commit, or an entry in the exemption list; it may keep a pull-request path filter."

Original (c): "(c) path-filter widenings and test moves that R6 requires to close a real coverage gap, each listed in the implementation pull request body with the test, the input and the job;"

Replacement: (c) is removed: R6 requires no widening or test move, and any such change is out of scope.

Original (d), as amended by delta-01: "(d) the move of capabilities between files (R2) and the regenerated GitLab output (R4), the latter equal to the pre-split output except for (e);" Unchanged. New item: "(f) the removal of the path filter from the `push` trigger on `main` and `release/**` of every capability in the reference, the workflow files and the generated output, the generated GitLab output changing only by the loss of `changes:` on the push rules and the corresponding anchors, and the rewrite of the push-trigger invariant test of R1(d); nothing else. The change SHALL land in its own pull request, separate from the pull request or requests that split the reference (R2, R12(e)), so that R13 compares outputs that differ by R12(e) and by the reordering only; its body lists every capability whose push filter was removed, with the count." The pull-request path filters, commands and required contexts stay untouched by (f).

**R12, closing paragraph.** Original: "Every new test or check (the per-file limit test, the filter-coverage check and its tests, the per-kind report test, the shared reader tests) SHALL be wired in the reference".

Replacement: "Every new test or check (the per-file limit test, the wiring test of R6 and its fixtures, the shared reader tests) SHALL be wired in the reference". The final Acceptance now reads "lists every job added or removed under (a) and (b), and every capability whose push filter was removed under (f)", and the clause "or widened under (c)" no longer applies.

**Scenario "Behaviour is unchanged by the split (R3, R4, R12)".** No change: it concerns the split change, which by R12(f) carries no push-filter removal.

**Out of scope, two bullets.** Original: "The scoping of spec-only pull requests (ticket #1933 owns it); this spec supplies only the shared report that #1933 reads (R8)." Replacement: "The scoping of spec-only pull requests and the per-pull-request-kind report (ticket #1933 owns both, R8)." Original (last bullet fragment): "the declaration form for undeterminable test inputs and the include-split decision". Replacement: "and the include-split decision, and the form of an unfiltered `push` trigger in the reference (R6)". New bullets: "Detecting a path-filter gap before the merge, by any static or dynamic analysis of what a test reads; changing any pull-request or merge-request path filter; running anything on a push other than to `main` and `release/**`."

## REMOVED

- R6 as approved: "A check SHALL fail unless every test file under `scripts/tests/` is run by at least one job whose path filter covers the inputs that test reads", all its derivation of inputs, its declarations, exemptions for uncovered tests, divergence between engines' filters and Acceptance, and delta-01's replacement of the input derivation (the module closure, the path-like literals, the undeterminable set, the declaration, the exclusions and their visibility file). No input derivation, declaration, exclusion, shrink-only baseline or freeze rule exists any more.
- R7's use of the check of R6, replaced under MODIFIED.
- R8 as approved (kinds, per-engine triggered-job report, shared computation, empty and mixed change sets), moved to #1933 by the new R8.
- Delta-01 R14 (the documented residual limit of declaration completeness), with no replacement: the derivation it qualified no longer exists.
- Scenarios of the approved spec and of delta-01 that serve the removed requirements: "A test is orphaned (R6)", "A test's input is not covered by the filter (R6)", "Undeterminable inputs fail closed (R6)", "The state of #2009 fails the check (R7)", "A SKILL.md-only change triggers the budget test on the real tree (R7, R8)", "The per-kind report (R8)", "A mixed or empty change set is not reported as free (R8)", "A test drives a library whose path it never names (R6)" and "A library reads a path computed at runtime (R6, R14)". Delta-01's R12(a) wording and its scenarios "A reference-only change still triggers the jobs that named the old file", "An unrelated path-filter edit hides behind the retargeting" and "A job for the reference-directory check is a permitted addition" stay.
- The open questions of the approved spec on where the per-kind report lives and on `test-*.sh` coverage by the filter-coverage check, both moot.
