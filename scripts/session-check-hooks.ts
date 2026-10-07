// session-check-hooks.ts — register or unregister the MemPalace session-start
// check in one CLI's user-level hook file (spec 0246 R11; plan v4 step 5).
//
//   node scripts/lib/node-floor-guard.js && \
//     node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/session-check-hooks.ts \
//       register|unregister <claude|gemini|copilot|antigravity> [--platform <p>]
//
// `register` installs the check under ~/.crewrig/hooks/session-check/ (R9) and
// writes exactly one entry, unless the check must not be registered for this
// CLI, in which case it acts as `unregister`:
//   - any platform other than darwin/linux (delta-01 R11 *Platform*);
//   - Antigravity CLI while ANTIGRAVITY_SESSION_CHECK.registered is false
//     (R8 fallback, R11 *Antigravity*);
//   - a CLI whose SESSION_CHECK_CHANNELS entry has neither channel (R7).
// `--platform` exists for tests only. Exit: 0 done, 1 refused or failed (the
// file is left untouched), 2 usage.

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import {
  ANTIGRAVITY_SESSION_CHECK,
  CLIS,
  type Cli,
  SESSION_CHECK_CHANNELS,
} from "./lib/mempalace-registration.ts";
import {
  CHECK_FILE,
  INSTALL_DIR,
  INSTALLED_SOURCES,
  type Obj,
  addEntry,
  hookCommand,
  hookFilePath,
  isObj,
  stripEntry,
} from "./lib/session-check-config.ts";
import { writeFileAtomic } from "./lib/tmp-file.ts";

const USAGE =
  "usage: session-check-hooks.ts register|unregister <claude|gemini|copilot|antigravity> [--platform <p>]";

interface Args {
  readonly action: "register" | "unregister";
  readonly cli: Cli;
  readonly platform: string;
}

function parseArgs(argv: readonly string[]): Args | null {
  const rest = [...argv];
  let platform: string = process.platform;
  const i = rest.indexOf("--platform");
  if (i >= 0) {
    const value = rest[i + 1];
    if (value === undefined || value === "") return null;
    platform = value;
    rest.splice(i, 2);
  }
  const [action, cli, ...extra] = rest;
  if (extra.length > 0 || (action !== "register" && action !== "unregister")) return null;
  if (!(CLIS as readonly string[]).includes(cli ?? "")) return null;
  return { action, cli: cli as Cli, platform };
}

/** Why the check must not be registered for this CLI here, or null. */
function exclusion(cli: Cli, platform: string): string | null {
  if (platform !== "darwin" && platform !== "linux") return `unsupported platform ${platform}`;
  if (cli === "antigravity") {
    return ANTIGRAVITY_SESSION_CHECK.registered
      ? null
      : "not registered on Antigravity CLI (evidence fallback)";
  }
  const channels = SESSION_CHECK_CHANNELS[cli];
  return channels.user === null && channels.model === null ? `no output channel on ${cli}` : null;
}

// --- file I/O ---------------------------------------------------------------------

/** Raised when a hook file exists but is not a JSON object; nothing is written. */
class NotAnObjectError extends Error {}

/** Read a hook file: null when it does not exist, its object otherwise. */
function readHookFile(file: string): Obj | null {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new NotAnObjectError(`${file} is not valid JSON; it was left untouched`);
  }
  if (!isObj(value))
    throw new NotAnObjectError(`${file} is not a JSON object; it was left untouched`);
  return value;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * Copy `file` to `<file>.bak.<YYYYMMDD-HHMMSS>[.NN]`, created exclusively at
 * 0600 (the file may hold the bearer token), as backup_file in common.sh names
 * it. Returns the backup path.
 */
function backupFile(file: string, now: Date = new Date()): string {
  const data = fs.readFileSync(file);
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  for (let n = 0; n < 100; n++) {
    const bak = n === 0 ? `${file}.bak.${stamp}` : `${file}.bak.${stamp}.${pad(n)}`;
    let fd: number;
    try {
      fd = fs.openSync(bak, "wx", 0o600);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw e;
    }
    try {
      fs.writeFileSync(fd, data);
    } finally {
      fs.closeSync(fd);
    }
    return bak;
  }
  throw new Error(`no free backup name for ${file} after 99 same-second collisions`);
}

interface EditResult {
  readonly changed: boolean;
  readonly backup: string | null;
}

/**
 * Apply `edit` to a hook file: backup first, then an atomic 0600 write. No
 * write and no backup when the edit changes nothing (idempotent re-runs). A
 * missing file is edited as `{}` when `createIfMissing`, else left absent.
 */
function editHookFile(file: string, edit: (doc: Obj) => Obj, createIfMissing: boolean): EditResult {
  const current = readHookFile(file);
  if (current === null && !createIfMissing) return { changed: false, backup: null };
  const before = current ?? {};
  const next = edit(before);
  if (current !== null && JSON.stringify(next) === JSON.stringify(current))
    return { changed: false, backup: null };
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const backup = current === null ? null : backupFile(file);
  writeFileAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
  return { changed: true, backup };
}

/**
 * Copy the check into `<home>/.crewrig/hooks/session-check/` (directories 0700,
 * files 0600, each written atomically), plus a `package.json` declaring ES
 * modules. Returns the installed check's absolute path.
 */
function installTree(scriptsDir: string, home: string): string {
  const root = path.join(home, INSTALL_DIR);
  for (const dir of [root, path.join(root, "lib")]) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
  }
  for (const rel of INSTALLED_SOURCES) {
    writeFileAtomic(path.join(root, rel), fs.readFileSync(path.join(scriptsDir, rel)));
  }
  writeFileAtomic(path.join(root, "package.json"), '{"type":"module"}\n');
  return path.join(root, CHECK_FILE);
}

function tilde(p: string, home: string): string {
  return p === home || p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p;
}

function main(argv: readonly string[]): number {
  const args = parseArgs(argv);
  if (args === null) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const { cli } = args;
  const home = os.homedir();
  const file = hookFilePath(cli, home);
  const why = args.action === "register" ? exclusion(cli, args.platform) : null;
  try {
    if (args.action === "register" && why === null) {
      const check = installTree(import.meta.dirname, home);
      const command = hookCommand(process.execPath, check, cli);
      const res = editHookFile(file, (doc) => addEntry(cli, doc, command), true);
      process.stdout.write(
        `  MemPalace session check ${res.changed ? "registered in" : "already registered in"} ${tilde(file, home)}\n`,
      );
      return 0;
    }
    const res = editHookFile(file, (doc) => stripEntry(cli, doc), false);
    const reason = why === null ? "" : ` (${why})`;
    process.stdout.write(
      res.changed
        ? `  MemPalace session check removed from ${tilde(file, home)}${reason}\n`
        : `  MemPalace session check not registered${reason}\n`,
    );
    return 0;
  } catch (e) {
    process.stderr.write(
      `  ERROR: session check ${args.action} for ${cli}: ${(e as Error).message}\n`,
    );
    return 1;
  }
}

process.exitCode = main(process.argv.slice(2));
