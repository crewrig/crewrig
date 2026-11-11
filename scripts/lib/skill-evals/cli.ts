// cli.ts — argument handling of `scripts/skill-evals.ts` (spec 0290 R16, R34, R33).
//
// Usage: task skill-evals -- <skill-name> | --changed [--out <dir>] [--mock] [--ticket <N>]
//        [--base <ref>] [--judge-config <file>]
// Exit: 0 ok, 1 a blocking outcome (invalid, error, and regression / no-evals under their
// settings), 2 usage error or unknown skill, 3 failed precondition (no credentials, refused judge
// configuration, no ticket to attribute the spend to).
// Finding-line format: see report.ts.

import path from "node:path";

import { runEvals } from "./run.ts";
import type { RunOptions } from "./run.ts";
import { describeSkill, findSkill, mergeBase, selectChanged } from "./select.ts";
import type { Selection } from "./select.ts";
import { DEFAULT_OUT_DIR } from "./settings.ts";

export interface CliIo {
  readonly stdout: (s: string) => void;
  readonly stderr: (s: string) => void;
}

export interface ParsedArgs {
  name?: string;
  changed: boolean;
  out: string;
  mock: boolean;
  ticket?: string;
  base: string;
  judgeConfig?: string;
}

export const USAGE =
  "Usage: task skill-evals -- <skill-name> | --changed [--out <dir>] [--mock] [--ticket <N>] [--base <ref>] [--judge-config <file>]";

export function parseArgs(argv: readonly string[]): ParsedArgs | { error: string } {
  const a: ParsedArgs = { changed: false, out: DEFAULT_OUT_DIR, mock: false, base: "origin/main" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    const value = (): string | undefined => argv[++i];
    if (arg === "--") continue;
    else if (arg === "--changed") a.changed = true;
    else if (arg === "--mock") a.mock = true;
    else if (
      arg === "--out" ||
      arg === "--ticket" ||
      arg === "--base" ||
      arg === "--judge-config"
    ) {
      const v = value();
      if (v === undefined || v.startsWith("--")) return { error: `${arg} needs a value` };
      if (arg === "--out") a.out = v;
      else if (arg === "--ticket") a.ticket = v;
      else if (arg === "--base") a.base = v;
      else a.judgeConfig = v;
    } else if (arg.startsWith("-")) return { error: `unknown option ${arg}` };
    else if (a.name === undefined) a.name = arg;
    else return { error: `unexpected argument ${arg}` };
  }
  if (a.changed === (a.name !== undefined))
    return { error: "give exactly one of <skill-name> or --changed" };
  return a;
}

export async function main(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  repoRoot: string,
  io: CliIo,
  extra: Partial<RunOptions> = {},
): Promise<number> {
  const args = parseArgs(argv);
  if ("error" in args) {
    io.stderr(`${args.error}\n${USAGE}\n`);
    return 2;
  }
  let selections: Selection[];
  if (args.changed) {
    const r = selectChanged(repoRoot, args.base);
    if ("error" in r) {
      io.stderr(`${r.error}\n`);
      return 2;
    }
    selections = r.selections;
    if (selections.length === 0) {
      io.stdout("skill-evals: no skill changed against the merge-base; nothing to run\n");
      return 0;
    }
  } else {
    const found = findSkill(repoRoot, args.name as string);
    if ("error" in found) {
      io.stderr(`${found.error}\n`);
      return 2;
    }
    const base = mergeBase(repoRoot, args.base);
    if (base === undefined) {
      io.stderr(`cannot compute the merge-base of HEAD with ${args.base}; pass --base <ref>\n`);
      return 2;
    }
    selections = [describeSkill(repoRoot, found.skill, base)];
  }
  const report = await runEvals(
    {
      repoRoot,
      out: path.resolve(repoRoot, args.out),
      mock: args.mock,
      env,
      ...(args.ticket !== undefined ? { ticket: args.ticket } : {}),
      ...(args.judgeConfig !== undefined ? { judgeConfigFile: args.judgeConfig } : {}),
      ...extra,
    },
    selections,
  );
  if (report.stderr !== "") io.stderr(report.stderr);
  if (report.results.length > 0) io.stdout(report.text);
  return report.exitCode;
}
