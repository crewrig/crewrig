# Skill evals

<!-- crewrig-doc: section=reference nav_order=165 published=true title="Skill evals" -->

A skill owns a small set of evaluation cases next to its `SKILL.md`. One command measures the skill on Claude Code with Sonnet 5.5 at effort `medium`, under a fixed two-stage sampling plan: each eval and each trigger probe is run a declared number of times, and the verdict follows fixed thresholds over the pooled runs. A measurement is recorded in a committed, content-hashed `evals/results.json` before its first model call, and the pull-request pipeline only checks that the file is fresh, complete and consistent with its own runs. The rules a skill and its evals follow are in the [Skill authoring standard](skill-authoring-standard.md). Specification: [spec 0304](../specs/0304-skill-evals-sampling-gate.md) (the gate described here) and [spec 0290](../specs/0290-skill-eval-runner.md) with its deltas [01](../specs/0290-skill-eval-runner.delta-01.md), [03](../specs/0290-skill-eval-runner.delta-03.md), [04](../specs/0290-skill-eval-runner.delta-04.md) and [07](../specs/0290-skill-eval-runner.delta-07.md); decisions: [ADR 0023](adr/0023-skill-eval-executor.md) (the executor) and [ADR 0024](adr/0024-skill-evals-sampling-gate.md) (the gate).

## Why the gate samples

One run of six evals is a noisy instrument: one flipped eval moves the rate by 0.17. The same skill content measured 1.00, 0.83, 0.83 and 0.67 in four runs, so a single run could not tell a skill from its luck. The gate therefore decides from repeated runs under a plan declared up front, and records every run. Re-running cannot shop for a pass: a finished measurement cannot be measured again, and identical content cannot be measured twice (see [Ledger and anti-gaming](#ledger-and-anti-gaming)).

## What a measurement costs

- **Executor runs.** Each eval runs 2 times per stage and each probe 1 time per stage. Stage 2 runs only for a pool that stage 1 left open. The plan maximum is `evals x 4 + probes x 2` (both stages for every eval and probe).
- **Judge calls.** One call per eval run that has expectations, plus at most one re-ask per eval run ([evidence re-ask](#evidence-rules)), plus retries. Probes are never judged.
- **Caps.** Enforced before the first model call and again at run time. See [Budget](#budget).
- **Authoring limits.** A skill with more than 6 evals that carry expectations is refused: its worst-case judge calls exceed `JUDGE_MAX_CALLS`. A plan maximum above `MAX_EXECUTOR_RUNS` (60) is refused too, so 6 judged evals take at most 18 probes. Split the skill or reduce its evals.

## Run it

```sh
task skill-evals -- pr-logbook            # one skill
task skill-evals -- --changed             # every skill whose content differs from the merge-base with origin/main
task skill-evals -- pr-logbook --mock     # no process, no model call, no credential: for plumbing checks
task skill-evals -- pr-logbook --dry-run  # authoring guard: check the eval samples, no executor run
task skill-evals -- pr-logbook --dry-run --eval 2   # one eval only
```

Options: `--out <dir>` (default `.skill-evals/`, git-ignored), `--mock`, `--dry-run`, `--eval <id>` (only with `--dry-run`, otherwise exit 2), `--ticket <N>`, `--base <ref>` (default `origin/main`), `--judge-config <file>`, `--use-api-key` (bill `ANTHROPIC_API_KEY` instead of the login; see [Credentials](#credentials)).

Exit codes: `0` ok, `1` a blocking outcome (a `fail`, `regression`, `error` or refused measurement, a complete or already measured skill, a cap refusal, a `sample-invalid` or missing sample in a dry-run), `2` usage error or unknown skill or eval id, `3` failed precondition (not logged in to Claude Code, a requested API key that is unset, a temporary directory inside `HOME` or a git work tree, a refused judge configuration, no ticket to attribute the spend to).

Everything runs on your machine. No CI job runs an eval, holds a model credential, or makes a model call.

## Requirements and scope of the measurement

- **Prerequisite.** Claude Code must be installed (the `claude` binary on your `PATH`) and you must be logged in to it (run `claude` once and log in). The binary is the executor of every run and, except under `--use-api-key`, the judge. A missing binary is reported with an install hint and exit 3. Unix only (macOS and Linux): the executor needs process groups.
- The eval measures a skill **on Claude Code**, not on each of the four CLIs the skill ships to. The executor is Claude Code only (spec 0290 R26). The runner is a repository development tool and deploys nothing to a CLI target, so no row under `docs/cli-matrix/rows/` exists for it.
- Each run starts from an empty conversation, in a throwaway workspace, and is isolated by flags rather than by a throwaway home: every `claude` child keeps your real `HOME` (and your `CLAUDE_CONFIG_DIR` when set) and receives `--setting-sources project --strict-mcp-config --no-session-persistence`, so no user or local settings, hooks, `CLAUDE.md`, MCP servers or user-scope skills are loaded and no session transcript is left behind. `--bare` is never used: it never reads the OAuth login or the keychain. The executor and the judge driver share this flag set.
- The workspace is a temporary directory outside any repository and outside `HOME`, so no repository rule and no memory file of an ancestor directory is loaded. When the temporary directory resolves inside `HOME` or inside a git work tree, the runner makes no model call, names `TMPDIR` and exits 3: point `TMPDIR` elsewhere.
- Every run (eval or probe) installs the skill at project scope, as `<workspace>/.claude/skills/<name>/` (`SKILL.md`, `scripts/`, `references/`, `assets/`, plus the `references/shared-<topic>.md` files for the shared references the skill cites, read from `artifacts/core/shared/references/`; never `evals/` or any other path, so the agent cannot read the expectations it is graded on). The top-level `.claude/` directory is the install location, not an output: it is excluded from `outputs/`. An eval run may use `Bash`, `Read`, `Write`, `Edit` and `Skill` only; a probe run may use `Skill` only.
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

## The sampling plan

The plan is one declared constant, `SAMPLING_PLAN`, in `scripts/lib/skill-evals/settings.ts`. Its id is `two-stage-1`.

| Member | Value | Meaning |
|---|---|---|
| `evalRunsPerStage` | `[2, 2]` | Runs of every eval in stage 1 and in stage 2. |
| `probeRunsPerStage` | `[1, 1]` | Runs of every probe in stage 1 and in stage 2. |
| `acceptStage1` | `0.90` | A pool at or above this after stage 1 is accepted. |
| `rejectStage1` | `0.60` | A pool below this after stage 1 is rejected; between the two it continues. |
| `acceptFinal` | `0.75` | A continuing pool is accepted when its cumulative rate over both stages reaches this, otherwise rejected. |
| `regression` | `{ test: "fisher-one-sided", alpha: 0.10, minDrop: 0.10 }` | The regression test, see [Regression](#regression). |

There is no third stage. The evals and the probes are two pools, decided separately and never mixed: the eval rate is the passed eval runs over the recorded eval runs, the probe rate the probes that triggered as expected over the recorded probe runs. A skill with no probe has no probe pool. Comparisons are exact: rates are compared on integer counts, so 9 of 10 meets 0.90 and 11 of 12 does too.

Stage boundaries, as tested:

- 11 of 12 is accepted at stage 1; 8 of 12 continues to stage 2; 7 of 12 is rejected and the status is `fail` with no stage 2.
- 9 of 10 meets 0.90 exactly and is accepted.
- A continuing pool of 8 of 12 that then passes 10 of 12 more (18 of 24) meets 0.75 and is accepted; 17 of 24 is rejected.

A measurement that has not finished is `in-progress`, never `pass`. The stage-2 trigger of a pool depends on that pool's own runs only, never on the base.

### Operating characteristics

The figures below are computed from the functions of `scripts/lib/skill-evals/plan.ts` for the eval pool alone, under the simplifying model that each run of an eval passes independently with the same probability `p`. Per-eval differences change the figures, and the probe pool is a second gate: the skill passes only when both pools are accepted, so a skill's probability is lower than the eval-pool figure. "Runs" is the expected number of eval runs of one measurement.

| True pass rate `p` | P(eval pool accepted) | P(continues to stage 2) | Expected eval runs | P(at least one pass in 3 measurements) | P(at least one pass in 4 measurements) |
|---|---|---|---|---|---|
| 0.50 | 0.01 | 0.19 | 14.3 | 0.04 | 0.05 |
| 0.60 | 0.10 | 0.42 | 17.0 | 0.26 | 0.34 |
| 0.65 | 0.21 | 0.54 | 18.5 | 0.51 | 0.61 |
| 0.70 | 0.38 | 0.64 | 19.7 | 0.77 | 0.86 |
| 0.75 | 0.60 | 0.68 | 20.2 | 0.93 | 0.97 |
| 0.80 | 0.80 | 0.65 | 19.8 | 0.99 | 1.00 |
| 0.85 | 0.94 | 0.53 | 18.4 | 1.00 | 1.00 |
| 0.90 | 0.99 | 0.34 | 16.0 | 1.00 | 1.00 |

Reading the table:

- **Indifference zone, 0.70 to 0.85.** Between these rates the verdict is close to a coin flip for one measurement and the gate spends the most runs there.
- **Honest power.** The statistic is not powerful for small drops: detecting a 0.10 drop with 80 percent power needs about 113 runs per side. The regression test catches large drops; the absolute thresholds carry the floor (see the [Regression](#regression) bar).

### Reroll bound

A skill may be measured again only after its content changes, so its number of measurements since the merge-base is bounded by `MAX_SKILL_USD` (10 USD), with each new measurement reserving `MAX_MEASUREMENT_USD` (5 USD). For a measurement that costs `c` USD, `floor((10 - 5) / c) + 1` measurements fit: 3 at a typical 2 USD, 4 at 1.5 USD (a measurement rejected at stage 1). A skill at a true pass rate of 0.65 passes at least one of three measurements about half the time, so the cap, not the hash, bounds the rerolls. Every edit of `SKILL.md` or `evals/evals.json` gives a new hash, and `measurements on this branch` keeps the count visible in review.

## Results file (schema 2)

`evals/results.json` is written by a real run. It is a JSON object with `schema_version: 2` and these keys, in this order: `schema_version`, `skill_name`, `content_hash`, `runner_version`, `executor_model`, `judge_model`, `effort`, `plan` (a copy of `SAMPLING_PLAN`), `ticket`, `declared_at`, `date` (the time of the last write), `status`, `stage_reached` (`{evals, probes}`, each 1 or 2; `probes` is `null` without probes), `evals` (per eval: `id`, `case_hash`, `runs`), `probes` (per probe: `index`, `should_trigger`, `runs`), `eval_passes`, `eval_runs`, `eval_pass_rate`, `probe_passes`, `probe_runs`, `probe_pass_rate`, `base`, `regression`, `errors`, `executor_runs`, `judge_calls`, `cost_usd`, `judge_cost_usd` and `ledger`.

- Each eval run records `passed`, `assertions` (one `1` or `0` per check, then per expectation, so a flaking expectation is visible), `skill_loaded`, `cost_usd`, `reasked`, and `cost_assumed: true` only when its cost is assumed.
- Each probe run records a boolean.
- The file is `in-progress` from before the first model call, and every graded run is appended and the file rewritten atomically.
- The verifier recomputes every figure, the status and the run counts from the recorded runs with the same `plan.ts` as the runner. A file whose figures, status or run counts do not follow from its runs is `invalid`, and the reason names the first difference.
- A mock run writes no results file.

## Measurement lifecycle: in-progress, resume and refuse

The runner acts on the content hash and status of an existing `evals/results.json`:

| Existing file | Action |
|---|---|
| Same hash, `in-progress`, same plan and ticket | Resume: the recorded runs count, only the missing slots of the stage they reach are run, and the decision is recomputed. |
| Same hash, a final status (`pass`, `fail`, `regression`) | Refuse, exit 1, no model call: `measurement complete for <hash>`. Change the skill content for a new measurement, or read the recorded status. |
| Same hash, `in-progress`, another ticket | Refuse, exit 1, naming both tickets. |
| Different hash, or `in-progress` with another plan | A new measurement starts; the previous file moves into the ledger, as `abandoned` when unfinished. |
| Absent, unparseable or schema 1 | A new measurement starts. A schema-1 file is not carried into the ledger. |

Each run's slot is retried once after an infrastructure failure (an executor or judge error with no gradable run). The failure is listed in `errors` and does not count in any rate. A second failure ends the skill with status `error`, and the file stays `in-progress`. A run that ends at a turn, time or cost limit is graded on what it produced and is a sample.

Each run's workspace, its outputs and its `metrics.json` go to `<out>/<skill>/eval-<id>/run-<r>/` (a probe to `probe-<n>/run-<r>/`), so a resumed measurement never overwrites a recorded run.

A measurement stops when its recorded spend (executor and judge, unknown costs at the assumed figures) reaches `MAX_MEASUREMENT_USD`: no new run starts, the runs already in flight finish and are recorded (so the spend can overshoot the cap by up to `EXECUTOR_CONCURRENCY` runs), the skill ends in `error` and the file stays `in-progress`. Resuming such a file is refused, unless every slot is already recorded, in which case the status is finalised with no model call.

## Ledger and anti-gaming

The ledger keeps one entry per earlier measurement of the skill: `content_hash`, `ticket`, `declared_at`, `date`, `status` (including `abandoned`), the eval and probe rates, the run and call counts, the costs and `cost_assumed`. An entry is identified by `content_hash`, `ticket` and `declared_at`. Nothing in the ledger is dropped.

- **Union at every start.** When a new measurement starts, the previous ledger is the union of the working-tree file, the copy at the merge-base and every revision of the file committed in `<merge-base>..HEAD`. So a restore (`git checkout <base> -- evals/results.json`), a deletion, or a committed restore followed by an edit cannot drop an entry.
- **Branch entries.** The entries of that union that are not in the merge-base set are the branch entries. The report and the attestation print `measurements on this branch: <n>`.
- **Refusal on identical content.** A new measurement whose `content_hash` already has a final entry is refused with `content already measured: <hash>`. No flag or setting allows it. An `abandoned` entry does not block its hash.
- **Attestation.** The check (in CI, and in the pre-push check) compares the head file with the merge-base copy and every committed revision in the range. A head file that lacks an entry of either, or records less spend, is `invalid`.
- **Spend.** The ledger's spend is summed for the caps. A ledger entry with `cost_usd: null` counts at `executor_runs` times `RUN_ASSUMED_USD` when its cost is assumed, else at `PER_RUN_USD` per run.

Residual risk, stated and not removed (spec 0290 R38): the file can be edited by hand, and that is visible only in review and through the git history of the file. An entry that was never committed is invisible. A rewrite of the branch history (rebase, squash or force-push of the range) removes entries and is tampering under the trust model. Each ledger entry is about 250 bytes, and the ledger's growth on `main` is accepted.

## Budget

The caps are declared constants, with no command-line, environment or file override: a raise is a reviewed diff.

| Cap | Value | Scope |
|---|---|---|
| `MAX_EXECUTOR_RUNS` | 60 | Plan maximum of executor runs per skill. |
| `JUDGE_MAX_CALLS` | 60 | Worst-case judge calls per skill. |
| `MAX_MEASUREMENT_USD` | 5 | One measurement (executor and judge), enforced at run time. |
| `MAX_SKILL_USD` | 10 | Per skill, over the spend since the merge-base, whatever the ticket label. |
| `MAX_TICKET_USD` | 25 | Per ticket label, across skills. |
| `MAX_INVOCATION_USD` | 100 | Aggregate bound of one invocation, see below. |
| `EXECUTOR_CONCURRENCY` | 4 | Executor runs in flight at once. |
| `PER_RUN_TURNS` / `PER_RUN_SECONDS` / `PER_RUN_USD` | 25 / 300 / 1 | Per run. A run that hits one is graded on its output and counted. |

**Before the first model call** the runner refuses, with no model call, exit 1 and status `error`, printing the planned or spent figure, the worst case and the cap, when:

- a skill's plan maximum of executor runs exceeds `MAX_EXECUTOR_RUNS`;
- its worst-case judge calls exceed `JUDGE_MAX_CALLS` (the judged eval runs of the plan maximum, times two, plus 25 percent for the re-ask and retries; seven judged evals make 63);
- a skill's spend since the merge-base plus `MAX_MEASUREMENT_USD` exceeds `MAX_SKILL_USD`;
- the ticket's recorded spend plus the summed worst cases of the selected skills exceeds `MAX_TICKET_USD` (checked once per invocation, after the per-skill checks);
- the aggregate bound exceeds `MAX_INVOCATION_USD`: per skill, the smaller of `plan-max runs x PER_RUN_USD` and `MAX_MEASUREMENT_USD + EXECUTOR_CONCURRENCY x PER_RUN_USD` (9 USD per skill with these values).

A resumable file with no remaining slot is finalised without any model call and is not refused. A resumable file with open slots is refused when its recorded cost has reached `MAX_MEASUREMENT_USD`; otherwise its worst case is the remainder.

The ticket is `--ticket`, else the number in the branch name `<prefix>/<NNNN>-<slug>`; with neither the run exits 3. A new `--ticket` label resets only the ticket cap, never the per-skill cap. The spend is attributed through `node scripts/usage-task.ts set --channel explicit --asset forge-issue:<owner>/<repo>#<number>` before any model call.

### Cost model

Unit costs as recorded in spec 0304 R21 (pilot figures, to be re-checked against recorded costs): about 0.065 USD per eval run, 0.02 per probe run, and 0.03 per judge call (`JUDGE_ASSUMED_USD`). For one measurement of a skill with `E` evals and `P` probes, with `J` judged evals, the stage-1 cost is `E x 2 x 0.065 + P x 0.02 + J x 2 x 0.03`; the worst case of both stages doubles the runs; a re-ask adds one judge call per eval run.

USD per measurement, from spec R21, one run, stage 1 only, typical (true pass rate about 0.9), worst case with both stages, and worst case with one re-ask per eval run:

| Skill | One run | Stage 1 only | Typical | Worst, both stages | Worst, with re-ask |
|---|---|---|---|---|---|
| `github-actions` (6 evals, 8 probes) | 0.71 | 1.30 | about 1.7 | 2.60 | 3.32 |
| `gitlab-ci` (6 evals, 12 probes) | 0.96 | 1.60 | about 2.1 | 3.21 | 3.93 |
| `security` (6 evals, 12 probes) | 0.80 | 1.37 | about 1.8 | 2.74 | 3.46 |

The formula reproduces the `github-actions` and `security` rows. The `gitlab-ci` row does not: the same formula gives 1.38 for stage 1 and 2.76 for the worst case with both stages. The figures are to be re-checked against recorded costs before they are relied on.

No paid measurement backs these figures in this change (spec R31). `JUDGE_ASSUMED_USD` is an assumption, not checked against recorded judge costs. When a driver reports no cost for a judge call, the report and the ledger say the judge figure is assumed. Likewise a run whose cost is unknown counts at `PER_RUN_USD`, and a measurement in which no run reported a cost counts every run at `RUN_ASSUMED_USD` (0.10 USD) and says so.

The aggregate of one invocation can exceed the cap. A pull request that changes more skills than `MAX_INVOCATION_USD` allows must be split (run `task skill-evals -- <skill>` per skill), or the setting raised in the same change.

## Evidence rules

The judge returns one line per expectation: `<n> VERDICT=<PASS|FAIL> EVIDENCE=<JSON string>`. A `PASS` counts only when its evidence is valid. The verdict word is read from the structured `VERDICT=` field only, never from text quoted inside `EVIDENCE`, and only `PASS`, `FAIL` and `UNCERTAIN` are verdict words. The evidence must have at least `EVIDENCE_MIN_CHARS` (12) non-whitespace characters and match one of the following:

- **`path:line` reference** (spec 0290 R13): a path naming a produced file and a line within it.
- **E1, a location followed by commentary** (spec 0304 R15): a `path:line` token followed by whitespace or the end of the string is accepted when the token itself holds at least 12 non-whitespace characters, the path is a produced file, and the line exists. Whatever follows the token is not checked. A short token such as `ci.yml:5` followed by a long remark is refused, as the bare reference is.
- **E2, a short whole line** (spec 0304 R16): 6 to 11 non-whitespace characters are accepted when, trimmed, they equal one whole line of exactly one produced file, and no other produced file. The transcript is never a source of a short line, because it echoes the prompt and the fixtures. Fewer than 6 characters are refused.
- **Text match** (spec 0290 R49), tried in this order: *exact* (an exact substring, line endings normalised); *normalised* (after Unicode NFKC, only letters and digits count, and the evidence is split on `...`, `…`, `[...]` and `[…]`, each piece at least 12 letters and digits, whole-word and in order); *window* (the longest verbatim run of consecutive words holds at least `EVIDENCE_WINDOW_CHARS` (40) letters and digits and at least `EVIDENCE_WINDOW_SHARE` (0.30) of the evidence's letters and digits).

Every accepted expectation records `evidence_match` in `grading.json`: `exact`, `normalised`, `window`, `path_line` or `short_line`, with `window_share` for `window`. The report prints `evidence_window: <n> of <m>`. The rules only widen acceptance and prove that a quote is grounded in the run's output, not that it supports the expectation. The window floor of 0.30 is calibrated on three recorded answers and is provisional.

**Evidence re-ask** (spec 0304 R17). When at least one `PASS` of an eval run is refused for unsupported evidence, the runner makes one further judge call for that run, asking only for those expectations and stating why each was refused. A re-asked expectation is `passed: true` only with a `PASS` whose evidence is valid under the rules above; any other answer, including a second unsupported `PASS`, is `passed: false`. A judge `FAIL` is never re-asked. The re-ask counts against the judge caps. The report prints `evidence_reask: <n> of <m>` on every run, `n` being the eval runs re-asked and `m` those judged.

A judge answer with no usable line at all is a judge failure, handled under the infrastructure-error rule. An expectation with no line, or an unreadable one, fails.

## Trigger probes

Each `trigger_probes` entry is one run whose prompt is the probe's `query`, with `--tools Skill --max-turns 1` and the skill installed. The probe observes whether the first assistant message calls the `Skill` tool naming this skill, and passes when that equals `should_trigger`. The single turn is the early stop, not a failure: it is not tagged as a limit and is not an error. No judge call is made. A probe runs once in stage 1 and once in stage 2 when its pool continues.

Only the skill under test is installed, so no other skill competes. A `should_trigger: false` probe tests restraint against no competitor, and a `true` probe is easier than in real use. A passing probe is not a guarantee of trigger quality in a full installation.

`skill_loaded` is informational: it records whether the agent called the `Skill` tool for this skill during the run, is not scored and affects no status.

## Deterministic checks

Checks run before any judge call. The closed set of check types is `exit_code`, `file_exists`, `file_contains` and `file_not_contains` (spec 0304 R18). `file_not_contains` takes `path` (relative to the run's `outputs/`, not escaping it) and a `pattern` (a regular expression). It passes when the produced file exists and does not match the pattern. When the file was not produced it fails with the observed value `file not produced`, because a run that wrote nothing has not shown an absence. An invalid pattern or an unknown field makes the evals file invalid, naming the eval and the field.

Use `file_not_contains` for an absence on a produced file; an expectation worded as an absence, such as "does not mention", cannot be judged soundly from a quoted line, and the linter warns on it (see [Skill authoring standard](skill-authoring-standard.md#evals)).

## Dry-run and samples

`--dry-run` is the authoring guard (spec 0304 R20). For each selected eval it reads a hand-written sample output under `evals/samples/<id>/`: any files at the paths a run would produce, plus an optional `transcript.md`. It then:

1. runs every deterministic check of the eval on the sample, a script of an `exit_code` check running from the skill directory as in a real run; a sample that fails one of its own checks is reported `sample-invalid`, naming the eval and the check, and the command exits 1;
2. makes one judge call per eval that has expectations, with no executor run, applying the evidence rules and the re-ask, and prints `PASS` or `FAIL` per expectation.

A `FAIL` on a conforming sample is a defect of the case or of the sample. It is printed and does not change the exit code. An eval with no sample is skipped with `no sample for eval <id>`; when no selected eval has a sample the command exits 1 with `dry-run: no sample for <skill>`, because nothing was checked. `--eval` with an unknown id exits 2.

A dry-run writes no `results.json`, no ledger entry and nothing under the skill's `evals/` other than reading the samples. It is not a measurement. It prints `dry-run spend: <usd> (<n> judge calls, measured|assumed)`; that spend is checked against the caps with its own worst case, but is not persisted, so repeated dry-runs can exceed the ticket cap. This is accepted: a dry-run costs only judge calls. `evals/samples/` stays out of the content hash and out of every shipped output.

Run the dry-run on the samples before any baseline is paid: a conforming sample should pass every expectation.

## Statuses

The status of a skill comes from its recorded runs with `plan.ts`:

- `fail`: either pool is rejected at stage 1 or at the final decision. Reported; exit 0 unless `FAIL_BLOCKING`.
- `regression`: neither pool is rejected and the regression test of [Regression](#regression) holds. Exit 0 unless `REGRESSION_BLOCKING`. When both `fail` and `regression` would hold, the status is `fail`.
- `pass`: otherwise, when both pools are accepted.
- `in-progress`: a pool is still open. Never `pass`.
- `invalid`: the `evals.json` is invalid, a symlink or a non-ignored untracked file sits under a hashed path, a cited shared reference has no tracked source, or the skill source holds a top-level `references/shared-*.md` file. The attestation also uses `invalid` for a results file that fails the recomputation or the ledger rule. Always blocks.
- `no-evals`: warning; exit 0 unless `MISSING_EVALS_BLOCKING`.
- `mock`, and `error` (executor or judge failure with credentials present, a refused plan, a cap reached at run time).
- `stale`: added by the attestation check; always blocks.

The report prints one line per skill with the status, the eval rate with its `passes/runs` and the stage reached, the probe rate (`n/a` without probes), the base figure (`n/a` when not compared, `legacy` for a schema-1 base) with the drop and the p-value, `skill_loaded`, the run and call counts, the costs (`judge_cost_usd` when assumed, stated), `measurements on this branch: <n>`, `evidence_reask: <n> of <m>` and the `evidence_window` line. It also lists, as a diagnostic that affects no status, the evals whose pass fraction fell by 0.5 or more against the base on the common evals.

A skill whose base is absent or unusable is `not compared: no usable evals/results.json at the merge-base`; this is not a status, and its status comes from its pools alone.

## Regression

The base is the `evals/results.json` committed at the merge-base with the base ref, read from that tree and never re-measured or read from the working tree. It is compared when it is a final schema-2 file, not a mock, naming the skill. Its recorded runs of the evals present on both sides with equal `case_hash` are the base figures; the head figures are the pooled runs of those evals over both stages.

- A schema-1 base is *legacy*: its `evals_passed` over `evals_total` count as one run each, over all its evals, and the head side then covers all head evals.
- A base that is absent, unreadable, `in-progress` or without a common eval is not compared (`base` is `null`).

The test: `regression` holds when the base rate minus the head rate is at least `minDrop` (0.10), and the one-sided Fisher exact test gives p below `alpha` (0.10). With `a` head passes over `n` head runs and `b` base passes over `m` base runs, p is the probability that a hypergeometric variable (population `n + m`, `a + b` successes, `n` draws) is at most `a`. Both conditions are exact: the drop on integers, and p as an exact rational number, in arbitrary-precision arithmetic, with no floating-point tolerance. At a drop of exactly 0.10 with p of exactly 0.10, the status is not `regression`, because p must be strictly below 0.10.

The absolute bar acts first: a head pool below `acceptFinal` is rejected before the test runs. Over 24 head runs the test can therefore fire only as follows (computed, not measured):

| Base | Heads that are `regression` |
|---|---|
| 24 of 24 | 18, 19 or 20 |
| 23 of 24 | 18 or 19 |
| 16 of 16 | 18 or 19 |
| 12 of 12 | 18 |
| 6 of 6, 5 of 6 or 4 of 6 (legacy) | none |

Against the legacy schema-1 bases the absolute bar is the only gate in practice. This is a property of the statistic, not a defect of the implementation, and it means that the regression test adds little for skills whose base is schema 1. The test widens by itself as the bases are re-measured under the plan.

Worked figures (from `plan.ts`): 20 of 24 against 24 of 24 gives a drop of 0.167 and p of 0.055, so `regression`; 21 of 24 gives p of 0.117, so `pass`; 18 of 24 gives p of 0.011, so `regression`; 15 of 24 is rejected by the absolute bar, so `fail`. Against a legacy 6 of 6, a head of 20 of 24 has p of 0.388, so `pass`.

The attestation recomputes the regression against the merge-base file as it stands when the check runs, so a sibling skill landing on `main` does not strand a branch.

## Content hash

The content hash identifies exactly what was evaluated. It is a SHA-256 over `SKILL.md`, every file under `scripts/`, `references/` and `assets/`, and `evals/evals.json`, plus the shared references the skill cites (`references/shared-<topic>.md`, the bytes of `artifacts/core/shared/references/<topic>.md`, so the hash covers the skill as it ships), read **once** at run start from the working tree (a dirty tree is allowed: the hash is over content, not commits) and also used for the install, so the installed bytes equal the hashed bytes. Files are sorted by their `/`-separated relative path in UTF-8 byte order; each contributes `path NUL mode-flag NUL size NUL bytes NUL`, where the mode flag is `1` when the git **index** mode is `100755` and `0` otherwise. Bytes are never normalised (the `SKILL.md` text is put in LF form only to find the cited topics, as the build does; the hashed and installed bytes stay raw). The mode is read through git (`git ls-files -s`, and `git ls-tree` at the merge-base), never from the filesystem, so the hash is identical on Windows, on Linux and with `core.fileMode=false`. The result is `sha256:` followed by 64 lowercase hexadecimal digits.

Only tracked files are hashed (a staged, uncommitted file counts). A git-ignored untracked file under a hashed path (`__pycache__/`, `.DS_Store`) is excluded from the hash and from the install; an untracked, non-ignored file or any symbolic link makes the skill `invalid`, naming the path, with no hash and no model call. `evals/results.json` is never hashed.

Each recorded eval carries a `case_hash` over its canonical JSON and the bytes of its `files` (see [Known limitation](#known-limitation-fixture-files)).

## The attestation

The pull-request pipeline runs `task ci:skill-evals-attestation`, which makes no model call and needs no credential. For every skill whose content hash differs from the base, or that is new, it decides one status:

- `no-evals`, `invalid` (as above, and a results file that fails the recomputation of its status or run counts, or the ledger rule, with the first difference named);
- `stale`, for a results file that is absent, unparseable, a mock, of another skill, of schema 1 (`schema 1: re-measure under the sampling plan`), `in-progress` (an interrupted measurement), carries a plan that differs from `SAMPLING_PLAN`, records another `content_hash`, or records a `case_hash` that differs from the one recomputed from the working tree, or an eval list that differs from the tree's (an eval added or removed after the measurement names that eval);
- otherwise the status recomputed from the recorded runs and the current merge-base file.

`invalid` and `stale` always block, with no setting to relax them. `fail`, `regression` and `no-evals` block only under their own setting. The check prints `measurements on this branch: <n>` for each skill it reads and the reason for every non-`pass` status. `task ci:pre-push` includes the same check.

A non-mock run writes a results file that you commit with your change. It is never shipped, and as a file under `evals/` it needs no `metadata.provenance.version` bump. A pull request that changes only `evals/evals.json` needs a fresh results file, because the hash includes that file. A pull request that edits a shared reference under `artifacts/core/shared/references/` selects every skill citing that topic, because the shipped skill changed.

**Trust model.** The attestation is self-declared by a same-repository contributor: nothing proves the recorded results came from a run of the runner, so the file is forgeable by design, and a forged or hand-edited file is visible in code review. The check verifies freshness and internal consistency (the recorded hash matches the current content, and the recorded status follows from the recorded runs), not truth. Nothing here is a guarantee that a recorded result is genuine.

## Known limitation: fixture files

The content hash covers `evals/evals.json` but not the fixture files its `files` entries name (for example `evals/files/diff.txt`). Each recorded eval carries a `case_hash` over its entry and its fixture bytes, and the attestation recomputes it from the working tree (spec 0304 R14), so a fixture edited after a measurement makes a selected skill `stale`. A skill that is not selected, because only its fixture changed, is not checked. After editing a fixture, re-run the evals and commit the new results file.

## File contract

`evals/evals.json` is a normative contract owned by [spec 0290](../specs/0290-skill-eval-runner.md) (R1 to R6); other documents refer to it and never redefine it. The names `skill_name`, `evals`, `id`, `prompt`, `expected_output`, `files` and `expectations` are taken verbatim from Anthropic's skill-creator evals format; `checks` (`exit_code`, `file_exists`, `file_contains`, `file_not_contains`) and `trigger_probes` are the only additions and are ignored by skill-creator. The validator reports every violation with the file, the JSON path and the rule, and fails before any model call.

`evals/` stays in the repository and is never copied to any CLI target, built output, staging directory, user-scope install or packaged archive: the build propagates only `scripts/`, `references/` and `assets/` (`scripts/lib/build-components/resources.ts`), and a test fails if a built skill directory ever contains an `evals/` path.

## Migration of schema-1 files

Nine skills on `main` hold a schema-1 results file: `architect`, `developer`, `doc-writer`, `pr-logbook`, `pr-reviewer`, `spec-author`, `tester`, `github-actions` and `gitlab-ci`. They stay valid until their hashed content changes. A schema-1 file for an unselected skill is not read by the attestation; for a selected skill it is `stale`. Nothing in this change rewrites a schema-1 file, makes a paid run to refresh one, or re-baselines a skill. A schema-1 file serves as a legacy base (see [Regression](#regression)). The procedure for a skill that is migrated to the plan is in [Skill authoring standard](skill-authoring-standard.md#migration-procedure).

## Settings

Every setting is one declared constant in `scripts/lib/skill-evals/settings.ts`, so recalibrating or flipping one is a one-line change. The gate binds through the wave specs, which require the status `pass`.

| Setting | Default | Meaning |
|---|---|---|
| `SAMPLING_PLAN` | `two-stage-1` (see [The sampling plan](#the-sampling-plan)) | The plan: runs per stage, the acceptance and rejection thresholds, the regression test. Copied into every results file. |
| `FAIL_BLOCKING` | `false` | When `true`, a `fail` makes the run and the attestation check exit non-zero. |
| `REGRESSION_BLOCKING` | `false` | When `true`, a regression (measured, or recorded in a results file) makes the run and the attestation check exit non-zero. |
| `MISSING_EVALS_BLOCKING` | `false` | When `true`, a changed skill without `evals/` makes the run and the attestation check exit non-zero. Stays `false` until the migration waves (issues #1852 to #1855) have landed. |
| `EFFORT` | `medium` | The `--effort` level of the executor, the probe runs and the judge call. Not applied under `--use-api-key`: the `anthropic` judge driver has no effort level. |
| `MAX_EXECUTOR_RUNS` | `60` | Plan maximum of executor runs per selected skill, see [Budget](#budget). |
| `JUDGE_MAX_CALLS` | `60` | Worst-case judge calls per selected skill. |
| `MAX_MEASUREMENT_USD` | `5` | Cost of one measurement, enforced at run time. |
| `MAX_SKILL_USD` | `10` | Per-skill spend since the merge-base. |
| `MAX_TICKET_USD` | `25` | Per-ticket-label spend across skills. |
| `MAX_INVOCATION_USD` | `100` | Aggregate worst-case bound of one invocation. |
| `JUDGE_ASSUMED_USD` | `0.03` | Cost assumed for one judge call whose cost is not recorded. Not verified against recorded judge costs in this change. |
| `RUN_ASSUMED_USD` | `0.10` | Cost assumed for each run of a measurement in which no run reported a cost. |
| `EXECUTOR_CONCURRENCY` | `4` | Executor runs in flight at once. |
| `PER_RUN_TURNS` / `PER_RUN_SECONDS` / `PER_RUN_USD` | `25` / `300` / `1` | Per-run limits. A run that hits one is graded on the output it produced, tagged in `metrics.json`, and counted like any other run. A probe's single turn is not a limit hit. |
| `EVIDENCE_MIN_CHARS` | `12` | Minimum non-whitespace characters of a valid evidence string (E1 and the text rules). |
| `EVIDENCE_SHORT_MIN_CHARS` | `6` | Minimum non-whitespace characters of a short whole-line quote (E2). |
| `EVIDENCE_WINDOW_CHARS` | `40` | The window rule: minimum letters and digits of the longest verbatim run. |
| `EVIDENCE_WINDOW_SHARE` | `0.3` | The window rule: minimum share of the evidence's letters and digits that the run covers. Provisional. |
| `EXECUTOR_MODEL` | `claude-sonnet-5-5` | The executor model, a Sonnet-class model; a run never silently uses another one. |
| `JUDGE_MODEL` | `claude-sonnet-5-5` | The judge model used by the runner, the same Sonnet-class model. |

## Tests

The runner's own suites run in mock mode with no key and no network (`task test-skill-evals`, and `task ci:skill-evals-tests` in CI): a stub `claude` that fails any model call, a throwing `fetch`, temporary git repositories for hashing and selection. The sampling plan is tested as a pure module, `plan.ts`, with the boundaries, the Fisher figures and the exact comparisons above.
