// setup-golden-readers.ts — readers of the golden cells and of the declaration goldens (not a test
// file itself): the stored observable behaviour of the shell setups.

import fs from "node:fs";
import path from "node:path";

import type { Cli } from "../lib/setup/context.ts";

const FIXTURES = path.join(import.meta.dirname, "fixtures");
const CELLS = path.join(FIXTURES, "setup-golden");

export interface Declaration {
  readonly steps: readonly string[];
  readonly facts: ReadonlyMap<string, string>;
}

/** The `step N: id` and `key=value` lines of the declaration golden of one CLI. */
export function declOf(cli: Cli): Declaration {
  const text = fs.readFileSync(
    path.join(FIXTURES, "setup-declarations", `${cli}.txt.golden`),
    "utf8",
  );
  const steps: string[] = [];
  const facts = new Map<string, string>();
  for (const line of text.split("\n").filter((l) => l !== "")) {
    const step = /^step (\d+): (\S+)$/.exec(line);
    if (step !== null) steps.push(step[2] as string);
    else facts.set(line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1));
  }
  return { steps, facts };
}

const cellDirs = (cli: Cli): string[] =>
  fs.readdirSync(path.join(CELLS, cli)).map((c) => path.join(CELLS, cli, c));

/** The printed lines of one cell (standard output then standard error). */
export function printed(cli: Cli, cell: string): string {
  const dir = path.join(CELLS, cli, cell);
  return ["stdout.golden", "stderr.golden"]
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
    .join("");
}

/** Every line any cell of the CLI printed. */
export function printedEverywhere(cli: Cli): string {
  return cellDirs(cli)
    .map((d) => printed(cli, path.basename(d)))
    .join("\n");
}

/** The files of a cell: path (with `<HOME>`) to the `repo:<source>` or digest of its content. */
export function treeOf(cli: Cli, cell: string): ReadonlyMap<string, string> {
  const file = path.join(CELLS, cli, cell, "tree.json.golden");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
    tree: { path: string; kind: string; sha256?: string }[];
  };
  return new Map(parsed.tree.map((e) => [e.path, e.sha256 ?? e.kind]));
}

/** Every path any cell of the CLI left behind. */
export function treeEverywhere(cli: Cli): ReadonlySet<string> {
  const all = new Set<string>();
  for (const d of cellDirs(cli)) for (const p of treeOf(cli, path.basename(d)).keys()) all.add(p);
  return all;
}
