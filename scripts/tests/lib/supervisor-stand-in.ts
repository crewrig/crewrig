// supervisor-stand-in.ts — test support for the installed launcher programs
// (spec 0252 requirements 10 to 12; plan v3 D6).
//
//   - `renderPrograms` writes the installed layout into a directory: the two
//     entries with their constants substituted and their imports rewritten, and
//     the flat `service-lib/` bundle (launcher/bundle.ts).
//   - `FIXTURE_DAEMON` is a stand-in for scripts/lib/mempalace-http-wrapper.py,
//     run as the daemon by process.execPath (Node executes it as CommonJS).
//   - `StandInSupervisor` models Restart=always / KeepAlive: the program runs in
//     its own session (setsid), a start count is kept, an unrequested end is
//     restarted after a short delay, and the two stop styles of systemd (the
//     signal goes to the whole group, then SIGKILL to the group) and launchd
//     (the signal goes to the program's PID only, then group SIGKILL) exist.
//     POSIX only.

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rewriteEntryImports, SERVICE_LIB_FILES } from "../../lib/service/launcher/bundle.ts";

const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "lib");

export const FIXTURE_DAEMON = `"use strict";
const fs = require("node:fs");
const mode = process.env.STANDIN_MODE || "run";
fs.writeFileSync(process.env.STANDIN_PID_FILE, String(process.pid));
if (mode === "exit0") process.exit(0);
if (mode === "exit3") process.exit(3);
if (mode === "ignoreterm") process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
`;

export interface Substitutions {
  readonly repoDir: string;
  readonly host: string;
  readonly port: string;
  readonly chromaHost: string;
  readonly chromaPort: string;
  readonly python: string;
}

export interface Installed {
  readonly launcher: string;
  readonly trustWrapper: string;
}

/** Write both entries and the bundle under `dir`; the fixture repo gets the daemon. */
export function renderPrograms(dir: string, s: Substitutions): Installed {
  fs.mkdirSync(path.join(dir, "service-lib"), { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}\n');
  for (const file of SERVICE_LIB_FILES) {
    fs.copyFileSync(path.join(LIB, file), path.join(dir, "service-lib", path.basename(file)));
  }
  const values: Record<string, string> = {
    __CREWRIG_REPO_DIR__: s.repoDir,
    __MCP_HOST__: s.host,
    __MCP_PORT__: s.port,
    __CHROMA_HOST__: s.chromaHost,
    __CHROMA_PORT__: s.chromaPort,
    __MEMPALACE_PYTHON__: s.python,
    __MEMPALACE_PALACE_PATH__: "",
    __LAUNCHER_SOURCE_SHA__: "0".repeat(64),
  };
  const render = (source: string, out: string): string => {
    let text = rewriteEntryImports(
      fs.readFileSync(path.join(LIB, "service", "launcher", source), "utf8"),
    );
    for (const [k, v] of Object.entries(values))
      text = text.replaceAll(`"${k}"`, JSON.stringify(v));
    const target = path.join(dir, out);
    fs.writeFileSync(target, text, { mode: 0o755 });
    return target;
  };
  const wrapperDir = path.join(s.repoDir, "scripts", "lib");
  fs.mkdirSync(wrapperDir, { recursive: true });
  fs.writeFileSync(path.join(wrapperDir, "mempalace-http-wrapper.py"), FIXTURE_DAEMON);
  return {
    launcher: render("mcp-daemon-launcher.ts", "mcp-daemon-launcher.ts"),
    trustWrapper: render("trust-wrapper.ts", "tls-exec.ts"),
  };
}

export interface RunRecord {
  readonly pid: number;
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function until(cond: () => boolean, ms: number, what: string): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}

export class StandInSupervisor {
  startCount = 0;
  readonly history: RunRecord[] = [];
  /** Whether the last stop needed the group SIGKILL. */
  groupKilled = false;
  private stopping = false;
  private current: ChildProcess | undefined;

  private readonly command: readonly string[];
  private readonly env: NodeJS.ProcessEnv;
  private readonly restartDelayMs: number;

  constructor(command: readonly string[], env: NodeJS.ProcessEnv, restartDelayMs = 100) {
    this.command = command;
    this.env = env;
    this.restartDelayMs = restartDelayMs;
  }

  get pid(): number | undefined {
    return this.current?.pid;
  }

  start(): void {
    const [program, ...args] = this.command as [string, ...string[]];
    this.startCount += 1;
    const child = spawn(program, args, { detached: true, stdio: "ignore", env: this.env });
    this.current = child;
    child.on("exit", (code, signal) => {
      this.history.push({ pid: child.pid as number, code, signal });
      if (!this.stopping) setTimeout(() => !this.stopping && this.start(), this.restartDelayMs);
    });
  }

  private groupKill(pid: number, signal: NodeJS.Signals): void {
    try {
      process.kill(-pid, signal);
    } catch {
      // the group is already gone
    }
  }

  private async waitForExit(pid: number, ms: number): Promise<boolean> {
    try {
      await until(() => this.history.some((h) => h.pid === pid), ms, "the program to end");
      return true;
    } catch {
      return false;
    }
  }

  /** systemd: signal to the whole group, then SIGKILL to the group. */
  async stopSystemd(timeoutMs: number): Promise<void> {
    const pid = this.pid as number;
    this.stopping = true;
    this.groupKill(pid, "SIGTERM");
    if (!(await this.waitForExit(pid, timeoutMs))) this.groupKilled = true;
    this.groupKill(pid, "SIGKILL");
  }

  /** launchd: the signal to the program's PID only, then group SIGKILL. */
  async stopLaunchd(timeoutMs: number): Promise<void> {
    const pid = this.pid as number;
    this.stopping = true;
    process.kill(pid, "SIGTERM");
    if (!(await this.waitForExit(pid, timeoutMs))) this.groupKilled = true;
    this.groupKill(pid, "SIGKILL");
  }

  /** Test teardown: nothing of the group survives. */
  dispose(): void {
    this.stopping = true;
    if (this.pid !== undefined) this.groupKill(this.pid, "SIGKILL");
  }
}
