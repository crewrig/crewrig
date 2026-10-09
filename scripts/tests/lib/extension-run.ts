// extension-run.ts — run the extension builders, shell or TypeScript, in a fixture root and
// collect what they produced (spec 0254 R22, R23). Shared by the golden, differential and
// Windows proofs so each compares exactly the same set of outputs.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { createFixtureTree } from "./build-fixture-tree.ts";
import type { FixtureTree, RunResult } from "./build-fixture-tree.ts";
import { writeTree } from "./extension-trees.ts";
import type { FileMap } from "./extension-trees.ts";

export type { FixtureTree, RunResult };

/** A fixture root with `subjects` written under `extensions/core/<name>/`. */
export function extensionRoot(subjects: Readonly<Record<string, FileMap>>): FixtureTree {
  const tree = createFixtureTree();
  for (const [name, files] of Object.entries(subjects)) {
    writeTree(path.join(tree.root, "extensions", "core", name), files);
  }
  return tree;
}

/** The skeleton container the `--check` run scans (an empty directory is enough). */
export function withSkeleton(tree: FixtureTree): void {
  fs.mkdirSync(path.join(tree.root, "extension-skeleton"), { recursive: true });
}

/** `bash scripts/<script>.sh <args>` in the root (the shell oracle). Linux and macOS only. */
export function runShell(tree: FixtureTree, script: string, args: readonly string[]): RunResult {
  const res = spawnSync("bash", [path.join(tree.root, "scripts", `${script}.sh`), ...args], {
    cwd: tree.root,
    encoding: "utf8",
    // LC_ALL=C: the shell sorts file lists by locale, the twins by code unit (spec 0254 R28(g)).
    env: { ...process.env, REPO_DIR: undefined, LC_ALL: "C" } as NodeJS.ProcessEnv,
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** `node scripts/<script>.ts <args>` in the root (the TypeScript entry). */
export function runTs(tree: FixtureTree, script: string, args: readonly string[]): RunResult {
  return tree.run(args, { entry: `scripts/${script}.ts` });
}

/** Every regular file under `dir`, `/`-separated relative path to bytes; empty when absent. */
export function collectFiles(dir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (current: string, rel: string): void => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = rel === "" ? entry.name : `${rel}/${entry.name}`;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full, next);
      else if (entry.isFile()) out.set(next, fs.readFileSync(full));
    }
  };
  walk(dir, "");
  return out;
}

/**
 * The golden tree on disk: every file carries a `.golden` suffix, so no tracked file is a shell
 * script, a JavaScript file or a Markdown file for the ratchet and the linters (spec 0254 R22).
 * Returns the files under their real names.
 */
export function collectGolden(dir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (const [rel, bytes] of collectFiles(dir)) {
    const text = bytes.subarray(0, SHEBANG_GUARD.length).equals(SHEBANG_GUARD)
      ? bytes.subarray(SHEBANG_GUARD.length)
      : bytes;
    out.set(rel.replace(/\.golden$/, ""), Buffer.from(text));
  }
  return out;
}

/** What the ratchet sees as no shebang: a stored file that begins with `#!` is prefixed with this. */
export const SHEBANG_GUARD = Buffer.from("GOLDEN-STORED:");

/** The bytes to store for a golden file (see `SHEBANG_GUARD`). */
export function goldenBytes(bytes: Buffer): Buffer {
  return bytes.subarray(0, 2).toString("latin1") === "#!"
    ? Buffer.concat([SHEBANG_GUARD, bytes])
    : bytes;
}

/** The outputs of a full `--target all` build of `name`, by golden directory name. */
export function outputDirs(tree: FixtureTree, name: string): Readonly<Record<string, string>> {
  const r = tree.root;
  return {
    gemini: path.join(r, "build", "extensions", name),
    "claude-plugin": path.join(r, "extensions", "core", name, "dist-claude-plugin", name),
    "copilot-plugin": path.join(r, "dist-copilot-plugin", name),
    "antigravity-plugin": path.join(r, "dist-antigravity-plugin", name),
    gaps: path.join(r, "build", "gaps", name),
  };
}

/** Compare two file maps; returns the differences as readable lines (empty when equal). */
export function diffFiles(left: Map<string, Buffer>, right: Map<string, Buffer>): string[] {
  const out: string[] = [];
  for (const rel of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const a = left.get(rel);
    const b = right.get(rel);
    if (a === undefined) out.push(`only on the right: ${rel}`);
    else if (b === undefined) out.push(`only on the left: ${rel}`);
    else if (!a.equals(b)) out.push(`differs: ${rel}`);
  }
  return out;
}

/** Replace the root's physical and logical spellings with a fixed token in a message. */
export function normalise(text: string, tree: FixtureTree): string {
  const logical = tree.root.replace(/^\/private/, "");
  return text.split(tree.root).join("<ROOT>").split(logical).join("<ROOT>");
}
