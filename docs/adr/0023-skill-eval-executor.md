# ADR 0023 — Skill eval executor, judge routing and attestation

<!-- crewrig-doc: section=architecture-adr nav_order=230 published=true title="ADR 0023 — Skill eval executor, judge routing and attestation" -->

**Status:** Accepted (issue #1849). Decided by [spec 0290](../../specs/0290-skill-eval-runner.md) and its [delta 01](../../specs/0290-skill-eval-runner.delta-01.md). Operating guide: [`docs/skill-evals.md`](../skill-evals.md).

## Context

A maintainer who changes a skill should learn, before the change merges, whether the skill still makes an agent behave better than the same agent without it. The repository needs a runner that grades a skill from its `evals/evals.json`, a way to run the agent under test, a judge, and a pull-request signal. Running evals costs money and is nondeterministic.

## Decisions

1. **Executor: headless Claude Code with a throwaway configuration.** `claude -p --output-format stream-json`, a throwaway `HOME` and `CLAUDE_CONFIG_DIR`, the skill installed as a real skill (`SKILL.md`, `scripts/`, `references/`, `assets/`, never `evals/`), a temporary workspace outside any repository, an allowlisted environment, one process group per run killed at the wall-clock limit. It exercises a skill exactly as it runs when installed, scripts included.
2. **Model pin: a Sonnet-class model (`claude-sonnet-4-6`).** It is the cost and capability tier the shipped agents run on, it keeps a per-run budget of 1 US dollar meaningful, and it is the model the e2e judge already names, so executor and judge share one verified identifier. The setting is single and documented; a run never silently uses another model. Verify that the pinned `claude` accepts the name at the first maintainer smoke run.
3. **The eval measures a skill on Claude Code only.** Not on each of the four CLIs the skill ships to. No CLI-matrix row is added: the runner is a repository development tool and deploys nothing to a CLI target.
4. **Judge follows the credential and never sends the subscription token to the Messages API.** With `CLAUDE_CODE_OAUTH_TOKEN` the judge's calls are made by headless `claude -p` through a new evidence-mode driver (`tests/e2e/lib/llm_judge_drivers/claude-cli.ts`, `complete()` only); with `ANTHROPIC_API_KEY` alone the existing `anthropic` driver is used. Whether a `setup-token` value may be used as a Bearer outside the `claude` binary is a terms-of-use question that is not decided here; the existing `claude-code` driver is not changed and an effective configuration that would send the token to the Messages API is refused (exit 3). The question is tracked in its own issue.
5. **Judging through the shared library.** An evidence-mode entry point (`llmJudgeEvidence`) lives in `tests/e2e/lib/llm_judge.ts` and shares one extracted quorum with `llmJudge`, so the three-call quorum, the `max_calls` cap and the mock mode are inherited, not copied; `llmJudge` output, exit codes and request bytes are pinned by the existing differential goldens.
6. **Evals run on the contributor's machine; CI verifies a committed, content-hashed attestation.** A real run writes `evals/results.json` holding a SHA-256 content hash; the pipeline recomputes the hash and compares. The pipeline makes no model call and holds no secret.
7. **Caps.** Per skill: 30 executor runs and 300 judge calls; per invocation: 100 US dollars of worst-case executor cost; 4 runs in flight; per run: 25 turns, 300 seconds, 1 dollar. All provisional, to be recalibrated from the measured costs of the `pr-logbook` pilot (issue #1852). A migration pull request over about 8 skills at pilot size (12 runs each) is refused by default and must be split or the setting raised.

## Trust model

The attestation is self-declared: nothing proves a results file came from a run of the runner, so it is forgeable by design and any forged file is visible in code review. The check proves freshness, not truth. This is accepted because the alternatives below are worse for a required check.

## Alternatives rejected

- **CI runs the evals with a repository secret.** A pull-request-controlled script, and an agent with `Bash`, can read the secret; fork pull requests would silently skip the gate; cost and flakiness would enter a required check; the secret would have to exist on both engines.
- **Direct Messages API with our own tool loop.** It does not install a real skill and re-implements skill discovery.
- **Claude Agent SDK.** It adds a root production dependency for the same engine.
- **`--bare` or project-scope `.claude/skills`.** `--bare` hides the skill; project scope makes the two arms asymmetric and loads repository rules.
- **Reusing the existing `claude-code` driver with the subscription token.** Terms and acceptance are unverified, and it would widen an e2e contract.
- **Treat a limit hit as an error.** It lets a looping skill hide and is flaky on slow machines.

## Consequences

- The runner needs the `claude` binary; Windows is unsupported for the executor.
- The first live runs are a maintainer smoke: `total_cost_usd` in the result record, `--max-turns`, the pinned model name, `claude -p` as a judge with a fresh configuration directory.
- The caps and the regression tolerance are provisional until the pilot has produced measured costs.
