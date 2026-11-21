// crewrig-cli.ts — the framework entry point that the organization launcher runs from a verified version
// (spec 0314 R5, R6, R10, R14). The launcher passes `<command> [arguments...]` verbatim; this file
// dispatches the commands it knows and refuses any other with exit 2, never with a launcher code (10 to 14).
// The command modules live under scripts/lib/crewrig-cli/ and nothing else of scripts/lib is loaded.

import path from "node:path";
import { parseInitArguments } from "./lib/crewrig-cli/args.ts";
import { runEntry } from "./lib/crewrig-cli/exit.ts";
import { originRepository } from "./lib/crewrig-cli/origin.ts";
import { runInit } from "./lib/crewrig-cli/scaffold.ts";

/** The root of the pinned version: this file sits in its scripts/ directory. */
const VERSION_ROOT = path.resolve(import.meta.dirname, "..");

async function dispatch(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined) {
    console.error("usage: node crewrig <command> [arguments...] (commands: init)");
    return 2;
  }
  if (command !== "init") {
    console.error(`crewrig: unknown command ${JSON.stringify(command)} (commands: init)`);
    return 2;
  }
  const parsed = parseInitArguments(rest);
  if (!parsed.ok) {
    console.error(parsed.message);
    return 2;
  }
  const cwd = process.cwd();
  return runInit({
    cwd,
    templateRoot: VERSION_ROOT,
    feedbackRepo: parsed.feedbackRepo,
    originRepo: () => originRepository(cwd),
  });
}

runEntry(() => dispatch(process.argv.slice(2)));
