// exit.ts — shared output and exit plumbing for the spec-id twins (spec 0262).
//
// Usage: note("..."), out("..."), fail("..."), throw new ExitSignal(code)
// Exit codes: not applicable (library); the entries map ExitSignal to process.exitCode.
// Finding-line format: not applicable.

/** Thrown to unwind to the entry with the shell's `exit <code>`. */
export class ExitSignal extends Error {
  readonly code: number;
  constructor(code: number) {
    super(`exit ${code}`);
    this.code = code;
  }
}

/** Shell `echo "$*" >&2`. */
export function note(text: string): void {
  process.stderr.write(`${text}\n`);
}

/** Shell `echo`/`printf '%s\n'` on stdout. */
export function out(text: string): void {
  process.stdout.write(`${text}\n`);
}

/** The reserve script's `fail`: `Error: <message>` on stderr, exit 1. */
export function fail(message: string): never {
  note(`Error: ${message}`);
  throw new ExitSignal(1);
}

/** Run `main`, translating ExitSignal into process.exitCode (0 when it returns). */
export function runEntry(main: () => void): void {
  try {
    main();
    process.exitCode = 0;
  } catch (error) {
    if (error instanceof ExitSignal) process.exitCode = error.code;
    else throw error;
  }
}

/** Bash `[[:space:]]` under LC_ALL=C. */
export const SPACE = " \t\n\v\f\r";

export function trimSpace(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && SPACE.includes(value[start] as string)) start += 1;
  while (end > start && SPACE.includes(value[end - 1] as string)) end -= 1;
  return value.slice(start, end);
}

/** `read -r` loop over a file's text: lines, the final unterminated one included. */
export function fileLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}
