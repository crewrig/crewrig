// chroma-state.ts — the PID-file state machine of the shared ChromaDB HTTP
// daemon and the `status` and `stop` operations built on it (spec 0252
// requirements 13, 14 and 27; plan v3 D7). It ports scripts/status-chroma-server.sh
// and scripts/stop-chroma-server.sh with every message and exit status kept.
//
// States: no PID file (the daemon is then supervisor-managed when the heartbeat
// answers), a PID file naming a live process, a PID file that does not (stale).
// A process counts as alive when `process.kill(pid, 0)` succeeds, as `kill -0`
// does in the shell; `EPERM` is not alive, as in the shell.
//
// The heartbeat goes through probe.ts, never `curl`. `curl -sf` has no timeout of
// its own and fails on an HTTP status of 400 or more; a redirect is not followed,
// so a 3xx counts as an answer. The bound used here is the 5 seconds delta-02 fixes
// for a state read, so a daemon that accepts the connection and never answers
// cannot hang `status` or `stop`.
//
// Windows has no graceful end of a console process: `stop` ends the descendants
// the process table lists, leaf first, then the process itself, by pid and
// without spawning `taskkill` (it is not a permitted tool, parent requirement 23
// as narrowed by 0215 delta-05).

import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { descendants, hasAncestor, parentTable } from "./process-tree.ts";
import { probe } from "./probe.ts";

export type EnvLike = Readonly<Record<string, string | undefined>>;

export interface Io {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export interface Endpoint {
  readonly host: string;
  readonly port: string;
}

export interface ChromaPaths {
  readonly dir: string;
  readonly pidFile: string;
  readonly logFile: string;
  readonly palaceDir: string;
}

/** The bound of one heartbeat in a state read, in milliseconds (delta-02). */
export const STATE_HEARTBEAT_TIMEOUT_MS = 5000;

/** `MEMPALACE_CHROMA_HOST` / `MEMPALACE_CHROMA_PORT`, defaulting to 127.0.0.1 / 8001. */
export function chromaEndpoint(env: EnvLike = process.env): Endpoint {
  const host = env["MEMPALACE_CHROMA_HOST"];
  const port = env["MEMPALACE_CHROMA_PORT"];
  return {
    host: host === undefined || host === "" ? "127.0.0.1" : host,
    port: port === undefined || port === "" ? "8001" : port,
  };
}

/** The files of the daemon under `~/.mempalace` (the palace honours `MEMPALACE_PALACE_PATH`). */
export function chromaPaths(env: EnvLike = process.env, home: string = homedir()): ChromaPaths {
  const dir = join(home, ".mempalace");
  const palace = env["MEMPALACE_PALACE_PATH"];
  return {
    dir,
    pidFile: join(dir, "chroma-server.pid"),
    logFile: join(dir, "chroma-server.log"),
    palaceDir: palace === undefined || palace === "" ? join(dir, "palace") : palace,
  };
}

/** True when the heartbeat answers with a status below 400 within `timeoutMs`. */
export async function heartbeatOk(ep: Endpoint, timeoutMs: number): Promise<boolean> {
  const host = ep.host.includes(":") && !ep.host.startsWith("[") ? `[${ep.host}]` : ep.host;
  const result = await probe({
    url: `http://${host}:${ep.port}/api/v2/heartbeat`,
    timeoutMs,
    maxBodyBytes: 4096,
  });
  return "status" in result && result.status < 400;
}

/** True when a process with this pid exists and may be signalled (`kill -0`). */
export function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export type PidState =
  | { readonly kind: "absent" }
  | { readonly kind: "alive"; readonly pid: number }
  | { readonly kind: "stale" };

/** Classify the PID file: absent, naming a live process, or stale (empty, unparsable, dead). */
export function pidState(pidFile: string): PidState {
  if (!existsSync(pidFile)) return { kind: "absent" };
  let text = "";
  try {
    text = readFileSync(pidFile, "utf8").trim();
  } catch {
    /* unreadable counts as empty, as `cat ... || true` does */
  }
  const pid = /^[0-9]+$/.test(text) ? Number(text) : 0;
  return processAlive(pid) ? { kind: "alive", pid } : { kind: "stale" };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function removeFile(file: string): void {
  rmSync(file, { force: true });
}

export interface StateOptions {
  readonly env: EnvLike;
  readonly io: Io;
  readonly home?: string;
}

/** `status`: exit 0 healthy, exit 1 not running or unreachable. */
export async function statusChroma(o: StateOptions): Promise<number> {
  const { host, port } = chromaEndpoint(o.env);
  const ep = { host, port };
  const state = pidState(chromaPaths(o.env, o.home).pidFile);
  if (state.kind === "absent") {
    if (await heartbeatOk(ep, STATE_HEARTBEAT_TIMEOUT_MS)) {
      o.io.out(`chroma server: HEALTHY (supervisor-managed, ${host}:${port})`);
      return 0;
    }
    o.io.out(`chroma server: NOT RUNNING (no PID file, heartbeat failed at ${host}:${port})`);
    return 1;
  }
  if (state.kind === "stale") {
    o.io.out(`chroma server: NOT RUNNING (stale PID file: ${chromaPaths(o.env, o.home).pidFile})`);
    return 1;
  }
  if (!(await heartbeatOk(ep, STATE_HEARTBEAT_TIMEOUT_MS))) {
    o.io.out(
      `chroma server: PROCESS ALIVE (PID ${state.pid}) but heartbeat FAILED at ${host}:${port}`,
    );
    return 1;
  }
  o.io.out(`chroma server: HEALTHY (PID ${state.pid}, ${host}:${port})`);
  return 0;
}

/** Depth of `pid` below `root` in `table`: the more ancestors, the further from the root. */
function depthBelow(table: ReadonlyMap<number, number>, pid: number, root: number): number {
  let depth = 0;
  for (let cur = table.get(pid); cur !== undefined && cur !== root && depth < 4096;) {
    depth += 1;
    cur = table.get(cur);
  }
  return depth;
}

/** Windows: end every descendant of `pid`, leaf first, then `pid`, by pid. */
function endTree(pid: number): void {
  const table = parentTable({ platform: "win32" });
  const below =
    table === null ? [] : descendants(table, pid).filter((p) => hasAncestor(table, p, pid));
  if (table !== null) below.sort((a, b) => depthBelow(table, b, pid) - depthBelow(table, a, pid));
  for (const target of [...below, pid]) {
    try {
      process.kill(target);
    } catch {
      /* already gone */
    }
  }
}

export interface StopOptions extends StateOptions {
  readonly platform: NodeJS.Platform;
  /** Seam for tests: the wait for a graceful end, default 5 000 ms. */
  readonly graceMs?: number;
}

/** `stop`: SIGTERM, up to five seconds, then SIGKILL; Windows ends the process tree. */
export async function stopChroma(o: StopOptions): Promise<number> {
  const paths = chromaPaths(o.env, o.home);
  const { host, port } = chromaEndpoint(o.env);
  const state = pidState(paths.pidFile);
  if (state.kind === "absent") {
    // A supervisor-managed daemon writes no PID file; it is reported, never acted on.
    if (await heartbeatOk({ host, port }, STATE_HEARTBEAT_TIMEOUT_MS)) {
      o.io.out(`chroma server: RUNNING and supervisor-managed (${host}:${port}, no PID file)`);
      o.io.out("  Not stopped: a supervised daemon restarts immediately.");
      o.io.out("  To end it, remove its supervisor unit (launchctl unload -w /");
      o.io.out("  systemctl --user disable --now mempalace-chroma-server).");
      return 0;
    }
    o.io.out(`chroma server not running (no PID file, heartbeat failed at ${host}:${port})`);
    return 0;
  }
  if (state.kind === "stale") {
    o.io.out("chroma server not running (stale PID file removed)");
    removeFile(paths.pidFile);
    return 0;
  }
  const pid = state.pid;
  if (o.platform === "win32") {
    endTree(pid);
    removeFile(paths.pidFile);
    o.io.out(`chroma server force-stopped (was PID ${pid})`);
    return 0;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* gone between the check and the signal */
  }
  const deadline = Date.now() + (o.graceMs ?? 5000);
  while (Date.now() < deadline) {
    if (!processAlive(pid)) {
      removeFile(paths.pidFile);
      o.io.out(`chroma server stopped (was PID ${pid})`);
      return 0;
    }
    await sleep(100);
  }
  o.io.err(`WARN: chroma server (PID ${pid}) did not exit after SIGTERM — sending SIGKILL.`);
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* gone */
  }
  removeFile(paths.pidFile);
  o.io.out(`chroma server force-stopped (was PID ${pid})`);
  return 0;
}
