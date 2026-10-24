---
id: "0285"
slug: shrink-ci-surfaces
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1782
version: 1.0.0
---

# Shrink the CI surfaces

## Intent

Slice 5 of `specs/0280-task-ci-contract.md` (R6, with the invariants of R9 and the measurement of R10) closes the work package: after the thin `task ci:<id>` contract and the removal of the `dorny/paths-filter` steps, the three engine-specific CI surfaces (`.github/workflows/build.yml`, `ci/ci-capabilities.yml`, `.gitlab-ci.yml`) and the two tools that read them are simplified to what that contract needs, the total of the three surfaces reaches the 8,880-line floor of R10 that is not lowered, and a committed report states each success measure of R10 as met or not met with its figure. A maintainer notices a smaller reference, a smaller generator and parity guard with no weaker guarantee, a GitLab python job that runs the version the reference names, and Windows jobs that no longer install dependencies twice, and skip the install entirely where their task needs none. Predecessors: `specs/0283-ci-jobs-run-task.md` (slice 3), whose last pull request removes the `dorny/paths-filter` steps (branch `test/1777-dorny-removal`, issue #1780), and `specs/0280-task-ci-contract.delta-01.md` (delta-01 of 0280, on branch `spec/0280-task-ci-contract-delta-01`), which relaxes the R7 ordering so that this spec and its plan may run before that last pull request merges while implementation waits for it. Parent issue #1777, epic #1761, logbook and slice issue #1782. Rationale: `docs/adr/0021-task-is-the-ci-contract.md`.

## Requirements

1. **R1 (baseline, target, report).** Measured on `origin/main` at a67ca65e on 2026-10-24 (wc -l): `.github/workflows/build.yml` 2,805; `ci/ci-capabilities.yml` 4,581; `.gitlab-ci.yml` 3,037; total 10,423 (baseline of 0280 R10: 3,758, 5,189, 3,734; total 12,681). At the end of slice 5 the total of the three surfaces SHALL be at most 8,880 lines (the 0280 R10 floor, not lowered). The `dorny/paths-filter` removal is expected to remove about 1,450 more lines (55 filter steps remain in `build.yml` at a67ca65e; assumption — verify by re-measuring on the first `origin/main` commit after the last slice 3 pull request), so slice 5 SHALL itself deliver the remainder: at least 90 lines on that estimate, with a target of at least 250 lines for margin. The slice SHALL commit a report (suggested `docs/ci-shrink-report.md`) with one table listing, before and after, every R10 surface, `taskfiles/ci.yml`, `scripts/lib/build-ci/`, `scripts/lib/ci-parity/` and every new script (the last four sit outside the floor and are reported so the shrink is not flattering), and SHALL state each 0280 R10 success measure as met or not met with its figure: the 8,880 floor, the 30% reduction, `ci:pre-push` wall time under load against the 60 s budget of `docs/pre-push-guard.md`, zero unverified `Install Task` steps, and the thin-job template of at most 15 lines. Acceptance: the report exists in the last pull request, its before column equals a67ca65e or the re-measured post-dorny state (stated), and a ratchet test pins the total at the achieved figure or at 8,880, whichever is lower.
2. **R2 (levers that change no normative contract).** The slice SHALL apply the following levers, none of which alters a contract of 0280, 0283, 0047 or 0048:
   - (e2 remainder) remove the default-valued `ci-job` inputs and the per-job boilerplate still present in the `build.yml` jobs after slice 3;
   - (f) halve the comment lines of `ci/ci-capabilities.yml` (644 comment lines on a67ca65e, so at most 322 afterwards), keeping every comment that carries the evidence of a `portability: specific` exception or a non-obvious path rationale and removing restatements of the adjacent key;
   - (c) merge the six `*-node-24-0` twins (`build-components-ts-node-24-0`, `extension-builders-ts-node-24-0`, `install-ts-node-24-0`, `usage-capture-node-24-0`, `worktree-guard-node-24-0`, `mempalace-transcript-node-24-0`) into matrix jobs, subject to the decision rule of R3.

   Acceptance: the comment-line count of the reference is at most 322 and a test or the report asserts it; each exception keeps its evidence (the existing evidence check of the parity guard passes unchanged); the report lists each lever with its measured line saving, or "not applied" with the reason.
3. **R3 (decision rule for lever c).** Before merging twins, the PLAN SHALL record the required status checks of `main` (rulesets API `repos/crewrig/crewrig/rules/branches/main` and branch protection) and every document or test that names a twin. Measured today (2026-10-24): the ruleset `main-protected` requires only `ratchet` and `lint-typescript`; no twin is a required check (assumption — verify at PLAN time, since rulesets change). If merging a twin into a matrix job would change the name of any required status check, the lever SHALL be dropped for that twin and recorded in the report as not applied; the required check SHALL NOT be renamed, and no ruleset SHALL be edited by this slice. A matrix merge SHALL keep every twin's capability id resolvable in the reference, or update every document that names it (for example `docs/cli-matrix/rows/` and `docs/cli-matrix.md`, rebuilt in the same diff per `AGENTS.md`). Acceptance: the report names, per twin, "merged" or "not applied" with the check names compared.
4. **R4 (tooling simplification, no weaker guard).** The slice SHALL simplify `ci/ci-capabilities.yml`, `scripts/build-ci.ts` with `scripts/lib/build-ci/` (788 lines of library on a67ca65e) and `scripts/check-ci-parity.ts` with `scripts/lib/ci-parity/` (1,460 lines of library) to what the thin `task ci:<id>` contract needs, by removing code, fields and checks made dead by the thin contract and by the removal of `dorny/paths-filter` (candidates: filter-block parity in `scripts/lib/ci-parity/path-filters.ts` and `filters-doc.ts`, command-text rendering paths in the generator). Every removed check SHALL be shown unreachable on the post-dorny tree, in the pull request body, by a statement of the input state that would reach it and the grep or test showing no such input exists. No guard SHALL be weakened: every remaining parity failure fixture SHALL still fail, and no fixture of a still-reachable check SHALL be deleted. The state after the last slice 3 pull request is the input, so the concrete file list is fixed by the PLAN after that pull request merges; this requirement fixes the rule and the reporting. Acceptance: the report lists lines before and after per file of both libraries; the full parity self-test suite passes with every pre-existing failing fixture still failing, or its removal is justified under the unreachability statement; the spec's own list of kept guards (traceability, cancel-on-failure, changeset-coverage, path-ownership, spec 0282 provisioning guard, evidence check) passes.
5. **R5 (GitLab python version).** The GitLab output for a job whose capability has `requires.runtime: python@X` SHALL install or select the referenced version X. Today GitLab python is unversioned (the apt tool recipe installs `python3` for `python@` runtimes and the image mapping uses `python:<ver>`; assumption — verify in `scripts/lib/build-ci/` at PLAN time). Decision rule: the first option, the recipe installs or selects the referenced version, is chosen unless the PLAN measures that it costs more than 10 added lines per job on the generated `.gitlab-ci.yml`; in that case the second option applies: `docs/ci-reference-format.md` SHALL state the python version the GitLab image provides and the parity guard SHALL assert that every `python@X` runtime in the reference equals it. The PLAN records the measurement and the chosen option. Acceptance: a fixture with `python@3.12` yields a GitLab job that runs 3.12 (first option) or a parity failure when X differs from the documented version (second option); the regenerated `.gitlab-ci.yml` is identical to the generator output.
6. **R6 (GitLab output is not verified on a live runner).** The GitLab output is verified by the generator equality check and by GitLab's lint only; it is not executed on a live GitLab runner (assumption — verify that no runner is attached to the project). The reference and every pull request body of this slice SHALL state this limit, so a green parity check is never read as a live-runner proof. Acceptance: each pull request body carries the sentence, and `docs/ci-reference-format.md` states it once.
7. **R7 (Windows jobs skip the production install).** The `ci-job` composite action (`.github/actions/ci-job`) SHALL accept a boolean input `gate` that defaults to `true`; with `gate: false` the action SHALL skip the path gate and the production `npm ci --omit=dev` that exists only to feed the gate. A job whose `install` input is `omit-dev` still needs exactly that install, so with `gate: false` the action SHALL run it once, as the job's own install step, and SHALL NOT run it twice; a job saves the install only when its `install` input is `none`. The slice SHALL therefore move a `windows-*` job to `install: none` with `gate: false` only after the PLAN shows, per job, that its `ci:<id>` task needs no `node_modules` (assumption — verify: today every `windows-*` job passes `install: omit-dev`, so the saving may be nil for some or all of them); a job that needs the install keeps `omit-dev` and gains nothing from `gate: false` beyond the removed duplicate. The expected saving is up to about 199 s of Windows runner time summed over the 24 `windows-*` jobs, no wall-clock change; ledger #961 R1-F4; assumption — verify the figure on a recent run; the report states the measured saving, including nil). `gate: false` SHALL be admissible only for a capability that has no `paths:` (capability level or trigger level); `scripts/check-ci-parity.ts` SHALL fail on a job that uses `gate: false` for a capability that has `paths:`. The 24 `windows-*` jobs SHALL use `gate: false` when their capabilities have no `paths:` (their install input follows the per-job rule above); a Windows capability that has `paths:` keeps the gate and is listed in the report. Acceptance: a fixture using `gate: false` for a capability with `paths:` fails the guard, a fixture without `paths:` passes, and a fixture job moved to `install: none` with `gate: false` still passes the guard, and the report shows the runner time before and after for the Windows jobs.
8. **R8 (invariants, 0280 R9).** At every merge of this slice: CI is green; the pull request is reversible by `git revert`; `.gitlab-ci.yml` is regenerated by `node scripts/build-ci.ts` and `check-ci-parity` is green; `cancel-on-failure`, `changeset-coverage` and `path-ownership` keep working; task names are stable; new tasks, if any, live only in `taskfiles/ci.yml` and never in the root `Taskfile.yml`; no new framework and no new YAML parser is introduced, reusing `scripts/lib/taskfile-tree.ts`, `scripts/lib/ci-parity/reference-read.ts` and `scripts/lib/glob-engine.ts`; every new test is wired in `.github/workflows/build.yml`, `ci/ci-capabilities.yml` and the regenerated `.gitlab-ci.yml` (and `scripts/check-test-wiring.ts`, following spec 0281); every new test uses `mkdtemp` directories only and never removes or restores a path it did not create (host safety). Acceptance: each pull request body shows each invariant green.
9. **R9 (pull request plan).** The slice MAY split into pull requests, each CI-green and reversible, on `test/1777-<slug>` branches until the last. The last pull request MAY use a `feat/` branch only if this spec's status is `implemented` at that point; otherwise it keeps `test/` (per the branch-prefix linter). Suggested split: PR A carries the levers of R2 and R3, the GitLab python change of R5 and the `gate` input of R7; PR B carries the tooling simplification of R4 and finalizes the report of R1. No implementation branch is cut before the last pull request of slice 3 is merged (0280 delta-01). Rollback of any pull request is `git revert`. The report is finalized in the last pull request. Acceptance: pull request titles and branches follow the convention, and the last pull request carries the finished report.
10. **R10 (rejected alternatives, riskiest decision).** Rejected: lowering the floor; the spec-changing levers (capability trigger, command and portability defaults, named path sets, compressed Windows evidence, dropping the GitLab `rules:changes` lists), which stay out of scope unless the coordinator asks; renaming required checks to enable lever c. Devil's advocate on R4: deleting guard code after a migration is where a silent hole appears, since a check that looks dead may guard an input a later contributor reintroduces. Mitigation: the unreachability statement per removed check, the rule that every surviving failure fixture still fails, and a mutation proof on the PR (reintroduce one removed input, show the remaining guards still reject or that the removal is justified). Acceptance: the pull request body of PR B carries the statements and the mutation proof.

## Scenarios

**Scenario:** The floor is reached

Given the last pull request of slice 3 is merged and the total of the three surfaces is measured at its commit
When the slice 5 pull requests are merged
Then the report lists each surface before and after and the total is at most 8,880 lines.

**Scenario:** A required check name would change

Given merging two `*-node-24-0` twins into a matrix job would rename a required status check
When the PLAN applies the decision rule
Then the lever is dropped for those twins and the report records "not applied" with both check names.

**Scenario:** A guard is removed only if unreachable

Given `path-filters.ts` checks a `dorny/paths-filter` block that no workflow contains after slice 3
When the simplification removes that check
Then the pull request states the input that would reach it and the grep showing none exists, and every remaining parity failure fixture still fails.

**Scenario:** A Windows job uses `gate: false` on a capability with paths

Given a `windows-*` job sets `gate: false` and its capability declares `paths:`
When `check-ci-parity` runs
Then it fails naming the job and the capability.

**Scenario:** GitLab python version differs

Given a capability with `requires.runtime: python@3.12`
When the generator emits its GitLab job
Then the job runs Python 3.12, or the parity guard fails if the documented image version differs.

**Scenario:** A required measure is missed

Given `ci:pre-push` under load takes longer than 60 s
When the report is finalized
Then it states that measure as not met with its figure instead of omitting it.

## Out of scope

- Spec-changing levers: capability trigger, command and portability defaults (d1 to d3), named path sets (d4), compressed Windows evidence (d5), dropping the GitLab `rules:changes` lists (b), unless the coordinator asks.
- Lowering the 8,880-line floor, editing the `main-protected` ruleset, or renaming any required status check.
- Running the GitLab output on a live runner.
- The `dorny/paths-filter` removal itself and its shadow-sample evidence (slice 3, issue #1780).
- Posting the final report as comments on #1777 and #1761, which the orchestrator does outside the pull requests.
- Any new framework, YAML parser or glob library.

## Open questions

- Which of the six twins can merge without renaming a check, and does any document or required check name them at PLAN time? (R3; decided by the rule, measured at PLAN.)
- Does the GitLab python recipe cost more than 10 lines per job, which selects the option of R5? (decided by measurement at PLAN.)
- Is the 30% reduction target of `specs/0280-task-ci-contract.md` R10 (assumption — verify: starting target the owner may adjust) still the owner's figure at slice 5 PLAN time?
