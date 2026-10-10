// backup.ts — `backup_file` of scripts/lib/common.sh (spec 0256 requirements 22 and 31): the file
// is copied to `<file>.bak.<YYYYMMDD-HHMMSS>` (`.NN` after a same-second collision), owner-only
// (0600), after every earlier `<file>.bak.*` regular file the user owns was narrowed to 0600 too.
// Its own implementation rather than hook-config.ts's `backupFile`, whose messages differ from
// the shell's and which prints nothing. Layer 1: node built-ins only.

import fs from "node:fs";
import path from "node:path";

import type { Io } from "./context.ts";

export interface BackupOptions {
  /** The clock (local time, as `date +%Y%m%d-%H%M%S`); defaults to the real one. */
  readonly now?: () => Date;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

function stamp(d: Date): string {
  const day = `${pad(d.getFullYear(), 4)}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  return `${day}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** `[ -e p ] || [ -L p ]`: the name is taken, a dangling link included. */
function occupied(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Earlier backups an older release left wide open stop exposing a token (issue #1174). */
function narrowOldBackups(target: string): void {
  const dir = path.dirname(target);
  const prefix = `${path.basename(target)}.bak.`;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    try {
      const old = path.join(dir, name);
      const st = fs.lstatSync(old);
      const mine = typeof process.getuid !== "function" || st.uid === process.getuid();
      if (st.isFile() && mine) fs.chmodSync(old, 0o600);
    } catch {
      // best effort, as `chmod ... 2>/dev/null || true`
    }
  }
}

/** A free `<target>.bak.<stamp>[.NN]` name, or `undefined` after 99 same-second collisions. */
function freeName(target: string, when: Date): string | undefined {
  const base = `${target}.bak.${stamp(when)}`;
  if (!occupied(base)) return base;
  let n = 1;
  while (occupied(`${base}.${pad(n)}`) && n < 99) n++;
  return occupied(`${base}.${pad(n)}`) ? undefined : `${base}.${pad(n)}`;
}

/** `cp -P` under umask 077: a link is copied as a link, a file is created 0600 from the first byte. */
function copyOwnerOnly(target: string, bak: string): void {
  if (fs.lstatSync(target).isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(target), bak);
  } else {
    fs.writeFileSync(bak, fs.readFileSync(target), { flag: "wx", mode: 0o600 });
  }
}

/**
 * Back `file` up. Prints `  Backed up: <name> -> <backup name>` and returns the backup's path (the
 * shell's `LAST_BACKUP_PATH`); returns `""` when `file` is absent (or neither a file nor a link),
 * when no free name was found, or when the copy failed (a warning goes to standard error).
 */
export function backupFile(
  ctx: { readonly io: Pick<Io, "out" | "err"> },
  file: string,
  options: BackupOptions = {},
): string {
  narrowOldBackups(file);
  let isLink: boolean;
  try {
    const st = fs.lstatSync(file);
    isLink = st.isSymbolicLink();
    if (!isLink && !st.isFile()) return "";
  } catch {
    return "";
  }
  const name = path.basename(file);
  const bak = freeName(file, (options.now ?? (() => new Date()))());
  if (bak === undefined) {
    ctx.io.err(
      `  WARNING: could not find a free backup name for ${name} after 99 same-second collisions — skipping this backup.`,
    );
    return "";
  }
  try {
    copyOwnerOnly(file, bak);
  } catch {
    // fall through to the failure warning
  }
  // `[ -e "$bak" ]` follows links: a copied dangling link counts as a failed backup, as in the shell.
  if (!fs.existsSync(bak)) {
    ctx.io.err(`  WARNING: Failed to back up ${name} (could not create ${path.basename(bak)})`);
    return "";
  }
  if (!isLink) {
    try {
      fs.chmodSync(bak, 0o600);
    } catch {
      ctx.io.err(`  WARNING: could not restrict ${path.basename(bak)} to 0600`);
    }
  }
  ctx.io.out(`  Backed up: ${name} -> ${path.basename(bak)}`);
  return bak;
}
