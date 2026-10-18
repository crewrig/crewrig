// shell-resolve-compare.ts — outcome comparison and the documented-difference table of the
// conformance suites (split from shell-resolve-harness.ts; re-exported there).

import type { Outcome, ResolveCase } from "./shell-resolve-harness.ts";

/** Differences between two outcomes, one `field: shell=... twin=...` line each; empty when equal. */
export function diffOutcomes(shell: Outcome, twin: Outcome): string[] {
  const keys = Object.keys(shell) as (keyof Outcome)[];
  const rows = keys.map((k) => [k, JSON.stringify(shell[k]), JSON.stringify(twin[k])] as const);
  return rows.filter(([, a, b]) => a !== b).map(([k, a, b]) => `${k}: shell=${a} twin=${b}`);
}

/** A listed, deliberate difference between a twin and the shell (R33 or a plan finding). */
export interface Documented {
  readonly id: string;
  /** The clause that allows it: stated in the suite, asserted nowhere else. */
  readonly clause: string;
  /** Case keys, `<builder name>#<profile index>`: every case of the builder if no `#`. */
  readonly keys: readonly string[];
  /** Null when the difference is exactly the documented one, else what is wrong. */
  readonly verify: (shell: Outcome, twin: Outcome) => string | null;
}

/** The differing fields of a case, for a `verify`. */
export const differing = (shell: Outcome, twin: Outcome): string[] =>
  diffOutcomes(shell, twin).map((line) => line.split(":")[0] ?? "");

const BASH_INTEGER = /^\S*model-resolve\.sh: line \d+: \[: \S*: integer(?: expression)? expected$/;
/** Plan finding S3: bash's own `[` diagnostic is not reproduced; nothing else differs. */
export function bashIntegerOnly(shell: Outcome, twin: Outcome): string | null {
  if (differing(shell, twin).join() !== "stderr")
    return `differs in ${differing(shell, twin)}, not stderr only`;
  const ours = shell.stderr.filter((l) => !BASH_INTEGER.test(l));
  if (shell.stderr.length === ours.length)
    return "the shell printed no bash diagnostic: the difference vanished";
  return JSON.stringify(ours) === JSON.stringify(twin.stderr)
    ? null
    : `the remaining lines differ: ${ours}`;
}

/** One case's problems against a table of documented differences; an unlisted difference is one. */
export function checkCase(
  c: ResolveCase,
  shell: Outcome,
  twin: Outcome,
  table: readonly Documented[],
): string[] {
  const row = table.find((r) =>
    r.keys.some((k) => `${c.label}/`.includes(k.includes("#") ? `/${k}/` : `/${k}#`)),
  );
  if (row === undefined) {
    const lines = diffOutcomes(shell, twin);
    return lines.length === 0 ? [] : [`${c.label}\n    ${lines.join("\n    ")}`];
  }
  const problem = row.verify(shell, twin);
  return problem === null
    ? []
    : [`${c.label}: documented difference "${row.id}" is not as listed: ${problem}`];
}
