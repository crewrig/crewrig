// sweep-en-us.ts — en-GB -> en-US orthographic sweep driver (spec 0023), the
// TypeScript twin of scripts/sweep-en-us.sh and its engine scripts/lib/en_us_sweep.py
// (spec 0262). Same modes, output and exit status; it never spawns python, so the
// shell driver's `PYTHON` override has no meaning here and is ignored.
//
// Usage: node scripts/sweep-en-us.ts [--apply|--check|--scope-test|--list|--aspell]
//   --apply       rewrite the in-scope set in place (default).
//   --check       R6 gate: zero British spellings, excluded trees untouched, detect
//                 list a strict superset of the map. Read-only.
//   --scope-test  sweep scope == detector scope for every in-scope file.
//   --list        print the resolved in-scope file set.
//   --aspell      optional, non-gating advisory (skipped when aspell is absent).

import path from "node:path";

import {
  EngineExit,
  doApply,
  doAspell,
  doCheck,
  doList,
  doScopeTest,
} from "./lib/en-us-sweep/modes.ts";
import type { Io } from "./lib/en-us-sweep/modes.ts";

const repoDir = path.resolve(import.meta.dirname, "..");
process.chdir(repoDir);
const paths = {
  map: path.join(repoDir, "scripts", "lib", "en-gb-us-map.txt"),
  detect: path.join(repoDir, "scripts", "lib", "en-gb-detect.txt"),
};
const io: Io = {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
};

function main(): number {
  const mode = process.argv[2] || "--apply";
  switch (mode) {
    case "--apply":
      return doApply(io, paths);
    case "--check":
      return doCheck(io, paths);
    case "--scope-test":
      return doScopeTest(io, paths);
    case "--list":
      return doList(io);
    case "--aspell":
      return doAspell(io);
    default:
      io.err(`usage: ${process.argv[1]} [--apply|--check|--scope-test|--list|--aspell]\n`);
      return 2;
  }
}

try {
  process.exitCode = main();
} catch (e) {
  io.err(
    e instanceof EngineExit
      ? `${e.message}\n`
      : `sweep-en-us: ${e instanceof Error ? e.message : String(e)}\n`,
  );
  process.exitCode = 1;
}
