---
id: "0290"
slug: skill-eval-runner
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1849
version: 2.0.0
---

# Skill eval runner: grade a skill from its evals.json when SKILL.md changes

*Delta 01 of `specs/0290-skill-eval-runner.md`. Sources: (1) the approved PLAN of issue #1849 (v2 and v3), which found places where the base spec cannot be implemented as written or leaves a layout and cost decision open: R5 asks for an observed trigger decision that nothing produces, R10 and R14 do not match the shapes skill-creator's results viewer loads, R23 is silent on a single run's cost, on several skills in one invocation and on measured spend, and R26's premise fails for the executor; (2) the user's scope decision that LLM-judged evals run on the contributor's machine and never in CI: the pull-request pipeline makes no model call and holds no model secret, as for every other check today, and instead verifies a committed, content-hashed results file produced by the local run. The version is a MAJOR bump: the CI execution contract of R17, R18, R22 and R24 (secrets, fork skip, job summary of a model run) is replaced, which invalidates the approved plan's CI steps. This delta opens no question.*

## ADDED

<!-- markdownlint-disable MD029 -->

27. **Per-run executor limits.** The runner SHALL apply three declared, documented per-run settings to every executor run: a turn limit (default 25), a wall-clock limit (default 300 seconds) and a per-run budget (default 1 US dollar). A run that hits a limit SHALL be graded on the output it produced so far, SHALL be tagged with the limit reached in its `metrics.json`, SHALL be counted in `pass_rate` like any other run, and SHALL NOT be reported as `error`.
    Acceptance: a run killed at the wall-clock limit leaves a `metrics.json` naming that limit, a `grading.json` graded on the partial output, and does not turn the skill's status into `error`.

28. **Aggregate cost bound.** The runner SHALL declare one documented setting, `max-invocation-usd`, defaulting to 100. After the credential check of R33 and before the first model call, the runner SHALL compute the worst-case executor cost as the planned executor runs across all selected skills multiplied by the per-run budget of requirement 27. When that cost exceeds `max-invocation-usd`, the runner SHALL make no model call, SHALL exit non-zero with status `error`, and SHALL report the planned cost versus the cap and advise selecting fewer skills per invocation.
    Acceptance: 210 planned runs at a 1 dollar per-run budget against the default of 100 make no model call, exit non-zero and print 210 and 100.

29. **Bounded concurrency.** The runner SHALL execute executor runs through a pool bounded by one documented local setting, `executor-concurrency`, defaulting to 4. The executor-run cap of R23 SHALL be reserved before each run starts, so concurrent runs cannot exceed it, and a runtime cap breach SHALL start no new run and terminate the runs in flight.
    Acceptance: with `executor-concurrency` of 4 no more than 4 executor runs are in flight at once, and a cap breach with 4 in flight starts no fifth run.

30. **Measured executor cost.** The runner SHALL read the total cost in US dollars and the token usage from the executor's result record of every run and SHALL write them to that run's `metrics.json`. The runner's report SHALL show the measured executor cost per skill and per invocation, and the results file of requirement 36 SHALL record the skill's total. A run that ended at a limit of requirement 27, and so may leave no result record, SHALL record its cost as unknown and SHALL be graded under requirement 27, never as an executor failure. Only a run that did not start, or that ended abnormally without reaching a limit and left no result record, SHALL record its cost as unknown and count as an executor failure under R24.
    Acceptance: for two skills of 6 and 4 runs, the report lists the sum of each skill's run costs and the sum over all 10 runs; a mock run killed at the wall-clock limit with no result record has cost `unknown` and is graded under requirement 27 without turning the status into `error`; a mock run that exits abnormally with no limit and no result record has cost `unknown` and makes the status `error`.

31. **Executor model pinned.** The executor's model SHALL be a Sonnet-class model selected through one declared, documented setting, and a run SHALL NOT silently use any other model. The rationale for the choice is recorded in an ADR, not in this spec.
    Acceptance: the model identifier given to the executor of every run equals the setting's value, and changing the setting changes it.

32. **Skill install contents.** For a `with_skill` run the runner SHALL install the skill into the agent under test by copying `SKILL.md` and the `scripts/`, `references/` and `assets/` directories of the skill when they exist, and SHALL NOT copy `evals/` or any other path, so the agent under test cannot read the expectations it is graded on.
    Acceptance: for a skill holding `SKILL.md`, `scripts/`, `evals/` and a stray `notes.md`, the installed skill directory contains the first two and neither of the others.

33. **Local credentials.** Executor and judge SHALL use the credentials of the contributor's own Claude Code installation, read from the environment: `CLAUDE_CODE_OAUTH_TOKEN` (produced by `claude setup-token`, subscription) SHALL be preferred and `ANTHROPIC_API_KEY` SHALL be accepted when it is absent. The judge SHALL follow the credential in use: with `CLAUDE_CODE_OAUTH_TOKEN` the judge's model calls are made by headless `claude -p`, the same binary and authentication as the executor (through the additional judge driver of R15); with `ANTHROPIC_API_KEY` alone the existing `anthropic` driver is used, and the runner SHALL accept `ANTHROPIC_API_KEY` as that judge's credential without requiring any judge-specific variable (how it is mapped is a plan detail). The runner SHALL NEVER send the subscription credential to the Messages API, that subscription credential being the value of `CLAUDE_CODE_OAUTH_TOKEN` or the OAuth credential held in the contributor's Claude credentials file. The judge library reads its configuration from the `judge` section of the `effective.json` in the directory named by `E2E_REPORT_DIR`, and its library default backend is `anthropic`; the runner SHALL build that effective judge configuration itself for its judge calls, in a directory of its own under the output directory, so that on the token path the default backend is the additional headless-`claude -p` driver of R15 and on the API-key path it is `anthropic` with `ANTHROPIC_API_KEY` as its credential. A contributor MAY override the judge configuration (backend, model or `api_key_env`), however supplied, except that when the effective configuration would make a driver send the subscription credential to the Messages API, namely backend `claude-code` in either authentication mode, or any driver whose `api_key_env` names `CLAUDE_CODE_OAUTH_TOKEN`, the runner SHALL make no model call, name the backend or variable and the reason, and exit 3. Apart from the variables the existing judge configuration already reads, the runner SHALL read no other credential variable. When neither variable is set and mock mode is off, the runner SHALL make no model call, SHALL print a message naming both variables and how to obtain the token, and SHALL exit 3.
    Acceptance: with both variables unset the entry point exits 3, names both variables and makes no model call; with only `ANTHROPIC_API_KEY` set the planning proceeds; with both set the token is the one given to the executor. With only the token set, every judge call is made through headless `claude -p` and no request reaches the Messages API with the token; with only `ANTHROPIC_API_KEY` set (and no judge-specific key variable) the judge uses the `anthropic` driver and its request authenticates with that key; an override of the judge configuration is honoured, except that an effective configuration with backend `claude-code` (in `oauth` or `api_key` mode) or with an `api_key_env` of `CLAUDE_CODE_OAUTH_TOKEN` makes the runner exit 3 naming it, with no model call, whichever credential variables are set.

34. **Changed-skill selection.** `task skill-evals -- --changed` SHALL select exactly the skills whose content hash (requirement 35) differs between the working tree and the merge-base of the current branch with `origin/main`, or that do not exist at that merge-base. The hash at the merge-base is computed over the same file set. A change to any hashed file, `evals/evals.json` included, selects the skill; a change confined to `evals/results.json` or to an unhashed file does not. A selected skill is planned as R19 and R23 state: three executor runs per eval, or two with no base replay when its installed content is identical to the merge-base's (for example when only `evals/evals.json` changed) or the skill is new. When no skill is selected the entry point SHALL exit 0 and say that nothing changed.
    Acceptance: a branch that edits one line of a skill's `scripts/` selects that skill and plans 3 runs per eval; a branch that edits only its `evals/evals.json` selects it and plans 2 runs per eval; a branch that edits only `evals/results.json`, or touches no skill, selects none; the set selected by `--changed` equals the set the attestation check of requirement 37 examines for the same base.

35. **Content hash.** The runner SHALL compute, per skill, the *content hash*, from the skill's source directory in the working tree as it stands when the run starts, with file bytes read from the working tree; a dirty tree is allowed because the hash is over content, not commits. Select: `SKILL.md`, every file under `scripts/`, `references/` and `assets/` (recursively), and `evals/evals.json`. Sort them by their path relative to the skill directory, written with `/` separators, in byte order of the UTF-8 encoding. Feed a SHA-256 digest, for each file in that order, the record: the relative path in UTF-8, a NUL byte, the mode flag as the single ASCII byte `1` when the file's git index mode is `100755` and `0` otherwise, a NUL byte, the file size in bytes as decimal ASCII, a NUL byte, the file's bytes unmodified (no line-ending or whitespace normalisation) and a NUL byte. The mode flag is read through git, never from the filesystem: from `git ls-files -s` (the index) for the working tree and from `git ls-tree` at the merge-base for the base, whose bytes are read from the merge-base tree. The hash is therefore identical on Windows, on Linux, and with `core.fileMode=false`. No other mode, owner or timestamp is hashed. Only a tracked file (present in the git index; a staged, uncommitted file qualifies) is hashed. A git-ignored untracked file under a selected path (for example `__pycache__/` content or `.DS_Store`) is excluded from the content hash and from the R32 install, and never makes the skill invalid. An untracked file under a selected path that is not git-ignored makes the skill `invalid`: the path is named with a message to `git add` it, and no hash is computed and no model call is made. A tracked file is hashed even if an ignore rule matches it. The *installed-content hash* is the same computation over the same files without `evals/evals.json`; the runner uses it, and only it, to decide whether base and head installed content are identical (R19). Record the digest as `sha256:` followed by 64 lowercase hexadecimal digits. `evals/results.json` and any other file are never hashed. The runner SHALL read the selected files once at run start, and hash and install (R32) from that one read, so the installed copy of `SKILL.md`, `scripts/`, `references/` and `assets/` is byte-identical to the hashed files. The runner SHALL install exactly the hashed files. A symbolic link among the selected paths (index mode `120000`, whether a file or a directory entry under the three directories) likewise makes the skill `invalid`, naming the path.
    Acceptance: changing one byte of any hashed file, adding or deleting a hashed file, or renaming one, changes the hash; changing `evals/results.json` or any unhashed file does not; toggling the git index mode of a hashed file between `100644` and `100755` without changing its bytes changes the hash; `core.fileMode=false`, or a filesystem permission change that leaves the index mode alone, does not; the installed-content hash ignores `evals/evals.json` and changes with every other hashed change; two checkouts holding the same files hash equal whatever the creation order; an uncommitted edit to `scripts/` changes the hash of a dirty tree; a symlink under `scripts/`, or a file under a hashed path that is neither in the index nor git-ignored, makes the skill `invalid` naming the path, and no hash is produced.

36. **Results file.** A non-mock run whose status is `pass`, `regression` or `new` SHALL write `evals/results.json` in the skill's source directory (replacing any previous one), a JSON object with exactly these keys: `skill_name`; `content_hash`, the content hash of requirement 35 computed at run start from the source directory that was installed for that run; `runner_version`; `executor_model` and `judge_model`, the model identifiers used; `date`, an ISO 8601 UTC timestamp; `status`; `benchmark`, an object with `with_skill_mean`, `without_skill_mean`, `base_mean` (null when the skill is new or the base replay was skipped under R19), `delta_value` and `tolerance`; `executor_runs` and `judge_calls`, the counts used; and `cost_usd`, the measured total of requirement 30, or null when any run's cost is unknown. A run with any other status, and every mock run, SHALL NOT write or modify `evals/results.json`. The file is committed by its author, is never shipped (R7) and, as a file under `evals/`, needs no `metadata.provenance.version` bump (R8: the skill-version check watches `SKILL.md` files only). A skill whose installed content equals the base's (R19) is planned with two runs per eval, reports `pass` with a null `base_mean`, and so can always be attested.
    Acceptance: a mock run leaves `evals/results.json` byte-identical or absent; a real run with status `pass` writes all keys with `content_hash` equal to the content hash computed from the tree it ran on; a run of a skill whose `scripts/` changed with `SKILL.md` unchanged writes a numeric `base_mean`; a run of a skill whose only change is `evals/evals.json` writes status `pass` with `base_mean` null; a skill with a limit-hit run and unknown cost writes `cost_usd` null; a change touching only `evals/results.json` passes the skill-version check.

37. **Attestation check.** A deterministic checker SHALL make no model call and SHALL need no credential. For each skill whose content hash differs between the pull request's head and its base, or that is new, it SHALL decide one status: `no-evals` when the skill has no `evals/` directory; `invalid` when `evals.json` is missing or invalid under R6, or a symbolic link or a non-ignored untracked file makes the skill invalid under requirement 35; `stale` when `evals/results.json` is absent, unparseable, lacks a key of requirement 36, carries `"mock": true`, names another `skill_name`, records a `status` other than `pass`, `regression` or `new`, or records a `content_hash` different from the skill's current content hash; otherwise the recorded `status`. Outcomes: `invalid` and `stale` SHALL be blocking (non-zero exit naming the skill and the reason) with no setting to relax them; `no-evals` and recorded `regression` SHALL be reported and SHALL block only under `missing-evals-blocking` and `regression-blocking` respectively (R20, R21). Because the content hash includes `evals/evals.json`, a pull request that changes only that file requires a fresh results file.
    Acceptance: see the scenarios *stale attestation blocks*, *fresh attestation passes*, *mock results are stale*, *an unrecognised status is stale*, *an evals.json change requires a fresh attestation* and *recorded regression is reported*.

38. **Trust model.** The attestation is self-declared by a same-repository contributor: nothing proves that the recorded results came from a run of the runner, so the file is forgeable by design, and any forged or edited file is visible in code review. The checker of requirement 37 verifies freshness (that the recorded hash matches the current content), not truth. The documentation of the runner SHALL state this trust model, and no requirement of this spec SHALL be read as a guarantee that a recorded result is genuine.

39. **No model in CI.** No CI job defined or changed for this spec SHALL make a model call, SHALL be given a model credential, or SHALL declare a secret in `ci/ci-capabilities.yml`. The runner SHALL NOT read `ANTHROPIC_EXECUTOR_API_KEY`, `SKILL_EVALS_PR_NUMBER` or `SKILL_EVALS_REPO`; none of these names exists in this design.
    Acceptance: the `skill-evals-attestation` capability entry declares no secret and its command runs with the credential variables of requirement 33 unset.

40. **Out of scope.** Added to the base list: running or re-running evals in CI under any trigger; verifying that a results file was produced by the runner (signing, provenance, re-execution); CI-side execution settings such as a job timeout sized for runner execution.

## MODIFIED

**Intent.** Original: "...one command runs them for one skill on a laptop or in the pull-request pipeline." Replacement: one command runs them for one skill, or for every changed skill, on the contributor's machine; the pull-request pipeline only checks that a fresh results file is committed.

**R5 (trigger probes).** Original: "Probes SHALL NOT be counted in `grading.json` or in the `pass_rate` of R14; they are reported separately as the fraction of probes whose observed trigger decision matched `should_trigger`." Replacement: "Probes SHALL NOT be counted in `grading.json` or in the `pass_rate` of R14. Until live trigger execution exists (see Out of scope), probes SHALL be validated under R5 and R6 and counted, and the report SHALL show the number of probes per skill with no match fraction; no trigger decision is observed or scored."

**R9 (paired runs).** Original last sentences: "...with a throwaway configuration that touches no user or repository configuration. ... Choosing the executor that satisfies this guarantee is left to PLAN." Replacement: the throwaway configuration SHALL touch no user or repository configuration and receives the credentials of requirement 33 through the environment only; the installed skill contents are those of requirement 32; the executor is Claude Code (R26).

**R10 (output layout).** Original: "Each run SHALL write to its own directory `<out>/<skill>/eval-<id>/<with_skill|without_skill>/` containing the produced files, a `transcript.md` of the run, and `grading.json`." Replacement: "Each run SHALL write to its own directory `<out>/<skill>/eval-<id>/<with_skill|without_skill>/` containing `transcript.md` and `grading.json` at that directory's top level and every file the run produced under its `outputs/` subdirectory. The `with_skill` replay on the base `SKILL.md` (R19) SHALL write under `<out>/<skill>/base/` with the same per-eval layout. The skill-level `benchmark.json` is unchanged." R4's "run's output directory" is thereby the run's `outputs/` subdirectory: a check `path` SHALL be relative to it and SHALL NOT escape it.

**R13 (judge evidence).** Original: "An expectation SHALL be recorded `passed: true` only when the verdict is PASS and the evidence is non-empty and, when it is an excerpt, occurs verbatim in the run's output." Replacement: "An expectation SHALL be recorded `passed: true` only when the verdict is PASS and the evidence is valid. Evidence is valid when it contains at least 12 non-whitespace characters and is either an exact substring of the run's `transcript.md` or of a file the run produced, line endings normalised, or a `path:line` reference naming a produced file and an existing line of it. Any other PASS SHALL be recorded `passed: false` with evidence stating that the verdict was unsupported." The UNCERTAIN rule is unchanged.

**R14 (benchmark.json).** Original: "`runs` ... one entry per run carrying `eval_id`, `configuration` ... and that run's `summary` from `grading.json` ... plus a `delta` entry equal to the `with_skill` mean minus the `without_skill` mean." Replacement: each `runs` entry SHALL carry `eval_id`, `configuration`, that run's `summary` from `grading.json`, and a `result` object carrying the same figures in the shape skill-creator's results viewer reads. `run_summary` SHALL carry `delta` as an object `{"pass_rate": "<signed decimal>"}`, for example `"+0.10"` or `"-0.05"`, and SHALL carry the same difference, `with_skill` mean minus `without_skill` mean, as the number `delta_value`. Mean and population standard deviation are unchanged.

**R15 (judge reuse).** Original: "Judging SHALL go through the existing judge library at `tests/e2e/lib/llm_judge.ts` and inherit its drivers (`anthropic`, `claude-code`, `gemini`, `ollama-cloud`), its three-call quorum, its `max_calls` cap and its `E2E_JUDGE_MOCK` mock mode, with behaviour unchanged for its existing callers." Replacement: judging still goes through `tests/e2e/lib/llm_judge.ts` and inherits its quorum, its `max_calls` cap and its mock mode, with behaviour unchanged for its existing callers. For the skill-evals runner on the token credential (requirement 33), the judge's model call is made by headless `claude -p` through one additional driver added to the judge library; adding that driver is permitted by this delta and no existing driver is modified. The base Out of scope bar on changing drivers is read as barring changes to existing drivers. The other sentences of R15 (evidence without altering existing output or exit behaviour, no new `.py` file, no vendored skill-creator Python) stand.

**R16 (entry point).** Original: "A `task` entry point SHALL run the evals of exactly one named skill, `task skill-evals -- <skill-name>`, locally and in CI ..." Replacement: `task skill-evals -- <skill-name>` SHALL run the evals of exactly one named skill and `task skill-evals -- --changed` SHALL run those of every skill selected by requirement 34, both on the contributor's machine only. An unknown name SHALL exit non-zero naming it. The entry point SHALL accept an option that selects the output directory and an option that selects mock mode. Exit 3 is reserved for a failed precondition (requirement 33).

**R17 (CI trigger).** Original: "The pull-request pipeline SHALL run the evals of a skill if and only if that skill's `SKILL.md` is modified ... a pull request that modifies no `SKILL.md` SHALL run no eval and SHALL make no judge call." Replacement: the pull-request pipeline SHALL run the attestation check of requirement 37, and only that, for the skills whose content hash (requirement 35) differs from the base; a pull request that changes no skill's hashed content SHALL check no skill. The pipeline SHALL run no eval and make no model call under any trigger, and no scheduled or push-to-branch run SHALL exist.

**R18 (capability and task wiring).** Original: "`ci/ci-capabilities.yml` SHALL gain a portable capability `skill-evals`, triggered on `pull-request` only, path-filtered to `artifacts/**/skills/*/SKILL.md` ... whose `command` is `task ci:skill-evals`; `taskfiles/ci/integration.yml` SHALL define that task." Replacement: `ci/ci-capabilities.yml` SHALL gain a portable capability `skill-evals-attestation`, triggered on `pull-request` only, path-filtered to `artifacts/**/skills/**`, requiring full history for the base comparison, declaring no secret (requirement 39), whose `command` is `task ci:skill-evals-attestation`; `taskfiles/ci/integration.yml` SHALL define that task. `task ci:pre-push` SHALL include the same check, so a contributor learns of a stale attestation before pushing. A second capability SHALL run the runner's own tests in mock mode (R25) whenever the runner's sources change. Both SHALL satisfy `docs/ci-reference-format.md` and the CI parity check.

**R19 (regression metric).** Original: "...for the head revision of `SKILL.md` and for the base revision of `SKILL.md`, both over the evals file of the head revision..." Replacement: the base replay SHALL install the whole skill as it is at the merge-base with `origin/main` (`SKILL.md`, `scripts/`, `references/` and `assets/`, per requirement 32), while the measuring instruments stay those of the head: `evals.json`, the eval `files`, and the scripts run by `exit_code` checks, which SHALL be run from the head skill directory. The runner SHALL skip the base replay only when the installed content is identical between base and head, that is when the installed-content hash of requirement 35 is equal; it then runs two executor runs per eval instead of three, compares no means, and reports status `pass` with the base mean not applicable. A skill new on the base branch SHALL likewise run two runs per eval and report `new`. A change confined to `scripts/`, `references/` or `assets/` changes the installed content, so it is replayed and compared; a regression introduced in a script is therefore detected. Every other sentence of R19 is unchanged.

**R20 (blocking outcomes).** Original: "The run SHALL exit non-zero ... when a changed skill has an `evals/` directory and its `evals.json` is invalid (R6). A regression (R19) SHALL be reported ... and SHALL NOT make the run exit non-zero by default. Whether it does SHALL be controlled by exactly one declared, documented setting, `regression-blocking` ..." Replacement: unchanged for the runner and extended to the attestation check: an invalid `evals.json` blocks in both; a regression, measured by the runner or recorded in a results file, is reported and blocks only under `regression-blocking` (default false); a `stale` attestation (requirement 37) blocks always.

**R21 (skill without evals).** Original: "...the run SHALL exit 0 for that skill. Whether that warning blocks SHALL be controlled by exactly one declared, documented setting, `missing-evals-blocking` ..." Replacement: the same sentence for both the runner and the attestation check; `missing-evals-blocking` governs both.

**R22 (report).** Original: "...and, when running in the pull-request pipeline, SHALL write the same summary to the job summary. The status SHALL be one of `pass`, `regression` ..., `invalid`, `no-evals`, `new`, `skipped`, `mock`, `error`." Replacement: the runner SHALL print a per-skill summary (status, `with_skill` and `without_skill` means, delta, base mean, executor runs used, judge calls used, measured cost); the attestation check SHALL print, and write to the job summary, one line per checked skill with its status and, for `stale`, `invalid` and `no-evals`, the reason. No model run summary is written by CI. The status SHALL be one of `pass`, `regression` (reported with exit 0 unless `regression-blocking` is true), `invalid`, `no-evals`, `new`, `stale`, `mock`, `error`; `skipped` no longer exists.

**R23 (budget, cost guard and attribution).** Original: "Per invocation the runner SHALL enforce two caps ... `max-executor-runs` ... and the judge's `max_calls` (R15)." Replacement: the two caps SHALL apply per selected skill, not per invocation: each skill is planned, checked and enforced against its own `max-executor-runs` (default 30) and judge `max_calls` (default 300), and the pre-flight, runtime enforcement and `error` outcome of R23 apply to each skill on that basis. The planned executor runs of a skill are, for each eval, three (head `with_skill`, base `with_skill`, `without_skill`), or two when the installed content is identical between base and head (R19) or the skill is new on the base branch. The two defaults SHALL be documented as provisional, to be recalibrated from the measured costs of requirement 30 on the `pr-logbook` pilot (issue #1852). The aggregate bound and concurrency are requirements 28 and 29. The usage declaration is unchanged, except that its `<number>` is the ticket number (no pull-request number exists, since nothing runs in CI): `node scripts/usage-task.ts set --channel explicit --asset forge-issue:<owner>/<repo>#<number>`. The runner reports the measured executor cost from the executor's result record, per requirement 30.

**R24 (backend unavailable).** Original: "When the executor or the judge backend has no credentials, the runner SHALL report each affected skill as `skipped` ... and SHALL exit 0, so that pull requests without access to secrets are not blocked." Replacement: missing credentials are a precondition failure, handled by requirement 33 (exit 3, no model call); there is no `skipped` status and no exit-0 skip. The remaining sentences stand: when credentials are present but the executor fails or the judge fails or returns no verdict after its retries, the runner SHALL report `error` and exit non-zero; mock mode SHALL report `mock`, SHALL mark every written `grading.json` and `benchmark.json` with `"mock": true`, SHALL NOT write `evals/results.json` (requirement 36), and SHALL NOT produce a regression or blocking outcome from mocked verdicts.

**R25 (offline tests).** Original list of covered areas: "...the three missing-evals paths (R21) and the unavailable-backend paths (R24) and the budget (R23)." Replacement: the list SHALL replace the unavailable-backend paths by the credential preconditions of requirement 33 and SHALL add the content hash (requirement 35), the results file (requirement 36), the attestation outcomes (requirement 37) and the changed-skill selection (requirement 34). The tests run with no API key and no network, in mock mode.

**R26 (CLI matrix finding).** Original: "...the work SHALL NOT add or change a row under `docs/cli-matrix/rows/`; if the plan finds that a per-CLI difference does arise, it SHALL record the evidence per `docs/cli-matrix-maintenance.md` and add the row in the same change." Replacement: the judge drivers other than the additional one of R15 remain independent of any installed agent CLI. On the token path, the skill-evals runner needs the `claude` binary for both the executor of R9 and the judge, and the documentation of the runner SHALL record this. The executor is Claude Code only. The eval measures a skill on Claude Code, not on each of the four CLIs the skill ships to, and the documentation of the runner SHALL say so. No row is added or changed under `docs/cli-matrix/rows/`, because the runner is a repository development tool and deploys nothing to a CLI target.

**Scenarios.** Replaced: *changed skill with healthy evals passes* (its `Given` and `When` name the pipeline running the evals) is restated below as *a local run writes the attestation*; the scenarios *regression versus base is reported and does not block by default*, *the regression-blocking knob flips the same condition*, *drop within tolerance does not block*, *invalid evals.json blocks before any model call*, *skill without evals warns and does not block by default* and *the blocking knob flips the same condition* stand, read as applying to the runner and to the attestation check alike.

## REMOVED

Quoted scenario titles of the base spec, false under the local-execution design:

- *no credentials is a visible skip* (a fork pull request skipped in CI with exit 0): removed with the `skipped` status; replaced by *missing credentials exit 3*.
- *executor without credentials is a visible skip*: removed for the same reason; covered by *missing credentials exit 3*, which names either variable.
- *no SKILL.md change means no eval and no spend*: removed; replaced by *an evals.json change requires a fresh attestation* and by requirement 39 (CI never spends).

Also removed from the base requirements, as parts of R17, R18, R22 and R24 quoted above: CI execution of evals, the CI judge and executor secrets, the fork skip rule, the CI job summary of a model run and the CI attribution to a pull-request number.

## Scenarios

**Scenario:** a local run writes the attestation

```text
Given a contributor changed skills/pr-logbook/SKILL.md, has CLAUDE_CODE_OAUTH_TOKEN set, and the skill has a valid evals/evals.json
When  they run task skill-evals -- pr-logbook and the head with_skill mean equals the base mean
Then  the report shows status pass with both means and the delta
And   evals/results.json is written with the content hash of the tree the run used and the measured cost
And   the run exits 0
```

**Scenario:** stale attestation blocks

```text
Given a pull request changes scripts/ of a skill after its evals/results.json was written
When  the attestation check runs
Then  the recorded content_hash differs from the current content hash
And   the status is stale, the check names the skill and the reason, and exits non-zero
And   no model call is made
```

**Scenario:** fresh attestation passes

```text
Given a pull request changes a skill's SKILL.md and its evals/results.json records the current content hash with status pass
When  the attestation check runs with no credential variable set
Then  the status is pass and the check exits 0
```

**Scenario:** mock results are stale

```text
Given a changed skill whose evals/results.json carries "mock": true
When  the attestation check runs
Then  the status is stale and the check exits non-zero
```

**Scenario:** recorded regression is reported

```text
Given a fresh results file recording status regression and regression-blocking left at false
When  the attestation check runs
Then  the report names the skill, the base mean, the head mean and the tolerance
And   the check exits 0
```

**Scenario:** the regression knob blocks recorded regressions

```text
Given the same results file and regression-blocking set to true
When  the attestation check runs
Then  the check exits non-zero naming the skill
```

**Scenario:** missing credentials exit 3

```text
Given neither CLAUDE_CODE_OAUTH_TOKEN nor ANTHROPIC_API_KEY is set and mock mode is off
When  the contributor runs task skill-evals -- pr-logbook
Then  no model call is made
And   the message names both variables
And   the run exits 3, and no results file is written
```

**Scenario:** changed-skill selection follows the content hash

```text
Given a branch that edits one line of a skill's references/ file and another skill's evals/results.json only
When  the contributor runs task skill-evals -- --changed
Then  the first skill is selected and the second is not
```

**Scenario:** a scripts-only change gets a real comparison

```text
Given a skill whose scripts/ changed while its SKILL.md equals the merge-base SKILL.md, with 2 evals
When  the contributor runs task skill-evals -- --changed
Then  the skill is selected and 6 executor runs are planned, including a base replay that installs the merge-base scripts/
And   the exit_code checks of the base replay run the head scripts
And   a script change that lowers the with_skill mean below the base mean by more than the tolerance gives status regression
And   evals/results.json is written and the attestation check then reports the recorded status
```

**Scenario:** an evals-only change plans two runs per eval

```text
Given a skill whose only change is evals/evals.json, with 2 evals
When  the contributor runs task skill-evals -- --changed
Then  the skill is selected, 4 executor runs are planned with no base replay
And   the status is pass with a null base_mean and evals/results.json is written
```

**Scenario:** the executable bit is part of the content hash, through the index

```text
Given a skill with a tracked script scripts/run.sh at index mode 100644
When  its index mode is changed to 100755 (git update-index --chmod=+x) and its bytes are left unchanged
Then  the content hash and the installed-content hash change
And   a results file recording the previous content hash is stale
```

**Scenario:** the hash ignores the filesystem mode

```text
Given the same skill checked out with core.fileMode=false, or on a filesystem without permission bits
When  the content hash is computed
Then  it equals the hash computed on a Linux checkout holding the same index modes and bytes
```

**Scenario:** an untracked file makes the skill invalid, an ignored file does not

```text
Given a changed skill with a new, never-added, non-ignored file scripts/helper.sh
When  the runner or the attestation check examines it
Then  the status is invalid naming scripts/helper.sh with a message to git add it
And   no hash is computed and no model call is made

Given the same skill with only a git-ignored scripts/__pycache__/x.pyc and a .DS_Store
When  the content hash is computed
Then  the skill is not invalid, the hash equals the hash without those files, and neither file is installed
```

**Scenario:** the token is never sent to the Messages API

```text
Given only CLAUDE_CODE_OAUTH_TOKEN is set and the judge configuration is left at its default
When  the runner judges an expectation
Then  the judge's model call is made by headless claude -p
And   no request is sent to the Messages API with the token
```

**Scenario:** a judge configuration that would send the subscription credential is refused

```text
Given a contributor override that sets the judge backend to claude-code in oauth mode, or sets api_key_env to CLAUDE_CODE_OAUTH_TOKEN
When  the contributor runs task skill-evals -- pr-logbook
Then  no model call is made
And   the message names the backend or variable and says it would send the subscription credential to the Messages API
And   the run exits 3
```

**Scenario:** the runner builds the judge configuration

```text
Given only CLAUDE_CODE_OAUTH_TOKEN is set and no judge override
When  the runner prepares its judge calls
Then  its effective judge configuration, in a directory of its own, selects the headless-claude backend
And   with only ANTHROPIC_API_KEY set it selects the anthropic backend instead
```

**Scenario:** an API key alone authenticates the judge

```text
Given only ANTHROPIC_API_KEY is set and no judge-specific key variable
When  the runner judges an expectation with the anthropic driver against a recording endpoint
Then  the request carries that key as its credential
```

**Scenario:** an evals.json change requires a fresh attestation

```text
Given a pull request that modifies only a skill's evals/evals.json, whose results file records the previous content hash
When  the attestation check runs
Then  the skill is checked, its status is stale and the check exits non-zero
```

**Scenario:** an unrecognised status is stale

```text
Given a changed skill whose results file carries the current content hash and the status "error"
When  the attestation check runs
Then  the status is stale and the check exits non-zero
```

**Scenario:** a symlink makes the skill invalid

```text
Given a changed skill with a symbolic link under scripts/
When  the runner or the attestation check examines it
Then  the status is invalid naming the path, no hash is computed and no model call is made
```

**Scenario:** a limit-ended run without a result record is not an error

```text
Given a mock executor run killed at the wall-clock limit that leaves no result record
When  the runner grades it
Then  its cost is unknown and it is graded on its partial output under requirement 27
And   the skill's status is not error and the results file records cost_usd null
```

**Scenario:** a limit hit is graded on partial output

```text
Given an executor run that reaches the 300 second wall-clock limit after producing part of its output
When  the runner grades that run
Then  grading.json reflects the partial output
And   metrics.json names the wall-clock limit
And   the run counts in pass_rate and the skill's status is not error
```

**Scenario:** an over-cost plan is refused before any call

```text
Given three selected skills whose planned executor runs total 210 and the default max-invocation-usd of 100
When  the runner computes its plan
Then  no model call is made
And   the status is error with 210 dollars planned and the cap of 100
And   the run exits non-zero
```

**Scenario:** measured cost is reported

```text
Given a skill whose executor result records report 0.40 and 0.35 dollars
When  the runner prints its summary
Then  each run's metrics.json holds its cost and token usage
And   the report shows 0.75 dollars for the skill and the invocation total
And   results.json records cost_usd 0.75
```

**Scenario:** identical installed content skips the base replay

```text
Given a run of a skill whose installed content is identical at base and head, with 2 evals
When  the runner plans the run
Then  it plans 4 executor runs and no base replay
```

**Scenario:** evals are not installed with the skill

```text
Given a skill with SKILL.md, scripts/ and evals/
When  the runner installs it for a with_skill run
Then  the installed directory holds SKILL.md and scripts/ and no evals/ path
```

**Scenario:** short evidence is unsupported

```text
Given the judge returns PASS with the evidence "ok"
When  the runner records the expectation
Then  passed is false and the evidence states the verdict was unsupported
```
