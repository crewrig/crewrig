// files.ts — the file walk and the NUL-byte predicate shared by the substitution and the survivor check.

import fs from "node:fs";
import path from "node:path";

/** Every regular file under `dir`, as `find -type f` lists them (symbolic links are not followed), sorted. */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * The text of a file that holds no NUL byte (`grep -Iq ''`), read byte for byte (latin1) so that
 * writing it back changes nothing but the replaced token; `null` for a file with a NUL byte.
 */
export function readTextCarrying(file: string): string | null {
  const bytes = fs.readFileSync(file);
  return bytes.includes(0) ? null : bytes.toString("latin1");
}
