// executor/types.ts — the executor contract (spec 0290 R9, R27, R30).
//
// An executor runs ONE paired-run arm in a throwaway workspace (a with_skill arm has the skill
// installed at project scope in it) under the contributor's real HOME, isolated by flags, and
// returns the transcript plus what the runner needs to grade and account for it. Limits (R27) are
// applied by the executor; a run that hits one is NOT a failure: it returns `limit` and is graded
// on its partial output. `failure` is reserved for a run that did not start, or ended abnormally
// without reaching a limit and left no result record (R24, R30).
//
// Usage: implemented by executor/claude-code.ts and executor/mock.ts. Exit codes: not applicable.
// Finding-line format: not applicable.

import type { Credential } from "../credentials.ts";

export type LimitName = "turns" | "wall-clock" | "budget";

export interface ExecLimits {
  readonly turns: number;
  readonly seconds: number;
  readonly usd: number;
}

export interface ExecRequest {
  readonly prompt: string;
  /** The run's workspace: the eval's R3 files, plus `.claude/skills/<name>/` for a with_skill run; the agent's working directory. */
  readonly workspaceDir: string;
  readonly model: string;
  /** The tool list passed as `--tools` and pre-approved; default EXECUTOR_TOOLS (the eval list). */
  readonly tools?: readonly string[];
  /** Reasoning effort passed as `--effort`; omitted from argv when unset. */
  readonly effort?: string;
  readonly limits: ExecLimits;
  readonly credential: Credential | undefined;
  readonly signal: AbortSignal;
  /** The environment the runner itself runs in (source of the allowlisted variables). */
  readonly baseEnv: Readonly<Record<string, string | undefined>>;
  readonly label: string;
}

export interface TokenUsage {
  readonly [k: string]: unknown;
}

export interface ExecOutcome {
  readonly transcript: string;
  readonly limit?: LimitName;
  /** Measured total cost in US dollars from the result record; null when unknown. */
  readonly costUsd: number | null;
  readonly usage: TokenUsage | null;
  readonly turns: number;
  readonly seconds: number;
  /** Skill names observed as `Skill` tool_use calls in assistant messages, in order (delta-04 R48). */
  readonly skillsLoaded: readonly string[];
  /** Set only for an executor failure (R24): did not start, or ended abnormally with no limit and no record. */
  readonly failure?: string;
  /** True when the runner cancelled the run (cap breach); the run is not graded. */
  readonly aborted?: boolean;
}

export interface Executor {
  run(req: ExecRequest): Promise<ExecOutcome>;
}
