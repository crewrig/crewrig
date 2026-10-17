// differential-shared.ts — shared-repository isolation for the wrapper mode of the differential.
// An unchanged Bash suite names local repositories (a bare remote, a work clone) in argv or in the
// environment; both legs would mutate the SAME ones, so the TS leg would see the shell leg's
// writes. For each such repository: snapshot before the shell leg, snapshot after it, restore the
// first before the TS leg, compare the refs both legs left behind, then restore the shell's state
// so the suite continues from it (spec 0262 req 21, 22).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { assertInside, assertRoot, isInside } from "./differential-guard.ts";
import { refsOf } from "./scratch-remote.ts";

export interface Shared {
  readonly root: string;
  readonly dir: string;
  pre?: string;
  post?: string;
}

const isRepo = (dir: string): boolean =>
  fs.existsSync(path.join(dir, ".git")) ||
  (fs.existsSync(path.join(dir, "HEAD")) && fs.existsSync(path.join(dir, "objects")));

/**
 * Existing local repositories named by `values` (argv, env, remote URLs) that resolve strictly
 * inside the differential `root` and outside every path in `excluded`. A value that names anything
 * else (HOMEBREW_PREFIX, HOME, GIT_DIR, the checkout...) is ignored and never touched.
 */
export function findShared(
  values: readonly string[],
  root: string,
  excluded: readonly string[],
): Shared[] {
  assertRoot(root);
  const found = new Map<string, Shared>();
  const queue = [...values];
  for (let v = queue.shift(); v !== undefined; v = queue.shift()) {
    if (v.startsWith("file://")) v = v.slice(7);
    if (!path.isAbsolute(v) || !isInside(root, v)) continue;
    let real: string;
    try {
      real = fs.realpathSync(v);
    } catch {
      continue;
    }
    // Re-checked on the realpath: a symlink inside the root must not lead out of it.
    if (!isInside(root, real) || excluded.some((e) => real === e || isInside(e, real))) continue;
    if (found.has(real) || !fs.statSync(real).isDirectory() || !isRepo(real)) continue;
    found.set(real, { root, dir: real });
    // A work clone's local remotes are shared state too.
    const urls = spawnSync("git", ["-C", real, "remote", "-v"], { encoding: "utf8" }).stdout ?? "";
    for (const line of urls.split("\n")) queue.push(line.split(/\s+/)[1] ?? "");
  }
  return [...found.values()];
}

function snapshot(s: Shared, into: string, tag: string): string {
  const dest = path.join(
    into,
    `${path.basename(s.dir)}.${tag}.${Math.random().toString(36).slice(2)}`,
  );
  assertInside(s.root, s.dir);
  assertInside(s.root, dest);
  fs.cpSync(s.dir, dest, { recursive: true, verbatimSymlinks: true });
  return dest;
}

function restore(s: Shared, from: string): void {
  assertInside(s.root, s.dir);
  assertInside(s.root, from);
  if (!isRepo(s.dir)) throw new Error(`refusing to restore over a non-repository: ${s.dir}`);
  // Copy first to a sibling inside the root; the old target goes away only once the copy worked.
  const rand = Math.random().toString(36).slice(2);
  const fresh = `${s.dir}.restore.${rand}`;
  const old = `${s.dir}.old.${rand}`;
  assertInside(s.root, fresh);
  assertInside(s.root, old);
  try {
    fs.cpSync(from, fresh, { recursive: true, verbatimSymlinks: true });
  } catch (err) {
    fs.rmSync(fresh, { recursive: true, force: true });
    throw err;
  }
  fs.renameSync(s.dir, old);
  try {
    fs.renameSync(fresh, s.dir);
  } catch (err) {
    fs.renameSync(old, s.dir);
    fs.rmSync(fresh, { recursive: true, force: true });
    throw err;
  }
  fs.rmSync(old, { recursive: true, force: true });
}

export const takePre = (all: Shared[], into: string): void =>
  all.forEach((s) => (s.pre = snapshot(s, into, "pre")));

/** After the shell leg: remember its state and rewind to `pre` for the TS leg. */
export function rewind(all: Shared[], into: string): string[] {
  return all.map((s) => {
    s.post = snapshot(s, into, "post");
    restore(s, s.pre ?? "");
    return refsOf(s.post);
  });
}

/** After the TS leg: diff the refs of each repository against the shell's, then re-adopt `post`. */
export function settle(all: Shared[], shellRefs: readonly string[]): string[] {
  const diffs: string[] = [];
  all.forEach((s, i) => {
    const ts = refsOf(s.dir);
    if (ts !== shellRefs[i])
      diffs.push(`shared repository refs differ (${s.dir}):\n shell=${shellRefs[i]}\n ts=${ts}`);
    restore(s, s.post ?? "");
  });
  return diffs;
}
