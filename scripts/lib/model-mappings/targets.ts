// targets.ts — argument parsing and the target work list (check-model-mappings.sh:111-189).
// A basename `*.org.yml` is an org channel file for the stem before `.org.yml`; every
// other `*.yml` is a core mapping; one entry per target, in first-appearance order.

import fs from "node:fs";
import path from "node:path";

import type { Outcome, TargetEntry } from "./types.ts";

export interface Args {
  printSelection: boolean;
  named: string[];
}

export function parseArgs(argv: readonly string[]): Args {
  const named = argv.filter((a) => a !== "--print-selection");
  return { printSelection: named.length !== argv.length, named };
}

const err = (message: string, code = 2): Outcome => ({ stdout: "", stderr: `${message}\n`, code });

const isFile = (p: string): boolean => fs.statSync(p, { throwIfNoEntry: false })?.isFile() === true;

/** The files to classify: the named ones, else `model-mappings/*.yml` in C-locale order. */
export function resolveFiles(args: Args, repoDir: string): string[] | Outcome {
  if (args.named.length > 0) {
    for (const a of args.named) {
      if (!isFile(a)) return err(`Error: named argument does not exist: ${a}`);
    }
    return [...args.named];
  }
  const dir = path.join(repoDir, "model-mappings");
  if (fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory() !== true) {
    return err(`Error: model-mappings/ not found: ${dir}`);
  }
  const files = fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".yml") && !n.startsWith("."))
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
    .map((n) => path.join(dir, n))
    .filter(isFile);
  if (files.length === 0) return err(`Error: no *.yml files under ${dir}`);
  return files;
}

/** One entry per target; a file that is not `*.yml` is skipped. */
export function classify(files: readonly string[]): TargetEntry[] {
  const entries: TargetEntry[] = [];
  for (const f of files) {
    const base = path.basename(f);
    let stem: string;
    let org: boolean;
    if (base.endsWith(".org.yml")) {
      stem = base.slice(0, -".org.yml".length);
      org = true;
    } else if (base.endsWith(".yml")) {
      stem = base.slice(0, -".yml".length);
      org = false;
    } else continue;
    let entry = entries.find((e) => e.target === stem);
    if (entry === undefined) {
      entry = { target: stem, corePath: "", orgPath: "" };
      entries.push(entry);
    }
    if (org) entry.orgPath = f;
    else entry.corePath = f;
  }
  return entries;
}
