// hook-statusline.ts — install and rewrite the Antigravity CLI status
// line command that feeds the usage-capture shim (spec 0243 R19, D5).
//
// Two files are involved: the CLI's `settings.json` (`statusLine.command`) and
// the framework's marker `<usage root>/state/antigravity-statusline.json`
// (`priorStatusLineCommand`, `installedStatusLineCommand`, `installedBy`).
// Setup recognises the status line as the framework's when the current command
// equals `installedStatusLineCommand` OR the transitional
// `previousInstalledStatusLineCommand`, so a crash between the two writes of a
// rewrite leaves a recognised state:
//   (a) marker: new command as installed, the old one as transitional;
//   (b) settings: new command;
//   (c) marker again, without the transitional key.
// The prior command is read from the settings file itself, never from `argv`
// (R23: configuration content never appears on a process argument list).
//
// On Windows (spec 0243 delta-03 R34) every direct `.ts` command — bare,
// guarded or pointing at another checkout — takes one path: the command is
// rebuilt from the registered path's checkout, kept when equal, left with the
// R32 diagnostic when the module refuses, and rewritten otherwise. A guarded
// command met on macOS or Linux is an unrecognised shape (S4): the module never
// produces it there.
//
// Standard library only (spec 0240 R16).

import fs from "node:fs";
import path from "node:path";

import { backupFile, readJsonObject, writeJsonConfig, type JsonObject } from "./hook-config.ts";
import { GUARDED_PREFIX, hookCommandLine, type MeasuredSurface } from "./hook-command.ts";
import { ANTIGRAVITY_STATUSLINE } from "./hook-descriptor.ts";
import { parseHookCommand } from "./hook-recognition.ts";
import { resolveReal } from "./paths.ts";

export interface StatuslineTarget {
  readonly settings: string;
  readonly marker: string;
  /** The checkout whose `hooks/antigravity-statusline-shim.ts` is wired. */
  readonly repo: string;
  readonly platform: NodeJS.Platform;
  /** Test seam: the measured-surface constant; hook-wiring.ts never sets it. */
  readonly measuredSurfaces?: readonly MeasuredSurface[];
}

const TRANSITIONAL = "previousInstalledStatusLineCommand";
const INSTALLED = "installedStatusLineCommand";

const isRecord = (v: unknown): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function currentCommand(settings: JsonObject): string {
  const line = settings["statusLine"];
  const command = isRecord(line) ? line["command"] : undefined;
  return typeof command === "string" ? command : "";
}

function withoutKey(marker: JsonObject, key: string): JsonObject {
  const copy = { ...marker };
  delete copy[key];
  return copy;
}

function setCommand(settings: JsonObject, command: string): JsonObject {
  const line = settings["statusLine"];
  return { ...settings, statusLine: { ...(isRecord(line) ? line : {}), command } };
}

/** Command line for the shim of `repo`, or the refusal to print. */
function shimCommand(target: StatuslineTarget): { command: string } | { refusal: string } {
  const script = path.join(target.repo, "hooks", "antigravity-statusline-shim.ts");
  if (!fs.existsSync(script)) return { refusal: `status-line shim not found at ${script}.` };
  const request = {
    cli: "antigravity",
    surface: "statusline",
    platform: target.platform,
    scriptPath: resolveReal(script),
    args: [],
  } as const;
  const built =
    target.measuredSurfaces === undefined
      ? hookCommandLine(request)
      : hookCommandLine(request, target.measuredSurfaces);
  return built.ok ? { command: built.command } : { refusal: built.refusal };
}

/**
 * The R35 note: under the guarded form the prior command the shim hands to
 * `%ComSpec%`, and its children, inherit `NoDefaultCurrentDirectoryInExePath`.
 * Printed only when the marker records a non-empty prior command.
 */
function propagationNote(prior: unknown, command: string, log: (line: string) => void): void {
  if (typeof prior !== "string" || prior === "" || !command.startsWith(GUARDED_PREFIX)) return;
  log(
    `  Note: your prior status line command (${prior}) now runs with NoDefaultCurrentDirectoryInExePath=1, so it and every program it starts no longer find a program in the current directory without a path (the current-directory lookup is disabled, spec 0243 R35). Name such a program by an explicit path in that command.`,
  );
}

/** The three ordered writes of a rewrite, (a) (b) (c), after a backup. Returns the exit status. */
function rewriteTo(
  target: StatuslineTarget,
  settings: JsonObject,
  marker: JsonObject,
  current: string,
  command: string,
  log: (line: string) => void,
): number {
  if (!backup(target.settings, log)) return 1; // before (a): a refusal leaves marker and settings untouched
  writeJsonConfig(target.marker, {
    ...marker,
    [INSTALLED]: command,
    [TRANSITIONAL]: current,
  }); // (a)
  writeJsonConfig(target.settings, setCommand(settings, command)); // (b)
  writeJsonConfig(target.marker, {
    ...withoutKey(marker, TRANSITIONAL),
    [INSTALLED]: command,
  }); // (c)
  log(`  Antigravity usage capture: rewrote statusLine.command -> ${command}`);
  propagationNote(marker["priorStatusLineCommand"], command, log);
  return 0;
}

/** Back `settings` up; `false` means it exists but has no restore point, so the caller must not write. */
function backup(settings: string, log: (line: string) => void): boolean {
  const made = backupFile(settings);
  if (made.status === "failed") {
    log(`  ERROR: could not back up ${settings}; leaving it untouched (backup-first, R23).`);
    return false;
  }
  if (made.status === "made") {
    log(`  Backed up: ${path.basename(settings)} -> ${path.basename(made.path)}`);
  }
  return true;
}

/** Fresh install: only over an empty `statusLine.command` (R20). Returns the exit status. */
export function installStatusline(target: StatuslineTarget, log: (line: string) => void): number {
  const built = shimCommand(target);
  if ("refusal" in built) {
    // Reported like a command R26 leaves (spec 0243 R18): neither settings nor
    // marker is touched and no backup is made. Exit 1 tells setup that capture
    // is not enabled; an existing command stays exactly as registered.
    log(`  Antigravity usage capture: left statusLine.command (${built.refusal})`);
    return 1;
  }
  const settings = readJsonObject(target.settings) ?? {};
  if (currentCommand(settings) !== "") {
    log(
      "  ERROR: statusLine.command already carries a value this framework did not install; leaving it untouched.",
    );
    return 1;
  }
  const existing = settings["statusLine"];
  if (existing !== undefined && !isRecord(existing)) {
    log(`  ERROR: statusLine in ${target.settings} is not an object; leaving it untouched.`);
    return 1;
  }
  fs.mkdirSync(path.dirname(target.marker), { recursive: true });
  fs.mkdirSync(path.dirname(target.settings), { recursive: true });
  // Backup before anything is written, so a refusal leaves marker and settings untouched.
  if (!backup(target.settings, log)) return 1;
  // Marker first: a crash before the settings write leaves a marker naming a
  // command nothing carries yet, which the next run simply overwrites.
  writeJsonConfig(target.marker, {
    priorStatusLineCommand: "",
    [INSTALLED]: built.command,
    installedBy: "crewrig-setup-antigravity-interactive",
  });
  writeJsonConfig(target.settings, setCommand(settings, built.command));
  log(`  Usage capture wired to ${built.command}`);
  // Install only ever runs over an empty statusLine.command (R20), so the
  // prior is "" and no note follows on this head (S1); kept for R35.
  propagationNote("", built.command, log);
  return 0;
}

/** Rewrite the legacy bare `.sh` status line to the direct form. Returns the exit status. */
export function rewriteStatusline(target: StatuslineTarget, log: (line: string) => void): number {
  const settings = readJsonObject(target.settings);
  const marker = readJsonObject(target.marker);
  if (settings === null || marker === null) {
    log("  No Antigravity usage capture is installed; nothing to rewrite.");
    return 0;
  }
  const current = currentCommand(settings);
  const installed = marker[INSTALLED];
  const transitional = marker[TRANSITIONAL];
  if (current === "" || (current !== installed && current !== transitional)) {
    log("  Antigravity usage capture: left statusLine.command (not installed by this framework).");
    return 0;
  }
  const parse = parseHookCommand(current, ANTIGRAVITY_STATUSLINE);
  if (parse === null || (parse.guarded && target.platform !== "win32")) {
    log("  Antigravity usage capture: left statusLine.command (unrecognised shape).");
    return 0;
  }
  const keepDirect = (): number => {
    if (TRANSITIONAL in marker && current === installed) {
      writeJsonConfig(target.marker, withoutKey(marker, TRANSITIONAL)); // (c) of an interrupted rewrite
    }
    log("  Antigravity usage capture: left statusLine.command (already the direct form).");
    return 0;
  };
  if (parse.ext === "ts") {
    if (target.platform !== "win32") return keepDirect();
    // R34 on Windows: one comparison covers keep, the bare->guarded upgrade and
    // the re-point; a command the module would refuse is never kept as current.
    const built = shimCommand({ ...target, repo: path.resolve(path.dirname(parse.path), "..") });
    if ("refusal" in built) {
      log(`  Antigravity usage capture: left statusLine.command (${built.refusal})`);
      return 0;
    }
    if (built.command === current) return keepDirect();
    return rewriteTo(target, settings, marker, current, built.command, log);
  }
  if (!fs.existsSync(`${parse.path.slice(0, -".sh".length)}.ts`)) {
    log(
      "  Antigravity usage capture: left statusLine.command (no .ts next to the registered .sh; it still works through its shell script).",
    );
    return 0;
  }
  const built = shimCommand({ ...target, repo: path.resolve(path.dirname(parse.path), "..") });
  if ("refusal" in built) {
    log(`  Antigravity usage capture: left statusLine.command (${built.refusal})`);
    return 0;
  }
  return rewriteTo(target, settings, marker, current, built.command, log);
}
