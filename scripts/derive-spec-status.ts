// derive-spec-status.ts — CLI entry of the spec 0109 delta-04 Requirement 23
// derivation: the status each merged spec or delta-spec truly carries on a
// branch, from commit-graph reachability and the forge's merged-PR record.
// The rule lives in scripts/lib/spec-status-derivation.ts.
//
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/derive-spec-status.ts \
//     --branch <ref> --scope draft-deltas|release-only [--main-ref crewrig/main] \
//     [--format md|tsv] [--apply [--worktree <dir>]] [--check]
//   task spec:derive-status -- --branch HEAD --scope draft-deltas --check
//
// Needs a full (unshallow) clone and an authenticated `gh`. The spec linter
// stays forge-free (spec 0109 R3); this tool is where forge evidence is read.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import type { RunResult } from "./lib/spec-status-derivation.ts";
import { main } from "./lib/spec-status-derivation.ts";
import { WiringError, repoRoot } from "./lib/ts-scope.ts";

function run(cmd: string, args: readonly string[], cwd?: string): RunResult {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? r.error?.message ?? "",
  };
}

let root: string;
try {
  root = repoRoot();
} catch (e) {
  if (!(e instanceof WiringError)) throw e;
  process.stderr.write(`derive-spec-status: wiring fault: ${e.message}\n`);
  process.exit(2);
}

process.exitCode = main(process.argv.slice(2), {
  git: (args, cwd) => run("git", ["-C", cwd ?? root, ...args]),
  gh: (args) => run("gh", args),
  readFile: (abs) => {
    try {
      return readFileSync(abs, "utf8");
    } catch {
      return null;
    }
  },
  writeFile: (abs, content) => writeFileSync(abs, content),
  root,
  sleep: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
});
