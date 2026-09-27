// ts-scope.ts — shared file-scope helpers for the spec 0238 checks
// (scripts/check-ratchet.ts, scripts/check-typescript.ts).
//
// Standard library only: the ratchet runs before `npm ci`, so nothing here
// may import a third-party package. It is the single source of truth for
// "which tracked files a check looks at", so every check excludes the same
// four built-copy trees (spec 0238 R2, R12).

import { spawnSync } from "node:child_process";
import { closeSync, lstatSync, openSync, readSync } from "node:fs";
import path from "node:path";

/** Generated built-copy trees, excluded from every check (spec 0238 R2, R12). */
export const BUILT_TREES: readonly string[] = [".claude/", ".gemini/", ".github/", ".agents/"];

/** Thrown for a wiring fault: the caller maps it to exit code 2. */
export class WiringError extends Error {}

export interface GitResult {
  status: number;
  stdout: string;
  stderr: string;
}

let cachedRoot: string | undefined;

/** Repository root: `CREWRIG_REPO_DIR` when set (as the sibling check-*.sh guards do), else the git top level. */
export function repoRoot(): string {
  if (cachedRoot !== undefined) return cachedRoot;
  const override = process.env.CREWRIG_REPO_DIR;
  if (override) {
    cachedRoot = path.resolve(override);
    return cachedRoot;
  }
  const res = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (res.status !== 0) throw new WiringError("not inside a git work tree");
  cachedRoot = res.stdout.trim();
  return cachedRoot;
}

/** Run git in the repository root, capturing its output. */
export function git(args: readonly string[]): GitResult {
  const res = spawnSync("git", ["-C", repoRoot(), ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/** True when a repository-relative path sits under one of the built-copy trees. */
export function inBuiltTree(rel: string): boolean {
  return BUILT_TREES.some((tree) => rel.startsWith(tree));
}

/** Every tracked path, repository-relative, as `git ls-files -z` reports it. */
export function trackedFiles(): string[] {
  const res = git(["ls-files", "-z"]);
  if (res.status !== 0) throw new WiringError(`git ls-files failed: ${res.stderr.trim()}`);
  return res.stdout.split("\0").filter((p) => p !== "");
}

const SHELL_SHEBANG = /^#!\s*(\S*\/)?(env\s+(-\S+\s+)*)?(bash|sh)(\s|$)/;

/** First line of a file, reading at most 256 bytes; empty when unreadable. */
function firstLine(abs: string): string {
  let fd: number | undefined;
  try {
    fd = openSync(abs, "r");
    const buf = Buffer.alloc(256);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).toString("utf8").split("\n")[0] ?? "";
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * A shell file per spec 0238 R1: a `*.sh` path, or a file whose shebang names
 * `bash` or `sh`. A symlink is judged by its name only, never followed.
 */
export function isShellFile(rel: string): boolean {
  if (rel.endsWith(".sh")) return true;
  const abs = path.join(repoRoot(), rel);
  try {
    if (!lstatSync(abs).isFile()) return false;
  } catch {
    return false;
  }
  return SHELL_SHEBANG.test(firstLine(abs));
}

/** True for a JavaScript path covered by the spec 0238 R3 ratchet. */
export function isJsFile(rel: string): boolean {
  return /\.(js|mjs|cjs)$/.test(rel);
}

/** Tracked `*.ts` sources outside the built-copy trees, sorted. */
export function trackedTsFiles(): string[] {
  return trackedFiles()
    .filter((p) => p.endsWith(".ts") && !inBuiltTree(p))
    .sort();
}

function verifies(ref: string): boolean {
  return git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).status === 0;
}

/** First remote matching `crewrig|origin`, else the first remote at all. */
function preferredRemote(): string | undefined {
  const remotes = git(["remote"])
    .stdout.split("\n")
    .map((r) => r.trim())
    .filter((r) => r !== "");
  return remotes.find((r) => /crewrig|origin/.test(r)) ?? remotes[0];
}

/** Candidate refs for an explicit BASE_REF: `origin/<x>` first, then `<x>` as given. */
function candidates(ref: string): string[] {
  return ref.startsWith("origin/") ? [ref] : [`origin/${ref}`, ref];
}

/** A resolved base: the ref it came from and its merge-base with HEAD. */
export interface BaseRef {
  ref: string;
  mergeBase: string;
}

function mergeBaseOf(ref: string): BaseRef {
  const res = git(["merge-base", ref, "HEAD"]);
  if (res.status !== 0) throw new WiringError(`no merge-base between '${ref}' and HEAD`);
  return { ref, mergeBase: res.stdout.trim() };
}

/**
 * The base the diff arms compare against, normalized as
 * scripts/lib/base-ref-resolve.sh does. An explicit `BASE_REF` that resolves
 * nowhere, even after one `git fetch origin <x>`, is a wiring fault. With no
 * `BASE_REF`, the default `<remote>/main` (then `/develop`) is used when it
 * verifies; otherwise `null` — the diff arms are skipped, not failed.
 */
export function resolveBase(): BaseRef | null {
  let explicit = process.env.BASE_REF ?? "";
  if (explicit.endsWith("/")) explicit = "";
  if (explicit !== "") {
    for (const ref of candidates(explicit)) if (verifies(ref)) return mergeBaseOf(ref);
    const branch = explicit.replace(/^origin\//, "");
    git(["fetch", "--quiet", "origin", `${branch}:refs/remotes/origin/${branch}`]);
    for (const ref of candidates(explicit)) if (verifies(ref)) return mergeBaseOf(ref);
    throw new WiringError(
      `BASE_REF '${explicit}' does not resolve and git fetch did not recover it`,
    );
  }
  const remote = preferredRemote();
  if (remote === undefined) return null;
  for (const ref of [`${remote}/main`, `${remote}/develop`])
    if (verifies(ref)) return mergeBaseOf(ref);
  return null;
}

/** Content of a repository-relative path at a commit, or `null` when absent there. */
export function showAt(commit: string, rel: string): string | null {
  const res = git(["show", `${commit}:${rel}`]);
  return res.status === 0 ? res.stdout : null;
}
