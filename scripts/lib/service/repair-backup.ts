// repair-backup.ts — the backup half of the MemPalace switch residue repair
// (spec 0165; spec 0252 requirement 18; plan v3 PR E). Ports `has_any_backup`,
// `file_mode`, `most_recent_usable_backup` and `restore_backup` of
// scripts/repair-mempalace-http.sh, without `jq`, with their rules kept:
//
//   * "usable" is the TypeScript counterpart of `jq -e .`: the file parses as
//     JSON and the document is neither `null` nor `false`. DEVIATION 31(b): the
//     strict `JSON.parse` is narrower than jq on a byte order mark, NaN and
//     several concatenated values; such a backup is unusable here.
//   * the restored mode is the backup's TARGET mode (`stat -L`), 0600 when the
//     owner triad lacks read or the mode cannot be read, and 0600 when the
//     content carries a bearer token;
//   * the content is staged in a 0600 sibling, its mode set while still staged,
//     and renamed over the configuration: a symlinked destination is replaced,
//     never written through, and the token is never wider than its final mode.

import { servicePlatform } from "./exec.ts";
import { existsSync, fchmodSync, readFileSync, statSync } from "node:fs";
import { createTempNextTo, discardTemp, publishTemp } from "../tmp-file.ts";
import { backupNamesOf } from "./assistant-config.ts";

/** `jq -e . <file>`: parses, and is neither `null` nor `false`. */
export function parsesAsJson(file: string): boolean {
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"));
    return value !== null && value !== false;
  } catch {
    return false;
  }
}

/** The backups beside a configuration, oldest first (the stamp is fixed-width: lexical is chronological). */
function sortedBackups(cfg: string): string[] {
  return backupNamesOf(cfg).sort();
}

/** `[ -e ]` on any `<cfg>.bak.*`: a dangling link is not a backup. */
export function hasAnyBackup(cfg: string): boolean {
  return sortedBackups(cfg).some((bak) => existsSync(bak));
}

/** The most recent usable backup, or null. */
export function mostRecentUsableBackup(cfg: string): string | null {
  let best: string | null = null;
  for (const bak of sortedBackups(cfg)) {
    if (existsSync(bak) && parsesAsJson(bak)) best = bak;
  }
  return best;
}

/**
 * The octal mode a COPY of `file` is given: its target's mode when the owner
 * triad can read (3 digits `[4-7]xx`, or 4 digits `x[4-7]xx`), else "600".
 * The digits are those `stat -c %a` prints: leading zeros stripped.
 */
export function fileMode(file: string): string {
  let m: string;
  try {
    m = (statSync(file).mode & 0o7777).toString(8);
  } catch {
    return "600";
  }
  return /^[4-7][0-7]{2}$/.test(m) || /^[0-7][4-7][0-7]{2}$/.test(m) ? m : "600";
}

/** `.mcpServers.mempalace.headers.Authorization // empty`: present and neither null nor false. */
function carriesToken(file: string): boolean {
  try {
    let node: unknown = JSON.parse(readFileSync(file, "utf8"));
    for (const key of ["mcpServers", "mempalace", "headers", "Authorization"]) {
      if (typeof node !== "object" || node === null || Array.isArray(node)) return false;
      node = (node as Record<string, unknown>)[key];
    }
    return node !== undefined && node !== null && node !== false;
  } catch {
    return false;
  }
}

export interface RepairIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/** R5 for one assistant: restore its most recent usable backup over `cfg`. True on success. */
export function restoreBackup(cli: string, cfg: string, io: RepairIo): boolean {
  const bak = mostRecentUsableBackup(cfg);
  if (bak === null) {
    io.out(`  ${cli}: NO USABLE BACKUP — restore the timestamped .bak file beside`);
    io.out(`        ${cfg} by hand, or re-run setup once the cause is fixed.`);
    return false;
  }
  const mode = carriesToken(bak) ? "600" : fileMode(bak);
  let content: Buffer;
  try {
    content = readFileSync(bak);
  } catch {
    io.err(`  ERROR: could not restore ${cfg} from ${bak}`);
    return false;
  }
  let tmp;
  try {
    tmp = createTempNextTo(cfg);
  } catch {
    io.err(`  ERROR: could not stage the restore of ${cfg} beside it`);
    return false;
  }
  try {
    if (servicePlatform() !== "win32") fchmodSync(tmp.fd, parseInt(mode, 8));
  } catch {
    discardTemp(tmp);
    io.err(`  ERROR: could not set mode ${mode} on the staged restore of ${cfg}.`);
    return false;
  }
  try {
    publishTemp(tmp, content);
  } catch {
    io.err(`  ERROR: could not restore ${cfg} from ${bak}`);
    return false;
  }
  io.out(`  ${cli}: restored from ${bak}`);
  return true;
}
