// selection.ts — which components to scaffold (spec 0258 R24, deviation (h)).
// Precedence: `--components`; else `CREWRIG_TEST_FZF_SELECTION` WHEN DEFINED (set and empty
// means no component), one component per line; else the built-in prompt when standard input is
// a terminal; else a failure naming the two non-interactive forms. The `fzf` stub that the Bash
// suites put on `PATH` is ignored: nothing here spawns a process.

import type { Env } from "../extension/types.ts";
import { promptComponents } from "./prompt.ts";

export const SELECTION_VARIABLE = "CREWRIG_TEST_FZF_SELECTION";

export type Selection =
  | { readonly ok: true; readonly components: readonly string[] }
  | { readonly ok: false; readonly message: string };

export interface SelectionInput {
  readonly name: string;
  readonly fromOption: readonly string[] | undefined;
  readonly env: Env;
  readonly stdinIsTty: boolean;
  readonly stdin: NodeJS.ReadableStream;
  readonly stdout: NodeJS.WritableStream;
}

/** The variable's value as the shell's `$(...)` and `read` loop saw it: lines, blanks dropped. */
export function linesOf(text: string): string[] {
  return text.split("\n").filter((line) => line !== "");
}

export async function selectComponents(input: SelectionInput): Promise<Selection> {
  if (input.fromOption !== undefined) return { ok: true, components: input.fromOption };
  const fromEnv = input.env[SELECTION_VARIABLE];
  if (fromEnv !== undefined) return { ok: true, components: linesOf(fromEnv) };
  if (input.stdinIsTty) {
    return { ok: true, components: await promptComponents(input.name, input.stdin, input.stdout) };
  }
  return {
    ok: false,
    message: `Error: no component selection and standard input is not a terminal; pass --components <a,b,...> or set ${SELECTION_VARIABLE} (one component per line; empty for none).`,
  };
}
