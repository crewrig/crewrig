// differential-compare.ts — the comparison core of the differential suites (spec 0250 R33): the
// deviation table (R33 letter to the transform from the shell's outcome to the entry's), the
// equality check that makes an unlisted difference fail and a vanished listed one fail, and the
// per-row runner. Linux gate or CREWRIG_SHELL_PARITY=1; retires with the shell script (PR D).

import assert from "node:assert/strict";

import { normalise, runShell, runTs } from "./differential-kit.ts";
import type { Outcome, Pair } from "./differential-kit.ts";

const RULE = "=".repeat(41);
const HINT_SHELL = "FAILED: Drift detected. Run 'bash scripts/build-components.sh' to regenerate.";
const HINT_TS = "FAILED: Drift detected. Run 'node scripts/build-components.ts' to regenerate.";

/** The deviation table: R33 letter to the transform from the shell's outcome to the entry's. */
export const DEVIATIONS: Record<string, (o: Outcome) => Outcome> = {
  // (a) the drift hint names the TypeScript invocation
  a: (o) => ({ ...o, stdout: o.stdout.replace(HINT_SHELL, HINT_TS) }),
  // (c) `--check` no longer runs the assembly test: its stdout block and its stderr tail go
  c: (o) => {
    const out = o.stdout.split("\n");
    const rules = out.flatMap((l, i) => (l === RULE ? [i] : []));
    const end = out.indexOf("OK: assembly verification passed.");
    const kept =
      rules.length >= 4 && end > 0 ? [...out.slice(0, rules[2]), ...out.slice(end + 1)] : out;
    const err = o.stderr.split("\n");
    const tail = /^model-note\tdeveloper\t\w+\tno-mapping\t/;
    while (err.length > 1 && tail.test(err[err.length - 2] ?? "")) err.splice(err.length - 2, 1);
    return { ...o, stdout: kept.join("\n"), stderr: err.join("\n") };
  },
};

/** Assert `ts` equals `shell` after the listed deviations (each must change the shell outcome). */
export function expectSame(
  label: string,
  shell: Outcome,
  ts: Outcome,
  deviation: readonly string[] = [],
): void {
  let expected = shell;
  for (const letter of deviation) {
    const transform = DEVIATIONS[letter];
    assert.ok(transform !== undefined, `${label}: no transform for R33(${letter})`);
    const next = transform(expected);
    assert.notDeepEqual(next, expected, `${label}: the listed deviation R33(${letter}) vanished`);
    expected = next;
  }
  assert.equal(ts.status, expected.status, `${label}: status`);
  assert.equal(ts.stdout, expected.stdout, `${label}: stdout`);
  assert.equal(ts.stderr, expected.stderr, `${label}: stderr`);
  assert.deepEqual(ts.tree, expected.tree, `${label}: the produced tree`);
  assert.deepEqual(ts.tmp, expected.tmp, `${label}: what is left under TMPDIR`);
}

export interface Row {
  readonly args: readonly string[];
  readonly deviation?: readonly string[];
  /** Build with the entry on both roots first (so `--check` starts from a built tree), then `tamper`. */
  readonly prebuild?: boolean;
  readonly tamper?: (root: string) => void;
  readonly env?: (pair: Pair, side: "a" | "b") => Record<string, string>;
}

export function compare(pair: Pair, row: Row): { shell: Outcome; ts: Outcome } {
  if (row.prebuild === true) {
    for (const root of [pair.a, pair.b]) {
      const tmp = root === pair.a ? pair.tmpA : pair.tmpB;
      assert.equal(runTs(root, tmp, []).status, 0, "the base build");
      row.tamper?.(root);
    }
  }
  const args = [...row.args];
  const shell = normalise(
    runShell(pair.a, pair.tmpA, args, row.env?.(pair, "a")),
    [pair.a],
    [pair.tmpA],
  );
  const ts = normalise(runTs(pair.b, pair.tmpB, args, row.env?.(pair, "b")), [pair.b], [pair.tmpB]);
  expectSame(args.join(" "), shell, ts, row.deviation);
  return { shell, ts };
}
