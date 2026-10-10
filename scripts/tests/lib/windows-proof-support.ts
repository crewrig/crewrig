// windows-proof-support.ts — the pure and spawn helpers of windows-install-proof.ts (spec 0255 R28):
// interpreter resolution through the PARENT environment, the hermetic child environment, and the
// diagnostic record of one entry run. Importable on any host: platform data come in as parameters.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import type { SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import path from "node:path";

import { resolveOnPath } from "../../lib/worktree-claim/launch-windows.ts";
import type { ResolveInput } from "../../lib/worktree-claim/launch-windows.ts";

export type Shell = "pwsh" | "cmd";
export interface Run {
  readonly entry: string;
  readonly status: number | null;
  readonly out: string;
  readonly err: string;
  readonly ms: number;
  /** Command line, spawn error, status, signal, and the head of stdout and stderr. */
  readonly detail: string;
}
export const WIN = process.platform === "win32";
const win = path.win32;

export interface Interpreters {
  readonly pwsh: string;
  readonly cmd: string;
  /** How each interpreter was found, for the diagnostic banner. */
  readonly notes: readonly string[];
}

function envGet(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(env))
    if (key.toLowerCase() === wanted && value !== undefined && value !== "") return value;
  return undefined;
}

/**
 * Locate the Windows interpreters through the PARENT environment, before the child's PATH is
 * narrowed: libuv resolves a bare executable name against the CHILD's PATH, which would miss `pwsh`.
 * `pwsh` (PowerShell 7) from PATH x PATHEXT, else Windows PowerShell under System32; `cmd.exe`
 * from %ComSpec%, else System32. Pure: platform data come in as `env` and `isFile`.
 */
export function resolveInterpreters(input: ResolveInput): Interpreters {
  if (input.platform !== "win32") return { pwsh: "pwsh", cmd: "cmd.exe", notes: ["not win32"] };
  const root = envGet(input.env, "SystemRoot") ?? envGet(input.env, "windir") ?? "C:\\Windows";
  const system32 = win.join(root, "System32");
  const found = resolveOnPath("pwsh", input);
  const legacy = win.join(system32, "WindowsPowerShell", "v1.0", "powershell.exe");
  const pwsh = found ?? (input.isFile(legacy) ? legacy : undefined);
  if (pwsh === undefined)
    throw new Error(`no PowerShell: pwsh is not on PATH and ${legacy} does not exist`);
  const comSpec = envGet(input.env, "ComSpec");
  const useComSpec = comSpec !== undefined && win.isAbsolute(comSpec) && input.isFile(comSpec);
  const cmd = useComSpec ? comSpec : win.join(system32, "cmd.exe");
  const notes = [
    `pwsh = ${pwsh} (${found === undefined ? "System32 fallback" : "parent PATH"})`,
    `cmd = ${cmd} (${useComSpec ? "ComSpec" : "System32 fallback"})`,
  ];
  return { pwsh, cmd, notes };
}

/** The child's hermetic PATH: the stubs, the system directory, node on Windows. */
export function sandboxPath(bin: string): string {
  const root = envGet(process.env, "SystemRoot") ?? envGet(process.env, "windir") ?? "C:\\Windows";
  const sys = WIN
    ? [path.dirname(process.execPath), win.join(root, "System32")]
    : ["/usr/bin", "/bin"];
  return [bin, ...sys].join(path.delimiter);
}

/** Set `key` on `env`, dropping case-variants first: Windows env names are case-insensitive ("Path"). */
export function setEnv(env: NodeJS.ProcessEnv, key: string, value: string): void {
  for (const k of Object.keys(env))
    if (WIN ? k.toLowerCase() === key.toLowerCase() : k === key) delete env[k];
  env[key] = value;
}

const head = (text: string): string => (text.length > 2000 ? `${text.slice(0, 2000)}...` : text);

/** An assertion message that carries the whole diagnostic of the run. */
export const why = (r: Run, what: string): string => `${r.entry}: ${what}\n${r.detail}`;

export function expectStatus(r: Run, want: number): void {
  assert.equal(r.status, want, why(r, `expected exit status ${want}`));
}

export interface EntrySpawn {
  readonly entry: string;
  readonly script: string;
  readonly args: string[];
  readonly shell: Shell;
  readonly env: Record<string, string>;
  readonly home: string;
  readonly bin: string;
  readonly interpreters: Interpreters;
}

/** Run an entry (POSIX: node directly; Windows: through the absolute interpreter) and record it. */
export function spawnEntry(o: EntrySpawn): Run {
  const full: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ["REPO_DIR", "CLAUDE_CONFIG_DIR"]) delete full[key];
  for (const [key, value] of Object.entries({ HOME: o.home, USERPROFILE: o.home, ...o.env }))
    setEnv(full, key, value);
  setEnv(full, "PATH", sandboxPath(o.bin)); // hermetic: no real claude, copilot or agy
  const started = process.hrtime.bigint();
  const argv = [process.execPath, o.script, ...o.args];
  const ps = `& ${argv.map((a) => `'${a.replaceAll("'", "''")}'`).join(" ")}; exit $LASTEXITCODE`;
  const cmd = `"${argv.map((a) => `"${a}"`).join(" ")}"`;
  const base = { encoding: "utf8", env: full, windowsHide: true } as const;
  const spawned: [string, string[], SpawnSyncOptionsWithStringEncoding] = !WIN
    ? [process.execPath, argv.slice(1), base]
    : o.shell === "cmd"
      ? [o.interpreters.cmd, ["/d", "/s", "/c", cmd], { ...base, windowsVerbatimArguments: true }]
      : [o.interpreters.pwsh, ["-NoProfile", "-NonInteractive", "-Command", ps], base];
  const res = spawnSync(spawned[0], spawned[1], spawned[2]);
  const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
  const out = res.stdout ?? "";
  const err = res.stderr ?? "";
  const detail = [
    `  command: ${JSON.stringify([spawned[0], ...spawned[1]])}`,
    `  spawn error: ${res.error?.message ?? "none"}`,
    `  status: ${res.status}, signal: ${res.signal}`,
    `  stdout: ${JSON.stringify(head(out))}`,
    `  stderr: ${JSON.stringify(head(err))}`,
  ].join("\n");
  return { entry: o.entry, status: res.status, out, err, ms, detail };
}
