// usage-wrapper.ts — the shared spawner of the nine `scripts/usage-<name>.ts`
// entries (spec 0253 R7). Each entry maps to one JavaScript module under
// scripts/lib and runs it in a child Node.js process, exactly as the shell
// predecessor did with `exec node --disable-warning=ExperimentalWarning`.
//
// The environment is passed through untouched, so `NODE_OPTIONS` and every other
// inherited variable reach the child. `nodePath` and `libDir` are test-only
// overrides.

import { spawnSync } from "node:child_process";
import path from "node:path";

export interface RunJsOptions {
  readonly nodePath?: string;
  readonly libDir?: string;
}

/** Run `scriptRelative` (relative to scripts/lib) with `args`; return the exit status. */
export function runJs(
  scriptRelative: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  options: RunJsOptions = {},
): number {
  const nodePath = options.nodePath ?? process.execPath;
  const libDir = options.libDir ?? import.meta.dirname;
  const result = spawnSync(
    nodePath,
    ["--disable-warning=ExperimentalWarning", path.join(libDir, scriptRelative), ...args],
    { stdio: "inherit", env },
  );
  if (result.status === null || result.error !== undefined) {
    const reason =
      result.error?.message ??
      (result.signal === null ? "no exit status" : `signal ${result.signal}`);
    process.stderr.write(`Error: ${scriptRelative} did not run to completion (${reason})\n`);
    return 1;
  }
  return result.status;
}
