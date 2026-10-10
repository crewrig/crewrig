// answers.ts — the pre-answers of one setup run (spec 0256 requirement 13). `createAnswers`
// validates every `--answer` against the closed inventory before any file is modified: an unknown
// id, an id given twice with different values and a value that is not one of the question's options
// are usage errors (one `Error:` line, `UsageError`, status 2). A known id the run never asks stays
// unused, and the caller prints `unusedWarning` once after the run.

import type { Io } from "../extension/types.ts";
import type { Cli } from "./context.ts";
import type { ParsedSetupArgv } from "./argv.ts";
import { UsageError } from "./exit.ts";
import { isPromptId, rowOf } from "./prompt-ids.ts";

export interface Answers {
  /** The pre-answer of `id` (the option's own spelling; a catalogue value verbatim), marking it consumed. */
  take(id: string): string | undefined;
  /** The ids accepted but never taken, in command-line order. */
  unused(): readonly string[];
}

function fail(io: Io, message: string): never {
  io.err(`Error: ${message}`);
  throw new UsageError(message);
}

/** The canonical value: the option's own spelling for an option question, any string for a catalogue one. */
function canonical(io: Io, id: string, value: string): string {
  const row = rowOf(id);
  if (row.catalogue !== undefined) return value;
  const lower = value.toLowerCase();
  const option = row.options.find((o) => o.toLowerCase() === lower);
  if (option === undefined) {
    fail(io, `--answer ${id}=${value}: '${value}' is not one of: ${row.options.join(", ")}`);
  }
  return option;
}

// `cli` is part of the signature (spec 0256 requirement 13): a known id the setup does not ask is
// accepted and ignored, which falls out of `unused()` without any per-CLI filtering here.
export function createAnswers(parsed: ParsedSetupArgv, _cli: Cli, io: Io): Answers {
  const values = new Map<string, string>();
  for (const { id, value } of parsed.answers) {
    if (!isPromptId(id)) fail(io, `--answer: unknown question id '${id}'`);
    const checked = canonical(io, id, value);
    const previous = values.get(id);
    if (previous !== undefined && previous !== checked) {
      fail(io, `--answer ${id} given twice with different values: '${previous}' and '${checked}'`);
    }
    values.set(id, checked);
  }
  const taken = new Set<string>();
  return {
    take(id) {
      const value = values.get(id);
      if (value !== undefined) taken.add(id);
      return value;
    },
    unused() {
      return [...values.keys()].filter((id) => !taken.has(id));
    },
  };
}

/** The one warning printed on standard error after the run, or `undefined` when nothing is unused. */
export function unusedWarning(ids: readonly string[]): string | undefined {
  if (ids.length === 0) return undefined;
  return `Warning: --answer given for a question that was not asked: ${ids.join(", ")}`;
}
