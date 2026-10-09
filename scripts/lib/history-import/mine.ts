// mine.ts — the only subprocess of the history-import port (spec 0253 R11): `mempalace mine`
// through the detected interpreter, with the child sharing the parent's standard streams.

import { spawnSync } from "node:child_process";

export interface MineArgs {
  readonly source: string;
  readonly wing: string;
  readonly agent: string;
  readonly extract: string;
  readonly dryRun: boolean;
}

/**
 * The Windows launcher `py -3` is listed by `detectMempalacePython` as one text but is a command
 * plus a leading argument; every other candidate is a single command (a path may hold spaces).
 */
export function splitInterpreter(candidate: string): readonly [string, ...string[]] {
  return candidate === "py -3" ? ["py", "-3"] : [candidate];
}

/** Run `<interpreter> -m mempalace mine ...`; returns the child's exit status, 127 when it cannot start. */
export function runMine(interpreter: string, args: MineArgs): number {
  const argv = [
    "-m",
    "mempalace",
    "mine",
    args.source,
    "--mode",
    "convos",
    "--wing",
    args.wing,
    "--agent",
    args.agent,
    "--extract",
    args.extract,
    ...(args.dryRun ? ["--dry-run"] : []),
  ];
  const [command, ...lead] = splitInterpreter(interpreter);
  const result = spawnSync(command, [...lead, ...argv], { stdio: "inherit" });
  if (result.error !== undefined || result.status === null) return 127;
  return result.status;
}
