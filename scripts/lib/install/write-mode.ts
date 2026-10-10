// write-mode.ts — publish a text file atomically with the mode the shell's `> file` gives it
// (spec 0255, differential finding on file modes).
//
// `writeFileAtomic` creates its temporary file 0600, so a published JSON file would come out 0600
// where the shell's `jq ... > "$file"` follows the umask (0666 & ~umask, 0644 by default) or, when
// the file already exists, keeps ITS mode. This helper computes that mode, applies it to the
// temporary file's descriptor BEFORE the rename (`fchmod`), and publishes: the published file never
// has a mode other than the final one, and no wider-than-final window exists. Standard library only.

import fs from "node:fs";

import { createTempNextTo, discardTemp, publishTemp } from "../tmp-file.ts";

/** The file's own path: the target of a link when `file` is one that resolves, else `file`. */
function resolved(file: string): string {
  try {
    return fs.realpathSync(file);
  } catch {
    return file;
  }
}

/** The mode a `> file` redirect leaves: the existing file's permission bits, else the umask's. */
export function redirectMode(file: string): number {
  try {
    return fs.statSync(file).mode & 0o777;
  } catch {
    return 0o666 & ~process.umask();
  }
}

/**
 * Write `text` to `file` (through a link, as the shell's redirect does) atomically, leaving the
 * mode a shell redirect leaves. On win32 modes are ignored, as `writeFileAtomic` documents.
 */
export function writeJsonKeepingMode(file: string, text: string): void {
  const target = resolved(file);
  const tmp = createTempNextTo(target);
  try {
    if (process.platform !== "win32") fs.fchmodSync(tmp.fd, redirectMode(target));
  } catch (error) {
    discardTemp(tmp);
    throw error;
  }
  publishTemp(tmp, text);
}
