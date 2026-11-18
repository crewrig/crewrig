// cli.ts — argument parsing and the io shape shared by the three framework release entries.

import { parseArgs } from "node:util";

export interface Io {
  out(line: string): void;
  err(line: string): void;
}

/** A usage error: printed as `Error: <message>` and exits 2. */
export class UsageError extends Error {}

type Options = NonNullable<Parameters<typeof parseArgs>[0]>["options"];

export function parseFlags(
  argv: readonly string[],
  options: Options,
): Record<string, string | boolean | undefined> {
  try {
    return parseArgs({ args: [...argv], options, allowPositionals: false, strict: true }).values;
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

export function required(
  flags: Record<string, string | boolean | undefined>,
  name: string,
): string {
  const value = flags[name];
  if (typeof value !== "string" || value === "") throw new UsageError(`--${name} is required`);
  return value;
}
