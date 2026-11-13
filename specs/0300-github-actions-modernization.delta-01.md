---
id: "0300"
slug: github-actions-modernization
status: approved
complexity: standard
interaction-mode: AUTO
related-issue: 1939
version: 1.1.0
---

# Modernize the github-actions skill and the ci-configurator agent to the authoring standard

*Delta 01 of `specs/0300-github-actions-modernization.md`. Source: issue #1939, plan review v1 (findings v1-F1 and v1-F2, class `spec`). The original R10 changed exit codes and messages of the five existing scripts of the skill, which spec 0258 pins through its differential and golden oracle (R4, the closed list of deviations of R31 and its delta-01). Recording those changes needs a delta of 0258 and would collide with sibling #1940, whose spec 0301 R8 moves `check-pinned-images` in the same oracle. Decision of the orchestrator, not reopened here: the existing scripts only GAIN `--help` and `--json`, every exit code and message stays byte-identical, and the new scripts alone follow the full 0/1/2/3 contract. Requirements modified: R6 (scope sentence), R10, R11 (`validate-pipeline.ts`), R21, the scenario "empty directory, unreadable input, missing tool" and the Out of scope list. Every other requirement is unchanged. This delta opens no question.*

## ADDED

Nothing is added as a requirement. The two orderings and the exit-code mapping that v1-F2 asked to settle are written into the amended R10 and R11 below.

## MODIFIED

<!-- markdownlint-disable MD029 -->

6. **R6 (check-permissions), scope sentence, original:** "A directory with no workflow file is a usage-level refusal with exit 2, not a silent success."

**Amended (R6, scope sentence only):** The common contract of R6 to R11 (`--help`, `--json` object `{ok, data, findings}`, exit codes 0/1/2/3, directory and `-` inputs) binds the five NEW scripts only: `check-permissions.ts`, `check-pull-request-target.ts`, `check-expression-injection.ts`, `resolve-engine.ts` and `validate-pipeline.ts`. For the three check scripts, a directory with no workflow file is a usage-level refusal with exit 2 and the stderr line `[FAIL] no workflow files found under: <target>`, not a silent success, and an unreadable or missing path is exit 3. The five existing scripts are governed by R10, not by this sentence. The rest of R6 is unchanged.

10. **R10 (existing scripts: audit and scope), original:** "The five existing scripts do not follow the contract today: none accepts `--help` (each treats it as a path and exits 1 or 0) and none offers `--json`. This change SHALL bring `lint-workflow.ts`, `check-pinned-actions.ts`, `simulate-job.ts` and `simulate-workflow.ts` onto the contract (`--help`, `--json`, exit codes 0/1/2/3, ...) ... except for the explicit exit-code and message changes below ((a) missing input exit 1 to 3, (b) empty directory exit 0 to 2, (c) tool status passed through to exit 1, signals 128+n to 1, (d) internal error 1 to 3, (e) `--help` as exit 0) ... A missing external tool ... SHALL stay a skipped check with exit 0 ... `check-secrets-exposure.ts` ... the single permitted edit is the minimal handling of `--help` ..."

**Amended (R10):** The five existing scripts, `lint-workflow.ts`, `check-pinned-actions.ts`, `simulate-job.ts`, `simulate-workflow.ts` and `check-secrets-exposure.ts`, are pinned by the differential and golden suites of spec 0258 (R4 and the closed deviation list of R31 with its delta-01). This change SHALL therefore make only additive changes to them, and SHALL NOT change any of their observable behaviour that those suites exercise:

- **(a) Additions.** `lint-workflow.ts`, `check-pinned-actions.ts`, `simulate-job.ts` and `simulate-workflow.ts` SHALL gain `--help` (usage on standard output, exit 0) and `--json` (a single object `{ok, data, findings}` on standard output in place of the human-readable text, with the same exit code the run would have had without `--json`). `check-secrets-exposure.ts` SHALL gain `--help` only, because `task check-skill-quality` runs every script of a protected skill with `--help` and reports an error otherwise; its `--json`, its detection and its replacement by the shared engine belong to sibling #1941. A bare `--help` or `--json` argument was never a valid path for these scripts, so no existing case changes.
- **(b) Unchanged, byte for byte.** Without `--json`, standard output, standard error and the exit code of every existing script SHALL stay identical to today for every input, and that includes: an unreadable or missing input path (exit 1, and for `simulate-job.ts` the `[FAIL] workflow file not found` line, for `simulate-workflow.ts` also `[FAIL] event payload file not found`), a directory with no workflow file (exit 0, the `[OK]` line of `check-pinned-actions.ts` and the `[SKIP] no workflow files found under: <target>` line of `lint-workflow.ts`), the non-zero status of `actionlint` or `act` passed through verbatim by `simulate-job.ts` and `simulate-workflow.ts` (a tool killed by a signal keeps its present handling), the end of `simulate-workflow.ts` after SIGINT or SIGTERM (status 128 plus the signal number, temporary payload file removed), an unexpected internal error (exit 1), usage errors (exit 2) and findings (exit 1). The existing exit-0-with-`[SKIP]` behaviour for a missing tool (`actionlint`, `act`, the `docker` CLI or daemon) stays, and the existing order stays: the tool check runs before the target check, so a missing tool with a missing target or an empty directory is still exit 0 with the `[SKIP]` line.
- **(c) Under `--json`.** A skipped external tool SHALL be reported as a warning finding `tool-missing` and `ok: true`, with the exit code the legacy run has (0). A legacy error path (missing path, internal error, tool status, signal) under `--json` SHALL report an error finding and keep the legacy exit code, so no mapping to 2 or 3 exists for these five scripts. The `--json` output is new surface: it is pinned by golden captures (below), not by the 0258 suites.
- **(d) Proof.** The existing 0258 differential and golden suites SHALL pass unchanged: the contributor SHALL NOT edit a 0258 golden file, deviation entry or fold, and SHALL NOT mint a new deviation letter. The new flags SHALL be pinned by golden captures of `--help` and `--json` stored with the tests of this skill, outside the 0258 oracle.
- **(e) Where the full contract lives.** The exit codes 0/1/2/3 of R6 apply to the five new scripts only. A migration of the legacy scripts onto them is out of scope here and needs a delta of 0258.

The rest of R10 (its audit sentence aside) is replaced by the five points above.

11. **R11 (agent-facing scripts), `validate-pipeline.ts` bullet, original:** "`validate-pipeline.ts <workflow-file-or-directory>...` SHALL run, from the same directory, `lint-workflow.ts`, `check-pinned-actions.ts`, `check-permissions.ts`, `check-pull-request-target.ts`, `check-expression-injection.ts` and `check-secrets-exposure.ts` on its inputs, and report each check as `ran` and passed, `ran` with findings, or `skipped` with the reason (the check script absent or its external tool missing). It SHALL exit 1 when any check that ran reported an error finding, and 0 otherwise. ..."

**Amended (R11, `validate-pipeline.ts`):** `validate-pipeline.ts <workflow-file-or-directory>...` SHALL follow this order:

1. A usage error is exit 2.
2. Target validity comes first: an input directory with no workflow file is exit 2 with `[FAIL] no workflow files found under: <target>`, an unreadable or missing input is exit 3. No check has run and no tool has been looked for when either occurs. This is how the empty-directory and missing-path behaviour of the legacy scripts stays unreachable from the pipeline.
3. Only then does it run, from the same directory, `lint-workflow.ts`, `check-pinned-actions.ts`, `check-permissions.ts`, `check-pull-request-target.ts`, `check-expression-injection.ts` and `check-secrets-exposure.ts`, and report each check as `ran` and passed, `ran` with findings, or `skipped` with the reason (the check script absent, or its external tool missing). It SHALL never mark a check `ran` that was skipped.

How it reads each check:

- The three new checks: exit 0 is `ran` and passed, exit 1 is `ran` with findings, and any other status, a signal or a spawn failure makes the pipeline exit 3 with the check named and that check reported as `failed`, never `ran`.
- `lint-workflow.ts` and `check-pinned-actions.ts`: it calls them with `--json` and reads the object and the legacy exit code. Legacy exit 0 with a `tool-missing` finding is `skipped` (tool missing); exit 0 without it is `ran` and passed; legacy exit 1 with an error finding is `ran` with findings; legacy exit 2, or exit 1 with no error finding (an internal error), makes the pipeline exit 3 with the check named and reported as `failed`.
- `check-secrets-exposure.ts`: it reads the exit code only and never its output, so it works whether or not sibling #1941 has landed, in either merge order. Exit 0 is `ran` and passed; exit 1 is `ran` with findings, with the script's standard output and standard error relayed verbatim in the report, since a finding and an internal error share that code; any other status, a signal or a spawn failure makes the pipeline exit 3 with the check named and reported as `failed`.

The pipeline SHALL exit 1 when any check that ran reported an error finding, 0 when every check ran and passed or was skipped, and 3 when any check `failed`. It writes nothing and makes no network call. The `resolve-engine.ts` bullet of R11 is unchanged.

Order for the new scripts in general (answers v1-F2): for `check-permissions.ts`, `check-pull-request-target.ts`, `check-expression-injection.ts`, `resolve-engine.ts` and `validate-pipeline.ts`, usage is checked first (exit 2), then target validity (empty directory exit 2, unreadable path exit 3), and only then the availability of an external tool. A missing tool is never reported ahead of an invalid target for these scripts. The three checks and `resolve-engine.ts` need no external tool.

21. **R21 (script tests), original:** "Each new or modified script of R6 to R11 SHALL have automated tests that run with no network and cover: the success path, every rule it can report, a compliant case for every flagged construct, the `unparsed` warning of R9, the usage error, the `--json` shape, `--help`, and (for the contract migration of R10) that the human-readable output without `--json` is unchanged against a recorded fixture, and that each exit-code change of R10 holds, including the missing event-payload file (exit 3) and the interruption by SIGINT or SIGTERM (exit 1, temporary payload file removed). The tests SHALL run from a copy of the built skill directory outside the repository, as the `doc-writer` tests do, so that a script that imports a repository file fails."

**Amended (R21):** Each new script of R6 to R11 SHALL have automated tests that run with no network and cover: the success path, every rule it can report, a compliant case for every flagged construct, the `unparsed` warning of R9, the usage error, the `--json` shape, `--help`, the empty directory (exit 2), the unreadable path (exit 3), and the order of R10 and R11 (an invalid target with a tool absent is still exit 2 or 3). For `validate-pipeline.ts` the tests SHALL also cover each mapping of the amended R11, including a `skipped` check, a `failed` check (exit 3) and `check-secrets-exposure.ts` read by exit code only. For each existing script, the tests SHALL cover `--help` (exit 0) and, for the four that gain it, `--json` against golden captures, plus a check that the run without `--json` is unchanged: the existing 0258 differential and golden suites passing with no edit to their golden files or deviation entries, and the order of R10(b) (a missing tool with a missing target or empty directory is still exit 0 with the `[SKIP]` line) pinned by the existing `skip-without-actionlint-*` and `workflow-missing-without-tools` cases. No test SHALL expect an exit code of 2 or 3 from an existing script for a missing, unreadable or empty target. The tests SHALL run from a copy of the built skill directory outside the repository, as the `doc-writer` tests do, so that a script that imports a repository file fails.

Scenario "Failure path — empty directory, unreadable input, missing tool", original:

> - **Given** a directory with no workflow file, an unreadable path, or a machine without `actionlint`,
> - **When** a check runs,
> - **Then** the empty directory is a usage-level exit 2 for every check including the migrated `lint-workflow.ts` and `check-pinned-actions.ts`, the unreadable path is exit 3 for every script of R6 to R11 and the four migrated ones, and the missing tool is a visible skip with exit 0 that `validate-pipeline.ts` reports as `skipped`, never as `ran`.

**Amended (scenario):**

### Failure path — empty directory, unreadable input, missing tool

- **Given** a directory with no workflow file, an unreadable path, or a machine without `actionlint`,
- **When** a new check (`check-permissions.ts`, `check-pull-request-target.ts`, `check-expression-injection.ts`) or `validate-pipeline.ts` runs, or an existing script (`lint-workflow.ts`, `check-pinned-actions.ts`) runs on the same input,
- **Then** for the new scripts the empty directory is exit 2 and the unreadable path is exit 3, whether or not a tool is present; for the existing scripts the behaviour is exactly today's (the empty directory exits 0 with the `[OK]` or `[SKIP]` line, the unreadable path exits 1, a missing tool exits 0 with the `[SKIP]` line before any target check); and `validate-pipeline.ts` reports a missing `actionlint` as `skipped`, never as `ran`.

### Failure path — existing scripts stay byte-identical

- **Given** the five existing scripts of the skill and the 0258 differential and golden suites,
- **When** the suites run on the rewritten skill with no edit to their golden files or deviation entries,
- **Then** every case passes, `--help` exits 0 on all five, `--json` returns the `{ok, data, findings}` object on the four that gain it, and the golden captures of those two flags pass.

## REMOVED

Nothing is removed as a requirement. Removed from the original text, quoted above and replaced under MODIFIED: the exit-code and message changes (a) to (e) of R10, the "usage-level exit 2 for every check including the migrated `lint-workflow.ts` and `check-pinned-actions.ts`" clause of the scenario, and the exit-code-change tests of R21. With them the concern about extending the closed deviation list of spec 0258 disappears: this change adds no deviation, no letter and no overlay to that oracle.

### Out of scope

Added to the Out of scope list of the parent spec:

- Any change of exit code, message, empty-directory behaviour, tool-absent behaviour or signal handling of the five existing scripts, and any edit of the 0258 oracle (a delta of spec 0258 owns such a migration, to be coordinated with sibling #1940 if it is ever wanted).
- `--json` for `check-secrets-exposure.ts` (sibling #1941).
