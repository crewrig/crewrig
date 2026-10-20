// run.ts — entry logic of scripts/build-cli-matrix.ts (spec 0272 R6, R8).
//
// Usage: runMain(argv) with argv = [] (write) | ["--check"] | ["row", "<id>"]
// Exit codes: 0 ok; 1 stale (--check), unknown row id, or invalid sources; 2 bad usage.
// Finding-line format: --check prints "first difference at line <N>" then the fix command.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assemble } from "./assemble.ts";
import { readManifest, rowHeadingId } from "./manifest.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SOURCE_DIR = join(ROOT, "docs", "cli-matrix");
const TARGET = join(ROOT, "docs", "cli-matrix.md");
const FIX = "task cli-matrix:build";

function firstDifference(a: string, b: string): number {
  const x = a.split("\n");
  const y = b.split("\n");
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return i + 1;
  return 0;
}

function printRow(id: string): number {
  const rows = readManifest(SOURCE_DIR).filter((p) => p.isRow);
  const byBase = rows.find((p) => p.name === `${id}.md`);
  const hit = byBase ?? rows.find((p) => rowHeadingId(readFileSync(p.path, "utf8"), p.name) === id);
  if (!hit) {
    process.stderr.write(
      `Unknown row id "${id}". Valid ids: ${rows.map((p) => p.name.replace(/\.md$/, "")).join(" ")}\n`,
    );
    return 1;
  }
  process.stdout.write(readFileSync(hit.path, "utf8"));
  return 0;
}

export function runMain(argv: string[]): number {
  try {
    if (argv[0] === "row") {
      if (argv.length !== 2) {
        process.stderr.write("Usage: build-cli-matrix.ts row <id>\n");
        return 2;
      }
      return printRow(argv[1]!);
    }
    if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--check")) {
      process.stderr.write("Usage: build-cli-matrix.ts [--check | row <id>]\n");
      return 2;
    }
    const generated = assemble(SOURCE_DIR);
    if (argv[0] === "--check") {
      let current = "";
      try {
        current = readFileSync(TARGET, "utf8");
      } catch {
        // a missing published file is stale by definition
      }
      if (current === generated) return 0;
      process.stderr.write(
        `docs/cli-matrix.md is stale: first difference at line ${firstDifference(current, generated)}.\nRegenerate with: ${FIX}\n`,
      );
      return 1;
    }
    writeFileSync(TARGET, generated);
    return 0;
  } catch (error) {
    process.stderr.write(`Error: ${(error as Error).message}\n`);
    return 1;
  }
}
