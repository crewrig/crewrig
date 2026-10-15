// create-extension-sandbox.ts — a throwaway repository root the scaffolder can run in (spec 0258
// R29). Built once per test file from what git tracks (`git ls-files -z`, never a directory copy,
// so a host `node_modules` or `dist` cannot leak in), with a real `git init`, the root
// `package.json` and REAL copies of `js-yaml` and `argparse` (the dependency loader refuses a
// symbolic link). `scripts/tests/`, `docs/` and `specs/` are left out: nothing the scaffolder or
// the build reads lives there, and they are the bulk of the tree. Each case then runs in a
// private copy of that template, so no case sees another's files.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";

export const REPO = path.resolve(import.meta.dirname, "..", "..", "..");

/** Packages the build loads from the root's own `node_modules` (production closure of `js-yaml`). */
export const STAGED_PACKAGES: readonly string[] = ["js-yaml", "argparse"];

const SKIPPED_PREFIXES: readonly string[] = ["scripts/tests/", "docs/", "specs/", ".github/"];

/** The six offered components, in the order the scaffolder prints them: bit 0 is the first. */
export const COMPONENT_BITS: readonly string[] = [
  "mcp-server",
  "command",
  "skill",
  "agent",
  "hook",
  "theme",
];

/** The newline-separated selection of a bitmask (0-63), as `CREWRIG_TEST_FZF_SELECTION` holds it. */
export function selectionOf(mask: number): string {
  return COMPONENT_BITS.filter((_, bit) => Math.floor(mask / 2 ** bit) % 2 === 1).join("\n");
}

const live = new Set<string>();
after(() => {
  for (const dir of live) fs.rmSync(dir, { recursive: true, force: true });
  live.clear();
});

function tempDir(label: string): string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`)));
  live.add(dir);
  return dir;
}

function trackedFiles(): string[] {
  const res = spawnSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "buffer" });
  if (res.status !== 0) throw new Error("git ls-files failed in the repository");
  return res.stdout
    .toString("utf8")
    .split("\0")
    .filter((file) => file !== "" && !SKIPPED_PREFIXES.some((prefix) => file.startsWith(prefix)));
}

function copyTracked(root: string): void {
  for (const rel of trackedFiles()) {
    const from = path.join(REPO, rel);
    const to = path.join(root, rel);
    const stat = fs.lstatSync(from, { throwIfNoEntry: false });
    if (stat === undefined) continue; // tracked but deleted in the working tree
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (stat.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to);
    else fs.copyFileSync(from, to);
  }
}

/** A repository root holding the tracked files, `.git`, `package.json` and the staged packages. */
export function createTemplate(): string {
  const root = tempDir("create-extension-template");
  copyTracked(root);
  const init = spawnSync("git", ["init", "--quiet", root], { encoding: "utf8" });
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
  fs.copyFileSync(path.join(REPO, "package.json"), path.join(root, "package.json"));
  for (const name of STAGED_PACKAGES) {
    const from = path.join(REPO, "node_modules", name);
    if (!fs.existsSync(from)) throw new Error(`${from} is missing: run the setup dependency step`);
    fs.cpSync(from, path.join(root, "node_modules", name), { recursive: true, dereference: true });
  }
  for (const tier of ["core", "library", "org"])
    fs.mkdirSync(path.join(root, "extensions", tier), { recursive: true });
  return root;
}

/** A private copy of the template for one case. */
export function cloneTemplate(template: string): string {
  const root = tempDir("create-extension-case");
  fs.cpSync(template, root, { recursive: true, verbatimSymlinks: true });
  return root;
}

/** Write a file under a sandbox root (parents created). */
export function writeFile(root: string, rel: string, content: string): void {
  const file = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
