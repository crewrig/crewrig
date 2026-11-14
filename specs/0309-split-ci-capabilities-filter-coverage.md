---
id: "0309"
slug: split-ci-capabilities-filter-coverage
status: draft
complexity: standard
interaction-mode: AUTO
related-issue: 2012
version: 1.0.0
---

# Split the CI capability reference and check filter coverage

## Intent

A contributor can add a CI check as its own job without folding it into an unrelated one, and a test can no longer sit in a job whose path filter never fires for the files that test reads. The CI capability reference is kept as one file per group, hand-authored CI files stay under a per-file size limit in place of a repository-wide line total, a fail-closed check proves that every test is run by at least one job whose path filter covers the test's inputs, and a report shows which jobs each kind of pull request triggers. This is one new spec and not two delta-specs, because a delta-spec carries its parent's id and amends a single parent (`docs/spec-format.md`, Delta-spec frontmatter), two deltas would each restate the same per-file limit and filter-coverage mechanism, and the old specs stay live for every requirement this one does not touch, so the whole-spec `superseded` status fits neither of them. Supersedes: R1 and R2 of `specs/0285-shrink-ci-surfaces.md`, and R13 of `specs/0287-staged-reusable-workflows.md` as amended by `specs/0287-staged-reusable-workflows.delta-01.md`; the exact parts are quoted in R1 below. Parent epic #1930, ticket #2012, related #1933, #2009, #2011. Rationale to be amended into `docs/adr/0021-task-is-the-ci-contract.md` (R9).

## Requirements

1. **R1 (supersession, declared in this file only).** The spec-PR holds exactly one file under `specs/` (`docs/spec-pr-workflow.md`, One-file rule) and the approved parents are immutable, so the supersession SHALL be declared here and nowhere else in the spec set: the Intent sentence starting `Supersedes:` and this requirement. This spec supersedes exactly these parts and no other: (a) 0285 R1, the clauses "the total of the three surfaces SHALL be at most 8,880 lines", "a ratchet test pins the total at the achieved figure or at 8,880, whichever is lower" and the committed report (suggested `docs/ci-shrink-report.md`); (b) 0285 R2, the clause "the comment-line count of the reference is at most 322 and a test or the report asserts it" (the levers themselves, already applied, are untouched, and the evidence check of the parity guard stays); (c) 0287 R13, the line ratchet over `build.yml`, every `_ci-*.yml`, `ci/ci-capabilities.yml` and `.gitlab-ci.yml`, the floor of 8,880, the pin rules, and the hard cap of 9,100, in the form amended by delta-01 of 0287 (the re-measure clause). Every other requirement of 0285 and 0287 stays in force. The implementation SHALL NOT edit 0285 or 0287 or either delta, and SHALL make the supersession discoverable from the code side: the header of the replacement test (R5) and the ADR amendment (R9) each cite `specs/0309-split-ci-capabilities-filter-coverage.md` and the three superseded items. A reader of the effective view of 0285 or 0287 (the original plus its merged deltas, `docs/spec-pr-workflow.md`, Delta-spec cumulative rule) is expected to find the supersession by searching the spec set for `0309`.
2. **R2 (reference split by group).** The capability reference SHALL live as one file per group under `ci/capabilities/`: `gate.yml`, `modules.yml`, `governance.yml`, `extensions.yml`, `integration.yml` and `windows.yml`, the six groups that already structure the `_ci-<group>.yml` callees, each holding exactly the capabilities whose `group` field names it. Capabilities that carry no `group` (23 of the 133 on `origin/main` at c7a1ff99, the jobs of the standalone workflows such as `ticket-pickup`, `release-tests` and the `usage-*` family) SHALL NOT be forced into a group file; they SHALL live in one or more further files of the same directory whose names the PLAN fixes and that carry no group name. A group file MAY be split into several files of that directory (named `<group>-<part>.yml`) when R5 requires it; the group of a capability stays its `group` field and never its file name alone. The single file `ci/ci-capabilities.yml` SHALL NOT exist after the split: a stale copy left in place fails the checks of R3. Every capability SHALL appear in exactly one file, with its content unchanged; the shared header comment of the old file SHALL be kept once, in the directory's documentation (`docs/ci-reference-format.md`), not copied into every file. Acceptance: the union of capability ids over the directory equals the 133 ids of the old file, no id appears twice, and a capability's `group` equals the group of the file that holds it, and every group named by a capability has at least one file.
3. **R3 (tooling reads the directory, fail closed).** `scripts/build-ci.ts`, `scripts/check-ci-parity.ts` and every other reader of the capability reference (the PLAN lists them with a search of the tree at plan time, covering at least the generator and parity libraries, the drift classifier, the test-wiring check and the CI wiring tests) SHALL read the directory as one logical reference through a single shared reader, not each their own glob. The reader SHALL fail with a message naming the file when: a file is not valid reference content; an id appears in two files; a capability's `group` differs from its group file; a group file name is not one of the six (or its split form of R2); the directory is missing or holds no file; or `ci/ci-capabilities.yml` still exists. A directory that holds only the ungrouped files and no group file is valid only if no capability names a group. The parity guard, the traceability, evidence and path-ownership checks, and the generator output SHALL behave as before for the same logical content: the set of jobs, their commands, triggers, path filters and stages, on both engines, does not change. Acceptance: `build-ci --check`, `check-ci-parity` and the wiring tests pass on the split tree, and a fixture for each failure case above fails with the named message.
4. **R4 (GitLab output, optional include split, symmetry).** The generated `.gitlab-ci.yml` SHALL remain generated and SHALL stay equal to the generator output under the existing equality check. The generator MAY emit one `include:` file per group (and per ungrouped file); that choice is the PLAN's, taken from the measured benefit, and the generated per-group files carry the same generated-file marker as `.gitlab-ci.yml`. Whichever the PLAN picks, the effective GitLab pipeline (the set of jobs with their `stage:`, `needs:`, `rules:` and scripts) SHALL equal the pipeline the old single file produced, and when no include split is applied the output SHALL be line-for-line identical to the output of the pre-split generator on the same logical reference. The per-file limit (R5) and the filter-coverage check (R6) SHALL apply to the GitHub and the GitLab engine alike; no check is added or relaxed for one engine only, and a divergence the PLAN must accept is recorded as a named gap in `docs/ci-reference-format.md` in the style of 0287 R15, never left silent. Acceptance: the equality check passes with and without the include split, a job-set diff between the pre-split and post-split generated pipelines is empty, and lint of the GitLab output (the existing server-side validation where available) passes.
5. **R5 (per-file limit replaces the global line cap).** The global line cap SHALL be removed: no test, report or document SHALL bound the total number of lines of the CI surfaces, and the floor, the pin and the hard cap of 0285 R1 and 0287 R13 SHALL cease to exist. In its place a test SHALL fail when any hand-authored CI file has more lines than the per-file limit. The hand-authored CI files are `.github/workflows/build.yml`, every `.github/workflows/_ci-*.yml`, and every file of `ci/capabilities/`; the generated files (`.gitlab-ci.yml` and any generated include of R4) SHALL be excluded, identified by their generated-file marker and not by a name list, so a hand-edited file cannot hide behind the marker's absence: a file under a generated path that lacks the marker SHALL fail. The limit is one integer constant in that test, with the value left to be fixed by the PLAN from a measurement on the post-split tree, of the order of 400 to 500 lines. The rule for choosing it: take the largest hand-authored CI file after the split of R2, multiply by 1.10, and round up to the next multiple of 50; the result SHALL be at least 400 and at most 500. If the rule yields more than 500, the PLAN SHALL split the largest files further (R2 allows it) until it yields at most 500, instead of raising the limit; if it yields less than 400 the limit is 400. The PLAN records the measured sizes of every hand-authored file, the largest, and the chosen value. Measurement at c7a1ff99 for orientation: `_ci-governance.yml` 402 lines is the largest workflow file, and the capability blocks by group total about 781 (governance), 744 (windows), 717 (ungrouped), 684 (modules), 565 (extensions), 518 (gate), 426 (integration), so several group files exceed 500 lines before any further split (assumption: verify at PLAN time). Raising the limit later SHALL be a deliberate edit of the constant, with the reason in the pull request body. Acceptance: the test reports the offending file and its line count; a fixture file one line over the limit fails and one at the limit passes; a hand-authored fixture under a generated path without the marker fails.
6. **R6 (fail-closed filter-coverage check).** A check SHALL fail unless every test file under `scripts/tests/` is run by at least one job whose path filter covers the inputs that test reads. A job runs a test when its capability's command (the `ci:<id>` task it resolves to) names the file or a glob that matches it. A job's path filter is its `paths:` at capability level or trigger level, as read from the reference (on GitHub the paths-based triggering, on GitLab the generated `rules:changes`); a job with no path filter runs on every change and covers every input. The inputs of a test are the repository files and globs the test opens, read, listed or spawns (at minimum its own file, the files it opens, and the directories it enumerates), determined by the check from the test source where they are static; where a test builds a path dynamically so that its inputs cannot be determined, the test SHALL carry an explicit declaration of its inputs in a form the PLAN fixes, and a test with undeterminable inputs and no declaration SHALL fail. An input is covered when at least one path pattern of the filter of at least one job that runs the test matches it. The check SHALL fail naming the test, in each of these cases: no job runs it (orphaned); every job that runs it has a path filter that leaves at least one input uncovered (naming the input and the jobs); its inputs are undeterminable and undeclared. A permitted path exists for a justified exception: an exemption entry with a non-empty reason, in the style of the exemption list of `scripts/check-test-wiring.ts`, and an exemption that no longer matches an orphaned or uncovered test SHALL itself fail as stale. The check SHALL run on both engines' derived filters, so a divergence between the GitHub filter and the generated GitLab `rules:changes` for the same job is reported. The check SHALL be wired as a job of the reference (hence in the GitHub workflows and the generated GitLab output, with a passing wiring test) and SHALL run when any file it reads changes, including `scripts/tests/**`, `ci/capabilities/**` and the workflow files. Acceptance: on the current tree, the check passes or lists every real gap, and the implementation fixes each listed gap in the same change (by widening a filter or moving a test, never by exempting it silently); a fixture for each failure case fails with the named message.
7. **R7 (regression state of #2009).** The implementation SHALL include a regression test, run in CI, that reproduces the state of pull request #2009: a job that runs `scripts/tests/skill-size-budgets.test.ts` and whose path filter does not cover the skill sources that test reads (`SKILL.md` files under the skill directories), so that a change touching only a `SKILL.md` triggers no job that runs the test. The check of R6 SHALL fail on that fixture, naming `skill-size-budgets.test.ts` and an uncovered `SKILL.md` input. The same test SHALL show the fixed state passing: a filter that covers `SKILL.md` makes the fixture pass. Acceptance: the test is verified failing on the #2009 fixture before the check is enabled on the real tree, and passing on the fixed fixture and on the real tree after the gaps of R6 are fixed; on the real tree a change touching only one `SKILL.md` triggers at least one job that runs `skill-size-budgets.test.ts` (checked offline from the reference, per R8's computation).
8. **R8 (triggered jobs per pull-request kind).** A report SHALL state, for each pull-request kind, which jobs a pull request of that kind triggers, per engine, with the job ids and their count. The kinds are `spec-only` (every changed file under `specs/`), `docs-only` (every changed file under `docs/`), `skill-only` (every changed file a skill source or one of its deployed copies or a skill's own evals, the representative set being the files of #2013: the `SKILL.md` of the skill in `artifacts/core/skills/`, `.agents/skills/`, `.claude/skills/`, `.gemini/skills/`, `.github/skills/`, and its `evals/results.json`) and `code` (everything else; a pull request whose files span several of the first three kinds, or touch a file outside them, is `code`). The report SHALL be computed offline from the reference and the derived path filters, with no CI run and no paid command, and SHALL be deterministic: the same tree yields the same report. It SHALL be producible as a table for humans and as machine-readable output, and the kind definitions and the computation SHALL live in one place, shared with ticket #1933, so the numbers #1933 uses are the numbers this report prints; #1933 keeps ownership of any scoping change for `spec-only` pull requests, and this spec changes no filter for that purpose. An empty set of files, or a file set that matches no kind definition, SHALL be reported as `code` with an explicit note, never as zero jobs. Acceptance: the report lists the four kinds, a `spec-only` fixture change lists the jobs a spec-only change triggers and a job with no path filter appears in all four kinds, and the output is identical across two runs.
9. **R9 (ADR-0021 amendment).** The implementation SHALL amend `docs/adr/0021-task-is-the-ci-contract.md` to record: the capability layout (the directory `ci/capabilities/`, the six group files, the ungrouped files and the group-field-to-file rule of R2, which also updates the existing paragraph on the `group` scalar that names `taskfiles/ci/<group>.yml`); the replacement of the global line cap by the per-file limit and the filter-coverage check, with the reason (lines are a poor proxy for the cost of a pull request, which is paid in triggered jobs; a generated file was counted twice; the cap forced unrelated checks into one job and widened path filters; the real risk, an unrun test, was not measured); the chosen limit value and the measurements behind it; the optional include split of R4 and which way the PLAN decided; and the rejected alternatives (keep one file and raise the cap; one file per capability, which multiplies files past the review benefit; a limit on the generated output; counting lines only for the reference). The amendment is part of the implementation PR, not of the spec-PR, and cites this spec and the superseded items (R1). Acceptance: the ADR diff names each item, and the amendment is the only place outside the spec set that narrates the supersession.
10. **R10 (retired report and ratchet test).** `scripts/tests/ci-shrink-report.test.ts` SHALL be removed or rewritten to hold only the per-file limit (R5), and its three present assertions (the total at most the pin and floor, the comment-line limit of 322, and the committed report listing every surface) SHALL NOT survive in any form. The committed report `docs/ci-shrink-report.md` is retired: the implementation SHALL delete it and repair every reference to it in the repository, because a report that lists surfaces the repository no longer measures is stale on arrival, and its role passes to the per-kind report of R8 and to the measurements in the ADR amendment (R9). The final line figures before the split (per file and total at the commit the implementation branches from) SHALL be recorded once in the implementation pull request body. The `scripts/lib/build-ci/` and `scripts/lib/ci-parity/` rows of that report have no replacement and are not required. Acceptance: no file of the tree references `docs/ci-shrink-report.md`, the old test's three assertions are gone, and the removal of the file is a deliberate part of the implementation diff.
11. **R11 (sequencing: no implementation branch before the go).** The implementation branch SHALL NOT be cut when this spec merges: it is cut only after the coordinator sends an explicit go, because workers on #1990, #1991 and #1992 are touching CI-adjacent files, and because the split rewrites `ci/ci-capabilities.yml`, which #2011 and #1989 also change (ticket #2012 sizing: start after both have merged). Until the go the ticket stays at the spec stage; when the go arrives, the implementation branch is cut from the then-current `main` and the split is made on that content, never on the state read at spec time. If the file `ci/ci-capabilities.yml` has changed between the spec and the go, the PLAN re-measures every figure it quotes from this spec (R5 orientation, the 133 and 23 counts). Acceptance: the first implementation commit post-dates the go recorded on the logbook of #2012, and no `ci/capabilities/` file exists on `main` before the implementation merges.
12. **R12 (invariants).** The change SHALL add, remove or rename no job, change no job's command, trigger or required status context, and edit no ruleset; the required contexts `ratchet` and `lint-typescript` keep reporting under their names. `.gitlab-ci.yml` is regenerated by `node scripts/build-ci.ts` and `check-ci-parity` passes. Every new test or check (the per-file limit test, the filter-coverage check and its tests, the per-kind report test, the shared reader tests) SHALL be wired in the reference, the GitHub workflows and the generated GitLab output, and in `scripts/check-test-wiring.ts`, and SHALL use `mkdtemp` directories only and never remove or restore a path it did not create. No new framework, YAML parser or glob library is introduced: the reader reuses `scripts/lib/ci-parity/reference-read.ts` and `scripts/lib/glob-engine.ts`. The change is reversible by `git revert` of its pull request or pull requests, each CI-green on its own. Acceptance: the pull request body shows each invariant green.

## Scenarios

**Scenario:** Supersession is discoverable from the code side (R1)

Given the implementation has merged and a reader holds the effective view of spec 0287 with its R13
When the reader searches the repository for the replacement of the line ratchet
Then the header of the per-file limit test and the ADR-0021 amendment both cite `specs/0309-split-ci-capabilities-filter-coverage.md` and the superseded items, and specs 0285, 0287 and delta-01 are unchanged.

**Scenario:** The reference is split and complete (R2)

Given `ci/ci-capabilities.yml` holds 133 capabilities, 110 with a group and 23 without
When the split is applied
Then the files of `ci/capabilities/` hold exactly those 133 ids once each, every grouped capability sits in the file of its group, the ungrouped ones sit in files with no group name, and `ci/ci-capabilities.yml` no longer exists.

**Scenario:** A group file holds a capability of another group (R2, R3)

Given `ci/capabilities/modules.yml` contains a capability whose `group` is `governance`
When the shared reader loads the directory
Then it fails naming the file and the capability, and `build-ci` and `check-ci-parity` fail with the same message.

**Scenario:** An id appears twice, or the old file is left behind (R3)

Given an id is present in two files of the directory, or `ci/ci-capabilities.yml` still exists next to the directory
When any tool reads the reference
Then the read fails naming both files and no tool proceeds on a partial reference.

**Scenario:** Behaviour is unchanged by the split (R3, R4, R12)

Given the pre-split generated pipelines of both engines
When the generator and the parity guard run on the split tree
Then the generated GitLab output equals the generator output, the set of jobs with their commands, stages, needs and `rules:` is identical to the pre-split set, and the required contexts `ratchet` and `lint-typescript` are unchanged.

**Scenario:** The optional include split stays equivalent (R4)

Given the PLAN chooses one generated `include:` file per group
When the equality check and the job-set diff run
Then both pass, the generated include files carry the generated-file marker, and they are excluded from the per-file limit.

**Scenario:** A hand-authored file exceeds the limit (R5)

Given the per-file limit is fixed at its measured value and `ci/capabilities/windows.yml` grows one line past it
When the limit test runs
Then it fails naming `ci/capabilities/windows.yml` and its line count, and the same total of lines spread across files under the limit passes.

**Scenario:** The limit follows the measurement rule (R5)

Given the largest hand-authored file after the split is 402 lines
When the PLAN applies the rule
Then 402 multiplied by 1.10 rounds up to 450, which lies in the range 400 to 500, and the limit is 450; and if the largest file were 480 lines the rule would yield 550, so the PLAN would split further instead of raising the limit above 500.

**Scenario:** A file escapes the limit through the generated marker (R5)

Given a hand-authored file under a generated path lacks the generated-file marker
When the limit test runs
Then it is counted as hand-authored and fails if over the limit, and a file that carries the marker is excluded.

**Scenario:** A test is orphaned (R6)

Given a test file under `scripts/tests/` that no job's command names or globs
When the filter-coverage check runs
Then it fails naming the test, unless an exemption with a reason exists, and an exemption left after the test gains a job fails as stale.

**Scenario:** A test's input is not covered by the filter (R6)

Given a job runs `scripts/tests/foo.test.ts`, the test reads `docs/bar/*.md`, and the job's only path pattern is `scripts/**`
When the filter-coverage check runs
Then it fails naming the test, the input `docs/bar/*.md` and the job; and it passes once a job that runs the test has a pattern matching that input or has no path filter.

**Scenario:** Undeterminable inputs fail closed (R6)

Given a test builds a file path from an environment value so its inputs cannot be derived
When the check runs with no declaration of inputs
Then it fails naming the test; with a declaration of the inputs it is checked like any other test.

**Scenario:** The state of #2009 fails the check (R7)

Given a fixture reference where the job running `skill-size-budgets.test.ts` has a path filter that does not cover `SKILL.md` files under the skill directories
When the filter-coverage check runs
Then it fails naming `skill-size-budgets.test.ts` and an uncovered `SKILL.md` input, and with the filter widened to cover them the same fixture passes.

**Scenario:** A SKILL.md-only change triggers the budget test on the real tree (R7, R8)

Given a change touching one `SKILL.md` and nothing else
When the triggered jobs are computed offline from the reference
Then at least one job that runs `skill-size-budgets.test.ts` is among them, on both engines.

**Scenario:** The per-kind report (R8)

Given the tree after the split
When the report runs for `spec-only`, `docs-only`, `skill-only` and `code`
Then it lists, per engine, the triggered job ids and their count for each kind, a job with no path filter appears in all four, and two runs print identical output.

**Scenario:** A mixed or empty change set is not reported as free (R8)

Given a change set with one file under `specs/` and one under `scripts/`, or an empty change set
When the report classifies it
Then it is classed `code` with a note, never as zero triggered jobs.

**Scenario:** The retired report is gone cleanly (R10)

Given the implementation diff
When the tree is searched for `docs/ci-shrink-report.md` and for the old test's pin, floor and 322-line limit
Then no reference to the file remains, none of the three assertions exists, and the pre-split figures appear once in the implementation pull request body.

**Scenario:** The ADR is amended (R9)

Given the implementation pull request
When `docs/adr/0021-task-is-the-ci-contract.md` is read
Then it records the directory layout, the limit and its measurements, the include-split decision and the rejected alternatives, and cites this spec.

**Scenario:** Implementation waits for the go (R11)

Given this spec has merged and the coordinator has not sent the go
When a worker picks up #2012
Then no implementation branch is cut and `ci/capabilities/` does not exist on `main`; after the go the branch is cut from the then-current `main` and the PLAN re-measures every figure it quotes.

## Out of scope

- Changing which jobs exist, their commands, triggers, required status contexts or the rulesets (R12).
- The scoping of spec-only pull requests (ticket #1933 owns it); this spec supplies only the shared report that #1933 reads (R8).
- Running the GitLab output on a live runner, or adding a GitLab-only or GitHub-only check.
- Splitting or limiting files outside the hand-authored CI set: the Taskfile split `taskfiles/ci/<group>.yml` of #1827, scripts, tests and documents.
- Editing or re-versioning specs 0285 and 0287 or delta-01 of 0287, which stay immutable (R1).
- Any new framework, YAML parser or glob library.
- Choosing the exact value of the per-file limit, the names of the ungrouped files, the declaration form for undeterminable test inputs and the include-split decision: the PLAN fixes them from measurement under the rules above.

## Open questions

- [AUTO-PARKED] Where do the 23 group-less capabilities go, and in how many files? Measured orientation at c7a1ff99 is about 717 lines for them, above the 500 order, so they likely need several files (for example one per standalone workflow family such as `usage-*` and `release-*`). R2 fixes the rule (no group name, same directory, no id twice); the PLAN fixes the names and count after re-measuring (R11).
- [AUTO-PARKED] Do the group files for `governance` (about 781 lines), `windows` (about 744), `modules` (about 684) and `extensions` (about 565) need a `<group>-<part>.yml` split to meet a limit of at most 500? R5 requires further splitting rather than a limit above 500; if the owner prefers one file per group with a limit above 500 for the reference only, that changes R5 and needs a delta-spec.
- [AUTO-PARKED] Should the per-kind report (R8) live as a task in `taskfiles/ci.yml` or a script of its own, and which shared module does #1933 import? R8 fixes only the one-place rule; coordinate with the #1933 spec author at PLAN time.
- [AUTO-PARKED] Is deleting `docs/ci-shrink-report.md` (R10) acceptable to the owner, or should it be kept with a retirement banner? The draft chooses deletion because a stale report is a trap; reversible by reading git history.
- [AUTO-PARKED] Does the filter-coverage check (R6) cover the `test-*.sh` scripts that `scripts/check-test-wiring.ts` handles today, or only `*.test.ts`? The draft says every test file under `scripts/tests/`; the PLAN confirms the file patterns against the tree.
