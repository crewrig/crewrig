// spawner.ts — the `Spawner` of context.ts over `node:child_process` (spec 0256 requirements 5, 20,
// 39, plan v2 step B1.9). An argument array, never a shell; the launch plan of a Windows `.cmd` shim
// is `planWindowsLaunch` of scripts/lib/worktree-claim/launch-windows.ts, exactly as
// scripts/lib/install/spawn.ts uses it. Layer 1: standard library and repository modules that import
// no package.

import { spawnSync } from "node:child_process";
import type { SpawnSyncOptions, SpawnSyncReturns } from "node:child_process";
import os from "node:os";

import type { Env, InstallCtx, SpawnOptions, SpawnResult, Spawner } from "./context.ts";
import { defaultIsFile, planWindowsLaunch } from "../worktree-claim/launch-windows.ts";

/** What the spawner reads from the context: the environment, the platform and the repository root. */
export type SpawnerCtx = Pick<InstallCtx, "env" | "platform" | "repoDir">;

/** Machine seams, injected by tests: the process starter and the Windows file probe. */
export interface SpawnerSeams {
  readonly run?: (
    file: string,
    args: readonly string[],
    options: SpawnSyncOptions,
  ) => SpawnSyncReturns<string>;
  readonly isFile?: (candidate: string) => boolean;
}

const MAX_BUFFER = 256 * 1024 * 1024;

/** The environment of a child: the context's plus the overrides, an `undefined` value removing one. */
function childEnv(base: Env, overrides: Env | undefined): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...base };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

function exitStatus(status: number | null, signal: NodeJS.Signals | null): number {
  if (status !== null) return status;
  const number = signal === null ? undefined : os.constants.signals[signal];
  return number === undefined ? 1 : 128 + number;
}

function failure(status: number, message: string): SpawnResult {
  return { status, stdout: "", stderr: `${message}\n` };
}

/** Build the `Spawner` of one run; `seams` exist for tests only. */
export function createSpawner(ctx: SpawnerCtx, seams: SpawnerSeams = {}): Spawner {
  const run = seams.run ?? ((file, args, options) => spawnSync(file, [...args], options));
  const isFile = seams.isFile ?? defaultIsFile;

  return (argv: readonly string[], options: SpawnOptions = {}): SpawnResult => {
    const name = argv[0] ?? "";
    const env = childEnv(ctx.env, options.env);
    let file = name;
    let args = argv.slice(1);
    let verbatim = false;
    if (ctx.platform === "win32") {
      const plan = planWindowsLaunch(argv, {
        platform: ctx.platform,
        env,
        isFile,
        toplevel: options.cwd ?? ctx.repoDir,
      });
      if (plan.kind === "missing") return failure(127, `Error: '${name}' was not found on PATH.`);
      if (plan.kind === "refused") return failure(1, `Error: ${plan.message}`);
      ({ file, verbatim } = plan);
      args = [...plan.args];
    }
    const inherit = options.inherit === true;
    const spawnOptions: SpawnSyncOptions = {
      env,
      encoding: "utf8",
      stdio: [
        options.input === undefined ? "ignore" : "pipe",
        inherit ? "inherit" : "pipe",
        inherit ? "inherit" : "pipe",
      ],
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      windowsVerbatimArguments: verbatim,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.input === undefined ? {} : { input: options.input }),
    };
    const res = run(file, args, spawnOptions);
    if (res.error !== undefined) {
      return failure(127, `Error: cannot run '${name}': ${res.error.message}`);
    }
    return {
      status: exitStatus(res.status, res.signal),
      stdout: typeof res.stdout === "string" ? res.stdout : "",
      stderr: typeof res.stderr === "string" ? res.stderr : "",
    };
  };
}
