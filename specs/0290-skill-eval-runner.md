---
id: "0290"
slug: skill-eval-runner
status: approved
complexity: standard
interaction-mode: INTERMEDIATE
related-issue: 1849
version: 1.0.0
---

# Skill eval runner: grade a skill from its evals.json when SKILL.md changes

## Intent

A maintainer who changes a skill's `SKILL.md` learns, before the change merges, whether the skill still makes an agent behave better than the same agent without it. Each skill owns a small, versioned set of evaluation cases that live next to it, and one command runs them for one skill on a laptop or in the pull-request pipeline. The result shows, expectation by expectation, what passed and what evidence supports it, and a change that makes the skill measurably worse than the base branch is reported to its author. Running the evals costs money, so the spend is capped, attributed to a ticket, and never silently counted as a pass when the judge could not run.

## Requirements

1. **R1 (location).** A skill's evaluation cases SHALL live in `evals/evals.json` inside that skill's source directory (`artifacts/<layer>/skills/<skill>/evals/evals.json`). The file's schema, defined by R2 to R6, is a normative contract owned by this spec; other specs and the authoring standard (issue #1848) SHALL refer to it and SHALL NOT redefine it.
2. **R2 (shape).** The file SHALL be a JSON object with exactly these top-level keys: `skill_name` (string, required), `evals` (array of at least one eval, required), `trigger_probes` (array, optional). The `skill_name`, `evals`, and per-eval `id`, `prompt`, `expected_output`, `files`, `expectations` names and meanings are taken verbatim from Anthropic's skill-creator evals format; `checks` (R4) and `trigger_probes` (R5) are the only additions, are optional, and are ignored by skill-creator. Reference instance:

    ```json
    {
      "skill_name": "pr-logbook",
      "evals": [
        {
          "id": 1,
          "prompt": "Open a PR for the change described in diff.txt.",
          "expected_output": "A PR title and body that follow the project's PR format.",
          "files": ["evals/files/diff.txt"],
          "expectations": [
            "The title starts with a single gitmoji and has no conventional-commit prefix",
            "The body contains a section named 'How to test this PR?'"
          ],
          "checks": [
            { "type": "file_contains", "path": "pr-body.md", "pattern": "How to test this PR\\?" }
          ]
        }
      ],
      "trigger_probes": [
        { "query": "write the PR description for my branch", "should_trigger": true },
        { "query": "refactor this Python function", "should_trigger": false }
      ]
    }
    ```

3. **R3 (eval fields).** Each eval SHALL carry: `id` (unique positive integer within the file), `prompt` (non-empty string, the task given to the agent), `expected_output` (non-empty string, a human description of success), `files` (array of strings, possibly empty, each a path relative to the skill directory that resolves to an existing file; the runner SHALL copy each into the root of the run's workspace under its base name before the run, so the agent under test sees it as `./<base name>`; two `files` entries of one eval with the same base name make the file invalid under R6), and `expectations` (array of non-empty strings, each a single verifiable statement about the run). An eval SHALL declare at least one expectation or at least one check.
4. **R4 (deterministic checks).** An eval MAY carry `checks`: an array of objects, each with a `type` from a closed set. `exit_code` takes `script` (a path under the skill's `scripts/` directory), optional `args` (array of strings) and `expected` (integer, default 0), and passes when the script exits with that code. `file_exists` takes `path` and passes when the run produced that file. `file_contains` takes `path` and `pattern` (a regular expression) and passes when the produced file matches it. A `path` SHALL be relative to the run's output directory and SHALL NOT escape it. An unknown `type` makes the file invalid.
5. **R5 (trigger probes).** Each trigger probe SHALL be an object with `query` (non-empty string) and `should_trigger` (boolean). Probes SHALL NOT be counted in `grading.json` or in the `pass_rate` of R14; they are reported separately as the fraction of probes whose observed trigger decision matched `should_trigger`.
6. **R6 (validity rules).** A file SHALL be valid if and only if it is well-formed JSON, satisfies R2 to R5, and its `skill_name` equals the name of the skill's directory. Agreement between the directory name and the `name` in the `SKILL.md` frontmatter is checked by the existing skill-structure checks, not by this validator. The validator SHALL report every violation, naming the file, the JSON path and the rule, and SHALL fail without running any eval when the file is invalid.
7. **R7 (never shipped).** `evals/` SHALL remain in the repository and SHALL NOT be copied to any CLI target, built output, staging directory, user-scope install or packaged archive. Today the build propagates only `scripts/`, `references/` and `assets/` of a skill (`scripts/lib/build-components/resources.ts`), so no build change is required; this requirement makes that behaviour a tested invariant, and any future change that would copy `evals/` SHALL exclude it. An automated check SHALL fail when a built skill directory contains an `evals/` path.
8. **R8 (existing tooling tolerates evals).** The skill linter, the built-components drift check, the path-ownership check and the skill-version check SHALL accept a skill directory that contains `evals/`. A change that touches only files under a skill's `evals/` SHALL NOT require a `metadata.provenance.version` bump of that skill.

9. **R9 (paired runs in fresh context).** For each eval the runner SHALL perform two runs: `with_skill`, in which the skill is available as a whole directory (`SKILL.md`, `scripts/`, `references/` and `assets/`) together with the eval's `prompt` and `files`, and `without_skill`, which has the `prompt` and `files` only. In a `with_skill` run the agent under test SHALL be able to read the skill's references and assets and to execute the skill's scripts, so that a skill which delegates deterministic work to `scripts/` is exercised as it would run when installed; the skill SHALL be installed as a real skill in the agent under test, with a throwaway configuration that touches no user or repository configuration. Each run SHALL start from an empty conversation that shares no state with any other run. Choosing the executor that satisfies this guarantee is left to PLAN.
10. **R10 (output layout).** Each run SHALL write to its own directory `<out>/<skill>/eval-<id>/<with_skill|without_skill>/` containing the produced files, a `transcript.md` of the run, and `grading.json`. The skill-level `benchmark.json` SHALL sit at `<out>/<skill>/benchmark.json`. The layout and file formats SHALL load unchanged in skill-creator's results viewer.
11. **R11 (grading.json).** `grading.json` SHALL contain `expectations`, an array of objects `{text, passed, evidence}` with `text` a string, `passed` a boolean and `evidence` a non-empty string, and `summary`, an object `{passed, failed, total, pass_rate}` where `passed + failed = total` and `pass_rate = passed / total` (0 when `total` is 0). Every eval expectation and every check SHALL appear as exactly one entry, in file order, with a check's `text` derived from its type and arguments.
12. **R12 (assertion order).** The runner SHALL evaluate all `checks` of a run before any judge call. A check failure SHALL be recorded with its observed value as evidence. The judge SHALL be called only for `expectations` entries, and SHALL NOT be called for a run whose output directory cannot be read.
13. **R13 (judge evidence).** The judge SHALL be asked, per expectation, for a verdict and for evidence: a verbatim excerpt of the run's output or a produced-file path with the supporting line. An expectation SHALL be recorded `passed: true` only when the verdict is PASS and the evidence is non-empty and, when it is an excerpt, occurs verbatim in the run's output. A PASS without evidence, or with an excerpt not found in the output, SHALL be recorded `passed: false` with evidence stating that the verdict was unsupported. A judge verdict of UNCERTAIN SHALL be recorded `passed: false` with evidence stating that the verdict was uncertain.
14. **R14 (benchmark.json).** `benchmark.json` SHALL contain `runs`, an array with one entry per run carrying `eval_id`, `configuration` (`with_skill` or `without_skill`) and that run's `summary` from `grading.json`, and `run_summary`, an object keyed by configuration whose values carry `pass_rate` as `{mean, stddev}` over the evals of that configuration, plus a `delta` entry equal to the `with_skill` mean minus the `without_skill` mean. The standard deviation SHALL be the population standard deviation and SHALL be 0 for a single eval.
15. **R15 (judge reuse).** Judging SHALL go through the existing judge library at `tests/e2e/lib/llm_judge.ts` and inherit its drivers (`anthropic`, `claude-code`, `gemini`, `ollama-cloud`), its three-call quorum, its `max_calls` cap and its `E2E_JUDGE_MOCK` mock mode, with behaviour unchanged for its existing callers. Evidence (R13) SHALL be obtained without altering the output or exit behaviour that the existing end-to-end suites observe. No new `.py` file SHALL be added and no skill-creator Python SHALL be vendored.

16. **R16 (one skill locally).** A `task` entry point SHALL run the evals of exactly one named skill, `task skill-evals -- <skill-name>`, locally and in CI, and SHALL exit non-zero naming the unknown name when no such skill exists. It SHALL accept an option that selects the output directory and an option that selects mock mode.
17. **R17 (CI trigger).** The pull-request pipeline SHALL run the evals of a skill if and only if that skill's `SKILL.md` is modified by the pull request relative to its base branch. A pull request that modifies no `SKILL.md` SHALL run no eval and SHALL make no judge call. No scheduled or push-to-branch run of the evals SHALL exist.
18. **R18 (capability and task wiring).** `ci/ci-capabilities.yml` SHALL gain a portable capability `skill-evals`, triggered on `pull-request` only, path-filtered to `artifacts/**/skills/*/SKILL.md`, requiring full history for the base-branch comparison, whose `command` is `task ci:skill-evals`; `taskfiles/ci/integration.yml` SHALL define that task. A second capability SHALL run the runner's own tests in mock mode (R24) whenever the runner's sources change. Both SHALL satisfy `docs/ci-reference-format.md` and the CI parity check.
19. **R19 (regression metric).** For each changed skill that has valid evals, the runner SHALL compute the `with_skill` mean `pass_rate` (R14) for the head revision of `SKILL.md` and for the base revision of `SKILL.md`, both over the evals file of the head revision, in the same fresh-context conditions. The `without_skill` run does not depend on `SKILL.md`, so it SHALL be run once per eval, on the head revision only; only the `with_skill` run SHALL be replayed on the base `SKILL.md`. A skill SHALL be a regression when the head mean is lower than the base mean by more than the tolerance, which SHALL be a single declared, documented constant defaulting to 0.05 (five percentage points); the documentation SHALL state that this default is to be calibrated on the `pr-logbook` pilot (issue #1852) before regression is made blocking. A skill whose `SKILL.md` does not exist on the base branch SHALL be reported as new and not compared.
20. **R20 (blocking outcomes).** The run SHALL exit non-zero, naming the skill and the reason, when a changed skill has an `evals/` directory and its `evals.json` is invalid (R6). A regression (R19) SHALL be reported, naming the skill and giving both means, the delta and the tolerance, and SHALL NOT make the run exit non-zero by default. Whether it does SHALL be controlled by exactly one declared, documented setting, `regression-blocking`, defaulting to false, following the same pattern as `missing-evals-blocking` (R21): flipping it SHALL be a one-line change and SHALL make the same condition exit non-zero.
21. **R21 (skill without evals).** A changed skill that has no `evals/` directory SHALL be reported as a warning naming the skill, and the run SHALL exit 0 for that skill. Whether that warning blocks SHALL be controlled by exactly one declared, documented setting, `missing-evals-blocking`, defaulting to false until the skill migration waves (issues #1852 to #1855) have landed; flipping it SHALL be a one-line change and SHALL make the same condition exit non-zero. A skill that has an `evals/` directory but no `evals.json` SHALL be treated as invalid under R20.
22. **R22 (report).** The runner SHALL print a per-skill summary (status, `with_skill` and `without_skill` means, delta, base mean, executor runs used, judge calls used, skipped reason when any) and, when running in the pull-request pipeline, SHALL write the same summary to the job summary. The status SHALL be one of `pass`, `regression` (reported with exit 0 unless `regression-blocking` is true), `invalid`, `no-evals`, `new`, `skipped`, `mock`, `error`.

23. **R23 (budget, cost guard and attribution).** Per invocation the runner SHALL enforce two caps, each a single declared, documented setting: `max-executor-runs`, the number of with_skill and without_skill runs (R9), and the judge's `max_calls` (R15). Documented defaults SHALL be sized so that a normal skill with a small eval set fits within both. After the credential check of R24 and before the first model call the runner SHALL compute the planned executor runs (for each eval: one head `with_skill` run, one base `with_skill` replay (R19) and one `without_skill` run, or two runs for a skill new on the base branch) and the worst-case judge calls (expectations, times runs, times the quorum, plus retries); if either exceeds its cap it SHALL make no model call, SHALL exit non-zero with status `error` and SHALL report planned versus cap. Both caps SHALL also be enforced at runtime, because retries can exceed the plan: when a cap would be exceeded the runner SHALL stop calling the model, SHALL exit non-zero with status `error` and SHALL report the executor runs and judge calls used. The runner SHALL declare its usage through the existing usage subsystem before any model call, with `node scripts/usage-task.ts set --channel explicit --asset forge-issue:<owner>/<repo>#<number>`, where `<number>` is the pull-request number in CI and the ticket number locally; the asset kind `forge-issue` and its reference grammar are those of `docs/usage-record-format.md` (External asset kinds), and no new asset kind is introduced.
24. **R24 (backend unavailable).** When the executor or the judge backend has no credentials, the runner SHALL report each affected skill as `skipped` with the missing-credentials reason naming which backend is missing and SHALL exit 0, so that pull requests without access to secrets are not blocked; this skip SHALL be visible in the report and the job summary and SHALL NOT be reported as `pass`. When credentials are present but the executor fails or the judge fails or returns no verdict after its retries, the runner SHALL report `error` and exit non-zero. Mock mode SHALL report `mock`, SHALL mark every written `grading.json` and `benchmark.json` with `"mock": true`, and SHALL NOT produce a regression or blocking outcome from mocked verdicts.
25. **R25 (offline tests).** The runner's own automated tests SHALL run with no API key and no network, using mock mode, and SHALL cover: schema validation (R6), check evaluation (R4), the evidence rule (R13), the output layout and formats (R10, R11, R14), the changed-skill selection (R17), the regression arithmetic, tolerance boundary and `regression-blocking` knob (R19, R20), the three missing-evals paths (R21) and the unavailable-backend paths (R24) and the budget (R23).
26. **R26 (CLI matrix finding).** Because the judge drivers call model APIs directly and no driver depends on which agent CLI is installed, the work SHALL NOT add or change a row under `docs/cli-matrix/rows/`; if the plan finds that a per-CLI difference does arise, it SHALL record the evidence per `docs/cli-matrix-maintenance.md` and add the row in the same change.

## Scenarios

**Scenario:** changed skill with healthy evals passes

```text
Given a pull request modifies artifacts/core/skills/pr-logbook/SKILL.md
And   that skill has a valid evals/evals.json and judge credentials are present
And   the head with_skill mean pass_rate equals the base mean
When  the pipeline runs task ci:skill-evals
Then  the runner runs each eval once with and once without the skill
And   it writes grading.json per run and benchmark.json for the skill
And   the report shows status pass with both means and the delta
And   the run exits 0
```

**Scenario:** regression versus base is reported and does not block by default

```text
Given a changed skill whose base with_skill mean is 0.90 and whose head mean is 0.80
When  the runner compares them with the default tolerance of 0.05
Then  the status is regression
And   the report names the skill, 0.90, 0.80, the delta and the tolerance
And   the run exits 0
```

**Scenario:** the regression-blocking knob flips the same condition

```text
Given the same regression and regression-blocking set to true
When  the runner compares them
Then  the status is regression
And   the run exits non-zero naming the skill
```

**Scenario:** a with_skill run can execute the skill's scripts

```text
Given a skill whose scripts/ directory holds a script, and an eval whose expectation can only be met by running that script
When  the runner performs the with_skill run
Then  the agent under test runs the script and the expectation passes
And   the same eval without the skill does not pass
```

**Scenario:** drop within tolerance does not block

```text
Given a changed skill whose base with_skill mean is 0.90 and whose head mean is 0.86
When  the runner compares them
Then  the status is pass
And   the run exits 0
```

**Scenario:** invalid evals.json blocks before any model call

```text
Given a changed skill whose evals.json has two evals with id 1 and a skill_name that differs from the directory name
When  the runner validates the file
Then  it reports both violations with file and JSON path
And   it makes no model call and no judge call
And   the run exits non-zero with status invalid
```

**Scenario:** skill without evals warns and does not block by default

```text
Given a changed skill with no evals/ directory and missing-evals-blocking left at its default
When  the runner processes it
Then  the report shows status no-evals with a warning naming the skill
And   the run exits 0
```

**Scenario:** the blocking knob flips the same condition

```text
Given the same skill with no evals/ directory and missing-evals-blocking set to true
When  the runner processes it
Then  the run exits non-zero naming the skill
```

**Scenario:** an unsupported PASS is rejected

```text
Given the judge returns PASS for an expectation but its evidence excerpt does not occur in the run's output
When  the runner records the expectation
Then  passed is false and the evidence states the verdict was unsupported
And   the summary counts it as failed
```

**Scenario:** deterministic checks run before the judge

```text
Given an eval with a file_exists check that fails and two expectations
When  the runner grades the with_skill run
Then  the failed check appears first in grading.json with its observed value as evidence
And   the judge is called only for the two expectations
```

**Scenario:** no credentials is a visible skip

```text
Given a pull request from a fork modifies a SKILL.md and no judge credentials are available
When  the pipeline runs task ci:skill-evals
Then  the report and job summary show status skipped with the missing-credentials reason
And   the run exits 0
And   no result is reported as pass
```

**Scenario:** judge outage is an error, not a pass

```text
Given credentials are present and the judge backend returns no verdict after its retries
When  the runner processes a changed skill
Then  the status is error
And   the run exits non-zero
```

**Scenario:** an over-budget plan is refused before any call

```text
Given a changed skill whose planned executor runs exceed max-executor-runs
When  the runner computes its plan
Then  no model call is made
And   the status is error with planned versus cap reported
And   the run exits non-zero
```

**Scenario:** a runtime cap stops the run

```text
Given a plan within both caps and retries that push the judge calls past max_calls
When  the cap would be exceeded
Then  the runner stops calling the model, reports the executor runs and judge calls used and exits non-zero with status error
```

**Scenario:** executor without credentials is a visible skip

```text
Given judge credentials are present and executor credentials are not
When  the runner processes a changed skill
Then  the status is skipped naming the executor as missing
And   the run exits 0
```

**Scenario:** no SKILL.md change means no eval and no spend

```text
Given a pull request modifies only docs and a skill's evals/evals.json
When  the pipeline evaluates the skill-evals capability
Then  no eval is run and no judge call is made
```

**Scenario:** evals are not shipped

```text
Given a skill with an evals/ directory
When  the components are built for every CLI target
Then  no built skill directory contains an evals/ path
And   the built-components drift check passes
```

**Scenario:** runner tests need no key

```text
Given no API key and no network access
When  the runner's own tests run in mock mode
Then  they pass and every grading.json and benchmark.json they produce carries "mock": true
```

## Out of scope

- The authoring standard, `check-skill-quality.ts` and any rule on what a good eval contains (issue #1848); that work refers to the contract in R1 to R6.
- Writing `evals/evals.json` for any existing skill; that belongs to the migration waves (issues #1852 to #1855).
- Evals for agents and commands, and evals of a skill's `scripts/` beyond the `exit_code` check.
- Measuring real skill-trigger behaviour in a live agent CLI; probes are stored and reported (R5) and their live execution is a later spec.
- A nightly or scheduled run, a stored baseline of past results, and trend dashboards.
- Per-skill cost breakdown in the usage dashboard; cost is attributed to the ticket only (R23).
- Choosing the executor and the judge backend for the paired runs; this is a PLAN decision constrained by R9 (skill installed as a real skill, scripts runnable), R15 and R26.
- Vendoring or porting skill-creator's Python scripts or its description-optimization loop.
- Changing the judge's three-call quorum, its drivers or the end-to-end suites that call it, beyond R15.
- Flipping `missing-evals-blocking` or `regression-blocking` to true; each is a later spec delta (the former once the migration waves land, the latter once the tolerance is calibrated on the `pr-logbook` pilot, issue #1852).

## Open questions

None. The regression tolerance, the missing-evals policy, the judge outage policy and the base-replay approach were settled at the SPECS gate.
