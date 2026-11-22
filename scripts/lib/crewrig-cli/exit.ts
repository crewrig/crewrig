// exit.ts — the exit wrapper of the framework entry point (spec 0314 R10; plan of issue #2101, v2-F3).
// The exit code is set to 1 before `main` runs, so a thrown error and a promise that never settles end in
// 1, never in a launcher code (10 to 14, Node itself uses 13 for an unsettled top-level await). The code
// of `main` is assigned only once `main` has resolved. `main` is a parameter, so the three outcomes are
// tested in a child process without any hook in the entry point.

export type EntryMain = () => Promise<number>;

export function runEntry(
  main: EntryMain,
  report: (message: string) => void = (message) => console.error(message),
): void {
  process.exitCode = 1;
  new Promise<number>((resolve) => resolve(main())).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      report(`crewrig: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}

/**
 * The status of `build`, `setup` and `update` (spec 0315 R3): exactly 0, 1 or 2. Any other value is a failure of
 * the command itself, so no code from 10 to 14 can come from these commands whatever a child process returned.
 */
export function commandCode(code: number): 0 | 1 | 2 {
  return code === 0 || code === 1 || code === 2 ? code : 1;
}
