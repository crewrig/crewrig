// spawn-spy.ts — a preload (`node --import <this file> <entry>`) that records
// every process the entry starts through `node:child_process` (spec 0248 R3,
// R11, R12, R24; plan verification duties 3 and 7).
//
// Each call appends one JSON line to the file named by $SPAWN_SPY_LOG:
// `{"fn": "spawnSync", "file": "git", "args": ["status"]}` (`exec` and
// `execSync` carry the shell command text in `file`). The wrappers call
// through, so the entry still works; `syncBuiltinESMExports` makes the
// patched functions the ones a later `import { spawnSync } from
// "node:child_process"` binds to, as well as the ones `require` returns.
//
// A test asserts on the log, never on the entry's own output, so a flag on the
// command line is acceptable here; the entry-form suite runs without one.

import childProcess from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

export interface SpyRecord {
  readonly fn: string;
  readonly file: string;
  readonly args: readonly string[];
}

const log = process.env["SPAWN_SPY_LOG"];
const patched = childProcess as unknown as Record<string, (...args: unknown[]) => unknown>;

function record(fn: string, file: unknown, args: unknown): void {
  if (log === undefined || log === "") return;
  const entry: SpyRecord = {
    fn,
    file: typeof file === "string" ? file : String(file),
    args: Array.isArray(args) ? args.map(String) : [],
  };
  fs.appendFileSync(log, `${JSON.stringify(entry)}\n`);
}

for (const fn of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"]) {
  const original = patched[fn];
  if (typeof original !== "function") continue;
  patched[fn] = function spied(this: unknown, ...args: unknown[]): unknown {
    record(fn, args[0], args[1]);
    return original.apply(this, args);
  };
}
syncBuiltinESMExports();
