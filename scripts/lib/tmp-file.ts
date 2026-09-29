// tmp-file.ts — collision-free, owner-only temporary files published by atomic
// rename (spec 0240 R10, R11).
//
// The TypeScript counterpart of `_mktemp_secret_file` and
// `write_json_config_secure` in scripts/lib/common.sh: the temporary file is
// created next to its target (same directory, so the final rename never
// crosses a file system), exclusively (`wx`, so a concurrent caller can never
// open the same file), with mode 0o600 where the platform honours POSIX modes,
// and it is removed on every failure path. Standard library only (R16).
//
// On Windows the mode is ignored and the file inherits its directory's ACL,
// exactly as the mktemp-based shell helpers behave under Git Bash.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** An open temporary file created by `createTempNextTo`. */
export interface TempFile {
  /** Absolute path of the temporary file. */
  readonly path: string;
  /** Open file descriptor, write-only. */
  readonly fd: number;
  /** Absolute path the file is published to. */
  readonly target: string;
}

const MAX_ATTEMPTS = 8;

/**
 * Create an empty temporary file next to `target`, named
 * `.<basename>.tmp-<12 hex>`, opened exclusively with mode 0o600.
 *
 * Retries with a fresh random suffix on `EEXIST`, up to a small bound; any
 * other error is thrown unchanged.
 */
export function createTempNextTo(target: string): TempFile {
  const abs = path.resolve(target);
  const dir = path.dirname(abs);
  const base = path.basename(abs);
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = path.join(dir, `.${base}.tmp-${randomBytes(6).toString("hex")}`);
    try {
      const fd = fs.openSync(candidate, "wx", 0o600);
      return { path: candidate, fd, target: abs };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      lastError = error;
    }
  }
  throw lastError;
}

/** Close and unlink a temporary file, ignoring errors: a cleanup path. */
export function discardTemp(tmp: TempFile): void {
  try {
    fs.closeSync(tmp.fd);
  } catch {
    // already closed
  }
  fs.rmSync(tmp.path, { force: true });
}

/**
 * Write `data` to the temporary file, flush it, close it and rename it onto
 * its target in one atomic step. On any error the temporary file is unlinked
 * and the error rethrown, so no partial file is left behind.
 */
export function publishTemp(tmp: TempFile, data: string | Uint8Array): void {
  let closed = false;
  try {
    fs.writeFileSync(tmp.fd, data);
    fs.fsyncSync(tmp.fd);
    fs.closeSync(tmp.fd);
    closed = true;
    fs.renameSync(tmp.path, tmp.target);
  } catch (error) {
    if (!closed) {
      try {
        fs.closeSync(tmp.fd);
      } catch {
        // already closed
      }
    }
    try {
      fs.rmSync(tmp.path, { force: true });
    } catch {
      // keep the original error: it is the one the caller needs
    }
    throw error;
  }
}

/** Create, fill and publish in one call: an atomic replacement of `target`. */
export function writeFileAtomic(target: string, data: string | Uint8Array): void {
  publishTemp(createTempNextTo(target), data);
}
