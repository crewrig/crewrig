// differential-guard.ts — the structural safety guard of the differential helpers (issue #1673).
// A harness never deletes, restores, moves or rewrites a path it did not create itself. Every
// destructive call in the differential libs goes through `assertInside(root, p)` first, where
// `root` is a directory the harness made with `fs.mkdtempSync` (see `createRoot`). Nothing taken
// from process.env, argv, HOME, PATH entries or a git remote URL is ever trusted by itself.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const MARKER = ".differential-root";
const MKTEMP_SHIM = `#!/bin/sh
real=/usr/bin/mktemp; [ -x "$real" ] || real=/bin/mktemp
if [ $# -eq 0 ]; then exec "$real" "\${TMPDIR:-/tmp}/tmp.XXXXXXXXXX"; fi
if [ $# -eq 1 ] && [ "$1" = "-d" ]; then exec "$real" -d "\${TMPDIR:-/tmp}/tmp.XXXXXXXXXX"; fi
exec "$real" "$@"
`;

/** Realpath of `p`, or of its nearest existing ancestor plus the missing tail (symlink-safe). */
function realish(p: string): string {
  const abs = path.resolve(p);
  const tail: string[] = [];
  for (let cur = abs; ; cur = path.dirname(cur)) {
    try {
      return path.join(fs.realpathSync(cur), ...tail.reverse());
    } catch {
      if (path.dirname(cur) === cur) return abs;
      tail.push(path.basename(cur));
    }
  }
}

/** True when `p` resolves strictly inside `root` (never equal to it, `..` and symlinks followed). */
export function isInside(root: string, p: string): boolean {
  const r = realish(root);
  const q = realish(p);
  return q.startsWith(r.endsWith(path.sep) ? r : r + path.sep) && q !== r;
}

/** Throw unless `p` resolves strictly inside `root`; call it before ANY rm/cp/rename. */
export function assertInside(root: string, p: string): void {
  if (!isInside(root, p)) throw new Error(`refusing to touch ${p}: outside ${root}`);
}

/** One per-run root made with mkdtemp, plus the `tmp` directory the legs get as TMPDIR. */
export function createRoot(prefix = "differential-"): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  fs.writeFileSync(path.join(root, MARKER), "");
  fs.mkdirSync(path.join(root, "tmp"));
  // BSD/macOS `mktemp -d` ignores TMPDIR; this shim (first on the legs' PATH) makes it honour it.
  fs.mkdirSync(path.join(root, "bin"));
  fs.writeFileSync(path.join(root, "bin", "mktemp"), MKTEMP_SHIM, { mode: 0o755 });
  return root;
}

/** Throw unless `root` is a root made by `createRoot`. */
export function assertRoot(root: string): void {
  if (!fs.existsSync(path.join(root, MARKER))) throw new Error(`not a differential root: ${root}`);
}

/** TMPDIR, TEMP and TMP all pointing at the root's own `tmp` directory, mktemp shim on PATH. */
export const tmpEnv = (root: string): Record<string, string> => ({
  TMPDIR: path.join(root, "tmp"),
  TEMP: path.join(root, "tmp"),
  TMP: path.join(root, "tmp"),
  PATH: `${path.join(root, "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
});
