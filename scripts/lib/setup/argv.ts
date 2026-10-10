// argv.ts — the command line of a setup entry (spec 0256 requirements 6 and 13). `--link` sets the
// link mode, `--answer <id>=<value>` (or `--answer=<id>=<value>`) is repeatable, and every other
// argument is ignored as the shell ignored it. A malformed `--answer` prints one `Error:` line and
// throws `UsageError` before anything is modified. Which ids and values are valid is checked by
// answers.ts against the inventory.

import type { Io } from "../extension/types.ts";
import { UsageError } from "./exit.ts";

export interface ParsedAnswer {
  readonly id: string;
  readonly value: string;
}

export interface ParsedSetupArgv {
  readonly link: boolean;
  readonly answers: readonly ParsedAnswer[];
}

function usage(io: Io, message: string): never {
  io.err(`Error: ${message}`);
  throw new UsageError(message);
}

function splitAnswer(io: Io, spec: string): ParsedAnswer {
  const eq = spec.indexOf("=");
  if (eq < 0) usage(io, `--answer expects <id>=<value>, got '${spec}'`);
  const id = spec.slice(0, eq);
  if (id === "") usage(io, `--answer expects a non-empty id before '=', got '${spec}'`);
  return { id, value: spec.slice(eq + 1) };
}

export function parseSetupArgv(argv: readonly string[], io: Io): ParsedSetupArgv {
  let link = false;
  const answers: ParsedAnswer[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--link") link = true;
    else if (arg === "--answer") {
      const next = argv[i + 1];
      if (next === undefined) usage(io, "--answer expects <id>=<value>, got no argument");
      answers.push(splitAnswer(io, next));
      i += 1;
    } else if (typeof arg === "string" && arg.startsWith("--answer=")) {
      answers.push(splitAnswer(io, arg.slice("--answer=".length)));
    }
  }
  return { link, answers };
}
