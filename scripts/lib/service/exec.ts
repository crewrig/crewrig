// exec.ts — the bounded spawn of a SERVICE MANAGER and of the daemon launch
// (spec 0252 requirements 5 and 27; plan v3 D1).
//
// Three tools only: launchctl, systemctl, schtasks. No shell is ever involved:
// the program is an executable path and the arguments are an array, so nothing
// is word-split, expanded or resolved through a shell. Every call has a
// timeout and captures stdout, stderr and the exit status. No parameter of any
// function here carries a token, and variables whose name suggests a secret
// are dropped from the child environment.
//
// This file inspects no listener and no process table: that concern lives in
// os-inspect.ts, and nothing here has a path to it (asserted by a test that
// scans this file).
//
// TEST SEAMS — two environment variables, read ONLY on POSIX (ignored on win32) and never set
// by production code. The black-box oracles of the shell tools fake the operating system with a
// `uname -s` stub and `launchctl`/`systemctl` stubs on PATH; that works across a process
// boundary for the shell but not for TypeScript, which reads `process.platform` and runs the
// absolute `/bin/launchctl` or `/usr/bin/systemctl`. The oracle harnesses therefore export:
//   CREWRIG_TEST_SERVICE_PLATFORM  `darwin`, `linux` or `freebsd` (the oracle's unsupported-OS
//                                  case): the platform `servicePlatform()`
//                                  returns in place of `process.platform` (backend selection
//                                  and the entries' OS branch);
//   CREWRIG_TEST_SERVICE_BIN_DIR   a directory: when `<dir>/<tool>` exists, `executableFor`
//                                  returns it, ahead of the absolute OS path (the
//                                  `setExecutableOverride` seam still comes first).

import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";

export type ManagerTool = "launchctl" | "systemctl" | "schtasks";

export const MANAGER_TOOLS: readonly ManagerTool[] = ["launchctl", "systemctl", "schtasks"];

/** How a call ended. `ok` is exit status 0; `nonzero` any other status. */
export type ExecKind = "ok" | "nonzero" | "timeout" | "absent" | "error";

export interface ExecResult {
  readonly kind: ExecKind;
  /** The exit status, or `null` when the program did not run to completion. */
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** The spawn error code (`ENOENT`, `ETIMEDOUT`, ...), when there was one. */
  readonly code?: string;
}

export interface RunOptions {
  /** Whole-call bound in milliseconds. Default 30 000. */
  readonly timeoutMs?: number;
  /** Cap on captured stdout and on captured stderr, in bytes. Default 1 MiB. */
  readonly maxBufferBytes?: number;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_BUFFER_BYTES = 1024 * 1024;

/**
 * The platform the service code selects its behaviour on: `process.platform`, except that on
 * POSIX the test seam `CREWRIG_TEST_SERVICE_PLATFORM` (`darwin`, `linux`, or `freebsd` for the unsupported-OS oracle case) replaces it.
 * Ignored on win32, and any other value is ignored.
 */
export function servicePlatform(
  env: Readonly<Record<string, string | undefined>> = process.env,
): NodeJS.Platform {
  if (process.platform === "win32") return process.platform;
  const fake = env["CREWRIG_TEST_SERVICE_PLATFORM"];
  return fake === "darwin" || fake === "linux" || fake === "freebsd" ? fake : process.platform;
}

const overrides = new Map<ManagerTool, string>();

/**
 * Test-only seam: run `executable` instead of the real tool named `tool`.
 * Pass `null` to remove the override. Production code never calls it.
 */
export function setExecutableOverride(tool: ManagerTool, executable: string | null): void {
  if (executable === null) overrides.delete(tool);
  else overrides.set(tool, executable);
}

/**
 * The executable that `tool` resolves to: the seam, else the test bin-dir stub, else the operating system's own path.
 * A bare name makes Windows look in the current directory first (a planted binary runs),
 * and `status` and `install` run from any directory; so on Windows `schtasks` is the one in
 * `%SystemRoot%\\System32`, and on macOS `launchctl` is `/bin/launchctl`. On Linux
 * `systemctl` is the first of `/usr/bin` and `/bin` that exists, else the bare name (a
 * distribution that puts it elsewhere is still served).
 */
export function executableFor(
  tool: ManagerTool,
  platform: NodeJS.Platform = servicePlatform(),
  env: Readonly<Record<string, string | undefined>> = process.env,
  exists: (file: string) => boolean = existsSync,
): string {
  const seam = overrides.get(tool);
  if (seam !== undefined) return seam;
  const binDir = env["CREWRIG_TEST_SERVICE_BIN_DIR"];
  if (process.platform !== "win32" && binDir !== undefined && binDir !== "") {
    const stub = `${binDir.replace(/\/+$/, "")}/${tool}`;
    if (exists(stub)) return stub;
  }
  if (platform === "win32" && tool === "schtasks") {
    const root = env["SystemRoot"] ?? env["windir"] ?? "C:\\Windows";
    return `${root}\\System32\\schtasks.exe`;
  }
  if (platform === "darwin" && tool === "launchctl") return "/bin/launchctl";
  if (platform === "linux" && tool === "systemctl") {
    return ["/usr/bin/systemctl", "/bin/systemctl"].find(exists) ?? tool;
  }
  return tool;
}

const SECRET_KEY_RE = /token|secret|password|bearer|api[_-]?key|credential/i;

/** The child environment: the given one (default: ours) without secret-looking keys. */
export function scrubbedEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && !SECRET_KEY_RE.test(key)) out[key] = value;
  }
  return out;
}

function classify(status: number | null, code: string | undefined): ExecKind {
  if (code === "ETIMEDOUT") return "timeout";
  if (code === "ENOENT") return "absent";
  if (code !== undefined || status === null) return "error";
  return status === 0 ? "ok" : "nonzero";
}

function boundedMs(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

/** Run a service manager to completion, bounded. Never throws. */
export function runManager(
  tool: ManagerTool,
  args: readonly string[],
  options: RunOptions = {},
): ExecResult {
  const run = spawnSync(executableFor(tool), [...args], {
    shell: false,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: boundedMs(options.timeoutMs),
    killSignal: "SIGKILL",
    maxBuffer: options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES,
    windowsHide: true,
    env: scrubbedEnv(options.env),
  });
  const raw: unknown = run.error;
  const code =
    raw instanceof Error && "code" in raw && typeof raw.code === "string" ? raw.code : undefined;
  const stdout: unknown = run.stdout;
  const stderr: unknown = run.stderr;
  return {
    kind: classify(run.status, code),
    status: run.status,
    stdout: typeof stdout === "string" ? stdout : "",
    stderr: typeof stderr === "string" ? stderr : "",
    ...(code === undefined ? {} : { code }),
  };
}

export interface LaunchOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Append the daemon's stdout and stderr to this file; discarded when absent. */
  readonly logFile?: string;
  /**
   * Pass `env` to the daemon as given. By default the secret-looking keys are dropped; the
   * ChromaDB daemon is launched as the shell launched it, with the user's whole environment
   * (a model-hub or proxy credential it needs is not ours to remove).
   */
  readonly unscrubbedEnv?: boolean;
}

/**
 * Start the daemon detached and return its PID (`undefined` when the program
 * could not be started). The caller owns the PID file; the child outlives us.
 */
export function launchDaemon(
  program: string,
  args: readonly string[],
  options: LaunchOptions = {},
): { readonly pid: number | undefined } {
  const fd = options.logFile === undefined ? null : openSync(options.logFile, "a", 0o600);
  try {
    const child = spawn(program, [...args], {
      shell: false,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", fd ?? "ignore", fd ?? "ignore"],
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      env: options.unscrubbedEnv === true ? { ...options.env } : scrubbedEnv(options.env),
    });
    child.on("error", () => {});
    child.unref();
    return { pid: child.pid };
  } finally {
    if (fd !== null) closeSync(fd);
  }
}
