# Skill evals

<!-- crewrig-doc: section=reference nav_order=165 published=true title="Skill evals" -->

A skill owns a small set of evaluation cases next to its `SKILL.md`. One command runs each case once, non-interactively, on Claude Code with Sonnet 5.5 at effort `medium`, and compares the answer with what the case expects. A passing run writes a committed, content-hashed `evals/results.json`; the pull-request pipeline only checks that this file is fresh. The rules a skill and its evals follow are in the [Skill authoring standard](skill-authoring-standard.md). Specification: [spec 0290](../specs/0290-skill-eval-runner.md) and its deltas [01](../specs/0290-skill-eval-runner.delta-01.md), [03](../specs/0290-skill-eval-runner.delta-03.md) and [04](../specs/0290-skill-eval-runner.delta-04.md) (one run and one judge call per eval); decisions: [ADR 0023](adr/0023-skill-eval-executor.md).

## What a run costs

- **Executor runs** = evals + trigger probes, one run each, with the skill installed. Nothing runs without the skill or on the base revision.
- **Judge calls** = evals that have at least one expectation, one call each, plus at most 25 percent of retries. Probes are never judged.
- **Order of magnitude.** An isolated Sonnet 5.5 run measured about 0.03 US dollars in the delta-03 smoke, so 3 evals and 5 probes (8 runs, at most 3 judge calls) cost well under one dollar. The effect of `--effort medium` on cost is not measured yet; the `pr-logbook` pilot measures it.
- **Hard bounds.** At most 20 executor runs and 20 judge calls per skill, 1 US dollar and 300 seconds per run, 100 US dollars of worst-case cost per invocation. See [Budget](#budget).

## Run it

```sh
task skill-evals -- pr-logbook            # one skill
task skill-evals -- --changed             # every skill whose content differs from the merge-base with origin/main
task skill-evals -- pr-logbook --mock     # no process, no model call, no credential: for plumbing checks
```

Options: `--out <dir>` (default `.skill-evals/`, git-ignored), `--mock`, `--ticket <N>`, `--base <ref>` (default `origin/main`), `--judge-config <file>`, `--use-api-key` (bill `ANTHROPIC_API_KEY` instead of the login; see [Credentials](#credentials)).

Exit codes: `0` ok, `1` a blocking outcome, `2` usage error or unknown skill, `3` failed precondition (not logged in to Claude Code, a requested API key that is unset, a temporary directory inside `HOME` or a git work tree, a refused judge configuration, no ticket to attribute the spend to).

Everything runs on your machine. No CI job runs an eval, holds a model credential, or makes a model call.

## Requirements and scope of the measurement

- **Prerequisite.** Claude Code must be installed (the `claude` binary on your `PATH`) and you must be logged in to it (run `claude` once and log in). The binary is the executor of every run and, except under `--use-api-key`, the judge. A missing binary is reported with an install hint and exit 3. Unix only (macOS and Linux): the executor needs process groups.
- The eval measures a skill **on Claude Code**, not on each of the four CLIs the skill ships to. The executor is Claude Code only (spec 0290 R26). The runner is a repository development tool and deploys nothing to a CLI target, so no row under `docs/cli-matrix/rows/` exists for it.
- Each run starts from an empty conversation, in a throwaway workspace, and is isolated by flags rather than by a throwaway home: every `claude` child keeps your real `HOME` (and your `CLAUDE_CONFIG_DIR` when set) and receives `--setting-sources project --strict-mcp-config --no-session-persistence`, so no user or local settings, hooks, `CLAUDE.md`, MCP servers or user-scope skills are loaded and no session transcript is left behind. `--bare` is never used: it never reads the OAuth login or the keychain. The executor and the judge driver share this flag set.
- The workspace is a temporary directory outside any repository and outside `HOME`, so no repository rule and no memory file of an ancestor directory is loaded. When the temporary directory resolves inside `HOME` or inside a git work tree, the runner makes no model call, names `TMPDIR` and exits 3: point `TMPDIR` elsewhere.
- Every run (eval or probe) installs the skill at project scope, as `<workspace>/.claude/skills/<name>/` (`SKILL.md`, `scripts/`, `references/`, `assets/`; never `evals/` or any other path, so the agent cannot read the expectations it is graded on). The top-level `.claude/` directory is the install location, not an output: it is excluded from `outputs/`. An eval run may use `Bash`, `Read`, `Write`, `Edit` and `Skill` only; a probe run may use `Skill` only.
- The environment of each `claude` child is an allowlist: `PATH`, `HOME`, `LANG`, `LC_ALL`, `TMPDIR`, `USER`, `CLAUDE_CONFIG_DIR` when you set it, and, when set, the network variables `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `SSL_CERT_DIR`, `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` and their lowercase forms, plus at most one credential variable. `USER` is needed because on macOS the login is held in the keychain and `claude` reports not logged in without it; the network variables are passed so that a contributor behind a corporate certificate authority or proxy can reach the model. Nothing else reaches the child.

## Credentials

The default is your logged-in Claude Code session: no variable is needed. Two optional overrides exist. The source is chosen in this order:

| Order | Source | Use |
|---|---|---|
| 1 | `ANTHROPIC_API_KEY`, only with `--use-api-key` | Explicit opt-in. The executor uses the key; the judge uses the existing `anthropic` driver with it. With the option and an unset or empty variable the runner makes no model call, names the variable and exits 3. |
| 2 | `CLAUDE_CODE_OAUTH_TOKEN` | Optional override: a subscription token produced by `claude setup-token`. Given to the executor; the judge makes its calls through headless `claude -p` with the same token. |
| 3 | Logged-in Claude Code session | The default. The executor and the judge (headless `claude -p`) use the login; no credential variable is passed. |

Without `--use-api-key`, `ANTHROPIC_API_KEY` is never used and is removed from the environment of every `claude` child (executor, judge driver and login probe), because `claude` prefers that variable to the login whenever it sees it and would bill the key silently. The report names the credential source in use (`logged-in Claude Code session`, `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY (--use-api-key)`) without printing any secret, so you see whom the run is billed to.

**Exit 3 when not logged in.** In session mode (no token, no `--use-api-key`, no `--mock`) the runner runs `claude auth status --json` before any model call; it is a local command that makes no model call. You are logged in only when it exits 0 and its `loggedIn` field is `true`; the runner reads no other field, since the output carries your e-mail address and organisation. Otherwise it makes no model call, writes no results file, prints a message telling you to run `claude` and log in (or to set `CLAUDE_CODE_OAUTH_TOKEN`, or to pass `--use-api-key` with `ANTHROPIC_API_KEY` set), and exits 3. When `ANTHROPIC_API_KEY` is set and was not requested, the message also says that the key exists but was not requested. A login that lapses during an invocation is not a precondition failure: the affected runs end as executor failures.

A token or key reaches the executor child through its environment only; it is never put on argv or in a file, and it is scrubbed from `transcript.md`. `exit_code` checks run with no credential in their environment and a throwaway `HOME`.

**The subscription token is never sent to the Messages API.** A judge configuration override is honoured (backend, model, `api_key_env`, `auth_mode`, `endpoint`) when supplied as a JSON file `{"judge": {...}}` through `--judge-config <file>` or the `SKILL_EVALS_JUDGE_CONFIG` variable, except that an effective configuration with backend `claude-code` (either authentication mode) or with an `api_key_env` of `CLAUDE_CODE_OAUTH_TOKEN` is refused with exit 3, naming the backend or variable. The supported judge backends are `claude-cli` (the default with the logged-in session or the token) and `anthropic` (used only under `--use-api-key`); the runner writes the effective judge configuration itself in `<out>/<skill>/.judge/effective.json`.

Whether a `setup-token` value may be used outside the `claude` binary is a terms-of-use question that is deliberately not answered here; the runner routes around it by judging through `claude -p`. The same holds for the OAuth credential of the logged-in session.

## Residual risk and prerequisites

Spec 0290 delta 03 requirement 44 requires these seven statements.

- **Prerequisite.** Claude Code installed and logged in. `claude setup-token` (`CLAUDE_CODE_OAUTH_TOKEN`) and `ANTHROPIC_API_KEY` are optional overrides, not the preferred path.
- **API key opt-in and credential exposure.** `ANTHROPIC_API_KEY` is used only with `--use-api-key`. In session mode the credential is no longer in the agent's environment, so the agent's `Bash` cannot read it from there. Where Claude Code keeps the login in a file under the real configuration directory instead of the keychain, that file is reachable by the agent's `Read` and `Bash`, and the residual is not reduced. On macOS the login is held in the keychain, which the agent's `Bash` may still reach through the `security` command, subject to the operating system's own prompt, so the keychain is not unreachable. With `CLAUDE_CODE_OAUTH_TOKEN`, or with `ANTHROPIC_API_KEY` under `--use-api-key`, the credential is in the child's environment and the previous residual stands unchanged: the agent's `Bash` can read its own environment.
- **Filesystem reach.** The agent runs as you, with your real `HOME`, so its `Bash`, `Read`, `Write` and `Edit` can reach your configuration directory and can modify it. The previous throwaway `HOME` never confined the filesystem (an absolute path always reached it); it only removed the default pointer to it. No tool-level deny rule is added, because `Bash` would bypass it and the rule would be a false boundary.
- **Shared state files and concurrency.** `claude` may still update its own state files in the configuration directory (for example a credential refresh), as any invocation does, and several runs in flight share that directory. `EXECUTOR_CONCURRENCY` stays at its default of 4 in session mode, to be verified by the maintainer smoke run with four concurrent runs; lower it if concurrent credential refreshes prove to interfere.
- **Measured cost.** An isolated run on Sonnet 5.5 costs about 0.03 US dollars: 0.022 for a one-word reply, 0.028 for a skill-triggered run of five turns, 0.025 without the skill (the same one-word reply cost 0.33 with the full user configuration loaded). These figures are an input to the recalibration of issue #1852; no cost default changes with delta 03.
- **Checked-out pull requests.** Running the evals on a checked-out pull request that is not your own executes that pull request's skill and scripts as you, with your real `HOME`. Review the skill's scripts first, as for any code you run locally. (The trust model below covers the forgeability of results, not this.)
- **Network variables.** The passed-through network variables are configuration, but a proxy URL may embed credentials, which the agent's `Bash` can then read. They are your own, at the same trust as the login.

## What a run does

For each eval the runner performs one run in a fresh context, with the skill installed, in `<out>/<skill>/eval-<id>/`. For each trigger probe it performs one probe run in `<out>/<skill>/probe-<n>/`. Every `claude` argv holds `--model claude-sonnet-5-5` and `--effort medium` (the `EFFORT` setting). The `evals.json`, the eval `files` and the scripts of `exit_code` checks come from the working tree.

Each eval directory holds `transcript.md`, `judge.txt` (the raw judge answer, written before it is parsed, so it survives a judge failure), `grading.json`, `metrics.json` (measured cost, token usage, turns, seconds, the limit reached or `null`, and `skill_loaded`) and `outputs/` (every file the run produced). Each probe directory holds `transcript.md`, `metrics.json` and `probe.json` (`query`, `should_trigger`, `observed`, `passed`).

Grading order: every `checks` entry first (deterministic), then one judge call for all of the eval's `expectations`. In `grading.json` the checks therefore come first, then the expectations, each list in file order. A failed check does not prevent the judge call. The judge is not called for an eval with no expectation, or whose output directory cannot be read (its expectations are then recorded failed).

`skill_loaded` is informational: it records whether the agent called the `Skill` tool for this skill during the run, is not scored and affects no status. With no run without the skill, it is the only indication that an eval passed because of the skill rather than from the model's own knowledge. The report counts the eval runs that loaded the skill.

### Judge call

The judge returns one line per expectation: `<n> VERDICT=<PASS|FAIL> EVIDENCE=<JSON string>`. A `PASS` counts only when the evidence is valid: at least 12 non-whitespace characters and either a `path:line` reference naming a produced file and an existing line, or a match of the run's `transcript.md` or of a produced file under one of three rules, tried in this order (spec 0290 delta-05, R49):

1. *Exact*: an exact substring, line endings normalised.
2. *Normalised*: after Unicode NFKC normalisation, only letters and digits count, so markdown markers, bullets, backticks, reflowed whitespace and joined lines no longer matter. The evidence is split on `...`, `…`, `[...]` and `[…]`; every piece has at least 12 letters and digits and occurs whole-word in the material, in order.
3. *Contiguous window with a coverage floor*: the longest run of consecutive words of the evidence that occurs verbatim in the material holds at least `EVIDENCE_WINDOW_CHARS` (40) letters and digits and at least `EVIDENCE_WINDOW_SHARE` (0.30) of the letters and digits of the whole evidence. This accepts a judge that wraps a real excerpt in commentary of its own, and refuses one that wraps a real 40-character run in a claim that is mostly invented.

The rules only widen acceptance, and the check proves that the quote is grounded in the run's real output, not that it supports the expectation. A quote that is mostly real with one word altered can pass rule 3. The share floor of 0.30 is calibrated on three recorded judge answers of the `spec-author` measurements (shares 0.35, 0.38 and 0.54, against a fabricated case at about 0.20): the margins are thin and the sample is small, so treat the figure as provisional. It is recalibrated on the wave-1 judge answers under issue #1852. No committed `results.json` is invalidated: the content hash does not cover the runner and no check compares `runner_version`. Otherwise the expectation is recorded `passed: false` with evidence stating the verdict was unsupported. An expectation with no line, or an unreadable one, is recorded `passed: false` with evidence stating the judge gave no verdict. An answer with no usable line at all is a judge failure: the skill's status is `error`.

The call goes through the shared judge library (`tests/e2e/lib/llm_judge.ts`, entry point `llmJudgeEvidence`): one model call counted against `max_calls`, plus transport retries. The library's other callers keep their three-call quorum and are guarded by byte-pinned goldens.

### Trigger probes

Each `trigger_probes` entry is one run whose prompt is the probe's `query`, with `--tools Skill --max-turns 1` and the skill installed. The probe observes whether the first assistant message calls the `Skill` tool naming this skill, and passes when that equals `should_trigger`. The single turn is the early stop, not a failure: it is not tagged as a limit and is not an error. No judge call is made.

Only the skill under test is installed, so no other skill competes. A `should_trigger: false` probe tests restraint against no competitor, and a `true` probe is easier than in real use. A passing probe is not a guarantee of trigger quality in a full installation.

## Settings

Every setting is one declared constant in `scripts/lib/skill-evals/settings.ts`, so recalibrating or flipping one is a one-line change. Defaults marked provisional are recalibrated from the measured costs of the `pr-logbook` pilot (issue #1880, calibration tracked in #1852), which also receives the isolated-run costs recorded under [Residual risk and prerequisites](#residual-risk-and-prerequisites).

| Setting | Default | Meaning |
|---|---|---|
| `PASS_THRESHOLD` | `0.8` | The eval pass rate, and the probe pass rate when the skill has probes, must each reach this for the skill to be `pass`. |
| `FAIL_BLOCKING` | `false` | When `true`, a `fail` makes the run and the attestation check exit non-zero. |
| `TOLERANCE` | `0.05` | A skill regresses when its head eval pass rate is lower than the base's recorded one by **more than** this. Provisional: calibrate on the pilot before regression is made blocking. |
| `REGRESSION_BLOCKING` | `false` | When `true`, a regression (measured, or recorded in a results file) makes the run and the attestation check exit non-zero. |
| `MISSING_EVALS_BLOCKING` | `false` | When `true`, a changed skill without `evals/` makes the run and the attestation check exit non-zero. Stays `false` until the migration waves (issues #1852 to #1855) have landed. |
| `EFFORT` | `medium` | The `--effort` level of the executor, the probe runs and the judge call. Not applied under `--use-api-key`: the `anthropic` judge driver has no effort level. |
| `MAX_EXECUTOR_RUNS` | `20` | Executor runs (evals + probes) per selected skill. Provisional. |
| `JUDGE_MAX_CALLS` | `20` | The judge `max_calls` per selected skill. Provisional. |
| `MAX_INVOCATION_USD` | `100` | Worst-case executor cost (planned runs x per-run budget) across all selected skills. |
| `EXECUTOR_CONCURRENCY` | `4` | Executor runs in flight at once. |
| `PER_RUN_TURNS` / `PER_RUN_SECONDS` / `PER_RUN_USD` | `25` / `300` / `1` | Per-run limits. A run that hits one is graded on the output it produced so far, tagged in `metrics.json`, and counted like any other run. A probe's single turn is not a limit hit. |
| `EXECUTOR_MODEL` | `claude-sonnet-5-5` | The executor model, a Sonnet-class model; a run never silently uses another one. |
| `JUDGE_MODEL` | `claude-sonnet-5-5` | The judge model used by the runner, the same Sonnet-class model. |

### Budget

After the credential check and before the first model call, the runner plans every selected skill: evals plus probes against `MAX_EXECUTOR_RUNS`, the evals with expectations plus the retry allowance (25 percent) against `JUDGE_MAX_CALLS`, and across all skills the planned runs multiplied by `PER_RUN_USD` against `MAX_INVOCATION_USD`. Any breach makes no model call, exits `1` with status `error` and prints planned versus cap. At runtime the caps are enforced again: executor runs are reserved before each starts; every judge attempt, a driver retry included, counts toward `max_calls`; and the summed measured cost stops new runs at `MAX_INVOCATION_USD`. A runtime breach starts no new run, terminates the runs in flight and ends with status `error`, reporting the executor runs and judge calls used.

Worst case for one skill: 20 runs of 1 dollar and 300 seconds each; with four runs in flight about 25 minutes of wall time. **A pull request that changes more skills than the invocation cap allows must be split** (run `task skill-evals -- <skill>` per skill), or the setting raised in the same change.

The spend is attributed to a ticket through the usage subsystem before any model call: `node scripts/usage-task.ts set --channel explicit --asset forge-issue:<owner>/<repo>#<number>`. `<number>` is `--ticket`, else the number in the branch name `<prefix>/<NNNN>-<slug>`; with neither the run exits 3. `<owner>/<repo>` comes from the `origin` remote. Measured executor cost is read from the executor's result record into each `metrics.json`; a run killed at a limit may leave no result record, so its cost is `unknown` and totals are then printed as a lower bound.

The turn limit is counted by the runner from the executor's stream: one turn is one assistant message, identified by its `message.id`. The `--max-turns` flag is also passed to `claude`, but the runner-side count is the primary guard.

## Statuses

The eval pass rate is the evals that passed divided by the evals; an eval passes when all its checks and expectations pass. The probe pass rate is the probes that passed divided by the probes, absent when the skill has none. The two are graded separately so that cheap probes cannot mask failing evals. `grading.json`'s `summary.pass_rate` is the per-eval fraction of checks and expectations passed and is informational.

- `pass`: the eval pass rate, and the probe pass rate when there are probes, are each at least `PASS_THRESHOLD`.
- `fail`: otherwise. Reported; exit 0 unless `FAIL_BLOCKING`.
- `regression`: the head eval pass rate is lower than the base's by more than `TOLERANCE` (exit 0 unless `REGRESSION_BLOCKING`). When both `fail` and `regression` hold, the status is `fail` and the regression line is printed too; each blocks only under its own setting.
- `invalid`: the `evals.json` is invalid, or a symlink or a non-ignored untracked file sits under a hashed path. Always blocks.
- `no-evals`: warning; exit 0 unless `MISSING_EVALS_BLOCKING`.
- `mock`, and `error` (executor or judge failure with credentials present, a refused plan, a runtime cap).
- `stale`: added by the attestation check; always blocks.

A skill with no valid base results shows `base=n/a` and the line `not compared: no valid evals/results.json at the merge-base`; this is not a status, and its status comes from the threshold alone.

The report prints one line per skill, `<skill>: status=<status> eval_pass_rate=<rate> (<passed>/<total>) probe_pass_rate=<rate> (<passed>/<total>) threshold=<t> base=<rate> diff=<d> skill_loaded=<n>/<evals> executor_runs=<n> judge_calls=<n> cost_usd=<usd>`, where an absent figure is `n/a`, then an `invocation:` line with the totals and, in a real run, `credential_source:`.

Mock mode reports `mock`, marks every `grading.json` and `probe.json` with `"mock": true`, writes no results file and never produces a regression or blocking outcome.

### Regression

Nothing is run on the base revision. The base figure is the `eval_pass_rate` of the `evals/results.json` committed at the merge-base with the base ref (`git show`), valid when it is of the current format, not a mock, names this skill and holds a numeric `eval_pass_rate`; its content hash is not compared. Caveats:

- The head and base rates may cover different sets of evals, because the base's cases are not re-run.
- Probes are not compared.
- A skill whose merge-base has no valid file (new, never attested, a file of an older format) is not compared.

## Content hash

The content hash identifies exactly what was evaluated. It is a SHA-256 over `SKILL.md`, every file under `scripts/`, `references/` and `assets/`, and `evals/evals.json`, read **once** at run start from the working tree (a dirty tree is allowed: the hash is over content, not commits) and also used for the install, so the installed bytes equal the hashed bytes. Files are sorted by their `/`-separated relative path in UTF-8 byte order; each contributes `path NUL mode-flag NUL size NUL bytes NUL`, where the mode flag is `1` when the git **index** mode is `100755` and `0` otherwise. Bytes are never normalised. The mode is read through git (`git ls-files -s`, and `git ls-tree` at the merge-base), never from the filesystem, so the hash is identical on Windows, on Linux and with `core.fileMode=false`. The result is `sha256:` followed by 64 lowercase hexadecimal digits.

Only tracked files are hashed (a staged, uncommitted file counts). A git-ignored untracked file under a hashed path (`__pycache__/`, `.DS_Store`) is excluded from the hash and from the install; an untracked, non-ignored file or any symbolic link makes the skill `invalid`, naming the path, with no hash and no model call. `evals/results.json` is never hashed.

## The attestation

A non-mock run with status `pass`, `fail` or `regression` writes `evals/results.json` in the skill directory, with these keys in this order: `skill_name`, `content_hash`, `runner_version`, `executor_model`, `judge_model`, `effort`, `date`, `status`, `eval_pass_rate`, `probe_pass_rate` (`null` without probes), `base_eval_pass_rate` (`null` when not compared), `threshold`, `tolerance`, `evals_passed`, `evals_total`, `probes_passed`, `probes_total`, `executor_runs`, `judge_calls` and `cost_usd` (`null` when a run's cost is unknown). You commit it with your change. It is never shipped, and as a file under `evals/` it needs no `metadata.provenance.version` bump.

The pull-request pipeline runs `task ci:skill-evals-attestation`, which makes no model call and needs no credential. For every skill whose content hash differs from the base, or that is new, it decides one status: `no-evals`; `invalid`; `stale` (the results file is absent, unparseable, incomplete, a mock, for another skill, of the former shape with a `benchmark` key or the status `new`, records a status other than `pass`, `fail` or `regression`, or records a different content hash); else the recorded status. `fail` and `regression` are decided from the recorded figures with the same function as the runner, and block only under `FAIL_BLOCKING` and `REGRESSION_BLOCKING`. `invalid` and `stale` always block. A pull request that changes only `evals/evals.json` needs a fresh results file, because the hash includes that file. `task ci:pre-push` includes the same check.

**Trust model.** The attestation is self-declared by a same-repository contributor: nothing proves the recorded results came from a run of the runner, so the file is forgeable by design, and a forged or hand-edited file is visible in code review. The check verifies freshness (the recorded hash matches the current content), not truth. Nothing here is a guarantee that a recorded result is genuine.

## Known limitation: fixture files are not hashed

The content hash covers `evals/evals.json` but not the fixture files its `files` entries name (for example `evals/files/diff.txt`). Editing a fixture alone therefore does **not** make `evals/results.json` stale, and the attestation check will not notice. After editing a fixture, re-run the evals and commit the new results file yourself.

## File contract

`evals/evals.json` is a normative contract owned by [spec 0290](../specs/0290-skill-eval-runner.md) (R1 to R6); other documents refer to it and never redefine it. The names `skill_name`, `evals`, `id`, `prompt`, `expected_output`, `files` and `expectations` are taken verbatim from Anthropic's skill-creator evals format; `checks` (`exit_code`, `file_exists`, `file_contains`) and `trigger_probes` are the only additions and are ignored by skill-creator. The validator reports every violation with the file, the JSON path and the rule, and fails before any model call.

`evals/` stays in the repository and is never copied to any CLI target, built output, staging directory, user-scope install or packaged archive: the build propagates only `scripts/`, `references/` and `assets/` (`scripts/lib/build-components/resources.ts`), and a test fails if a built skill directory ever contains an `evals/` path.

## Tests

The runner's own suites run in mock mode with no key and no network (`task test-skill-evals`, and `task ci:skill-evals-tests` in CI): a stub `claude` that fails any model call, a throwing `fetch`, temporary git repositories for hashing and selection.
