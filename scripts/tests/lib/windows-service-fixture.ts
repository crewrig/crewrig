// windows-service-fixture.ts — the fixtures of scripts/tests/service-windows*.test.ts.
// Each chain is installed through the real installer (program-install.ts): the
// REAL launcher (MCP chain) or the REAL trust wrapper (ChromaDB chain) is the
// first argument of the task. Only the daemon is a stand-in, run by Node: it
// serves /healthz and /api/v2/heartbeat and records its pid, ppid and port in a
// test-owned file. A Task Scheduler task does not inherit this process's
// environment, so everything the real programs need travels through the install
// constants (repository, host, ports, python, palace) or the task arguments; the
// token sits at the palace-keyed path the real launcher derives. Files live under
// a test-owned directory, except that token (removed by `disposeChain`); nothing
// is written under ~/.crewrig/.

import { spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { derivedTokenPath } from "../../lib/service/launcher/launcher-token.ts";
import type { DaemonKind, ServiceNames } from "../../lib/service/names.ts";
import {
  installedPaths,
  installLauncherProgram,
  installTrustWrapperProgram,
  uninstallPrograms,
  type InstalledPaths,
} from "../../lib/service/program-install.ts";
import {
  chromaChain,
  currentUserId,
  mcpChain,
  renderTaskFile,
  type RenderInput,
} from "../../lib/service/windows-task-xml.ts";

// The stand-in daemon: `<node> <script> ... --port <n>`. Control file `exit0`
// makes it exit 0 on request.
const DAEMON = `const http = require("http"), fs = require("fs"), path = require("path");
const dir = __STATE_DIR__;
const state = path.join(dir, "state.json"), ctl = path.join(dir, "exit0");
const a = process.argv, port = Number(a[a.indexOf("--port") + 1]);
const srv = http.createServer((q, r) => { r.statusCode = q.url === "/healthz" || q.url === "/api/v2/heartbeat" ? 200 : 404; r.end("ok"); });
srv.listen(port, "127.0.0.1", () => fs.writeFileSync(state, JSON.stringify({ pid: process.pid, ppid: process.ppid, port })));
setInterval(() => { if (fs.existsSync(ctl)) { fs.rmSync(ctl); process.exit(0); } }, 200);
`;

export interface StandInChain {
  readonly kind: DaemonKind;
  readonly names: ServiceNames;
  readonly task: string;
  readonly dir: string;
  /** Where the stand-in daemon writes state.json and reads the exit0 control file. */
  readonly stateDir: string;
  /** The first-argument program: the real launcher (MCP) or the real trust wrapper (ChromaDB). */
  readonly program: string;
  readonly paths: InstalledPaths;
  readonly input: RenderInput;
  /** The rendered definition on disk, ready for `install`. */
  readonly definitionPath: string;
  /** The token file the real launcher derives (MCP chain), removed by `disposeChain`. */
  readonly tokenFile: string | null;
  /** The loopback ChromaDB heartbeat stub of the launcher's wait (MCP chain). */
  readonly stub: http.Server | null;
}

/** A loopback port that is free right now (checked by binding it). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

function startStub(port: number): Promise<http.Server> {
  const srv = http.createServer((q, r) => {
    r.statusCode = q.url === "/api/v2/heartbeat" ? 200 : 404;
    r.end("{}");
  });
  return new Promise((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(port, "127.0.0.1", () => resolve(srv));
  });
}

function token48(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: 48 }, () => alphabet[randomInt(alphabet.length)]).join("");
}

export function runId(): string {
  return process.env["GITHUB_RUN_ID"] ?? String(Date.now());
}

/** Install one real chain under a throwaway leaf, through the real installer's program step. */
export async function makeChain(
  kind: DaemonKind,
  root: string,
  id: string,
  leafTag = kind === "mcp" ? "mcp" : "chroma",
): Promise<StandInChain> {
  const leaf = `mempalace-test-${leafTag}-${id}`;
  const dir = path.join(root, leaf);
  fs.mkdirSync(dir, { recursive: true });
  const paths = installedPaths(dir, {
    MEMPALACE_MCP_LAUNCHER_PATH: path.join(dir, "mcp-daemon-launcher.sh"),
    MEMPALACE_TLS_EXEC_PATH: path.join(dir, "tls-exec.sh"),
  });
  const host = "127.0.0.1";
  const port = await freePort();
  let stateDir = dir;
  let tokenFile: string | null = null;
  let stub: http.Server | null = null;
  let chain;
  if (kind === "mcp") {
    const repoDir = path.join(dir, "repo");
    stateDir = repoDir;
    const palace = path.join(dir, "palace");
    fs.mkdirSync(palace, { recursive: true });
    fs.mkdirSync(path.join(repoDir, "scripts", "lib"), { recursive: true });
    fs.writeFileSync(
      path.join(repoDir, "scripts", "lib", "mempalace-http-wrapper.py"),
      DAEMON.replace("__STATE_DIR__", JSON.stringify(repoDir)),
    );
    // The launcher reads MEMPALACE_MCP_TOKEN_FILE, which a task cannot inherit; the
    // palace constant makes it derive this path, with the real derivation.
    tokenFile = derivedTokenPath(palace, os.homedir());
    fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
    fs.writeFileSync(tokenFile, `${token48()}\n`);
    const chromaPort = await freePort();
    stub = await startStub(chromaPort);
    installLauncherProgram({
      paths,
      repoDir,
      host,
      port: String(port),
      chromaHost: host,
      chromaPort: String(chromaPort),
      python: process.execPath,
      palacePath: palace,
    });
    chain = mcpChain(process.execPath, paths.launcher);
  } else {
    const chroma = path.join(dir, "chroma.cjs");
    fs.writeFileSync(chroma, DAEMON.replace("__STATE_DIR__", JSON.stringify(dir)));
    installTrustWrapperProgram({ paths });
    chain = chromaChain({
      nodePath: process.execPath,
      wrapper: paths.wrapper,
      python: process.execPath,
      chroma,
      palacePath: dir,
      host,
      port: String(port),
    });
  }
  const task = `\\CrewRig\\${leaf}`;
  const input: RenderInput = { chain, taskUri: task, userId: currentUserId() };
  const definitionPath = path.join(dir, "task.xml");
  fs.writeFileSync(definitionPath, renderTaskFile(input));
  return {
    kind,
    names: { kind, label: leaf, unit: leaf },
    task,
    dir,
    stateDir,
    program: chain.programPath,
    paths,
    input,
    definitionPath,
    tokenFile,
    stub,
  };
}

/** Remove what the chain put outside its directory and stop its stub; the installed programs go too. */
export async function disposeChain(c: StandInChain): Promise<void> {
  uninstallPrograms(c.kind, c.paths, []);
  if (c.tokenFile !== null) fs.rmSync(path.dirname(c.tokenFile), { recursive: true, force: true });
  if (c.stub !== null) await new Promise<void>((r) => c.stub?.close(() => r()));
}

/** The command line of a process, read through PowerShell (empty when it cannot be read). */
export function commandLineOf(pid: number): string {
  const run = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 30_000 },
  );
  return typeof run.stdout === "string" ? run.stdout.trim() : "";
}

export interface DaemonState {
  pid: number;
  ppid: number;
  port: number;
}

export function readState(c: StandInChain): DaemonState | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(c.stateDir, "state.json"), "utf8")) as DaemonState;
  } catch {
    return null;
  }
}

export function clearState(c: StandInChain): void {
  fs.rmSync(path.join(c.stateDir, "state.json"), { force: true });
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function waitFor<T>(
  what: string,
  fn: () => T | null | false,
  timeoutMs: number,
  stepMs = 500,
): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v !== null && v !== false) return v;
    if (Date.now() > end) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

export function healthz(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/healthz", timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

/** What sits under ~/.crewrig/ (null when it does not exist). */
export function crewrigHomeListing(): string[] | null {
  const home = path.join(os.homedir(), ".crewrig");
  try {
    return fs.readdirSync(home, { recursive: true }).map(String).sort();
  } catch {
    return null;
  }
}

export function measure(line: string): void {
  console.log(`MEASURE: ${line}`);
}
