// setup-golden-cases-prereq.ts — the tooling-guard cells of the four shell setups (spec 0256
// requirement 7, review finding i1-F4): without `fzf`, then without `jq`, each setup prints its
// `Error: <tool> is required but not installed.` guard, exits 1 and writes nothing. The
// TypeScript setup has no such guard (requirement 44), so the cells run on the shell leg only.
import fs from "node:fs";
import path from "node:path";

import { CLIS } from "./setup-golden-types.ts";
import type { GoldenCase } from "./setup-golden-types.ts";

const DEVIATION = "deviation (a): the TypeScript setup has no fzf/jq guard";

const missing = (cli: GoldenCase["cli"], tool: "fzf" | "jq"): GoldenCase => ({
  id: `missing-${tool}`,
  cli,
  note: `No \`${tool}\` on PATH: \`Error: ${tool} is required but not installed.\` and status 1 before anything is written (R7 missing prerequisite, requirement 21).`,
  seed: (sb) => fs.rmSync(path.join(sb.bin, tool), { force: true }),
  shellOnly: DEVIATION,
});

export const cases: readonly GoldenCase[] = CLIS.flatMap((cli) => [
  missing(cli, "fzf"),
  missing(cli, "jq"),
]);
