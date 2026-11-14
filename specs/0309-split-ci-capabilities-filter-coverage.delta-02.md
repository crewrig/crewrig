---
id: "0309"
slug: split-ci-capabilities-filter-coverage
status: draft
complexity: standard
interaction-mode: AUTO
related-issue: 2012
version: 1.2.0
---

# Split the CI capability reference and check filter coverage

## ADDED

Delta-02 builds on delta-01 (merged at c8010740) and follows the owner decision logged on #2012 (`https://github.com/crewrig/crewrig/issues/2012#issuecomment-6885492532`), taken after plan v2 was rejected (`https://github.com/crewrig/crewrig/issues/2012#issuecomment-6885463383`) because the static filter-coverage check flagged 862 of 873 tests and would have needed about 1,000 declarations. It replaces that check with an unfiltered run on the protected branches. The version is MINOR (1.1.0 to 1.2.0). `docs/spec-format.md` (Versioning) reserves MAJOR for a requirement modified or removed "in a way that invalidates an in-flight implementation"; that literal criterion is not met, because no implementation branch exists (R11 holds it back) and the only artifact built on the removed requirements, plan v2 of #2012 (rejected, link above), is a plan, not an implementation. The delta does remove normative requirements (R6 as approved and as amended by delta-01, R8, R14); that is a reasoned reading of MINOR for a change that adds the unfiltered-run requirement, and the removals are listed under REMOVED so that no reader misses them. R1 to R5, R9 to R11 and R13 stay as approved or as amended by delta-01, except for the edits that the removal forces and that MODIFIED lists.

**R6 (every verifying capability runs unfiltered on a push to a protected branch).** On every push to `main` and to a `release/**` branch (the branches of today's `push` triggers), every capability that has a `push` trigger naming that branch (122 of the 133 capabilities of the reference today) SHALL run with no path filter, on both engines, whatever files the push changed, except the capabilities of the exemption list below. On GitHub this holds for every workflow file under `.github/workflows/` that declares an `on.push` trigger naming `main` or `release/**`, not only for `build.yml`: the standalone workflows too (at the time of writing 17 workflow files declare an `on.push` key, and 15 of them carry `paths:` on it, 14 standalone workflows plus `pages.yml`, among them `ticket-pickup`, `release-notes`, `release-tests` and the `usage-*` family, and the runtime gate never sees them; `build.yml` and `release-monorepo.yml` carry none). The `push` trigger of each such file lists its branches and carries no `paths:` and no `paths-ignore:`; the implementation either removes the filter (R12(f)) or lists the workflow in the exemption list. For `build.yml` the runtime path gate decides to run every such capability for a push to those branches, including when the diff would match no pattern (the existing fail-open on an uncomputable diff is unchanged). A job reached on such a push SHALL NOT be skipped by a job-level `if:` unless the job is in the exemption list; the decidable rule is in the wiring test (c). Only the job-level `if:` is in scope: a step-level `if:` is out of scope of this spec and of the test. On GitHub an `on.push` with only `tags:` is not a branch push and never counts; one with `branches-ignore:` is evaluated for `main` and `release/` refs or fails closed. On GitLab: a branch pipeline is created for a push to the default branch (`main`) and to the release branches, and in it every job of the generated output that belongs to such a capability is matched by a rule that has no `changes:` or `exists:` clause and whose `when` is absent, `on_success` or `always`; a rule with `when: manual`, `when: delayed` or `when: never` does not count as running. On GitHub a trigger counts only under `on.push`: a branch listed under `workflow_dispatch` or `schedule` alone does not. Pull requests and merge requests are not changed: their per-event path filters and the gate's pull-request decision stay as R3, R12(e) and the parity guard define them, no filter is added, removed or widened for them, and events other than a push to those branches (tags, schedules, manual runs, merge requests) behave as before. The reference SHALL be able to express an unfiltered `push` trigger beside a filtered `pull-request` trigger of the same capability, and the generator, the runtime gate and the parity guard SHALL read the same meaning from it (the inheritance of a capability-level `paths:` by a trigger with none, 0283 R3, must therefore not hand a filter to such a push trigger); the form, for example moving the capability-level `paths:` to the pull-request trigger or an explicit unfiltered marker, is the PLAN's choice and SHALL be documented in `docs/ci-reference-format.md`. Whatever the form, the effective `cache.files` and `cache.env` of every capability, and so the GitLab `cache:key:files` output, SHALL be identical before and after it (0283 R3 makes `cache.files` default to the capability-level `paths:`, which the form must not change). **Exemption list.** A committed file (suggested `ci/push-main-exemptions.txt`), visible in review, printed in full by the test, with one entry per line: a kind, the capability id or workflow file, and a non-empty reason. Two kinds exist. `no-push`: a capability with no `push` trigger on those branches (pull-request-only, scheduled, tag- or release-only, engine-specific). `side-effect`: a deploy or publish capability whose job mutates or publishes something outside the repository and must not run again on every push, which keeps its push filter; `pages-deploy`, which publishes the communication site to the `github-pages` environment on `communication/**`, is the known case, and a release, deploy, publication or bot-mention workflow qualifies on the same reasoning. A capability that runs a test or a check never qualifies for `side-effect`, whatever its reason. Decision rule: for a capability with a `ci:<id>` command, the closure of R7 over its task and `cmds` is computed, and the test fails an entry whose closure reaches a test file under `scripts/tests/` or a `check-*` script; for a capability with no task (a hand-authored, engine-specific one such as `pages-deploy`), the closure is empty and the capability is classified by what its command or workflow does, which the reason entry states and the reviewer checks; the test verifies only that the reason is non-empty. A release or deploy workflow follows the same entry-with-reason rule and not the closure heuristic: its `run:` steps may call a `check-*` preflight before publishing without disqualifying it, and a verifying job that reaches a check through a direct script call in a `run:` step is not thereby exempt, because the closure also reads the `run:` steps of the job in the workflow file. Job-to-capability mapping: a job belongs to the capability whose `ci:<id>` command it runs; a job that runs no such command belongs to the capability of its workflow file, and an entry may name a workflow file or a job id when no capability maps to it. The trade-off is accepted: a filter gap of the #2009 class is detected minutes after the merge, as a red run of `main`, instead of before it; detecting such a gap before the merge is out of scope. The extra cost is accepted too: today 133 capabilities, 24 of them Windows jobs, of which 122 have a `push` trigger and 11 have none, run on a push to `main` or `release/**` only when their filter matches, and an unfiltered run starts about 122 jobs per engine per push (the 11 push-less capabilities never run on a push), on the order of the full pull-request pipeline, with `cancel-in-progress` false for pushes; the R9 amendment records the measured job count and runner minutes of one run.

**R6 wiring test (decidable, fail closed).** A test SHALL assert R6 offline from committed files only, with no CI run, through the shared reader of R3, the existing gate decision function and a closed evaluator of the GitLab rule conditions and of the GitHub job conditions below. It SHALL fail naming the capability or job, the file and the engine in each of these cases: (a) in the reference, the effective `push` path set on `main` of a capability that has such a trigger is not empty and the capability has no `side-effect` entry; (b) on GitHub, for every workflow file under `.github/workflows/` (the files read are `build.yml`, the `_ci-*.yml` callees and the standalone workflows, all of them) whose `on.push` names `main` or `release/**` by name, by glob (a closed matcher) or by no `branches:` and no `tags:` clause (a trigger with only `tags:` never counts as a branch push and is skipped): the trigger carries `paths:` or `paths-ignore:` and neither the workflow file nor a capability it hosts has an exemption entry (the test fails closed on any such workflow not in the list), or, for `build.yml`, the `push` trigger lacks `main` or `release/**`, or a file that cannot be parsed, or a branch pattern the matcher cannot resolve; (c) on GitHub, the gate decision for a push to `main` with a change set that no filter pattern of the reference matches (a synthetic file name chosen so that none matches) is not run for a capability of (a)'s set, or a job reached on a push to `main` (a job of a workflow of (b), including a `_ci-*.yml` job called from it) carries a job-level `if:` that is not statically true for that event. Accepted forms: no `if:`; `always()`; `success()`; a comparison of `github.event_name`, `github.ref`, `github.ref_name` or `github.repository` (with `==` or `!=`) with a string literal, and `!`, `&&`, `||` and parentheses over those forms, evaluated with `github.event_name` equal to `push`, `github.ref` equal to `refs/heads/main` (`github.ref_name` equal to `main`) and `github.repository` equal to the canonical repository `crewrig/crewrig`, and evaluated a second time with a `release/` ref for the forms that read the ref. A `github.repository` comparison is a fork guard, not a path filter: it is true on the canonical repository, so a job guarded by `github.repository == 'crewrig/crewrig'` (the `release` job of `release-monorepo.yml`) passes with no exemption; a comparison with another literal evaluates false and fails like any skipped job. An expression outside these forms (for example `github.actor`, `contains(...)`, `needs.*` or `vars.*`) fails closed, naming the job. An accepted expression that evaluates false (for example `github.event_name == 'pull_request'`) means the job does not run on a push and fails unless the job is in the exemption list; a job whose `needs:` names such a job fails likewise; (d) on GitLab, the workflow rules do not create a pipeline for a push to `main` and to a `release/` branch with no open merge request, or the first rule of a job that is true in that context carries `changes:` or `exists:`, or has `when` other than absent, `on_success` or `always`; a job with no rules passes only when its job-level `when` is absent, `on_success` or `always` (a job with no `rules:` and `when: manual` or `when: delayed` does not count as running), and a job that uses `only` or `except` fails closed; (e) a GitLab rule condition, `extends` or include that the evaluator cannot resolve fails closed, naming the job, never passes; (f) the exemption list: a capability with neither an unfiltered `push` trigger on `main` nor an entry (unlisted), an entry with an empty reason, an entry for a capability or workflow that does not exist, an entry for a capability that has an unfiltered `push` trigger (stale, for either kind), and a `side-effect` entry for a capability that runs a test or a check; (g) the control for (b) to (d): for every capability with a `pull-request` path filter, a pull-request event with that same synthetic change set is not run on GitHub, and the GitLab merge-request rules still carry `changes:`, so removing the filters from pull requests also fails. (h) cache invariance: the effective `cacheFiles` and `cache.env` of every capability, read by the gate reader and by the generator reader, are equal before and after the form of R6, asserted on a fixture where a capability-level `paths:` is moved to the pull-request trigger; a fixture that changes either fails. The test prints the exemption list in full on every run. Landing order: the test fails on the real tree until R12(f) has removed every push filter that is not exempt, so it SHALL land in the pull request of R12(f), as the one addition that pull request makes besides (f) itself (the job that runs it is a change under R12(a)), or after it, never before. The test SHALL be wired per R12 and its own path filter SHALL cover the files it reads (the reference, the workflow files, `.gitlab-ci.yml`, the exemption list, the gate and the rule evaluator and their libraries). Acceptance: the test passes on the real tree after the change; a fixture for each of (a) to (h) fails with the named message, and the fixed fixture passes.

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

**Scenario:** A standalone workflow keeps its own push filter (R6)

Given a fixture workflow `ticket-pickup.yml` whose `on.push.branches` lists `main` and whose `on.push.paths` is non-empty, with no exemption entry
When the wiring test runs
Then it fails naming the workflow file and the engine, and with the `paths:` removed, or with the workflow listed with a reason, the fixture passes.

**Scenario:** A deploy capability keeps its filter by a reasoned exemption (R6)

Given `pages-deploy` with `paths: communication/**` on `push` to `main` and a `side-effect` entry with a non-empty reason
When the wiring test runs
Then it passes and prints the entry; with the reason empty, or the same entry for a capability that runs a test, it fails naming the entry.

**Scenario:** A job-level condition skips a job on a push (R6)

Given a job reached on a push to `main` with `if: github.actor != 'dependabot[bot]'`, and another with `if: github.event_name == 'pull_request'`
When the wiring test runs
Then the first fails closed as an expression outside the accepted forms and the second fails as not run on a push unless listed; a job with `if: always()` or no `if:` passes.

**Scenario:** A fork guard on the canonical repository is not a filter (R6)

Given the `release` job of `release-monorepo.yml` with `if: github.repository == 'crewrig/crewrig'` and no `paths:`
When the wiring test evaluates it for a push to `main` on the canonical repository
Then the expression is accepted and true and the job passes with no exemption; with the literal changed to another repository it evaluates false and fails.

**Scenario:** A pull-request-only job needs an entry (R6)

Given a job of `_ci-governance.yml` with `if: github.event_name == 'pull_request'`, mapped by its `ci:<id>` command to a capability with no push trigger
When the wiring test runs
Then it fails unless that capability has a `no-push` entry with a reason.

**Scenario:** A GitLab job with no rules but `when: manual` does not run (R6)

Given a GitLab job with no `rules:` and `when: manual`
When the wiring test runs
Then it fails naming the job.

**Scenario:** The cache key survives the form of the unfiltered push (R6)

Given a capability whose capability-level `paths:` is moved to its pull-request trigger
When the wiring test compares the effective `cacheFiles` and `cache.env` before and after
Then they are equal and the test passes; a fixture where they differ fails.

**Scenario:** A manual GitLab rule does not count as running (R6)

Given a GitLab job whose only rule true for a push to `main` has `when: manual`
When the wiring test runs
Then it fails naming the job.

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

Replacement: "and a filter gap, a test that sits in a job whose path filter never fires for the files that test reads, no longer goes unnoticed on the protected branches. The CI capability reference is kept as one file per group, hand-authored CI files stay under a per-file size limit in place of a repository-wide line total, and every capability that has a `push` trigger on `main` or a release branch runs without path filters on a push, on both engines, as a wiring test proves; a capability with no such trigger needs a `no-push` entry with a reason in the exemption list, so that a new push-less capability is a reviewed decision. The trade-off is stated plainly: a filter gap of the #2009 class is detected minutes after the merge, as a red run of `main`, instead of before it, because per-pull-request path filters stay as they are; detecting a gap before the merge, by a static analysis of what each test reads, was measured on the tree and rejected as disproportionate (862 of 873 tests flagged, about 1,000 declarations), and is out of scope. Every push to a protected branch then costs a full run, a cost the owner accepts."

**R1, item list.** Original: "(c) 0287 R13, the line ratchet over `build.yml`, every `_ci-*.yml`, `ci/ci-capabilities.yml` and `.gitlab-ci.yml`, the floor of 8,880, the pin rules, and the hard cap of 9,100, in the form amended by delta-01 of 0287 (the re-measure clause)."

Replacement: the same item (c), followed by "(d) for a push to `main` or a `release/**` branch only, every other event and the pull-request semantics of each clause staying in force: 0283 R6, the clause "Semantics SHALL equal today's filter: `pull_request` is the files changed by the PR (merge ref against the base tip, a tree diff that needs no merge-base), `push` is `before..after`" (superseded for its `push` half); 0283 R3, the clause "A `pull-request` or `push` trigger with no `paths:` of its own inherits it, and `cache.files` defaults to it when absent" (superseded for the `push` inheritance only, `cache.files` unchanged, R6); 0283 R7, the clause "The effective path set of a trigger SHALL be its own `paths` when present, else the capability `paths` (the definition 0049 delta-02 carries)" and 0049 delta-02 R25, the clause "A capability that declares a capability-level `paths` and whose `pull-request` or `push` trigger declares none has, for that trigger, a path-bearing comparable trigger for R12" (both superseded for such a push trigger: an unfiltered `push` trigger has an empty effective path set and inherits nothing, and 0049 R12 to R20 compare it as unfiltered); the invariant of `scripts/tests/ci-paths-push-trigger.test.ts` that the `pull-request` and `push` path sets of every job are identical, which the implementation rewrites to the reverse for those branches. Kept without change: 0283 R4, the clause "emit each job's `changes:` list once, with a YAML anchor, and reference it by alias in the second rule" (it applies to every rule that carries `changes:`; a push rule that has none has nothing to alias), and 0283 R7 and 0049 delta-02 R25 for every other trigger." The sentence "the header of the replacement test (R5) and the ADR amendment (R9) each cite" gains the header of the rewritten push-trigger test, and each cites this delta and the superseded clauses of (d) as well. Specs 0283, 0285 and 0287 and their deltas are not edited.

**R4, symmetry sentence.** Original: "The per-file limit (R5) and the filter-coverage check (R6) SHALL apply to the GitHub and the GitLab engine alike; no check is added or relaxed for one engine only".

Replacement: "The per-file limit (R5) and the wiring test (R6) SHALL apply to the GitHub and the GitLab engine alike; no check is added or relaxed for one engine only".

**R6, replaced.** Original (first sentence; the rest of R6, through its Acceptance, is replaced, as is its version in delta-01): "A check SHALL fail unless every test file under `scripts/tests/` is run by at least one job whose path filter covers the inputs that test reads."

Replacement: R6 and its wiring test as in ADDED. The orphan check of `scripts/check-test-wiring.ts` (spec 0076) stays as it is and is the only check that every test is run by some job.

**R7, replaced.** Original: "The implementation SHALL include a regression test, run in CI, that reproduces the state of pull request #2009: a job that runs `scripts/tests/skill-size-budgets.test.ts` and whose path filter does not cover the skill sources that test reads (`SKILL.md` files under the skill directories), so that a change touching only a `SKILL.md` triggers no job that runs the test. The check of R6 SHALL fail on that fixture, naming `skill-size-budgets.test.ts` and an uncovered `SKILL.md` input."

Replacement: "The implementation SHALL include a regression test, run in CI, for the state of pull request #2009: the job that runs `scripts/tests/skill-size-budgets.test.ts` is run on a push to `main` on both engines regardless of its path filter, asserted by the wiring test of R6. On the real tree the job is found by resolving, transitively over the `task:` references and `cmds` of `taskfiles/` (the closure `scripts/check-test-wiring.ts` uses), which `ci:<id>` command reaches a task that runs `skill-size-budgets.test.ts`, then the capability `<id>` and its job on each engine; a tree where no command reaches the test fails closed, naming the test. The fixture is the R6(a)/(b)/(c) case under another name: a reference where that job's push trigger carries a filter that does not cover `SKILL.md`. The #2009 state itself was a pull-request filter gap, which this delta leaves to merge by design (Intent): the regression is the run on `main`, not a pre-merge detection, which is out of scope. Acceptance: the wiring test fails on the unfixed fixture, naming the job and the engine, and passes on the fixed fixture; and passes on the real tree. It does not exist before the change, so it is not verified failing before it."

**R9, rationale and alternatives.** Original: "the replacement of the global line cap by the per-file limit and the filter-coverage check, with the reason (lines are a poor proxy for the cost of a pull request, which is paid in triggered jobs; a generated file was counted twice; the cap forced unrelated checks into one job and widened path filters; the real risk, an unrun test, was not measured)" and "the rejected alternatives (keep one file and raise the cap; one file per capability, which multiplies files past the review benefit; a limit on the generated output; counting lines only for the reference)".

Replacement: "the replacement of the global line cap by the per-file limit and the unfiltered run on push to the protected branches, with the reason (the same, ending: the real risk, an unrun test, was not measured and is now bounded by a run of every capability on `main`)" and the rejected alternatives gain "a static filter-coverage check over what each test reads, rejected after measurement (862 of 873 tests flagged, about 1,000 declarations, a shrink-only baseline and drain pull requests)". The amendment also records the trade-off of the Intent, the rewritten push-trigger invariant of R1(d), and the measured cost of one unfiltered run: the job count per engine and the runner minutes (Windows jobs apart), from a real run of `main` after R12(f) merges.

**R10, last clause.** Original: "and its role passes to the per-kind report of R8 and to the measurements in the ADR amendment (R9)".

Replacement: "and its role passes to the measurements in the ADR amendment (R9) and, for the per-kind view of triggered jobs, to ticket #1933 (R8)".

**R12, lead and (a), (c), (d).** Permitted changes are now (a), (b), (d), (e) as amended by delta-01, plus (f), and only these. The effective view of (b) and (e) is that of delta-01, which this delta neither quotes nor restates: it depends on delta-01 R12(b) and (e).

Original (a), as replaced by delta-01: "(a) the new jobs the spec requires, each running only the checks and tests this spec adds: one for the filter-coverage check (R6) and, as the PLAN needs, the ones for the per-file limit test, the per-kind report, the shared reader and reference-directory tests, and the self-tests of the checks; no existing job gains or loses a command or a test through them;"

Replacement (a): "(a) the new jobs the spec requires, each running only the checks and tests this spec adds: one for the wiring test of R6 and, as the PLAN needs, the ones for the per-file limit test, the shared reader and reference-directory tests, and the self-tests of the checks (the clause of delta-01 is kept); no existing job gains or loses a command or a test through them. Interaction with R6: a job added under (a) is itself a capability, so it SHALL have an unfiltered `push` trigger on `main` and `release/**` from its first commit, or an entry in the exemption list; it may keep a pull-request path filter."

Original (c): "(c) path-filter widenings and test moves that R6 requires to close a real coverage gap, each listed in the implementation pull request body with the test, the input and the job;"

Replacement: (c) is removed: R6 requires no widening or test move, and any such change is out of scope.

Original (d), as amended by delta-01: "(d) the move of capabilities between files (R2) and the regenerated GitLab output (R4), the latter equal to the pre-split output except for (e);" Unchanged. New item: "(f) the removal of the path filter from the `push` trigger on `main` and `release/**` of every capability in the reference that is not in the exemption list, in the workflow files (every file of R6(b), not only `build.yml`) and in the generated output, the generated GitLab output changing only by the loss of `changes:` on the push rules and the corresponding anchors, and the rewrite of the push-trigger invariant test of R1(d); nothing else, except the job of the wiring test of R6, which (a) permits in the same pull request. The change SHALL land in its own pull request, separate from the pull request or requests that split the reference (R2, R12(e)), so that R13 compares outputs that differ by R12(e) and by the reordering only; its body lists every capability whose push filter was removed, with the count." The pull-request path filters, commands and required contexts stay untouched by (f).

**R12, closing paragraph.** Original: "Every new test or check (the per-file limit test, the filter-coverage check and its tests, the per-kind report test, the shared reader tests) SHALL be wired in the reference".

Replacement: "Every new test or check (the per-file limit test, the wiring test of R6 and its fixtures, the shared reader tests) SHALL be wired in the reference". The final Acceptance now reads "lists every job added or removed under (a) and (b), and every capability whose push filter was removed under (f)", and the clause "or widened under (c)" no longer applies.

**R1, last clause of the 0291 R26 and 0306 R25 sentence.** Original: "their remaining content (new cases go into existing files that an existing capability already runs; the wiring budget as a wiring rule) is unaffected and is then bounded by R5 and R6 of this spec instead of by a line total."

Replacement: "their remaining content (new cases go into existing files that an existing capability already runs; the wiring budget as a wiring rule) is unaffected and is then bounded by R5 of this spec (the per-file limit) instead of by a line total; R6 bounds no wiring budget, it only requires that every capability run on a push to a protected branch."

**R12(f) landing.** The wiring test of R6 lands in the pull request of (f) or after it (R6, Landing order).

**Scenario "Behaviour is unchanged by the split (R3, R4, R12)".** No change: it concerns the split change, which by R12(f) carries no push-filter removal.

**Out of scope, two bullets.** Original: "The scoping of spec-only pull requests (ticket #1933 owns it); this spec supplies only the shared report that #1933 reads (R8)." Replacement: "The scoping of spec-only pull requests and the per-pull-request-kind report (ticket #1933 owns both, R8)." Original (last bullet fragment): "the declaration form for undeterminable test inputs and the include-split decision". Replacement: "and the include-split decision, and the form of an unfiltered `push` trigger in the reference (R6)". New bullets: "Detecting a path-filter gap before the merge, by any static or dynamic analysis of what a test reads; changing any pull-request or merge-request path filter; running anything on a push other than to `main` and `release/**`."

## REMOVED

- R6 as approved, header "**R6 (fail-closed filter-coverage check).**": "A check SHALL fail unless every test file under `scripts/tests/` is run by at least one job whose path filter covers the inputs that test reads", all its derivation of inputs, its declarations, exemptions for uncovered tests, divergence between engines' filters and Acceptance, and delta-01's replacement of the input derivation (the module closure, the path-like literals, the undeterminable set, the declaration, the exclusions and their visibility file). No input derivation, declaration, exclusion, shrink-only baseline or freeze rule exists any more.
- R7's use of the check of R6, header "**R7 (regression state of #2009).**": "The check of R6 SHALL fail on that fixture, naming `skill-size-budgets.test.ts` and an uncovered `SKILL.md` input", replaced under MODIFIED.
- R8 as approved, header "**R8 (triggered jobs per pull-request kind).**": "A report SHALL state, for each pull-request kind, which jobs a pull request of that kind triggers, per engine, with the job ids and their count" (kinds, per-engine triggered-job report, shared computation, empty and mixed change sets), moved to #1933 by the new R8.
- Delta-01 R14, header "**R14 (documented limit of R6).**": "`docs/ci-reference-format.md` SHALL state, in the style of the named gap of R4, the one residual limit of the input derivation of R6 as modified by this delta" (the documented residual limit of declaration completeness), with no replacement: the derivation it qualified no longer exists.
- Scenarios of the approved spec and of delta-01 that serve the removed requirements: "A test is orphaned (R6)", "A test's input is not covered by the filter (R6)", "Undeterminable inputs fail closed (R6)", "The state of #2009 fails the check (R7)", "A SKILL.md-only change triggers the budget test on the real tree (R7, R8)", "The per-kind report (R8)", "A mixed or empty change set is not reported as free (R8)", "A test drives a library whose path it never names (R6)" and "A library reads a path computed at runtime (R6, R14)". Delta-01's R12(a) is not removed but replaced under MODIFIED; its scenarios "A reference-only change still triggers the jobs that named the old file", "An unrelated path-filter edit hides behind the retargeting" and "A job for the reference-directory check is a permitted addition" stay.
- The open questions of the approved spec on where the per-kind report lives and on `test-*.sh` coverage by the filter-coverage check, both moot.
