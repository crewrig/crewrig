# Skill evals

<!-- crewrig-doc: section=reference nav_order=165 published=true title="Skill evals" -->

A skill owns a small set of evaluation cases next to its `SKILL.md`. One command runs them on your machine and grades each skill expectation by expectation, with and without the skill, and against the base branch. A passing run writes a committed, content-hashed `evals/results.json`; the pull-request pipeline only checks that this file is fresh. Specification: [spec 0290](../specs/0290-skill-eval-runner.md) and its [delta 01](../specs/0290-skill-eval-runner.delta-01.md); decisions: [ADR 0023](adr/0023-skill-eval-executor.md).

## Run it

```sh
task skill-evals -- pr-logbook            # one skill
task skill-evals -- --changed             # every skill whose content differs from the merge-base with origin/main
task skill-evals -- pr-logbook --mock     # no process, no model call, no credential: for plumbing checks
```

Options: `--out <dir>` (default `.skill-evals/`, git-ignored), `--mock`, `--ticket <N>`, `--base <ref>` (default `origin/main`), `--judge-config <file>`.

Exit codes: `0` ok, `1` a blocking outcome, `2` usage error or unknown skill, `3` failed precondition (no credentials, a refused judge configuration, no ticket to attribute the spend to).

Everything runs on your machine. No CI job runs an eval, holds a model credential, or makes a model call.

## Requirements and scope of the measurement

- The `claude` binary (Claude Code) must be on your `PATH`: it is the executor of every run and, on the token path, the judge. A missing binary is reported as an `error` with an install hint. Unix only: the executor needs process groups.
- The eval measures a skill **on Claude Code**, not on each of the four CLIs the skill ships to. The executor is Claude Code only (spec 0290 R26). The runner is a repository development tool and deploys nothing to a CLI target, so no row under `docs/cli-matrix/rows/` exists for it.
- Each run starts from an empty conversation in a throwaway `HOME` and `CLAUDE_CONFIG_DIR`, in a throwaway workspace outside any repository, so no user or repository configuration is touched or read. A `with_skill` run installs the skill as a real skill (`SKILL.md`, `scripts/`, `references/`, `assets/`; never `evals/` or any other path, so the agent cannot read the expectations it is graded on); a `without_skill` run has no skill. The agent may use `Bash`, `Read`, `Write`, `Edit` and `Skill` only.

## Credentials

| Variable | Use |
|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | Preferred. A subscription token produced by `claude setup-token`. Given to the executor; the judge makes its calls through headless `claude -p` with the same token. |
| `ANTHROPIC_API_KEY` | Accepted when the token is absent. The executor uses it; the judge uses the existing `anthropic` driver with this key (no judge-specific variable needed). |

With neither variable set (and no `--mock`) the runner makes no model call, names both variables and how to obtain the token, and exits 3. The credential reaches the executor child through its environment only (an allowlist: `PATH`, `HOME`, `CLAUDE_CONFIG_DIR`, `LANG`, `LC_ALL`, `TMPDIR`, plus that one variable); it is never put on argv or in a file, and it is scrubbed from `transcript.md`. **Residual:** the agent's `Bash` tool can read its own environment, so the credential is exposed to the skill under test; it is your own credential on your own machine. `exit_code` checks run with no credential in their environment.

**The subscription token is never sent to the Messages API.** A judge configuration override is honoured (backend, model, `api_key_env`, `auth_mode`, `endpoint`) when supplied as a JSON file `{"judge": {...}}` through `--judge-config <file>` or the `SKILL_EVALS_JUDGE_CONFIG` variable, except that an effective configuration with backend `claude-code` (either authentication mode) or with an `api_key_env` of `CLAUDE_CODE_OAUTH_TOKEN` is refused with exit 3, naming the backend or variable. The supported judge backends are `claude-cli` (the default on the token path) and `anthropic` (the default on the API-key path); the runner writes the effective judge configuration itself in `<out>/<skill>/.judge/effective.json`.

Whether a `setup-token` value may be used outside the `claude` binary is a terms-of-use question that is deliberately not answered here; the runner routes around it. It is tracked in its own issue.

## What a run does

For each eval the runner performs paired runs in fresh context:

| Run | Skill installed | Location |
|---|---|---|
| `with_skill` (head) | the working tree | `<out>/<skill>/eval-<id>/with_skill/` |
| `without_skill` | none | `<out>/<skill>/eval-<id>/without_skill/` |
| `with_skill` (base replay) | the skill as of the merge-base with `origin/main` | `<out>/<skill>/base/eval-<id>/with_skill/` |

The `evals.json`, the eval `files` and the scripts of `exit_code` checks always come from the head, in every run. The base replay is skipped, and two runs per eval are planned instead of three, when the installed content (everything but `evals/evals.json`) is identical at base and head, or when the skill is new on the base branch.

Each run directory holds `transcript.md`, `grading.json`, `metrics.json` (measured cost, token usage, turns, seconds, the limit reached or `null`) and `outputs/` (every file the run produced). Layout and files load unchanged in skill-creator's results viewer; `benchmark.json` sits at `<out>/<skill>/benchmark.json`.

Grading order: every `checks` entry first (deterministic), then every `expectations` entry through the judge. In `grading.json` the checks therefore come first, then the expectations, each list in file order.

### Judge evidence

The judge returns a verdict and evidence per expectation. A `PASS` counts only when the evidence is valid: at least 12 non-whitespace characters and either an exact substring of the run's `transcript.md` or of a produced file (line endings normalised), or a `path:line` reference naming a produced file and an existing line. Otherwise the expectation is recorded `passed: false` with evidence stating the verdict was unsupported; `UNCERTAIN` is recorded `passed: false` too. The judge goes through the shared judge library (`tests/e2e/lib/llm_judge.ts`, entry point `llmJudgeEvidence`): same three-call quorum, same `max_calls` cap, same mock mode; its existing callers are unchanged and guarded by byte-pinned goldens. When a quorum passes, the evidence of the first `PASS` answer is the one graded.

### Trigger probes

`trigger_probes` are validated and counted. Until live trigger execution exists nothing is observed or scored: the report shows the number of probes and no match fraction.

## Settings

Every setting is one declared constant in `scripts/lib/skill-evals/settings.ts`, so recalibrating or flipping one is a one-line change. Defaults marked provisional are to be recalibrated from the measured costs on the `pr-logbook` pilot (issue #1852).

| Setting | Default | Meaning |
|---|---|---|
| `TOLERANCE` | `0.05` | A skill regresses when its head `with_skill` mean is lower than the base mean by **more than** this. Provisional: calibrate on the pilot before regression is made blocking. |
| `REGRESSION_BLOCKING` | `false` | When `true`, a regression (measured, or recorded in a results file) makes the run and the attestation check exit non-zero. |
| `MISSING_EVALS_BLOCKING` | `false` | When `true`, a changed skill without `evals/` makes the run and the attestation check exit non-zero. Stays `false` until the migration waves (issues #1852 to #1855) have landed. |
| `MAX_EXECUTOR_RUNS` | `30` | Executor runs per selected skill. Provisional. |
| `JUDGE_MAX_CALLS` | `300` | The judge `max_calls` per selected skill. Provisional. |
| `MAX_INVOCATION_USD` | `100` | Worst-case executor cost (planned runs x per-run budget) across all selected skills. |
| `EXECUTOR_CONCURRENCY` | `4` | Executor runs in flight at once. |
| `PER_RUN_TURNS` / `PER_RUN_SECONDS` / `PER_RUN_USD` | `25` / `300` / `1` | Per-run limits. A run that hits one is graded on the output it produced so far, tagged in `metrics.json`, counted in `pass_rate`, and never an `error`. |
| `EXECUTOR_MODEL` | `claude-sonnet-4-6` | The executor model, a Sonnet-class model; a run never silently uses another one. |

### Budget and cost

After the credential check and before the first model call, the runner plans every selected skill: three runs per eval (two with no base replay) against `MAX_EXECUTOR_RUNS`, the worst-case judge calls (expectations x runs x quorum, plus 25 percent for retries) against `JUDGE_MAX_CALLS`, and across all skills the planned runs multiplied by `PER_RUN_USD` against `MAX_INVOCATION_USD`. Any breach makes no model call, exits `1` with status `error` and prints planned versus cap. At runtime the caps are enforced again: executor runs are reserved before each starts so concurrent runs cannot exceed the cap; every judge attempt, retries included, counts toward `max_calls`; and the summed measured cost stops new runs at `MAX_INVOCATION_USD`. A runtime breach starts no new run, terminates the runs in flight and ends with status `error`, reporting the executor runs and judge calls used.

Worst case for one skill: 30 runs of 1 dollar and 300 seconds each; with four runs in flight about 38 minutes of executor wall time. The default `MAX_INVOCATION_USD` therefore allows 8 skills of 12 runs (the pilot size) per invocation, or about 3 skills at the per-skill cap: **a pull request that changes more skills than that must be split** (run `task skill-evals -- <skill>` per skill, or select fewer skills), or the setting raised in the same change.

The spend is attributed to a ticket through the usage subsystem before any model call: `node scripts/usage-task.ts set --channel explicit --asset forge-issue:<owner>/<repo>#<number>`. `<number>` is `--ticket`, else the number in the branch name `<prefix>/<NNNN>-<slug>`; with neither the run exits 3. `<owner>/<repo>` comes from the `origin` remote. Measured executor cost is read from the executor's result record into each `metrics.json`; a run killed at a limit may leave no result record, so its cost is `unknown` and totals are then printed as a lower bound.

The turn limit is counted by the runner from the executor's stream: one turn is one assistant message, identified by its `message.id`, so a message split over several stream events counts once. The `--max-turns` flag is also passed to `claude`, but it is absent from `claude --help`: that is an assumption, to verify at the first maintainer smoke run, and the runner-side count is the primary guard.

## Statuses

`pass`, `regression` (exit 0 unless `REGRESSION_BLOCKING`), `invalid` (the `evals.json` is invalid, or a symlink or a non-ignored untracked file sits under a hashed path), `no-evals` (warning; exit 0 unless `MISSING_EVALS_BLOCKING`), `new` (the skill does not exist on the base branch; not compared), `mock`, `error` (executor or judge failure with credentials present, a refused plan, a runtime cap). The attestation check adds `stale`. Mock mode reports `mock`, marks every `grading.json` and `benchmark.json` with `"mock": true`, writes no results file and never produces a regression or blocking outcome.

## Content hash

The content hash identifies exactly what was evaluated. It is a SHA-256 over `SKILL.md`, every file under `scripts/`, `references/` and `assets/`, and `evals/evals.json`, read **once** at run start from the working tree (a dirty tree is allowed: the hash is over content, not commits) and also used for the install, so the installed bytes equal the hashed bytes. Files are sorted by their `/`-separated relative path in UTF-8 byte order; each contributes `path NUL mode-flag NUL size NUL bytes NUL`, where the mode flag is `1` when the git **index** mode is `100755` and `0` otherwise. Bytes are never normalised. The mode is read through git (`git ls-files -s`, and `git ls-tree` at the merge-base), never from the filesystem, so the hash is identical on Windows, on Linux and with `core.fileMode=false`. The result is `sha256:` followed by 64 lowercase hexadecimal digits.

Only tracked files are hashed (a staged, uncommitted file counts). A git-ignored untracked file under a hashed path (`__pycache__/`, `.DS_Store`) is excluded from the hash and from the install; an untracked, non-ignored file or any symbolic link makes the skill `invalid`, naming the path, with no hash and no model call. `evals/results.json` is never hashed. The installed-content hash is the same computation without `evals/evals.json`; it decides whether the base replay can be skipped.

## The attestation

A non-mock run with status `pass`, `regression` or `new` writes `evals/results.json` in the skill directory: `skill_name`, `content_hash`, `runner_version`, `executor_model`, `judge_model`, `date`, `status`, `benchmark` (`with_skill_mean`, `without_skill_mean`, `base_mean`, `delta_value`, `tolerance`), `executor_runs`, `judge_calls` and `cost_usd` (`null` when a run's cost is unknown). You commit it with your change. It is never shipped, and as a file under `evals/` it needs no `metadata.provenance.version` bump.

The pull-request pipeline runs `task ci:skill-evals-attestation`, which makes no model call and needs no credential. For every skill whose content hash differs from the base, or that is new, it decides one status: `no-evals`; `invalid`; `stale` (the results file is absent, unparseable, incomplete, a mock, for another skill, records a status other than `pass`, `regression` or `new`, or records a different content hash); else the recorded status. `invalid` and `stale` always block. A pull request that changes only `evals/evals.json` needs a fresh results file, because the hash includes that file. `task ci:pre-push` includes the same check.

**Trust model.** The attestation is self-declared by a same-repository contributor: nothing proves the recorded results came from a run of the runner, so the file is forgeable by design, and a forged or hand-edited file is visible in code review. The check verifies freshness (the recorded hash matches the current content), not truth. Nothing here is a guarantee that a recorded result is genuine.

## Known limitation: fixture files are not hashed

The content hash covers `evals/evals.json` but not the fixture files its `files` entries name (for example `evals/files/diff.txt`). Editing a fixture alone therefore does **not** make `evals/results.json` stale, and the attestation check will not notice. After editing a fixture, re-run the evals and commit the new results file yourself.

## File contract

`evals/evals.json` is a normative contract owned by [spec 0290](../specs/0290-skill-eval-runner.md) (R1 to R6); other documents refer to it and never redefine it. The names `skill_name`, `evals`, `id`, `prompt`, `expected_output`, `files` and `expectations` are taken verbatim from Anthropic's skill-creator evals format; `checks` (`exit_code`, `file_exists`, `file_contains`) and `trigger_probes` are the only additions and are ignored by skill-creator. The validator reports every violation with the file, the JSON path and the rule, and fails before any model call.

`evals/` stays in the repository and is never copied to any CLI target, built output, staging directory, user-scope install or packaged archive: the build propagates only `scripts/`, `references/` and `assets/` (`scripts/lib/build-components/resources.ts`), and a test fails if a built skill directory ever contains an `evals/` path.

## Tests

The runner's own suites run in mock mode with no key and no network (`task test-skill-evals`, and `task ci:skill-evals-tests` in CI): a stub `claude` that fails any model call, a throwing `fetch`, temporary git repositories for hashing and selection.
