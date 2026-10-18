// entry.ts — ci-cache-guard: argument parsing, cache mode and the dispatch to `--stray-scan`
// (spec 0147 R6/R7, spec 0170 delta-01, spec 0262 req 10). Twin of scripts/ci-cache-guard.sh.
//
// Usage: runGuard(argv, self). Exit codes: 0 hit or success, the wrapped command's status,
// 2 usage error (unknown option, no command, --stray-scan with a cache option), 70/71 stray-scan.
// Finding-line format: `ci-cache-guard: cache hit for: <cmd>`, `ci-cache-guard: cache miss,
// running: <cmd>`, `ci-cache-guard: wrote marker <path>`.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { fatal, ok } from "../governance/report.ts";
import { markerPath } from "./key.ts";
import { atLine, bashPath, NO_BASH, shellName, statusOf } from "./shell.ts";
import { strayScan } from "./stray.ts";

/**
 * Options that take a value. A missing value is a shell runtime diagnostic (`$2: unbound
 * variable`, with a script path and line): spec 0262 requirement 24 (c), so one `Error:` line, 1.
 */
const OPTION_LINES: Record<string, number> = { "--cache-dir": 1, "--key-files": 1, "--key-env": 1 };
const RUN_LINE = 218;

export async function runGuard(argv: readonly string[], entry: string): Promise<number> {
  const self = shellName(entry);
  let cacheDir = ".ci-cache";
  let keyFiles = "";
  let keyEnv = "";
  let stray = false;
  let cacheOpt = false;
  let i = 0;
  for (; i < argv.length;) {
    const a = argv[i] as string;
    const line = OPTION_LINES[a];
    if (line !== undefined) {
      const value = argv[i + 1];
      if (value === undefined) {
        fatal(`Error: ${self}: option '${a}' needs a value`);
        return 1;
      }
      if (a === "--cache-dir") cacheDir = value;
      else if (a === "--key-files") keyFiles = value;
      else keyEnv = value;
      cacheOpt = true;
      i += 2;
    } else if (a === "--stray-scan") {
      stray = true;
      i += 1;
    } else if (a === "--") {
      i += 1;
      break;
    } else {
      fatal(`Error: unknown option '${a}'`);
      return 2;
    }
  }
  const args = argv.slice(i);
  if (args.length === 0) {
    fatal("Error: no command given after '--'");
    return 2;
  }
  if (stray && cacheOpt) {
    fatal("Error: --stray-scan cannot be combined with --cache-dir, --key-files or --key-env");
    return 2;
  }
  if (stray) return strayScan(args, self);

  const cwd = process.cwd();
  const marker = markerPath({ cacheDir, keyFiles, keyEnv, args, cwd, env: process.env });
  const cmd = args.join(" ");
  if (fs.statSync(path.resolve(cwd, marker), { throwIfNoEntry: false })?.isFile() === true) {
    ok(`ci-cache-guard: cache hit for: ${cmd}`);
    return 0;
  }
  const bash = bashPath();
  if (bash === null) {
    fatal(NO_BASH);
    return 1;
  }
  ok(`ci-cache-guard: cache miss, running: ${cmd}`);
  const r = spawnSync(bash, ["-c", atLine(RUN_LINE, '"$@"'), self, ...args], {
    stdio: "inherit",
  });
  if (r.error !== undefined) {
    fatal("ci-cache-guard: bash was not found on PATH");
    return 127;
  }
  const status = statusOf(r.status, r.signal);
  if (status !== 0) return status;
  fs.mkdirSync(path.dirname(path.resolve(cwd, marker)), { recursive: true });
  fs.writeFileSync(path.resolve(cwd, marker), "");
  ok(`ci-cache-guard: wrote marker ${marker}`);
  return 0;
}
