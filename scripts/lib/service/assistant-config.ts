// assistant-config.ts — read, back up and write the MemPalace registration of
// the four assistants (spec 0252 requirement 18; plan v3 D1 row
// `assistant-config`). Ports `capture_mempalace_registration`,
// `restore_mempalace_registration`, `register_mempalace_mcp`, `backup_file` and
// the `.bak.*` purge of scripts/switch-mempalace-http.sh, without `jq`.
//
// CLAUDE CODE is registered the way the shell does: through its configuration
// file (~/.claude.json), never through `claude mcp add --header` nor
// `claude mcp add-json`, whose arguments would carry the bearer token on a
// world-readable argument list (/proc/<pid>/cmdline). The only `claude`
// invocation is `claude mcp remove --scope user mempalace`, which has no secret
// on it. The token therefore reaches disk only as file content, written to a
// 0600 staged sibling and renamed into place (tmp-file.ts), so the target never
// widens and a planted symlink at a predictable name is never followed.

import { servicePlatform } from "./exec.ts";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import type { Stats } from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "../tmp-file.ts";
import { assistantConfigPath } from "./assistant-arrangement.ts";
import type { Cli } from "./assistant-arrangement.ts";

export const ASSISTANTS: readonly Cli[] = ["claude", "gemini", "copilot", "antigravity"];

/** A registration as stored: the JSON object under `mcpServers.mempalace`, or null for none. */
export type Registration = Record<string, unknown> | null;

type Doc = Record<string, unknown>;

function parseDoc(file: string): Doc {
  const value: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${file} is not a JSON object`);
  }
  return value as Doc;
}

function serversOf(doc: Doc): Doc {
  const servers = doc["mcpServers"];
  return typeof servers === "object" && servers !== null && !Array.isArray(servers)
    ? (servers as Doc)
    : {};
}

/** `.mcpServers.mempalace // null` of the assistant's file; null when absent or unreadable. */
export function captureRegistration(cli: Cli, home: string): Registration {
  const file = assistantConfigPath(cli, home);
  if (!existsSync(file)) return null;
  try {
    const entry = serversOf(parseDoc(file))["mempalace"];
    return typeof entry === "object" && entry !== null && !Array.isArray(entry)
      ? (entry as Doc)
      : null;
  } catch {
    return null;
  }
}

/** The native registration shape of each assistant, the token in the header value only. */
export function registrationEntry(cli: Cli, url: string, token: string): Doc {
  const headers = { Authorization: `Bearer ${token}` };
  // Antigravity's remote shape is {serverUrl, headers} with no transport type key.
  return cli === "antigravity" ? { serverUrl: url, headers } : { type: "http", url, headers };
}

/** Rewrite one file with `mcpServers.mempalace` set (an object) or removed (null). */
function writeEntry(file: string, entry: Registration): void {
  const doc = parseDoc(file);
  const servers = { ...serversOf(doc) };
  if (entry === null) delete servers["mempalace"];
  else servers["mempalace"] = entry;
  writeFileAtomic(file, `${JSON.stringify({ ...doc, mcpServers: servers }, null, 2)}\n`);
  if (servicePlatform() !== "win32") chmodSync(file, 0o600);
}

/** The `claude mcp remove` of the shell, injectable; its failure is ignored (`|| true`). */
export type ClaudeRemover = () => void;

export const defaultClaudeRemover: ClaudeRemover = () => {
  spawnSync("claude", ["mcp", "remove", "--scope", "user", "mempalace"], {
    stdio: "ignore",
    timeout: 30_000,
  });
};

/** Register one assistant. Throws on any failure; the caller restores. */
export function registerAssistant(
  cli: Cli,
  home: string,
  url: string,
  token: string,
  removeClaude: ClaudeRemover = defaultClaudeRemover,
): void {
  const file = assistantConfigPath(cli, home);
  if (cli === "claude") {
    // Claude Code installed but never run has no file yet; the transaction
    // must create it, or a fresh install fails the whole switch.
    if (!existsSync(file)) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileAtomic(file, '{"mcpServers":{}}\n');
    }
    removeClaude();
  } else if (!existsSync(file)) {
    throw new Error(`${file} does not exist`);
  }
  writeEntry(file, registrationEntry(cli, url, token));
}

/** Put back a captured registration (null removes it). Throws when it cannot. */
export function restoreRegistration(cli: Cli, home: string, captured: Registration): void {
  const file = assistantConfigPath(cli, home);
  if (!existsSync(file)) throw new Error(`${file} does not exist`);
  writeEntry(file, captured);
}

export const stamp = (d: Date = new Date()): string => {
  const p = (n: number, w = 2): string => String(n).padStart(w, "0");
  return (
    `${p(d.getFullYear(), 4)}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
};

/** Every `<file>.bak.*` beside the configuration, in directory order (callers sort). */
export function backupNamesOf(file: string): string[] {
  const dir = path.dirname(file);
  const prefix = `${path.basename(file)}.bak.`;
  try {
    return readdirSync(dir)
      .filter((name) => name.startsWith(prefix))
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

/**
 * Back the file up as `<file>.bak.<%Y%m%d-%H%M%S>` (`.NN` on a same-second
 * collision), mode 0600; earlier backups are narrowed to 0600 first. Returns the
 * backup path, or null when the file is absent or the backup could not be made.
 */
export function backupConfig(file: string, now: Date = new Date()): string | null {
  const posix = servicePlatform() !== "win32";
  if (posix) {
    for (const old of backupNamesOf(file)) {
      try {
        if (lstatSync(old).isFile()) chmodSync(old, 0o600);
      } catch {
        // best effort, as the shell
      }
    }
  }
  const source = lstatOrNull(file);
  if (source === null) return null;
  // A name is taken when anything, a dangling symlink included, sits at it (`-e` or `-L`
  // in the shell): writing through such a link would put the token-bearing copy elsewhere.
  const taken = (name: string): boolean => lstatOrNull(name) !== null;
  const base = `${file}.bak.${stamp(now)}`;
  let target = base;
  for (let n = 1; taken(target) && n < 100; n++) {
    target = `${base}.${String(n).padStart(2, "0")}`;
  }
  if (taken(target)) return null;
  let created = false;
  try {
    if (source.isSymbolicLink()) {
      // `cp -P`: the link itself is copied, no content (and no token) is read.
      symlinkSync(readlinkSync(file), target);
      return target;
    }
    // Created exclusively and at 0600 from the first byte (the shell's `umask 077`).
    const fd = openSync(target, "wx", 0o600);
    created = true;
    try {
      writeFileSync(fd, readFileSync(file));
    } finally {
      closeSync(fd);
    }
    if (posix) chmodSync(target, 0o600);
    return target;
  } catch {
    // Only a file this call created is removed; a lost race leaves the winner's alone.
    if (created) rmSync(target, { force: true });
    return null;
  }
}

function lstatOrNull(name: string): Stats | null {
  try {
    return lstatSync(name);
  } catch {
    return null;
  }
}

/** Remove every `<config>.bak.*` of one assistant (`--rotate`). Returns the files removed. */
export function purgeBackups(cli: Cli, home: string): string[] {
  const removed: string[] = [];
  for (const bak of backupNamesOf(assistantConfigPath(cli, home))) {
    try {
      if (lstatSync(bak).isDirectory()) continue;
      rmSync(bak, { force: true });
      removed.push(bak);
    } catch {
      // left in place
    }
  }
  return removed;
}
