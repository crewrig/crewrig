# Skill evals

<!-- crewrig-doc: section=reference nav_order=165 published=true title="Skill evals" -->

A skill owns a small set of evaluation cases next to its `SKILL.md`. One command runs them on your machine and grades each skill expectation by expectation, with and without the skill, and against the base branch. A passing run writes a committed, content-hashed `evals/results.json`; the pull-request pipeline only checks that this file is fresh. Specification: [spec 0290](../specs/0290-skill-eval-runner.md) its [delta 01](../specs/0290-skill-eval-runner.delta-01.md) and its [delta 03](../specs/0290-skill-eval-runner.delta-03.md) (logged-in session, isolation by flags); decisions: [ADR 0023](adr/0023-skill-eval-executor.md).

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
- A `with_skill` run installs the skill at project scope, as `<workspace>/.claude/skills/<name>/` (`SKILL.md`, `scripts/`, `references/`, `assets/`; never `evals/` or any other path, so the agent cannot read the expectations it is graded on); a `without_skill` run has no `.claude/skills` directory, so the two arms differ only by the installed skill. The base replay installs the merge-base skill the same way. The top-level `.claude/` directory is the install location, not an output: it is excluded from `outputs/`. The agent may use `Bash`, `Read`, `Write`, `Edit` and `Skill` only.
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

Every setting is one declared constant in `scripts/lib/skill-evals/settings.ts`, so recalibrating or flipping one is a one-line change. Defaults marked provisional are to be recalibrated from the measured costs on the `pr-logbook` pilot (issue #1852), which also receives the isolated-run smoke costs recorded under [Residual risk and prerequisites](#residual-risk-and-prerequisites) as an input; none of the cost defaults changed with delta 03.

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
| `EXECUTOR_MODEL` | `claude-sonnet-5-5` | The executor model, a Sonnet-class model (accepted by `claude` 2.1.322 in the delta-03 smoke); a run never silently uses another one. |
| `JUDGE_MODEL` | `claude-sonnet-5-5` | The judge model used by the runner, the same Sonnet-class model. |

### Budget and cost

After the credential check and before the first model call, the runner plans every selected skill: three runs per eval (two with no base replay) against `MAX_EXECUTOR_RUNS`, the worst-case judge calls (expectations x runs x quorum, plus 25 percent for retries) against `JUDGE_MAX_CALLS`, and across all skills the planned runs multiplied by `PER_RUN_USD` against `MAX_INVOCATION_USD`. Any breach makes no model call, exits `1` with status `error` and prints planned versus cap. At runtime the caps are enforced again: executor runs are reserved before each starts so concurrent runs cannot exceed the cap; every judge attempt, retries included, counts toward `max_calls`; and the summed measured cost stops new runs at `MAX_INVOCATION_USD`. A runtime breach starts no new run, terminates the runs in flight and ends with status `error`, reporting the executor runs and judge calls used.

Worst case for one skill: 30 runs of 1 dollar and 300 seconds each; with four runs in flight about 38 minutes of executor wall time. The default `MAX_INVOCATION_USD` therefore allows 8 skills of 12 runs (the pilot size) per invocation, or about 3 skills at the per-skill cap: **a pull request that changes more skills than that must be split** (run `task skill-evals -- <skill>` per skill, or select fewer skills), or the setting raised in the same change.

The spend is attributed to a ticket through the usage subsystem before any model call: `node scripts/usage-task.ts set --channel explicit --asset forge-issue:<owner>/<repo>#<number>`. `<number>` is `--ticket`, else the number in the branch name `<prefix>/<NNNN>-<slug>`; with neither the run exits 3. `<owner>/<repo>` comes from the `origin` remote. Measured executor cost is read from the executor's result record into each `metrics.json`; a run killed at a limit may leave no result record, so its cost is `unknown` and totals are then printed as a lower bound.

The turn limit is counted by the runner from the executor's stream: one turn is one assistant message, identified by its `message.id`, so a message split over several stream events counts once. The `--max-turns` flag is also passed to `claude`; the executor accepted it in the delta-03 smoke, but the runner-side count remains the primary guard. The judge driver does not pass it: the flag is absent from `claude --help`, so it stays unverified there.

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
