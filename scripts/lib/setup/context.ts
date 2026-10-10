// context.ts — the types every module of the setup graph shares (spec 0256 requirement 3, plan v2
// step B1.10). It holds no logic: a module takes a `SetupCtx` (or the part of it it needs) and a
// small `Deps` object for everything that touches the machine, so unit tests run with no process
// spawned and no real home.

import type { Env, Io } from "../extension/types.ts";
import type { InstallCtx } from "../install/ctx.ts";

export type { Env, Io, InstallCtx };

export type Cli = "claude" | "gemini" | "copilot" | "antigravity";
export const CLIS: readonly Cli[] = ["claude", "gemini", "copilot", "antigravity"];

/** What a captured child process returns; `status` is the exit status (127 when it cannot start). */
export interface SpawnResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface SpawnOptions {
  readonly cwd?: string;
  /** Overrides on top of the context environment; an `undefined` value removes the variable. */
  readonly env?: Env;
  /** Text written to the child's standard input; without it the child's standard input is ignored. */
  readonly input?: string;
  /** Let the child write to the parent's streams instead of capturing them (the stdout/stderr are then empty). */
  readonly inherit?: boolean;
}

/** Start `argv` (tool name first) with an argument array, never through a shell. */
export type Spawner = (argv: readonly string[], options?: SpawnOptions) => SpawnResult;

/** What one setup run knows: the install context plus the CLI being set up and the link mode. */
export interface SetupCtx extends InstallCtx {
  readonly cli: Cli;
  /** `--link`: place files as links (through the link-or-copy module) instead of copies. */
  readonly link: boolean;
}

/** Lines a module prints, in the order the shell printed them (`ctx.io.out` appends the line feed). */
export type Say = (line: string) => void;
