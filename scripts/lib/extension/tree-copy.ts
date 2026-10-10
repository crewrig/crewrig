// tree-copy.ts — tree copy, emptying and generated-output removal (spec 0254 R6, R14).
// Twin of `cp -a "$src"/. "$dst"/` (dotfiles included; links reproduced, not followed; modes
// kept) and of the `ext_class_scan` predicate (scripts/build-extension.sh:140-165) used as a
// remover. Emptying is guarded: a wrong root is data loss, so the filesystem root, the user's
// home and the repository (or any ancestor of it) are refused.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { GeneratedClass } from "./descriptors.ts";
import { ExtError } from "./types.ts";

const LINK_REFUSALS = new Set(["EPERM", "EACCES", "ENOTSUP", "EOPNOTSUPP", "UNKNOWN"]);

function lstatOrNull(p: string): fs.Stats | null {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

function errCode(error: unknown): string {
  return error instanceof Error && "code" in error ? String(error.code) : "";
}

function real(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function isSameOrWithin(inner: string, outer: string): boolean {
  const rel = path.relative(outer, inner);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** Throw `ExtError` when `dir` is the filesystem root, the home directory, or the repository or an ancestor of it. */
export function assertSafeToRemove(dir: string, repoDir: string): void {
  const candidates = new Set([path.resolve(dir), real(dir)]);
  const repos = [path.resolve(repoDir), real(repoDir)];
  for (const target of candidates) {
    const why =
      path.parse(target).root === target
        ? "it is the filesystem root"
        : target === path.resolve(os.homedir()) || target === real(os.homedir())
          ? "it is the home directory"
          : repos.some((repo) => isSameOrWithin(repo, target))
            ? "it is the repository or an ancestor of it"
            : "";
    if (why !== "") throw new ExtError(`refusing to remove or empty '${dir}': ${why}`);
  }
}

function copyInto(src: string, dst: string, notices: string[]): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = `${src}/${entry.name}`;
    const to = `${dst}/${entry.name}`;
    const existing = lstatOrNull(to);
    if (entry.isSymbolicLink()) {
      if (existing !== null) fs.rmSync(to, { recursive: true, force: true });
      copyLink(from, to, notices);
    } else if (entry.isDirectory()) {
      if (existing !== null && !existing.isDirectory()) fs.rmSync(to, { force: true });
      copyInto(from, to, notices);
      fs.chmodSync(to, fs.statSync(from).mode & 0o7777);
    } else if (entry.isFile()) {
      if (existing !== null && !existing.isFile()) fs.rmSync(to, { recursive: true, force: true });
      fs.copyFileSync(from, to);
      fs.chmodSync(to, fs.statSync(from).mode & 0o7777);
    } else {
      notices.push(`skipped ${from}: not a regular file, directory or link`);
    }
  }
}

function copyLink(from: string, to: string, notices: string[]): void {
  const target = fs.readlinkSync(from);
  try {
    fs.symlinkSync(target, to);
    return;
  } catch (error) {
    if (!LINK_REFUSALS.has(errCode(error))) throw error;
  }
  // The system refused to create a link: copy what the link points to, and say so.
  let kind: fs.Stats;
  try {
    kind = fs.statSync(from);
  } catch {
    notices.push(`skipped ${from}: link creation refused and its target does not exist`);
    return;
  }
  if (kind.isDirectory()) copyInto(from, to, notices);
  else fs.copyFileSync(from, to);
  notices.push(`copied the target of ${from} instead of a link: link creation refused`);
}

/**
 * `cp -a "$src"/. "$dst"/`: merge the contents of `src` into `dst` (created if absent).
 * Returns the notices (links that had to be copied as files; special files skipped).
 */
export function copyTree(src: string, dst: string): string[] {
  if (isSameOrWithin(real(dst), real(src)))
    throw new ExtError(`cannot copy '${src}' into itself ('${dst}')`);
  const notices: string[] = [];
  copyInto(src, dst, notices);
  return notices;
}

/** Remove every entry of `dir` and keep `dir` (created when absent); refused on a guarded path. */
export function emptyDir(dir: string, repoDir: string): void {
  assertSafeToRemove(dir, repoDir);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(dir))
    fs.rmSync(`${dir}/${name}`, { recursive: true, force: true });
}

function walkFiles(root: string, rel: string, out: string[]): void {
  for (const entry of fs.readdirSync(rel === "" ? root : `${root}/${rel}`, {
    withFileTypes: true,
  })) {
    const next = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) walkFiles(root, next, out);
    else if (entry.isFile()) out.push(next);
  }
}

/**
 * A shell `case` pattern as a regular expression: `*` matches any run of characters,
 * `/` included, and `?` any one character (`ext_class_scan`, scripts/build-extension.sh:155).
 * This is not the pathname expansion of a `for` loop, where `*` stops at `/`.
 */
export function caseGlobRegExp(glob: string): RegExp {
  let source = "";
  for (const ch of glob) {
    if (ch === "*") source += "[^]*";
    else if (ch === "?") source += "[^]";
    else source += ch.replace(/[\\^$.|+(){}[\]]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

/** The regular files under `dir` (relative, `/`-separated, code-unit order) in the generated-output class. */
export function scanGenerated(dir: string, generatedClass: GeneratedClass): string[] {
  if (!fs.existsSync(dir)) return [];
  const literals = new Set(generatedClass.manifestClass);
  const globs = generatedClass.generatedGlobs.map((glob) => caseGlobRegExp(glob));
  const files: string[] = [];
  walkFiles(dir, "", files);
  return files.sort().filter((rel) => literals.has(rel) || globs.some((re) => re.test(rel)));
}

/** Remove every file of the generated-output class under `dir`; returns the removed relative paths. */
export function removeGenerated(dir: string, generatedClass: GeneratedClass): string[] {
  const removed = scanGenerated(dir, generatedClass);
  for (const rel of removed) fs.rmSync(`${dir}/${rel}`, { force: true });
  return removed;
}

function copyDereferenced(src: string, dst: string, trail: string[], notices: string[]): void {
  let kind: fs.Stats;
  try {
    kind = fs.statSync(src);
  } catch {
    notices.push(`skipped ${src}: link target does not exist`);
    return;
  }
  if (kind.isFile()) {
    fs.copyFileSync(src, dst);
    fs.chmodSync(dst, kind.mode & 0o7777);
    return;
  }
  if (!kind.isDirectory()) {
    notices.push(`skipped ${src}: not a regular file, directory or link`);
    return;
  }
  const here = real(src);
  if (trail.includes(here)) {
    notices.push(`skipped ${src}: link cycle`);
    return;
  }
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src))
    copyDereferenced(`${src}/${name}`, `${dst}/${name}`, [...trail, here], notices);
  fs.chmodSync(dst, kind.mode & 0o7777);
}

/**
 * Copy `src` (a file or a directory) to the not-yet-existing `dst`: byte for byte, mode bits kept,
 * mtimes not preserved, every link inside the source dereferenced. A dangling link, a link cycle
 * or a special file is skipped and reported in the returned notices.
 */
export function copyTreeDereferenced(src: string, dst: string): string[] {
  if (isSameOrWithin(real(dst), real(src)))
    throw new ExtError(`cannot copy '${src}' into itself ('${dst}')`);
  const notices: string[] = [];
  copyDereferenced(src, dst, [], notices);
  return notices;
}
