// shell.ts — the one permitted shell spawn of ci-cache-guard and ci-changeset-coverage (spec 0262
// req 4): the wrapped commands run through `bash -c`, so builtins, functions and the shell's own
// "command not found" diagnostic behave as under the shell twin.
//
// Usage: library. Exit codes: not applicable. Finding-line format: not applicable.

import os from "node:os";

/**
 * Script text whose first statement sits on line `line`. A bash diagnostic names its line, so
 * padding with line feeds makes the twin print the same `<script>: line N:` prefix as the shell.
 */
export function atLine(line: number, body: string): string {
  return `${"\n".repeat(line - 1)}${body}`;
}

/** The status bash reports: the exit status, or 128 + the signal number for a killed child. */
export function statusOf(status: number | null, signal: NodeJS.Signals | null): number {
  if (status !== null) return status;
  if (signal !== null) return 128 + (os.constants.signals[signal] ?? 1);
  return 1;
}

/** `$0` the shell script would show: the twin's own path with the `.sh` extension. */
export function shellName(entry: string): string {
  return entry.replace(/\.ts$/, ".sh");
}
