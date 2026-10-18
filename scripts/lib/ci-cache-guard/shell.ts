// shell.ts — the one permitted shell spawn of ci-cache-guard and ci-changeset-coverage (spec 0262
// req 4): the wrapped commands run through `bash -c`, so builtins, functions and the shell's own
// "command not found" diagnostic behave as under the shell twin.
//
// Usage: library. Exit codes: not applicable. Finding-line format: not applicable.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Script text whose first statement sits on line `line`. A bash diagnostic names its line, so
 * padding with line feeds makes the twin print the same `<script>: line N:` prefix as the shell.
 */
export function atLine(line: number, body: string): string {
  return `${"\n".repeat(line - 1)}${body}`;
}

/** The status bash reports: the exit status, or 128 + the signal number for a killed child. */
export function statusOf(status: number | null, signal: NodeJS.Signals | null): number {
  if (status !== null) return status;
  if (signal !== null) return 128 + (os.constants.signals[signal] ?? 1);
  return 1;
}

/** `$0` the shell script would show: the twin's own path with the `.sh` extension. */
export function shellName(entry: string): string {
  return entry.replace(/\.ts$/, ".sh");
}

function envGet(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [k, v] of Object.entries(env))
    if (k.toLowerCase() === wanted && v !== undefined && v !== "") return v;
  return undefined;
}

/**
 * The `bash.exe` to run on Windows, or null. Pure: `env` and `exists` are injected. Preference:
 * (1) a `bash.exe` on the PARENT PATH outside System32, Sysnative and WindowsApps (the System32
 * one is the WSL launcher, not a shell), (2) Git for Windows under %ProgramFiles%,
 * %ProgramW6432% and %ProgramFiles(x86)% (`bin` then `usr\bin`), (3) `..\bin\bash.exe` of the
 * directory holding a `git.exe` found on PATH.
 */
export function resolveBashWin(
  env: NodeJS.ProcessEnv,
  exists: (file: string) => boolean,
): string | null {
  const w = path.win32;
  const root = envGet(env, "SystemRoot") ?? envGet(env, "windir") ?? "C:\\Windows";
  const norm = (p: string): string => w.normalize(p).toLowerCase().replace(/\\+$/, "");
  const banned = [norm(w.join(root, "System32")), norm(w.join(root, "Sysnative"))];
  const excluded = (dir: string): boolean => {
    const d = norm(dir);
    return (
      banned.some((b) => d === b || d.startsWith(`${b}\\`)) || d.split("\\").includes("windowsapps")
    );
  };
  const dirs = (envGet(env, "PATH") ?? "")
    .split(";")
    .map((d) => d.replace(/^"|"$/g, ""))
    .filter((d) => d !== "" && !excluded(d));
  for (const d of dirs) {
    const candidate = w.join(d, "bash.exe");
    if (exists(candidate)) return candidate;
  }
  for (const name of ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"]) {
    const pf = envGet(env, name);
    if (pf === undefined) continue;
    for (const rel of ["bin", "usr\\bin"]) {
      const candidate = w.join(pf, "Git", rel, "bash.exe");
      if (exists(candidate)) return candidate;
    }
  }
  for (const d of dirs) {
    if (!exists(w.join(d, "git.exe"))) continue;
    const candidate = w.join(d, "..", "bin", "bash.exe");
    if (exists(candidate)) return candidate;
  }
  return null;
}

/** The bash to spawn: plain `bash` off Windows, the resolved one on Windows; null when none. */
export function bashPath(env: NodeJS.ProcessEnv = process.env): string | null {
  if (process.platform !== "win32") return "bash";
  return resolveBashWin(env, (f) => fs.statSync(f, { throwIfNoEntry: false })?.isFile() === true);
}

/** The one `Error:` line printed when no bash exists. */
export const NO_BASH = "Error: no bash found (install Git for Windows or put its bash.exe on PATH)";
