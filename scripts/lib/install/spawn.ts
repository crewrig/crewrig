// spawn.ts — start an external tool (`claude`, `copilot`, `agy`, `gemini`, `git`, `node`) with an
// argument array and the parent's standard streams (spec 0255 R24). No lookup logic of its own:
// presence is `findOnPath` of scripts/lib/mempalace-python.ts; on Windows the executable and the
// `.cmd` launch plan come from `planWindowsLaunch` of scripts/lib/worktree-claim/launch-windows.ts
// (which resolves through `resolveOnPath`: PATH only, never the current directory).

import { spawnSync } from "node:child_process";
import os from "node:os";

import { findOnPath } from "../mempalace-python.ts";
import { defaultIsFile, planWindowsLaunch } from "../worktree-claim/launch-windows.ts";
import type { Env, Io } from "../extension/types.ts";

export interface ToolEnv {
  readonly env: Env;
  readonly platform: NodeJS.Platform;
  readonly io: Io;
}

/** `command -v name`: true when `name` resolves on the environment's PATH. */
export function onPath(tool: ToolEnv, name: string): boolean {
  return findOnPath(name, { ...tool.env }, { platform: tool.platform }) !== undefined;
}

function exitStatus(status: number | null, signal: NodeJS.Signals | null): number {
  if (status !== null) return status;
  const number = signal === null ? undefined : os.constants.signals[signal];
  return number === undefined ? 1 : 128 + number;
}

/**
 * Run `argv` (tool name first) and return its exit status; a refused or missing tool is 127 or 1.
 * `allowSpaces` lets a path argument hold spaces through a Windows `.cmd` shim (a home such as
 * `C:\Users\John Doe`); it is passed for path arguments only.
 */
export function runTool(
  tool: ToolEnv,
  argv: readonly string[],
  opts: { readonly allowSpaces?: boolean } = {},
): number {
  const name = argv[0] ?? "";
  let file = name;
  let args = argv.slice(1);
  let verbatim = false;
  if (tool.platform === "win32") {
    const plan = planWindowsLaunch(argv, {
      platform: tool.platform,
      env: tool.env,
      isFile: defaultIsFile,
      toplevel: process.cwd(),
      ...(opts.allowSpaces === true ? { allowSpaces: true } : {}),
    });
    if (plan.kind === "missing") {
      tool.io.err(`Error: '${name}' was not found on PATH.`);
      return 127;
    }
    if (plan.kind === "refused") {
      tool.io.err(`Error: ${plan.message}`);
      return 1;
    }
    ({ file, verbatim } = plan);
    args = [...plan.args];
  }
  const res = spawnSync(file, args, {
    stdio: "inherit",
    env: { ...tool.env },
    windowsVerbatimArguments: verbatim,
  });
  if (res.error !== undefined) {
    tool.io.err(`Error: cannot run '${name}': ${res.error.message}`);
    return 127;
  }
  return exitStatus(res.status, res.signal);
}
