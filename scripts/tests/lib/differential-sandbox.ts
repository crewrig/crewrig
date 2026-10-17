// differential-sandbox.ts — isolated sandboxes for the shell-versus-TypeScript differential
// (spec 0262 req 21): a copy of only what git tracks, a clone of `.git` with no remote, the root
// package.json and REAL copies of node_modules/js-yaml and node_modules/argparse; plus the cleaned
// child environment, the root normaliser and the state digests.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertInside, assertRoot, createRoot } from "./differential-guard.ts";
import { git } from "./scratch-remote.ts";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const RECORD_DIR = ".differential";

export type Side = "shell" | "ts";

let template: string | undefined;

/** One per-process snapshot of the tracked files (never untracked node_modules or dist). */
function snapshot(): string {
  if (template !== undefined) return template;
  // The template lives in its own marked root (createRoot); the tracked copy sits below it.
  const tplRoot = createRoot("differential-tpl-");
  const dir = path.join(tplRoot, "tree");
  fs.mkdirSync(dir);
  process.on("exit", () => {
    assertRoot(tplRoot);
    assertInside(tplRoot, dir);
    fs.rmSync(tplRoot, { recursive: true, force: true });
  });
  for (const rel of git(REPO, ["ls-files", "-z"]).split("\0").filter(Boolean)) {
    const src = path.join(REPO, rel);
    const dest = path.join(dir, rel);
    const st = fs.lstatSync(src, { throwIfNoEntry: false });
    if (st === undefined || st.isDirectory()) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (st.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(src), dest);
    else fs.copyFileSync(src, dest);
    if (!st.isSymbolicLink()) fs.chmodSync(dest, st.mode & 0o777);
  }
  for (const mod of ["js-yaml", "argparse"]) {
    const from = path.join(REPO, "node_modules", mod);
    if (fs.existsSync(from))
      fs.cpSync(from, path.join(dir, "node_modules", mod), { recursive: true, dereference: true });
  }
  template = dir;
  return dir;
}

/** Copy a tree with copy-on-write where the platform has it (macOS `cp -c`, Linux reflink). */
function copyTree(root: string, from: string, to: string): void {
  assertInside(root, to);
  const flags = process.platform === "darwin" ? ["-cR"] : ["-R", "--reflink=auto"];
  const res = spawnSync("cp", [...flags, from, to], { stdio: "ignore" });
  if (res.status !== 0) {
    fs.rmSync(to, { recursive: true, force: true });
    fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
  }
}

// Per-sandbox (size, mtime) of every file as copied: unchanged files are not re-hashed.
const baselines = new Map<string, Map<string, string>>();

function stamps(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full);
      } else {
        const st = fs.lstatSync(full);
        out.set(path.relative(root, full).split(path.sep).join("/"), `${st.size}:${st.mtimeMs}`);
      }
    }
  };
  walk(root);
  return out;
}

/** Build one sandbox at `dest`: tracked copy, `.git` clone with its remotes removed. */
export function makeSandbox(root: string, dest: string): string {
  assertInside(root, dest);
  copyTree(root, snapshot(), dest);
  baselines.set(dest, stamps(dest));
  const clone = `${dest}.clone`;
  assertInside(root, clone);
  git(root, ["clone", "--quiet", "--no-checkout", "--local", REPO, clone]);
  fs.renameSync(path.join(clone, ".git"), path.join(dest, ".git"));
  fs.rmSync(clone, { recursive: true, force: true });
  git(dest, ["remote", "remove", "origin"]);
  git(dest, ["reset", "--quiet"]);
  return dest;
}

/** Child environment: no CI / NODE_TEST_CONTEXT, C locale, no system git config, scratch HOME. */
export function cleanEnv(home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ["CI", "NODE_TEST_CONTEXT", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"])
    delete env[key];
  env.LC_ALL = "C";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = path.join(home, ".gitconfig");
  env.HOME = home;
  return { ...env, ...extra };
}

/** Every spelling of `p` (as given and real) mapped to `token`, longest first. */
export function normaliser(pairs: Array<[string, string]>): (text: string) => string {
  const rules: Array<[string, string]> = [];
  for (const [p, token] of pairs) {
    rules.push([p, token]);
    if (fs.existsSync(p)) rules.push([fs.realpathSync(p), token]);
  }
  rules.sort((x, y) => y[0].length - x[0].length);
  return (text) => rules.reduce((acc, [from, to]) => acc.split(from).join(to), text);
}

const SKIP_DIRS = new Set([".git", "node_modules", RECORD_DIR]);

/** name -> "mode:sha" for every file below `root` except `exclude` (root-relative). */
export function treeMap(
  root: string,
  norm: (s: string) => string,
  exclude: readonly string[],
): Map<string, string> {
  const out = new Map<string, string>();
  const base = baselines.get(root);
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(full);
      } else if (!exclude.includes(rel)) {
        const st = base ? fs.lstatSync(full) : undefined;
        if (st && base?.get(rel) === `${st.size}:${st.mtimeMs}`) {
          out.set(rel, "base");
          continue;
        }
        const content = e.isSymbolicLink()
          ? Buffer.from(`link ${norm(fs.readlinkSync(full))}`, "latin1")
          : Buffer.from(norm(fs.readFileSync(full).toString("latin1")), "latin1");
        const mode = e.isSymbolicLink() ? "l" : fs.statSync(full).mode & 0o111 ? "x" : "-";
        out.set(rel, `${mode}:${createHash("sha256").update(content).digest("hex")}`);
      }
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}

/** Human-readable difference between two tree maps (empty when equal). */
export function diffMaps(a: Map<string, string>, b: Map<string, string>): string {
  const lines: string[] = [];
  for (const k of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    if (a.get(k) !== b.get(k))
      lines.push(`${k}: shell=${a.get(k) ?? "absent"} ts=${b.get(k) ?? "absent"}`);
  }
  return lines.join("\n");
}

/** Make `b` mirror `a` (excluding `exclude`), so harness-made fixtures exist on both sides. */
export function mirror(a: string, b: string, exclude: readonly string[]): void {
  const id = (s: string): string => s;
  const from = treeMap(a, id, exclude);
  const to = treeMap(b, id, exclude);
  for (const [rel, sig] of from) {
    if (to.get(rel) === sig) continue;
    const dest = path.join(b, rel);
    assertInside(b, dest);
    assertInside(a, path.join(a, rel));
    fs.rmSync(dest, { force: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(path.join(a, rel), dest, { verbatimSymlinks: true });
  }
  for (const rel of to.keys()) {
    if (from.has(rel)) continue;
    assertInside(b, path.join(b, rel));
    fs.rmSync(path.join(b, rel), { force: true });
  }
}
