// settings.ts — every declared, documented setting of the skill eval runner (spec 0290 R19-R23,
// R27-R31). One constant per line so that flipping or recalibrating a value is a one-line change.
// Documented in docs/skill-evals.md; the caps and the regression tolerance are provisional until
// the pr-logbook pilot (issue #1852) calibrates them from measured costs. The sampling plan, the
// caps and the assumed costs are spec 0304 R1, R21 and R23.
//
// Usage: import { REGRESSION_BLOCKING, ... } from "./settings.ts".
// Exit codes: not applicable (library). Finding-line format: not applicable.

/** R20: when true, a regression (measured or recorded) makes the run or the check exit non-zero. */
export const REGRESSION_BLOCKING = false;
/** R21: when true, a changed skill without evals/ makes the run or the check exit non-zero. */
export const MISSING_EVALS_BLOCKING = false;
/** R46: when true, a skill whose result is `fail` makes the run or the check exit non-zero. */
export const FAIL_BLOCKING = false;
/** R47: the `--effort` level of the executor, the probe and the judge call. */
export const EFFORT = "medium";

/** 0304 R21 (per skill): the plan maximum of executor runs allowed per measurement, retries included. */
export const MAX_EXECUTOR_RUNS = 60;
/** 0304 R21 (per skill): the judge's `max_calls` for the invocation. */
export const JUDGE_MAX_CALLS = 60;
/** 0304 R22: aggregate bound: the sum over the selected skills of the smaller of the plan-maximum runs x per-run budget and the measurement cap plus the concurrency term. */
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
/** R23: share of the one-call-per-eval judge estimate added for retries. */
export const JUDGE_RETRY_ALLOWANCE = 0.25;

/** R13: minimum non-whitespace characters of a valid evidence string. */
export const EVIDENCE_MIN_CHARS = 12;

/** R49 rule 3: minimum letters and digits of the longest verbatim run of the evidence. */
export const EVIDENCE_WINDOW_CHARS = 40;

/** R49 rule 3: minimum share of the evidence's letters and digits that the longest verbatim run covers. */
export const EVIDENCE_WINDOW_SHARE = 0.3;

/** 0304 R16: minimum non-whitespace characters of a short whole-line evidence quote. */
export const EVIDENCE_SHORT_MIN_CHARS = 6;

/**
 * 0304 R1: the sampling plan, declared once and copied into evals/results.json before the first
 * model call. Pools (evals, probes) are decided apart; the values are never copied elsewhere.
 */
export const SAMPLING_PLAN = {
  id: "two-stage-1",
  /** Runs of every eval in stage 1 and in stage 2. */
  evalRunsPerStage: [2, 2],
  /** Runs of every probe in stage 1 and in stage 2. */
  probeRunsPerStage: [1, 1],
  acceptStage1: 0.9,
  rejectStage1: 0.6,
  acceptFinal: 0.75,
  regression: { test: "fisher-one-sided", alpha: 0.1, minDrop: 0.1 },
} as const;

/** 0304 R21: US dollars allowed for one measurement (executor and judge), enforced at run time. */
export const MAX_MEASUREMENT_USD = 5;
/** 0304 R21: US dollars allowed per skill since the merge-base, whatever the ticket label. */
export const MAX_SKILL_USD = 10;
/** 0304 R21: US dollars allowed per ticket label, across skills. */
export const MAX_TICKET_USD = 25;
/** 0304 R23: cost assumed for one judge call whose cost is not recorded (checked against recorded costs, M1). */
export const JUDGE_ASSUMED_USD = 0.03;
/** 0304 R23: cost assumed for each run of a measurement in which no run reported a cost. */
export const RUN_ASSUMED_USD = 0.1;

/** Written to evals/results.json (R36). */
export const RUNNER_VERSION = "3.0.0";

/** Tools the executor may use: the main security boundary, kept in one place. */
export const EXECUTOR_TOOLS = ["Bash", "Read", "Write", "Edit", "Skill"] as const;

/** Credential variables (R33), in order of preference. */
export const TOKEN_VAR = "CLAUDE_CODE_OAUTH_TOKEN";
export const API_KEY_VAR = "ANTHROPIC_API_KEY";

/** Default output directory of the entry point (git-ignored). */
export const DEFAULT_OUT_DIR = ".skill-evals";
