// json-secure.ts — `write_json_config_secure` and `write_json_config_secure_from` of
// scripts/lib/common.sh (spec 0256 requirements 27 and 31, deviations (j) and (p)).
//
// A JSON document is written to `file`: the target is backed up first when it exists (the
// `<file>.bak.<YYYYMMDD-HHMMSS>[.NN]` rule of `backup_file`), the text goes to a fresh exclusive
// temporary file next to the target (never a predictable name a planted link could hijack) and is
// renamed onto it, so a reader sees the old or the new file and no tmp is left behind. The mode is
// 0600 from the first byte off win32; on win32 no mode is set and the profile ACL applies. The text is
// what `jq .` prints (two-space indent, key order kept, LF only, one final line feed), except that a
// number is written as JavaScript writes it. Documents are `JsonValue`s: objects are `Map`s, which
// keep the order of the file. Layer 2: no process, no environment, nothing from `process`.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { writeJsonText } from "../extension/json-write.ts";
import { parseJson } from "../extension/json-ordered.ts";
import { ExtError } from "../extension/types.ts";
import type { Io, JsonValue } from "../extension/types.ts";
import { backupFile } from "./backup.ts";
import { SetupExit } from "./exit.ts";

/** What the writers need of the setup context. */
export interface JsonSecureCtx {
  readonly io: Pick<Io, "out" | "err">;
  readonly platform: NodeJS.Platform;
}

export interface WriteJsonSecureOptions {
  readonly ctx: JsonSecureCtx;
  /** The file to write. */
  readonly file: string;
  /** Write this document as it is (no read). Exclusive with `patch` and `from`. */
  readonly value?: JsonValue;
  /**
   * The `jq` program: maps the base document to the document to write. It may throw an `ExtError`
   * (reported as one `Error:` line, status 1).
   */
  readonly patch?: (current: JsonValue) => JsonValue;
  /**
   * Where the base document comes from (`write_json_config_secure_from`): a file path to read, or a
   * document. Defaults to `file` itself (`write_json_config_secure`).
   */
  readonly from?: string | JsonValue;
  /** Back `file` up first when it exists; defaults to `true`. The shell's callers did it themselves. */
  readonly backup?: boolean;
  /** The clock of the backup name; defaults to the real one. */
  readonly now?: () => Date;
}

/**
 * The document was renamed onto its destination but the destination could not be narrowed to 0600
 * (the error line is already printed). Typed so a caller tells "merged but incomplete" from "not
 * written" without matching the message.
 */
export class ModeRestrictError extends SetupExit {
  constructor(message: string) {
    super(1, message);
    this.name = "ModeRestrictError";
  }
}

/** Print `Error: <message>` (one line, standard error) and end the run with status 1. */
function fail(ctx: Pick<JsonSecureCtx, "io">, message: string): never {
  ctx.io.err(`Error: ${message}`);
  throw new SetupExit(1, message);
}

/** The parsed JSON document of `file`; an absent, unreadable or invalid file ends the run (deviation (j)). */
export function readJsonOrFail(ctx: Pick<JsonSecureCtx, "io">, file: string): JsonValue {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return fail(ctx, `${file} cannot be read`);
  }
  try {
    return parseJson(text, file);
  } catch (error) {
    if (error instanceof ExtError) return fail(ctx, error.message.split("\n")[0] ?? file);
    throw error;
  }
}

/** Like `readJsonOrFail`, for a file whose top level must be an object (a settings or MCP config). */
export function readJsonObjectOrFail(
  ctx: Pick<JsonSecureCtx, "io">,
  file: string,
): Map<string, JsonValue> {
  const value = readJsonOrFail(ctx, file);
  if (!(value instanceof Map)) return fail(ctx, `${file} is not a JSON object`);
  return value;
}

/** A free exclusive temporary file next to `file`: 0600 off win32, no mode on win32 (deviation (p)). */
function openTemp(file: string, platform: NodeJS.Platform): { fd: number; tmp: string } {
  const dir = path.dirname(path.resolve(file));
  const base = path.basename(file);
  let last: unknown;
  for (let attempt = 0; attempt < 8; attempt++) {
    const tmp = path.join(dir, `.${base}.tmp-${randomBytes(6).toString("hex")}`);
    try {
      const fd = platform === "win32" ? fs.openSync(tmp, "wx") : fs.openSync(tmp, "wx", 0o600);
      return { fd, tmp };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      last = error;
    }
  }
  throw last;
}

/** Publish `text` onto `file` atomically; no temporary file survives a failure. */
function publish(ctx: JsonSecureCtx, file: string, text: string): void {
  let tmp: string | undefined;
  try {
    const opened = openTemp(file, ctx.platform);
    tmp = opened.tmp;
    try {
      fs.writeFileSync(opened.fd, text);
      fs.fsyncSync(opened.fd);
    } finally {
      fs.closeSync(opened.fd);
    }
    fs.renameSync(tmp, file);
  } catch (error) {
    if (tmp !== undefined) fs.rmSync(tmp, { force: true });
    return fail(ctx, `cannot write ${file}: ${(error as Error).message.split("\n")[0]}`);
  }
  // The destination now holds what may be a credential, whatever it was before.
  if (ctx.platform === "win32") return;
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    ctx.io.err(`  ERROR: ${file} holds a bearer token and could not be restricted to 0600.`);
    throw new ModeRestrictError(`${file} could not be restricted to 0600`);
  }
}

/** The document to write, computed before any file is touched. */
function document(options: WriteJsonSecureOptions): JsonValue {
  const { ctx, file, value, patch, from } = options;
  if (value !== undefined) return value;
  let base: JsonValue;
  if (from === undefined) base = readJsonOrFail(ctx, file);
  else if (typeof from === "string") base = readJsonOrFail(ctx, from);
  else base = from;
  if (patch === undefined) return base;
  try {
    return patch(base);
  } catch (error) {
    if (error instanceof ExtError) return fail(ctx, error.message);
    throw error;
  }
}

/**
 * Write the document: `value`, or `patch` applied to the base (the file itself, or `from`). Returns the
 * path of the backup made first (`""` when none: the target was absent, `backup` is false, or the
 * backup failed with its warning). An invalid or unreadable input, a patch that refuses, or a failed
 * write prints one `Error:` line and throws `SetupExit(1)`; the target is then left as it was
 * (only its backup may have been made).
 */
export function writeJsonConfigSecure(options: WriteJsonSecureOptions): string {
  const { ctx, file } = options;
  if (
    (options.value === undefined) ===
    (options.patch === undefined && options.from === undefined)
  ) {
    throw new TypeError("writeJsonConfigSecure needs a value, or a patch or a source");
  }
  const bak =
    options.backup === false ? "" : backupFile(ctx, file, options.now ? { now: options.now } : {});
  // Read the base after the backup, as the shell's callers did; a bad input leaves the target intact.
  let text: string;
  try {
    text = writeJsonText(document(options));
  } catch (error) {
    if (error instanceof SetupExit) throw error;
    return fail(ctx, `${file}: ${(error as Error).message}`);
  }
  publish(ctx, file, text);
  return bak;
}
