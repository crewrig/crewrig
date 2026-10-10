// setup-steps-agy-fixtures.ts — shared helpers of the Antigravity/tier step tests (not a test
// file): the golden reader, a fake spawner and the real-repository files a deployment needs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Spawner } from "../lib/setup/context.ts";
import { sandbox } from "./setup-flow-fixtures.ts";

const REAL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GOLDEN = path.join(REAL, "scripts", "tests", "fixtures", "setup-golden");

/** A golden file of one cell with its placeholders replaced by the sandbox (home == repo here). */
export function golden(cli: string, cell: string, file: string): string {
  const text = fs.readFileSync(path.join(GOLDEN, cli, cell, file), "utf8");
  return text.replaceAll("<HOME>", sandbox.tmp).replaceAll("<REPO>", sandbox.tmp);
}

/** The lines of `text` from the line that starts with `from` (plus `offset`) up to `to` (excluded). */
export function slice(text: string, from: string, to: string | undefined, offset = 0): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith(from)) + offset;
  const end = to === undefined ? lines.length : lines.findIndex((l) => l.startsWith(to));
  if (start - offset < 0 || end < 0) throw new Error(`marker not found: ${from} / ${to}`);
  return `${lines.slice(start, end).join("\n")}\n`;
}

/** The printed output without the pre-answer echoes, with the backup stamp neutralised. */
export function printed(out: string): string {
  return out
    .split("\n")
    .filter((l) => !l.startsWith("[answer] "))
    .join("\n")
    .replaceAll(fs.realpathSync(sandbox.tmp), sandbox.tmp)
    .replace(/\.bak\.[\d-]+/g, ".bak.<STAMP>");
}

/** A spawner for which every child succeeds and `git rev-parse` names a plain checkout. */
export const okSpawn: Spawner = (argv) =>
  argv[0] === "git"
    ? { status: 0, stdout: ".git\n", stderr: "" }
    : { status: 0, stdout: "", stderr: "" };

/** `hooks/` and the floor guard of the real checkout, copied into the sandbox repository. */
export function copyRepoHooks(): void {
  fs.cpSync(path.join(REAL, "hooks"), path.join(sandbox.tmp, "hooks"), { recursive: true });
  const guard = path.join(sandbox.tmp, "scripts", "lib", "node-floor-guard.js");
  fs.mkdirSync(path.dirname(guard), { recursive: true });
  fs.copyFileSync(path.join(REAL, "scripts", "lib", "node-floor-guard.js"), guard);
}

export function put(rel: string, text: string): void {
  const file = path.join(sandbox.tmp, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

export const exists = (rel: string): boolean => fs.existsSync(path.join(sandbox.tmp, rel));
export const read = (rel: string): string => fs.readFileSync(path.join(sandbox.tmp, rel), "utf8");
