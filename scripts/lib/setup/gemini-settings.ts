// gemini-settings.ts — `gemini_settings_write` of scripts/lib/gemini-settings.sh (spec 0256
// requirements 27 and 31), and the exit mapping of scripts/setup-gemini-interactive.sh.
//
// The write is: the target's directory, the timestamped backup (printed, and made BEFORE any
// change), the merge (`mergeGeminiSettings`: its warnings go to standard output, its failure text to
// standard error), then the merged document as plain JSON through `writeJsonConfigSecure` (atomic
// rename, 0600 off win32). It returns the shell's code: 0 merged; 1 nothing was written; 2 the target
// holds the merged document but a step after the rename did not complete (the shell's "incomplete MCP
// servers" condition). `explainGeminiRc` is the call site: it prints the setup's message and ends the
// run with status 1 for any code but 0.

import fs from "node:fs";
import path from "node:path";

import { parseJson } from "../extension/json-ordered.ts";
import { ExtError } from "../extension/types.ts";
import type { Io } from "../extension/types.ts";
import { backupFile } from "./backup.ts";
import { SetupExit } from "./exit.ts";
import { readAndMerge } from "./gemini-settings-merge.ts";
import type { MergeInput } from "./gemini-settings-merge.ts";
import { writeJsonConfigSecure } from "./json-secure.ts";
import { wrapStdioCommand } from "./trust-wrapper.ts";

/** What the write needs of the setup context. */
export interface GeminiWriteCtx {
  readonly io: Pick<Io, "out" | "err">;
  readonly platform: NodeJS.Platform;
  readonly home: string;
  readonly repoDir: string;
}

/** Seams of a run; none is needed outside tests. */
export interface GeminiWriteEnv {
  /** The clock of the backup name; defaults to the real one. */
  readonly now?: () => Date;
}

export interface GeminiSettingsWriteOptions {
  readonly ctx: GeminiWriteCtx;
  /** `~/.gemini/settings.json`. */
  readonly settingsTarget: string;
  /** `config/gemini/settings.json`. */
  readonly settingsSrc: string;
  /** The MemPalace interpreter; `""` when MemPalace is absent (no `mempalace` entry). */
  readonly python: string;
  /** The org servers in Gemini's native shape (`orgMcpToNative`); `""` or `undefined` for none. */
  readonly orgNative?: MergeInput["orgNative"];
  readonly env?: GeminiWriteEnv;
}

/** The text of a failure of the shell's `_gs_fail1` (nothing was written). */
function fail1(target: string, what: string, bak: string): string[] {
  const lines = [`  ERROR: ${what}; ${target} was left unchanged.`];
  if (bak !== "")
    lines.push(`         The prior file is preserved in the timestamped backup: ${bak}`);
  return lines;
}

/** The text of a failure of the shell's `_gs_fail2` (the target holds the merged settings). */
function fail2(target: string, what: string, bak: string): string[] {
  const lines = [`  ERROR: ${target} holds the merged settings, but ${what} did not complete.`];
  if (bak !== "")
    lines.push(`         The prior file is preserved in the timestamped backup: ${bak}`);
  return lines;
}

const present = (file: string): boolean => {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
};

/** The template as an ordered document, or `undefined` when it cannot be read (the merge then fails). */
function readSeed(file: string): unknown {
  try {
    return parseJson(fs.readFileSync(file, "utf8"), file);
  } catch (error) {
    if (error instanceof ExtError || (error as NodeJS.ErrnoException).code !== undefined) {
      return undefined;
    }
    throw error;
  }
}

/** The file of `text` as an ordered document: `writeJsonConfigSecure` takes documents, not text. */
const asDocument = (text: string, file: string): ReturnType<typeof parseJson> =>
  parseJson(text, file);

/**
 * Merge the framework's settings into `settingsTarget` and write them. Returns the code of
 * `gemini_settings_write`: 0, 1 (nothing written) or 2 (merged, but a later step failed). Every
 * message of the shell goes to the same stream through `ctx.io`.
 */
export function geminiSettingsWrite(options: GeminiSettingsWriteOptions): number {
  const { ctx, settingsTarget: target, settingsSrc, python } = options;
  const { io, platform, home, repoDir } = ctx;
  const report = (lines: readonly string[]): void => {
    for (const line of lines) io.err(line);
  };
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  } catch {
    report(fail1(target, `cannot create ${path.dirname(target)}`, ""));
    return 1;
  }

  // R13: the backup exists before the first change, or nothing changes.
  let bak = "";
  if (present(target)) {
    bak = backupFile(ctx, target, options.env?.now ? { now: options.env.now } : {});
    if (bak === "") {
      report(fail1(target, "the backup could not be created", ""));
      return 1;
    }
  }

  const wrap: NonNullable<MergeInput["wrap"]> = (words) => {
    const [head, ...rest] = words;
    const command = platform === "win32" && head === "npx" ? "npx.cmd" : head;
    return wrapStdioCommand({ platform, home, repoDir }, [command ?? "", ...rest]);
  };
  const merged = readAndMerge(target, {
    seed: readSeed(settingsSrc),
    repoDir,
    python,
    orgNative: options.orgNative,
    seedPath: settingsSrc,
    backupRef: bak === "" ? undefined : bak,
    wrap,
  });
  if (!merged.ok) {
    io.err(merged.message);
    return merged.code;
  }
  for (const line of merged.warnings) io.out(line);

  // The write reports through a buffer: a failure is told in the shell's words, by what had happened.
  const errors: string[] = [];
  const quiet = { io: { out: io.out, err: (line: string) => void errors.push(line) }, platform };
  try {
    writeJsonConfigSecure({
      ctx: quiet,
      file: target,
      value: asDocument(merged.text, target),
      backup: false,
    });
  } catch (error) {
    if (!(error instanceof SetupExit)) throw error;
    const renamed = errors.some((line) => line.includes("could not be restricted to 0600"));
    if (renamed) {
      try {
        fs.chmodSync(target, 0o600);
      } catch {
        // best effort first, as `chmod 600 "$target" 2>/dev/null`
      }
      report(fail2(target, "restricting it to 0600", bak));
      return 2;
    }
    report(fail1(target, "the merged file could not be moved into place", bak));
    return 1;
  }

  // A stale "<target>.tmp" of an older setup would be truncated in place and keep its 0644 mode.
  try {
    fs.rmSync(`${target}.tmp`, { force: true });
  } catch {
    report(fail2(target, `removing the stale ${target}.tmp`, bak));
    return 2;
  }
  return 0;
}

/** The call-site mapping of the Gemini setup: nothing for 0, a message and `SetupExit(1)` otherwise. */
export function explainGeminiRc(rc: number, io: Pick<Io, "err">): void {
  if (rc === 0) return;
  io.err(
    rc === 2
      ? "  settings.json was merged but its MCP servers are incomplete — setup aborted. Re-run this script."
      : "  settings.json was not changed — setup aborted.",
  );
  throw new SetupExit(1);
}
