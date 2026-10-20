// build-cli-matrix.ts — assemble docs/cli-matrix.md from docs/cli-matrix/ (spec 0272).
//
// Usage: node scripts/build-cli-matrix.ts [--check | row <id>]
// Exit codes: 0 ok (written / fresh / row printed); 1 stale, unknown row id or invalid
//   sources (stderr); 2 bad usage.
// Output: write mode regenerates docs/cli-matrix.md; the logic lives under
//   scripts/lib/build-cli-matrix/.

import { runMain } from "./lib/build-cli-matrix/run.ts";

process.exitCode = runMain(process.argv.slice(2));
