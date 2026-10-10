// link-or-copy-swap.ts — the staged swap of spec 0255 R14, R16: a copy or a link is built under a
// sibling staging name, then swapped in so a failure never destroys the old destination.
// Synchronous, standard library only, prints nothing.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** The file-system calls the swap makes: a test injects a failing one (rollback, retry). */
export interface SwapFs {
  readonly lstatSync: (p: string) => fs.Stats;
  readonly mkdirSync: (p: string, o: { recursive: true }) => unknown;
  readonly renameSync: (from: string, to: string) => void;
  readonly rmSync: (p: string, o: { recursive: true; force: true }) => void;
}

export interface SwapOptions {
  readonly fsImpl?: SwapFs;
  /** Defaults to `process.platform`; the rename retry only runs on `win32`. */
  readonly platform?: string;
  /** Blocking sleep in milliseconds; injectable so a test needs no real delay. */
  readonly sleep?: (ms: number) => void;
}

/** Attempts and spacing of a Windows rename that fails with `EPERM`/`EBUSY` (R16). */
export const RENAME_ATTEMPTS = 5;
export const RENAME_DELAY_MS = 50;

const realFs: SwapFs = {
  lstatSync: (p) => fs.lstatSync(p),
  mkdirSync: (p, o) => fs.mkdirSync(p, o),
  renameSync: (a, b) => fs.renameSync(a, b),
  rmSync: (p, o) => fs.rmSync(p, o),
};

function errCode(error: unknown): string {
  return error instanceof Error && "code" in error ? String(error.code) : "";
}

function blockingSleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function beside(dest: string, infix: string): string {
  const abs = path.resolve(dest);
  const hex = randomBytes(6).toString("hex");
  return path.join(path.dirname(abs), `.${path.basename(abs)}.${infix}-${hex}`);
}

/** `.<name>.crewrig-tmp-<hex>` beside `dest`: same directory, hence same volume. Created by no one. */
export function stagedName(dest: string): string {
  return beside(dest, "crewrig-tmp");
}

/** Rename with the bounded Windows retry; after the last attempt the last error is thrown. */
export function renameRetry(from: string, to: string, opts: SwapOptions = {}): void {
  const f = opts.fsImpl ?? realFs;
  const retry = (opts.platform ?? process.platform) === "win32";
  const sleep = opts.sleep ?? blockingSleep;
  for (let attempt = 1; ; attempt++) {
    try {
      f.renameSync(from, to);
      return;
    } catch (error) {
      const busy = errCode(error) === "EPERM" || errCode(error) === "EBUSY";
      if (!retry || !busy || attempt >= RENAME_ATTEMPTS) throw error;
      sleep(RENAME_DELAY_MS);
    }
  }
}

/** Remove a leftover stage (file, directory or link, never followed); errors are ignored. */
export function discardStage(stage: string, opts: SwapOptions = {}): void {
  try {
    (opts.fsImpl ?? realFs).rmSync(stage, { recursive: true, force: true });
  } catch {
    // a cleanup path: the caller already has the error that matters
  }
}

function existing(f: SwapFs, p: string): fs.Stats | null {
  try {
    return f.lstatSync(p);
  } catch (error) {
    if (errCode(error) === "ENOENT") return null;
    throw error;
  }
}

/**
 * Put `stage` at `dest`. Returns what was there: `"absent"`, `"symlink"` (dangling included, removed
 * as a link only) or `"other"` (file or directory). The old entry is renamed aside to
 * `.<name>.old-<hex>`, the stage renamed in, the old one deleted (best effort once the new entry is
 * in place); when the second rename fails the first is rolled back. On any failure the stage is
 * removed and the old entry is intact (or its aside path is in the thrown message when the rollback
 * itself failed). `dest` is inspected with `lstat`, never `existsSync`.
 */
export function swapIn(
  stage: string,
  dest: string,
  opts: SwapOptions = {},
): "absent" | "symlink" | "other" {
  const f = opts.fsImpl ?? realFs;
  try {
    f.mkdirSync(path.dirname(path.resolve(dest)), { recursive: true });
    const old = existing(f, dest);
    if (old === null) {
      renameRetry(stage, dest, opts);
      return "absent";
    }
    const aside = beside(dest, "old");
    renameRetry(dest, aside, opts);
    try {
      renameRetry(stage, dest, opts);
    } catch (error) {
      try {
        renameRetry(aside, dest, opts);
      } catch (rollback) {
        throw new Error(
          `could not place '${dest}' and could not restore it: the previous entry is at '${aside}'`,
          { cause: rollback },
        );
      }
      throw error;
    }
    discardStage(aside, opts);
    return old.isSymbolicLink() ? "symlink" : "other";
  } catch (error) {
    discardStage(stage, opts);
    throw error;
  }
}
