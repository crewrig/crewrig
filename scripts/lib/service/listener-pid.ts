// listener-pid.ts — the PID of the listener on the daemon port (spec 0252
// requirement 16; PLAN v3 D8). Port of `mcp_listener_pid` (scripts/lib/common.sh).
//
// Linux reads /proc/net/tcp{,6} (state 0A) and the socket inodes under
// /proc/<pid>/fd; macOS and Windows parse the text os-inspect.ts returns. This
// file spawns nothing. `null` means "no listener found or undeterminable": the
// owner verdict treats both as UNVERIFIABLE, as the shell's empty string was.

import { servicePlatform } from "./exec.ts";
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { listenerTable } from "./os-inspect.ts";

export interface ListenerOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Root of the proc file system; a test points it at a fixture tree. */
  procRoot?: string;
}

/**
 * Seam semantics of MEMPALACE_MCP_LISTENER_PID / MEMPALACE_MCP_EXPECTED_PID:
 * set-but-empty (or not a PID) is undeterminable, unset means look up.
 */
export function pidSeam(
  env: NodeJS.ProcessEnv,
  name: string,
): { set: false } | { set: true; pid: number | null } {
  const value = env[name];
  if (value === undefined) return { set: false };
  return { set: true, pid: /^[0-9]+$/.test(value.trim()) ? Number(value.trim()) : null };
}

function portOf(address: string): number {
  const at = Math.max(address.lastIndexOf("."), address.lastIndexOf(":"));
  return /^[0-9]+$/.test(address.slice(at + 1)) ? Number(address.slice(at + 1)) : -1;
}

/** Inodes of the sockets in LISTEN state (0A) on `port` in one /proc/net/tcp text. */
export function parseProcNetTcp(text: string, port: number): string[] {
  const inodes: string[] = [];
  for (const line of text.split("\n").slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 10 || f[3] !== "0A") continue;
    if (Number.parseInt(f[1].split(":")[1] ?? "", 16) === port && f[9] !== "0") inodes.push(f[9]);
  }
  return inodes;
}

function linuxListener(port: number, root: string): number | null {
  const inodes = new Set<string>();
  for (const table of ["net/tcp", "net/tcp6"]) {
    try {
      for (const i of parseProcNetTcp(readFileSync(join(root, table), "utf8"), port)) inodes.add(i);
    } catch {
      if (table === "net/tcp") return null;
    }
  }
  if (inodes.size === 0) return null;
  let pids: number[];
  try {
    pids = readdirSync(root)
      .filter((n) => /^[0-9]+$/.test(n))
      .map(Number)
      .sort((a, b) => a - b);
  } catch {
    return null;
  }
  for (const pid of pids) {
    let fds: string[];
    try {
      fds = readdirSync(join(root, String(pid), "fd"));
    } catch {
      continue; // another user's process or one that just exited
    }
    for (const fd of fds) {
      try {
        const m = /^socket:\[([0-9]+)\]$/.exec(readlinkSync(join(root, String(pid), "fd", fd)));
        if (m?.[1] !== undefined && inodes.has(m[1])) return pid;
      } catch {
        /* the descriptor closed between the listing and the read */
      }
    }
  }
  return null;
}

/** macOS `netstat -anv -p tcp`: columns located by the header, the PID from `process:pid`. */
export function parseNetstatDarwin(text: string, port: number): number | null {
  let local = -1;
  let state = -1;
  let withPid = false;
  for (const line of text.split("\n")) {
    const tokens = line.trim().split(/\s+/);
    if (tokens[0] === "Proto") {
      const header = tokens
        .join(" ")
        .replace("Local Address", "Local")
        .replace("Foreign Address", "Foreign");
      const cols = header.split(" ");
      local = cols.indexOf("Local");
      state = cols.indexOf("(state)");
      withPid = cols.includes("process:pid");
      continue;
    }
    if (!withPid || local < 0 || state < 0 || !(tokens[0] ?? "").startsWith("tcp")) continue;
    if (tokens[state] !== "LISTEN" || portOf(tokens[local] ?? "") !== port) continue;
    const proc = tokens.slice(state + 1).find((t) => /:[0-9]+$/.test(t));
    const pid = proc === undefined ? null : Number(proc.slice(proc.lastIndexOf(":") + 1));
    if (pid !== null && pid > 0) return pid;
  }
  return null;
}

/**
 * Windows `netstat -ano` (TCP then TCPv6 text): a listening row has a foreign
 * port of 0, which holds under every display language, where the state word
 * ("LISTENING") is localized. The PID is the last column.
 */
export function parseNetstatWindows(text: string, port: number): number | null {
  for (const line of text.split("\n")) {
    const t = line.trim().split(/\s+/);
    if (t.length < 5 || t[0] !== "TCP") continue;
    if (portOf(t[2] ?? "") !== 0 || portOf(t[1] ?? "") !== port) continue;
    const pid = /^[0-9]+$/.test(t[t.length - 1] ?? "") ? Number(t[t.length - 1]) : 0;
    if (pid > 0) return pid;
  }
  return null;
}

/** The PID listening on `port`, or null (none found, or undeterminable). */
export function listenerPid(port: number, opts: ListenerOptions = {}): number | null {
  const seam = pidSeam(opts.env ?? process.env, "MEMPALACE_MCP_LISTENER_PID");
  if (seam.set) return seam.pid;
  const platform = opts.platform ?? servicePlatform();
  if (platform === "linux") return linuxListener(port, opts.procRoot ?? "/proc");
  if (platform !== "darwin" && platform !== "win32") return null;
  const table = listenerTable(platform);
  if (!table.ok) return null;
  return platform === "darwin"
    ? parseNetstatDarwin(table.stdout, port)
    : parseNetstatWindows(table.stdout, port);
}
