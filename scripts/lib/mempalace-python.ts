// mempalace-python.ts — find the Python interpreter that has MemPalace
// (spec 0252 requirement 4, delta-01).
//
// The TypeScript counterpart of `detect_mempalace_python`,
// `mempalace_python_candidates`, `mempalace_pipx_home`, `console_script_python`
// and `resolve_symlink` in scripts/lib/common.sh. Synchronous, standard library
// only (spec 0240 R16). Candidate ORDER only is decided by
// `mempalacePythonCandidates`; nothing is probed there. `detectMempalacePython`
// walks the list and returns the first candidate that imports
// `mempalace.mcp_server`.
//
// `consoleScriptPython` reads a console script as TEXT — it is never executed —
// and never returns a shell (issue #1417): it understands the plain shebang, the
// `env` form, and the `#!/bin/sh` polyglot wrapper pip/distlib and uv write when
// the venv path contains a space.
//
// Platforms. Every function takes the process environment and an optional
// `host` carrying the platform, so the Windows branch is unit-testable on any
// OS. On Windows the candidate list is `WINDOWS_CANDIDATES`; its exact shape is
// to be confirmed by a measurement on the `windows-latest` job (plan step 17),
// which is why it is one constant and nothing else names a Windows spelling.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Platform selector; defaults to the running platform. */
export interface PythonHost {
  readonly platform?: NodeJS.Platform;
}

/**
 * The Windows candidate list, in one place. `venvPython` is the pipx venv
 * interpreter, relative to the venv directory; `launchers` replace `python3`
 * (absent on Windows); a launcher with a space is a command plus arguments.
 * Pipx's Windows default home is `%LOCALAPPDATA%\pipx\pipx` (platformdirs).
 */
const WINDOWS_CANDIDATES = {
  venvPython: ["Scripts", "python.exe"],
  launchers: ["python", "py -3"],
  pipxHome: ["pipx", "pipx"],
} as const;

const POSIX_LAUNCHER = "python3";
const SHELL_NAMES: ReadonlySet<string> = new Set(["sh", "bash", "dash", "zsh", "ksh"]);
const MAX_HOPS = 32;
const SCRIPT_HEAD_BYTES = 16384;

// Anchored on the ` "$0"` that follows the quoted interpreter, so a truncated
// parse cannot match (distlib/pip form, then uv form).
const RE_DQ = /^'''exec' "(\/[^"]+)" "\$0"/;
const RE_SQ = /^'''exec' '(\/(?:[^']|'\\'')*)' "\$0"/;

function isWindows(host: PythonHost | undefined): boolean {
  return (host?.platform ?? process.platform) === "win32";
}

/** A non-empty string value of `env[key]`, else `""`; values are `unknown`. */
function envString(env: NodeJS.ProcessEnv, key: string): string {
  const value: unknown = env[key];
  return typeof value === "string" ? value : "";
}

function homeOf(env: NodeJS.ProcessEnv, windows: boolean): string {
  const home = envString(env, "HOME") || (windows ? envString(env, "USERPROFILE") : "");
  return home || os.homedir();
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function isExecutableFile(target: string): boolean {
  try {
    if (!fs.statSync(target).isFile()) return false;
    fs.accessSync(target, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The name after the last `/` or `\`, without a Windows `.exe` suffix. */
function interpreterName(interp: string): string {
  const base = interp.split(/[\\/]/).pop() ?? "";
  const lower = base.toLowerCase();
  return lower.endsWith(".exe") ? lower.slice(0, -4) : base;
}

/**
 * Follow every symlink hop of `target` (capped at 32) and normalise the
 * directory component. Hand-rolled like the shell helper, so both platforms
 * report the same fact. A hop that is not a symlink ends the walk; a directory
 * that cannot be resolved leaves the walked path unchanged.
 */
export function resolveSymlink(target: string): string {
  let current = target;
  for (let hops = 0; hops < MAX_HOPS; hops++) {
    let link: unknown;
    try {
      if (!fs.lstatSync(current).isSymbolicLink()) break;
      link = fs.readlinkSync(current);
    } catch {
      break;
    }
    if (typeof link !== "string") break;
    current = path.isAbsolute(link) ? link : `${path.dirname(current)}/${link}`;
  }
  try {
    return path.join(fs.realpathSync(path.dirname(current)), path.basename(current));
  } catch {
    return current;
  }
}

/** The first two lines of a file, read as text from its first bytes only. */
function readHeadLines(script: string): string[] | undefined {
  let fd: number | undefined;
  try {
    if (!fs.statSync(script).isFile()) return undefined;
    fd = fs.openSync(script, "r");
    const buffer = Buffer.alloc(SCRIPT_HEAD_BYTES);
    const count = fs.readSync(fd, buffer, 0, SCRIPT_HEAD_BYTES, 0);
    return buffer
      .subarray(0, count)
      .toString("utf8")
      .split("\n")
      .slice(0, 2)
      .map((line) => line.replace(/\r$/, ""));
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** The interpreter a polyglot `'''exec'` line names, or `""` when it names none. */
function polyglotInterpreter(execLine: string): string {
  const dq = RE_DQ.exec(execLine);
  if (dq?.[1] !== undefined) {
    // distlib does not escape: sh would expand these, so the text is not the path.
    return /[$`\\]/.test(dq[1]) ? "" : dq[1];
  }
  const sq = RE_SQ.exec(execLine);
  // uv escapes an apostrophe in the single-quoted path as `'\''`: undo it.
  return sq?.[1] === undefined ? "" : sq[1].replaceAll("'\\''", "'");
}

/**
 * The interpreter a console script runs under, read from the script as text, or
 * `undefined` when none can be determined. A shell is never returned. A parsed
 * path is returned even when it does not exist (a pipx venv left dangling by a
 * Homebrew Python upgrade), so the caller can name and probe the broken one; the
 * sibling-`python` guess, by contrast, must be executable.
 */
export function consoleScriptPython(script: string): string | undefined {
  const lines = readHeadLines(script);
  const first = lines?.[0];
  if (lines === undefined || first === undefined || !first.startsWith("#!")) return undefined;
  const words = first
    .slice(2)
    .split(/[ \t]+/)
    .filter((word) => word !== "");
  let interp = words[0] ?? "";
  if (interpreterName(interp || "none") === "env") interp = words[1] ?? "";
  if (interp === "") return undefined;
  if (!SHELL_NAMES.has(interpreterName(interp))) return interp;

  let py = polyglotInterpreter(lines[1] ?? "");
  if (py === "") {
    const dir = path.dirname(resolveSymlink(script));
    const names = process.platform === "win32" ? ["python", "python.exe"] : ["python"];
    py = names.map((name) => path.join(dir, name)).find(isExecutableFile) ?? "";
  }
  if (py === "" || SHELL_NAMES.has(interpreterName(py))) return undefined;
  return py;
}

/**
 * The directory pipx installs venvs under, by pipx's own resolution order: a
 * non-empty `PIPX_HOME`; else the legacy `~/.local/pipx` when it exists; else
 * the platform default (`~/Library/Application Support/pipx` on macOS,
 * `%LOCALAPPDATA%\pipx\pipx` on Windows, `${XDG_DATA_HOME:-~/.local/share}/pipx`
 * elsewhere). Only directory existence is consulted; pipx is never invoked.
 */
function pipxHome(env: NodeJS.ProcessEnv, host: PythonHost | undefined): string {
  const windows = isWindows(host);
  const p = windows ? path.win32 : path.posix;
  const explicit = envString(env, "PIPX_HOME");
  if (explicit !== "") return explicit;
  const home = homeOf(env, windows);
  // Existence is asked of the host file system; the answer is spelled for `host`.
  if (isDirectory(path.join(home, ".local", "pipx"))) return p.join(home, ".local", "pipx");
  const platform = host?.platform ?? process.platform;
  if (windows) {
    const local = envString(env, "LOCALAPPDATA") || p.join(home, "AppData", "Local");
    return p.join(local, ...WINDOWS_CANDIDATES.pipxHome);
  }
  if (platform === "darwin") return p.join(home, "Library", "Application Support", "pipx");
  return p.join(envString(env, "XDG_DATA_HOME") || p.join(home, ".local", "share"), "pipx");
}

/** `command -v name`: the executable `name` resolves to on `env`'s PATH. */
function findOnPath(
  name: string,
  env: NodeJS.ProcessEnv,
  host: PythonHost | undefined,
): string | undefined {
  const windows = isWindows(host);
  if (/[\\/]/.test(name)) return isExecutableFile(name) ? name : undefined;
  const pathKey = Object.keys(env).find((k) =>
    windows ? k.toLowerCase() === "path" : k === "PATH",
  );
  const rawPath = pathKey === undefined ? "" : envString(env, pathKey);
  const exts = windows
    ? ["", ...(envString(env, "PATHEXT") || ".EXE;.CMD").split(";").filter((e) => e !== "")]
    : [""];
  for (const dir of rawPath.split(windows ? ";" : ":")) {
    if (dir === "") continue;
    for (const ext of exts) {
      const full = path.join(dir, name + ext);
      if (isExecutableFile(full)) return full;
    }
  }
  return undefined;
}

/**
 * The interpreter candidates `detectMempalacePython` considers, highest
 * priority first, without duplicates: the pipx venv under pipx's own home; the
 * interpreter of the `mempalace` console script on PATH (a shell never); then
 * `python3` — or, on Windows, the `python` and `py -3` launchers. Nothing is
 * probed here.
 */
export function mempalacePythonCandidates(
  env: NodeJS.ProcessEnv = process.env,
  host?: PythonHost,
): string[] {
  const windows = isWindows(host);
  const p = windows ? path.win32 : path.posix;
  const venvPython = windows ? WINDOWS_CANDIDATES.venvPython : (["bin", "python"] as const);
  const candidates: string[] = [p.join(pipxHome(env, host), "venvs", "mempalace", ...venvPython)];
  const script = findOnPath("mempalace", env, host);
  if (script !== undefined) {
    const fromScript = consoleScriptPython(script);
    if (fromScript !== undefined) candidates.push(fromScript);
  }
  candidates.push(...(windows ? WINDOWS_CANDIDATES.launchers : [POSIX_LAUNCHER]));
  return [...new Set(candidates.filter((c) => c !== ""))];
}

/**
 * A candidate as `[command, ...leading arguments]`; only a launcher has any (`py -3`
 * is `["py", "-3"]`). A caller that spawns the interpreter `detectMempalacePython`
 * returned spawns `command` with `[...leading, ...its own arguments]`, never the whole
 * text as one argv[0].
 */
export function splitLauncher(candidate: string): string[] {
  return (WINDOWS_CANDIDATES.launchers as readonly string[]).includes(candidate)
    ? candidate.split(" ")
    : [candidate];
}

/**
 * The first candidate that resolves and imports `mempalace.mcp_server`, or
 * `undefined`. The returned text is the candidate as listed (so `py -3` stays
 * `py -3`).
 */
export function detectMempalacePython(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const candidate of mempalacePythonCandidates(env)) {
    const [command, ...lead] = splitLauncher(candidate);
    const resolved = command === undefined ? undefined : findOnPath(command, env, undefined);
    if (resolved === undefined) continue;
    const probe = spawnSync(resolved, [...lead, "-c", "import mempalace.mcp_server"], {
      env,
      stdio: "ignore",
      windowsHide: true,
    });
    if (probe.status === 0) return candidate;
  }
  return undefined;
}
