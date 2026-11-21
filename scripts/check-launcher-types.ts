// check-launcher-types.ts — strict type check of the organization launcher (spec 0314 R12; plan of
// issue #2101, step 11). The check itself lives in scripts/lib/launcher-types.ts; the `launcher` step
// of scripts/check-typescript.ts runs it inside `lint-typescript`.
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-launcher-types.ts [--file <path>]
//   --file <path>  the launcher, relative to the repository root (default templates/org-repo/crewrig)
//
// Exit: 0 clean, 1 a header defect or a type error, 2 a wiring fault or a usage error.

import { checkLauncher, LAUNCHER_FILE } from "./lib/launcher-types.ts";
import { repoRoot } from "./lib/ts-scope.ts";

function fileArgument(argv: string[]): string | undefined {
  if (argv.length === 0) return LAUNCHER_FILE;
  if (argv.length === 2 && argv[0] === "--file" && argv[1] !== undefined && argv[1] !== "")
    return argv[1];
  if (
    argv.length === 1 &&
    argv[0]?.startsWith("--file=") === true &&
    argv[0].length > "--file=".length
  ) {
    return argv[0].slice("--file=".length);
  }
  return undefined;
}

function main(argv: string[]): number {
  const file = fileArgument(argv);
  if (file === undefined) {
    console.log("check-launcher-types: usage: check-launcher-types.ts [--file <path>]");
    return 2;
  }
  const result = checkLauncher(repoRoot(), file);
  for (const line of result.lines) console.log(line);
  const verdict = result.status === 0 ? "OK" : result.status === 1 ? "FAILED" : "ERROR";
  console.log(`check-launcher-types: ${verdict}`);
  return result.status;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  console.error(`check-launcher-types: error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 2;
}
