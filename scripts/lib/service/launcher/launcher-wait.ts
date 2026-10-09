// launcher-wait.ts — the two waits of the installed MCP launcher (spec 0252
// requirement 11(e) and (f)): the in-process bind probe of the daemon's own
// port, and the ChromaDB heartbeat wait on a deadline.
//
// Nothing here spawns a process. Every diagnostic is the shell launcher's text.
//
// BUNDLE (installed flat as service-lib/launcher-wait.ts): standalone, imports
// only node:http and node:net. Used by launcher/mcp-daemon-launcher.ts.

import { request } from "node:http";
import { createServer } from "node:net";

export const DEFAULT_CHROMA_WAIT_SECONDS = 60;
export const HEARTBEAT_TIMEOUT_MS = 2000;

/** Whether `host:port` can be bound right now (any failure counts as taken). */
export function canBind(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    try {
      server.listen({ host, port, exclusive: true }, () => {
        server.close(() => resolve(true));
      });
    } catch {
      resolve(false);
    }
  });
}

/** The shell's port-taken diagnostic. */
export function portTakenMessage(host: string, port: string): string {
  return `port ${port} on ${host} is already in use.
       Retrying will not help — the supervisor would respawn this forever.
       Find the holder:   netstat -anv | grep ${port}
       (lsof may show nothing: a system service under launchd is invisible
        without elevation.)
       Choose another:    MEMPALACE_MCP_PORT=<port> task mempalace:switch-http`;
}

/** One heartbeat probe: `curl -sf --max-time 2`, true on a 2xx answer. */
export function heartbeat(
  host: string,
  port: string,
  timeoutMs = HEARTBEAT_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean): void => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        resolve(ok);
      }
    };
    const req = request(
      { host, port: Number(port), path: "/api/v2/heartbeat", method: "GET" },
      (res) => {
        res.resume();
        finish((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300);
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      finish(false);
    }, timeoutMs);
    req.on("error", () => finish(false));
    req.end();
  });
}

export interface ChromaWaitOptions {
  readonly host: string;
  readonly port: string;
  readonly repoDir: string;
  /** `MEMPALACE_MCP_CHROMA_WAIT`, raw. Empty, unset or invalid means 60. */
  readonly waitSetting?: string | undefined;
  readonly probe?: (host: string, port: string) => Promise<boolean>;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export type WaitResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

export function chromaWaitSeconds(setting: string | undefined): number {
  if (setting === undefined || setting === "") return DEFAULT_CHROMA_WAIT_SECONDS;
  const n = Number(setting);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_CHROMA_WAIT_SECONDS;
}

/** Wait for the ChromaDB heartbeat until the deadline; probe first, then check. */
export async function waitForChroma(o: ChromaWaitOptions): Promise<WaitResult> {
  const seconds = chromaWaitSeconds(o.waitSetting);
  const probe = o.probe ?? ((h, p) => heartbeat(h, p));
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = now() + seconds * 1000;
  while (!(await probe(o.host, o.port))) {
    if (now() >= deadline) {
      return {
        ok: false,
        message: `ChromaDB daemon unreachable at ${o.host}:${o.port} after ${seconds}s.
       The MCP daemon serves through it (ADR 0006) and will not start without it.
       Check: bash ${o.repoDir}/scripts/status-chroma-server.sh`,
      };
    }
    await sleep(1000);
  }
  return { ok: true };
}

/** Export the endpoint just proved reachable into `env` (the child's). */
export function exportChromaEnv(
  env: Record<string, string | undefined>,
  host: string,
  port: string,
): void {
  env.MEMPALACE_CHROMA_HOST = host;
  env.MEMPALACE_CHROMA_PORT = port;
}
