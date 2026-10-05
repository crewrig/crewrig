// launch.ts — starting the wrapped command of `run` (spec 0248 R22, R24).
//
// From its argument vector, with the standard streams inherited, with the
// toplevel as its working directory and with no shell: `shell` is `false` on
// every platform and `exec` is never used, so no argument is ever read as syntax.
// POSIX hands the vector to `spawn`; Windows goes through `launch-windows.ts`,
// whose resolution and `.cmd` allowlist are the whole of the difference.

import { spawn } from "node:child_process";
import os from "node:os";
import { defaultIsFile, planWindowsLaunch } from "./launch-windows.ts";
import type { Env } from "./types.ts";

/** What `planLaunch` decided, before any claim is taken. */
export type LaunchPlan =
  | {
      readonly kind: "spawn";
      readonly file: string;
      readonly args: readonly string[];
      readonly verbatim: boolean;
    }
  | { readonly kind: "missing" }
  | { readonly kind: "refused"; readonly message: string };

/** How the wrapped command ended. `error` means it never ran. */
export type LaunchResult =
  | { readonly kind: "exit"; readonly code: number }
  | { readonly kind: "signal"; readonly signal: NodeJS.Signals }
  | { readonly kind: "error"; readonly code: string };

export interface PlanInput {
  readonly platform: NodeJS.Platform;
  readonly env: Env;
  readonly toplevel: string;
  readonly isFile?: (candidate: string) => boolean;
}

/** Decide how to start `argv`. Pure apart from `isFile`; refusals happen here, before the gate. */
export function planLaunch(argv: readonly string[], input: PlanInput): LaunchPlan {
  const [name, ...rest] = argv;
  if (name === undefined) return { kind: "missing" };
  if (input.platform !== "win32") return { kind: "spawn", file: name, args: rest, verbatim: false };
  return planWindowsLaunch(argv, {
    platform: input.platform,
    env: input.env,
    toplevel: input.toplevel,
    isFile: input.isFile ?? defaultIsFile,
  });
}

/** Start the planned command in `toplevel` and wait for it. Never rejects. */
export function startCommand(plan: LaunchPlan, toplevel: string): Promise<LaunchResult> {
  if (plan.kind !== "spawn") return Promise.resolve({ kind: "error", code: "ENOENT" });
  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: LaunchResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = spawn(plan.file, [...plan.args], {
      stdio: "inherit",
      cwd: toplevel,
      shell: false,
      windowsVerbatimArguments: plan.verbatim,
    });
    child.once("error", (error: NodeJS.ErrnoException) =>
      settle({ kind: "error", code: error.code ?? "UNKNOWN" }),
    );
    child.once("close", (code, signal) => {
      if (code !== null) settle({ kind: "exit", code });
      else if (signal !== null) settle({ kind: "signal", signal });
      else settle({ kind: "error", code: "UNKNOWN" });
    });
  });
}

/** `128 + n` for a signal, as a POSIX shell reports a signalled child. */
export function signalExitCode(signal: NodeJS.Signals): number {
  return 128 + (os.constants.signals[signal] ?? 0);
}
