// settings.ts — every declared, documented setting of the skill eval runner (spec 0290 R19-R23,
// R27-R31). One constant per line so that flipping or recalibrating a value is a one-line change.
// Documented in docs/skill-evals.md; the caps and the regression tolerance are provisional until
// the pr-logbook pilot (issue #1852) calibrates them from measured costs.
//
// Usage: import { REGRESSION_BLOCKING, ... } from "./settings.ts".
// Exit codes: not applicable (library). Finding-line format: not applicable.

/** R19: a skill regresses when its head mean is lower than the base mean by MORE than this. */
export const TOLERANCE = 0.05;
/** R20: when true, a regression (measured or recorded) makes the run or the check exit non-zero. */
export const REGRESSION_BLOCKING = false;
/** R21: when true, a changed skill without evals/ makes the run or the check exit non-zero. */
export const MISSING_EVALS_BLOCKING = false;

/** R23 (per skill): executor runs (with_skill and without_skill) allowed per invocation. */
export const MAX_EXECUTOR_RUNS = 30;
/** R23 (per skill): the judge's `max_calls` for the invocation. */
export const JUDGE_MAX_CALLS = 300;
/** R28: worst-case executor cost (planned runs x per-run budget) allowed across all skills. */
export const MAX_INVOCATION_USD = 100;
/** R29: executor runs in flight at once. */
export const EXECUTOR_CONCURRENCY = 4;

/** R27: assistant turns allowed per executor run. */
export const PER_RUN_TURNS = 25;
/** R27: wall-clock seconds allowed per executor run. */
export const PER_RUN_SECONDS = 300;
/** R27: US dollars allowed per executor run. */
export const PER_RUN_USD = 1;

/** R31: the executor's model, a Sonnet-class model (rationale: docs/adr/0023-skill-eval-executor.md). */
export const EXECUTOR_MODEL = "claude-sonnet-5-5";
/** The judge's model for the runner's effective configuration (tests/e2e/defaults.toml keeps its own pin). */
export const JUDGE_MODEL = "claude-sonnet-5-5";
/** Judge `max_tokens` for an evidence call (the library default of 256 cannot hold an excerpt). */
export const JUDGE_MAX_TOKENS = 512;
/** R23: share of the quorum-times-runs judge estimate added for retries. */
export const JUDGE_RETRY_ALLOWANCE = 0.25;
/** The judge quorum size (tests/e2e/lib/llm_judge.ts runs up to three calls). */
export const JUDGE_QUORUM = 3;

/** R13: minimum non-whitespace characters of a valid evidence string. */
export const EVIDENCE_MIN_CHARS = 12;

/** Written to evals/results.json (R36). */
export const RUNNER_VERSION = "1.1.0";

/** Tools the executor may use: the main security boundary, kept in one place. */
export const EXECUTOR_TOOLS = ["Bash", "Read", "Write", "Edit", "Skill"] as const;

/** Credential variables (R33), in order of preference. */
export const TOKEN_VAR = "CLAUDE_CODE_OAUTH_TOKEN";
export const API_KEY_VAR = "ANTHROPIC_API_KEY";

/** Default output directory of the entry point (git-ignored). */
export const DEFAULT_OUT_DIR = ".skill-evals";
