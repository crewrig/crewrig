// launch-windows.ts — starting the wrapped command on Windows without a shell
// (spec 0248 R22, plan decisions D1 and D2).
//
// Everything here is pure: `platform`, `env` and `isFile` are parameters, so the
// resolution and the argument allowlist are tested on any host.
//
// Resolution is ours, because Node.js on Windows hands a bare name to
// `CreateProcess`, which searches the current directory first (D2: a planted
// `npm.cmd` or `git.exe` in a worktree must not be run). A name with a
// separator is resolved against the toplevel; a bare name is searched through
// `PATH` only, crossed with `PATHEXT`. `.exe` and `.com` are started directly.
// A `.cmd` or `.bat` cannot be started without `cmd.exe`, so it goes through
// `%ComSpec% /d /s /c "<quoted path> <args>"`, and only when `cmd.exe` has
// nothing to interpret: a path free of its metacharacters and arguments drawn
// from a small allowlist. Otherwise the command is refused (D1 fallback), never
// handed to a shell that would read argument characters as syntax.

import fs from "node:fs";
import path from "node:path";
import type { Env } from "./types.ts";

const win = path.win32;

/** Only these characters may appear in an argument handed to `cmd.exe`. */
const SAFE_ARGUMENT = /^[A-Za-z0-9_.,:;=+@/\\-]+$/;

/**
 * What `cmd.exe` interprets even inside quotes, or that a path has no business
 * holding: `%` and `!` expand variables, `"` ends the quoting, `& | < > ^` are
 * its operators, and control characters are never part of a file name.
 * A space is allowed (`Program Files`), and so are parentheses (`(x86)`): within
 * the quotes this wrapper always adds they are literal.
 */
const UNSAFE_PATH = /[%!"&|<>^\u0000-\u001f]/;

const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

export interface ResolveInput {
  readonly platform: NodeJS.Platform;
  readonly env: Env;
  /** True when the path names an existing regular file. */
  readonly isFile: (candidate: string) => boolean;
}

export interface WindowsLaunchInput extends ResolveInput {
  /** The directory a name with a separator is resolved against. */
  readonly toplevel: string;
}

/** What to start: a file and its arguments, or the reason the command is refused. */
export type WindowsPlan =
  | {
      readonly kind: "spawn";
      readonly file: string;
      readonly args: readonly string[];
      readonly verbatim: boolean;
    }
  | { readonly kind: "missing" }
  | { readonly kind: "refused"; readonly message: string };

export function defaultIsFile(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/** An environment variable by name, case-insensitively as Windows reads it. */
function envValue(env: Env, name: string): string | undefined {
  const exact = env[name];
  if (exact !== undefined) return exact;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(env)) {
    if (key.toLowerCase() === wanted && value !== undefined) return value;
  }
  return undefined;
}

function pathExtensions(env: Env): string[] {
  const raw = envValue(env, "PATHEXT");
  const source = raw === undefined || raw.trim() === "" ? DEFAULT_PATHEXT : raw;
  return source
    .split(";")
    .map((extension) => extension.trim())
    .filter((extension) => extension.startsWith(".") && extension.length > 1);
}

/** The file names to try for `name`: as written when its extension is executable, then with each extension appended. */
function candidates(name: string, env: Env): string[] {
  const extensions = pathExtensions(env);
  const known = new Set(extensions.map((extension) => extension.toLowerCase()));
  const own = known.has(win.extname(name).toLowerCase()) ? [name] : [];
  return [...own, ...extensions.map((extension) => `${name}${extension}`)];
}

/** `PATH` entries that name a directory unambiguously: empty and relative entries stand for the current directory and are skipped (D2). */
function pathDirectories(env: Env): string[] {
  const raw = envValue(env, "PATH") ?? "";
  return raw
    .split(";")
    .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
    .filter((entry) => entry !== "" && win.isAbsolute(entry));
}

/**
 * A bare command name searched through `PATH` only, never the current
 * directory, crossed with `PATHEXT`. Returns the first file found, or
 * `undefined`. Not win32: the name is returned unchanged, because `execvp`
 * already searches `PATH` alone there. Exported for any caller that must keep
 * `spawnSync("git")` from running a planted `git.exe` on Windows.
 */
export function resolveOnPath(name: string, input: ResolveInput): string | undefined {
  if (input.platform !== "win32") return name;
  for (const directory of pathDirectories(input.env)) {
    for (const candidate of candidates(name, input.env)) {
      const full = win.join(directory, candidate);
      if (input.isFile(full)) return full;
    }
  }
  return undefined;
}

/**
 * Resolve the first word of the wrapped command. A name holding a separator
 * (`/` or `\`) is a path, resolved against the toplevel unless absolute; any
 * other name goes through `resolveOnPath`. Returns `undefined` when nothing
 * matches. Not win32: the name is returned unchanged.
 */
export function resolveCommand(name: string, input: WindowsLaunchInput): string | undefined {
  if (input.platform !== "win32") return name;
  if (!/[\\/]/.test(name)) return resolveOnPath(name, input);
  const base = win.isAbsolute(name) ? win.normalize(name) : win.join(input.toplevel, name);
  for (const candidate of [base, ...candidates(base, input.env)]) {
    if (candidate === base && win.extname(base) === "") continue;
    if (input.isFile(candidate)) return candidate;
  }
  return undefined;
}

/** The shell interpreter: `%ComSpec%`, else `System32\cmd.exe`; never a bare name, which `CreateProcess` would search for in the current directory. */
function comSpec(env: Env): string {
  const configured = envValue(env, "ComSpec");
  if (configured !== undefined && win.isAbsolute(configured)) return configured;
  const root = envValue(env, "SystemRoot") ?? envValue(env, "windir") ?? "C:\\Windows";
  return win.join(root, "System32", "cmd.exe");
}

/** The plan to start `argv` on Windows; the first refusal wins and nothing has been run. */
export function planWindowsLaunch(argv: readonly string[], input: WindowsLaunchInput): WindowsPlan {
  const name = argv[0] ?? "";
  const rest = argv.slice(1);
  const resolved = resolveCommand(name, input);
  if (resolved === undefined) return { kind: "missing" };

  const extension = win.extname(resolved).toLowerCase();
  if (extension === ".exe" || extension === ".com") {
    return { kind: "spawn", file: resolved, args: rest, verbatim: false };
  }
  if (extension !== ".cmd" && extension !== ".bat") {
    return refused(
      name,
      `it resolves to '${resolved}', which is neither an executable nor a .cmd or .bat script`,
    );
  }

  if (UNSAFE_PATH.test(resolved)) {
    return refused(name, `its path '${resolved}' holds a character cmd.exe would interpret`);
  }
  for (const [index, argument] of rest.entries()) {
    if (!SAFE_ARGUMENT.test(argument)) {
      return refused(
        name,
        `argument ${index + 1} (${JSON.stringify(argument)}) is not a run of letters, digits and _.,:;=+@/\\- ` +
          "and a .cmd or .bat script can only be started through cmd.exe, which would read it as syntax",
      );
    }
  }
  // `/s` strips the first and the last quote of the string that follows `/c`, so
  // the quoted path survives it; `windowsVerbatimArguments` keeps Node.js from
  // quoting that string a second time.
  const line = `"${[`"${resolved}"`, ...rest].join(" ")}"`;
  return {
    kind: "spawn",
    file: comSpec(input.env),
    args: ["/d", "/s", "/c", line],
    verbatim: true,
  };
}

function refused(name: string, reason: string): WindowsPlan {
  return {
    kind: "refused",
    message:
      `cannot run '${name}' on Windows: ${reason}. ` +
      "Refusing rather than starting a shell; no claim was taken.",
  };
}
