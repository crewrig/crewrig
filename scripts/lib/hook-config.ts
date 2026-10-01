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
// `readJsonConfig` is an opt-in reader added for spec 0245: the Gemini CLI
// JSONC dialect (`jsonc`) and a refusal of input a rewrite could not
// reproduce (`lossless`). `readJsonObject` keeps its plain-JSON behaviour.
//
// Standard library only (spec 0240 R16).

import fs from "node:fs";
import path from "node:path";

import { findDuplicateKey, stripJsonComments } from "./jsonc.ts";
import { createTempNextTo, publishTemp } from "./tmp-file.ts";

export type JsonObject = Record<string, unknown>;

/** A configuration file that exists but does not parse as one JSON object. */
export class NotAJsonObjectError extends Error {
  constructor(file: string) {
    super(`${file} is not readable as a JSON object.`);
    this.name = "NotAJsonObjectError";
  }
}

/**
 * A configuration file `readJsonConfig` refuses under `lossless: true`: it
 * parses, but rewriting it would change a declaration (spec 0245 R8).
 */
export class LossyJsonError extends Error {
  readonly file: string;
  readonly reason: string;
  constructor(file: string, reason: string) {
    super(`${file} cannot be rewritten without loss: ${reason}.`);
    this.name = "LossyJsonError";
    this.file = file;
    this.reason = reason;
  }
}

export interface ReadJsonConfigOptions {
  /** Read the Gemini CLI JSONC dialect: comments removed, an empty text is `{}`. */
  readonly jsonc?: boolean;
  /** Throw {@link LossyJsonError} for input a rewrite could not reproduce. */
  readonly lossless?: boolean;
}

export interface JsonConfig {
  readonly doc: JsonObject;
  /** `true` only when a comment was actually removed (`jsonc: true`). */
  readonly comments: boolean;
}

const CANONICAL_INDEX = /^(?:0|[1-9][0-9]*)$/;
const JSON_WHITESPACE_ONLY = /^[ \t\n\r]*$/;

/** The reviver of `lossless: true`: no lossy number, no reordered key. */
function losslessReviver(file: string) {
  return function (this: unknown, key: string, value: unknown, context?: { source?: string }) {
    if (!Array.isArray(this) && CANONICAL_INDEX.test(key) && Number(key) < 2 ** 32 - 1) {
      throw new LossyJsonError(file, `key "${key}" is an integer-like key a rewrite would reorder`);
    }
    if (typeof value === "number" && context?.source !== undefined) {
      if (JSON.stringify(value) !== context.source) {
        throw new LossyJsonError(file, `number ${context.source} does not round-trip`);
      }
    }
    return value;
  };
}

/**
 * Read `file` as one JSON object; `null` when the file does not exist. Throws
 * {@link NotAJsonObjectError} when it does not parse as an object (a BOM
 * included) and, under `lossless: true`, {@link LossyJsonError} for a
 * duplicate key, a number literal that does not round-trip, or an
 * integer-like key.
 */
export function readJsonConfig(
  file: string,
  options: ReadJsonConfigOptions = {},
): JsonConfig | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let text = raw;
  let comments = false;
  if (options.jsonc === true) {
    text = stripJsonComments(raw);
    comments = text !== raw;
    if (JSON_WHITESPACE_ONLY.test(text)) return { doc: {}, comments };
  }
  let value: unknown;
  try {
    value = options.lossless === true ? JSON.parse(text, losslessReviver(file)) : JSON.parse(text);
  } catch (error) {
    if (error instanceof LossyJsonError) throw error;
    throw new NotAJsonObjectError(file);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new NotAJsonObjectError(file);
  }
  if (options.lossless === true) {
    const duplicate = findDuplicateKey(text);
    if (duplicate !== null) {
      throw new LossyJsonError(file, `duplicate key ${JSON.stringify(duplicate.join("."))}`);
    }
  }
  return { doc: value as JsonObject, comments };
}

/** Parse `file` as one JSON object; `null` when the file does not exist. */
export function readJsonObject(file: string): JsonObject | null {
  return readJsonConfig(file)?.doc ?? null;
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
 * The outcome of {@link backupFile}. `failed` is distinct from `absent` so a
 * caller can refuse to overwrite a config that has no restore point (R23
 * backup-first; security review finding 2).
 */
export type BackupResult =
  | { readonly status: "absent" }
  | { readonly status: "made"; readonly path: string }
  | { readonly status: "failed" };

/**
 * Back `target` up as `<target>.bak.<YYYYMMDD-HHMMSS>[.NN]`, mode 0600.
 * `absent` when there is nothing to back up; `failed` when the target exists
 * but the copy failed or 99 same-second collisions exhausted the suffix range.
 */
export function backupFile(target: string, options: BackupOptions = {}): BackupResult {
  const warn = options.warn ?? ((message: string) => process.stderr.write(`${message}\n`));
  narrowOldBackups(target);
  if (!occupied(target)) return { status: "absent" };

  const base = `${target}.bak.${stampNow(options.now ?? new Date())}`;
  let backup = base;
  if (occupied(backup)) {
    let n = 1;
    while (occupied(`${base}.${pad(n)}`) && n < 99) n++;
    if (occupied(`${base}.${pad(n)}`)) {
      warn(
        `  WARNING: could not find a free backup name for ${path.basename(target)} after 99 same-second collisions — no backup made.`,
      );
      return { status: "failed" };
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
    return { status: "failed" };
  }
  return { status: "made", path: backup };
}
