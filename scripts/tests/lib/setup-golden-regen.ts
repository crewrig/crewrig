// setup-golden-regen.ts — storage and comparison of the setup golden fixtures (spec 0256
// requirement 7, plan v2 step A5). One directory per case, `fixtures/setup-golden/<cli>/<id>/`,
// holding `status.golden`, `stdout.golden`, `stderr.golden` and `tree.json.golden`; EVERY stored
// file ends in `.golden` (the ratchet counts tracked scripts). With `SETUP_GOLDEN_REGEN=1` the
// files are WRITTEN (to `SETUP_GOLDEN_OUT` when set, else the fixtures directory) instead of
// compared. Re-exports the capture API so a consumer needs one import.
// API: goldenDir, serialize, writeGolden, readGolden, checkGolden, unifiedDiff, isRegen.

import fs from "node:fs";
import path from "node:path";

import { REPO } from "./build-fixture-tree.ts";
import type { CaseResult } from "./setup-golden-run.ts";
import type { Cli, GoldenCase } from "./setup-golden-types.ts";

export { runCase } from "./setup-golden-run.ts";
export type { CaseResult } from "./setup-golden-run.ts";
export { normalize, treeOf } from "./setup-golden-tree.ts";

/** Where compare mode reads the fixtures: `SETUP_GOLDEN_DIR` when set, else the committed directory. */
export const FIXTURES_DIR =
  process.env["SETUP_GOLDEN_DIR"] ?? path.join(REPO, "scripts/tests/fixtures/setup-golden");

/** The four stored files of a case, by their name without the `.golden` suffix. */
export const GOLDEN_FILES = ["status", "stdout", "stderr", "tree.json"] as const;
export type GoldenName = (typeof GOLDEN_FILES)[number];
export type GoldenText = Readonly<Record<GoldenName, string>>;

export const isRegen = (): boolean => process.env["SETUP_GOLDEN_REGEN"] === "1";

/** `<base>/<cli>/<id>`; `base` defaults to the fixtures directory. */
export const goldenDir = (cli: Cli, id: string, base: string = FIXTURES_DIR): string =>
  path.join(base, cli, id);

/** The text of the four stored files; the tree is one entry per line so a diff reads line by line. */
export function serialize(result: CaseResult): GoldenText {
  const rows = (items: readonly unknown[]): string =>
    items.length === 0
      ? "[]"
      : `[\n${items.map((i) => `    ${JSON.stringify(i)}`).join(",\n")}\n  ]`;
  const tree = [
    "{",
    `  "tree": ${rows(result.tree)},`,
    `  "bakCount": ${JSON.stringify(result.bakCount)},`,
    `  "fzf": ${rows(result.fzfRecords)},`,
    `  "curl": ${rows(result.curlRecords)}`,
    "}",
    "",
  ].join("\n");
  return {
    status: `${result.status === null ? "null" : result.status}\n`,
    stdout: result.stdout,
    stderr: result.stderr,
    "tree.json": tree,
  };
}

/** Write the case's golden files under `base` (default: `SETUP_GOLDEN_OUT`, else the fixtures directory). */
export function writeGolden(
  cli: Cli,
  id: string,
  result: CaseResult,
  base: string = process.env["SETUP_GOLDEN_OUT"] ?? FIXTURES_DIR,
): string {
  const dir = goldenDir(cli, id, base);
  fs.mkdirSync(dir, { recursive: true });
  const text = serialize(result);
  for (const name of GOLDEN_FILES) fs.writeFileSync(path.join(dir, `${name}.golden`), text[name]);
  return dir;
}

/** The committed golden files of a case; throws naming the missing file and the regen command. */
export function readGolden(cli: Cli, id: string, base: string = FIXTURES_DIR): GoldenText {
  const dir = goldenDir(cli, id, base);
  const read = (name: GoldenName): string => {
    const file = path.join(dir, `${name}.golden`);
    if (!fs.existsSync(file)) {
      throw new Error(`golden file missing: ${file} (generate it with SETUP_GOLDEN_REGEN=1)`);
    }
    return fs.readFileSync(file, "utf8");
  };
  return {
    status: read("status"),
    stdout: read("stdout"),
    stderr: read("stderr"),
    "tree.json": read("tree.json"),
  };
}

/** Line diff in unified style (no hunk headers): `-` expected, `+` actual, at most `max` lines. */
export function unifiedDiff(expected: string, actual: string, max = 60): string {
  const a = expected.split("\n");
  const b = actual.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a.at(-1 - tail) === b.at(-1 - tail)) {
    tail++;
  }
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  const out: string[] = [`@@ line ${head + 1} @@`];
  if (x.length * y.length > 4_000_000) {
    out.push(...x.map((l) => `-${l}`), ...y.map((l) => `+${l}`));
  } else {
    const lcs: number[][] = Array.from({ length: x.length + 1 }, () =>
      new Array<number>(y.length + 1).fill(0),
    );
    const at = (i: number, j: number): number => lcs[i]?.[j] ?? 0;
    for (let i = x.length - 1; i >= 0; i--) {
      for (let j = y.length - 1; j >= 0; j--) {
        const row = lcs[i];
        if (row !== undefined)
          row[j] = x[i] === y[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
      }
    }
    let i = 0;
    let j = 0;
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) {
        i++;
        j++;
      } else if (j >= y.length || (i < x.length && at(i + 1, j) >= at(i, j + 1))) {
        out.push(`-${x[i++]}`);
      } else {
        out.push(`+${y[j++]}`);
      }
    }
  }
  return out.length > max
    ? [...out.slice(0, max), `... ${out.length - max} more lines`].join("\n")
    : out.join("\n");
}

/**
 * Regen mode: write the case's files (under `base`, default as `writeGolden`) and return. Compare mode: throw an Error naming the case,
 * the leg and a readable diff per differing file.
 */
export function checkGolden(c: GoldenCase, result: CaseResult, leg: string, base?: string): void {
  if (isRegen()) {
    writeGolden(c.cli, c.id, result, base);
    return;
  }
  const expected = readGolden(c.cli, c.id, base);
  const actual = serialize(result);
  const failures = GOLDEN_FILES.filter((name) => expected[name] !== actual[name]).map(
    (name) =>
      `--- ${c.cli}/${c.id}/${name}.golden (expected)\n+++ ${leg} leg (actual)\n${unifiedDiff(expected[name], actual[name])}`,
  );
  if (failures.length > 0) {
    throw new Error(
      `golden mismatch for ${c.cli}/${c.id} [${leg}]: ${c.note}\n${failures.join("\n")}`,
    );
  }
}
