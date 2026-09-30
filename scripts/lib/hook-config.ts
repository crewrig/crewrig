// hook-config.ts — JSON configuration I/O for the hook wiring (spec 0243 R23).
//
// The TypeScript counterpart of `backup_file` and `write_json_config_secure`
// in scripts/lib/common.sh. A configuration file can hold the MemPalace bearer
// token, so:
//   - a non-object file is refused, never rewritten;
//   - the backup is owner-only whatever the target's mode, every earlier
//     `<target>.bak.*` regular file the user owns is narrowed to 0600, a
//     symlink is never chmod-ed or followed, and a same-second name collision
//     probes a capped `.NN` suffix (v1-F4, issue #1174 S1, issue #1246);
//   - the write is atomic (temporary file next to the target, 0600, rename),
//     so a failure leaves the target byte-identical.
//
// Standard library only (spec 0240 R16).

import fs from "node:fs";
import path from "node:path";

import { createTempNextTo, publishTemp } from "./tmp-file.ts";

export type JsonObject = Record<string, unknown>;

/** A configuration file that exists but does not parse as one JSON object. */
export class NotAJsonObjectError extends Error {
  constructor(file: string) {
    super(`${file} is not readable as a JSON object.`);
    this.name = "NotAJsonObjectError";
  }
}

/** Parse `file` as one JSON object; `null` when the file does not exist. */
export function readJsonObject(file: string): JsonObject | null {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new NotAJsonObjectError(file);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new NotAJsonObjectError(file);
  }
  return value as JsonObject;
}

/** Serialise like `jq`: two-space indent and a trailing newline. */
export function serialiseJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Write `value` to `file` atomically, ending at mode 0600. */
export function writeJsonConfig(file: string, value: unknown): void {
  // Serialise first: a value that cannot be written must not leave a temporary
  // file behind.
  const text = serialiseJson(value);
  publishTemp(createTempNextTo(file), text);
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

function stampNow(now: Date): string {
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

function occupied(file: string): boolean {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

function ownedByUser(stat: fs.Stats): boolean {
  return typeof process.getuid !== "function" || stat.uid === process.getuid();
}

/** Narrow every earlier `<target>.bak.*` regular file the user owns to 0600. */
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
    const old = path.join(dir, name);
    try {
      const stat = fs.lstatSync(old);
      if (stat.isFile() && !stat.isSymbolicLink() && ownedByUser(stat)) fs.chmodSync(old, 0o600);
    } catch {
      // best effort, like `chmod … 2>/dev/null || true`
    }
  }
}

export interface BackupOptions {
  readonly now?: Date;
  /** Diagnostic sink; default writes to standard error. */
  readonly warn?: (message: string) => void;
}

/**
 * Back `target` up as `<target>.bak.<YYYYMMDD-HHMMSS>[.NN]`, mode 0600.
 * Returns the backup path, or `null` when the target is absent, the copy
 * failed or 99 same-second collisions exhausted the suffix range.
 */
export function backupFile(target: string, options: BackupOptions = {}): string | null {
  const warn = options.warn ?? ((message: string) => process.stderr.write(`${message}\n`));
  narrowOldBackups(target);
  if (!occupied(target)) return null;

  const base = `${target}.bak.${stampNow(options.now ?? new Date())}`;
  let backup = base;
  if (occupied(backup)) {
    let n = 1;
    while (occupied(`${base}.${pad(n)}`) && n < 99) n++;
    if (occupied(`${base}.${pad(n)}`)) {
      warn(
        `  WARNING: could not find a free backup name for ${path.basename(target)} after 99 same-second collisions — skipping this backup.`,
      );
      return null;
    }
    backup = `${base}.${pad(n)}`;
  }

  try {
    if (fs.lstatSync(target).isSymbolicLink()) {
      // `cp -P`: copy the link itself; a symlink's mode is meaningless.
      fs.symlinkSync(fs.readlinkSync(target), backup);
    } else {
      // Created 0600 from the first byte (`wx`: never reuses an existing name),
      // so the credential is never readable through a wider intermediate mode.
      fs.writeFileSync(backup, fs.readFileSync(target), { flag: "wx", mode: 0o600 });
      fs.chmodSync(backup, 0o600);
    }
  } catch {
    warn(
      `  WARNING: Failed to back up ${path.basename(target)} (could not create ${path.basename(backup)})`,
    );
    return null;
  }
  return backup;
}
