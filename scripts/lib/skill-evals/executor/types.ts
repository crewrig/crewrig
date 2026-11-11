// executor/types.ts — the executor contract (spec 0290 R9, R27, R30).
//
// An executor runs ONE paired-run arm in a throwaway workspace with a throwaway configuration and
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
  /** The run's workspace: holds only the eval's R3 files; the agent's working directory. */
  readonly workspaceDir: string;
  /** Throwaway HOME. The agent's config dir is `<homeDir>/.claude`; a with_skill run has the skill in it. */
  readonly homeDir: string;
  readonly model: string;
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
  /** Set only for an executor failure (R24): did not start, or ended abnormally with no limit and no record. */
  readonly failure?: string;
  /** True when the runner cancelled the run (cap breach); the run is not graded. */
  readonly aborted?: boolean;
}

export interface Executor {
  run(req: ExecRequest): Promise<ExecOutcome>;
}
