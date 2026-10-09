// daemon-replace.ts — leave the running MCP daemon process honouring the CURRENT
// token (spec 0252 requirement 18; spec 0139 R1, R2, R5). Ports
// `mcp_daemon_replace_process` and `_mcp_daemon_probe_accepts` of
// scripts/lib/common.sh with their wording kept.
//
// The probe is the bounded `tools/list` POST of probe.ts to the daemon's own
// endpoint with the bearer header built in this process, and only to a loopback
// host (probe.ts refuses an `authorization` header otherwise): the token is never
// on an argument list. The restart request is the backend's `stop` (under
// supervision a stop IS a restart request). Before the window opens the
// replacement-window warning is shown; a squatter on the port is evicted with
// MEMPALACE_MCP_EVICT_CMD (run through a shell, as the shell's `eval`) or
// SIGTERM then SIGKILL.

import { spawnSync } from "node:child_process";
import type { ServiceBackend } from "./backend.ts";
import { listenerPid } from "./listener-pid.ts";
import type { EnvLike, ServiceNames } from "./names.ts";
import { probe } from "./probe.ts";
import type { ProbeRequest, ProbeResult } from "./probe.ts";

export interface ReplaceIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export interface ReplaceOptions {
  readonly backend: ServiceBackend;
  readonly names: ServiceNames;
  readonly host: string;
  readonly port: string;
  readonly token: string;
  readonly env: EnvLike;
  readonly home: string;
  readonly io: ReplaceIo;
  /** Test seams. */
  readonly probeFn?: (req: ProbeRequest) => Promise<ProbeResult>;
  readonly listener?: (port: number) => number | null;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly kill?: (pid: number, signal: NodeJS.Signals) => void;
  readonly evict?: (command: string) => void;
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Does POST /mcp answer a bearer-authenticated `tools/list` with a 2xx status? */
export async function probeAccepts(
  host: string,
  port: string,
  token: string,
  probeFn: (req: ProbeRequest) => Promise<ProbeResult> = probe,
): Promise<boolean> {
  const bracketed = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  const res = await probeFn({
    url: `http://${bracketed}:${port}/mcp`,
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    timeoutMs: 3000,
  });
  return "status" in res && res.status >= 200 && res.status < 300;
}

export function warningLines(host: string, port: string): string[] {
  return [
    "",
    `  WARNING: replacing the daemon frees ${host}:${port} between the stop and`,
    "           the relaunch. Any local process that binds it in that window",
    "           receives the newly minted token in the very next probe — this",
    "           one — and can then answer your agents with fabricated memory.",
    "           Nothing below can tell that process from the real daemon.",
    `           Evict any squatter process on ${host}:${port}, verify port`,
    "           release, and only then rotate the token.",
    "",
  ];
}

/** True when the daemon accepts the current token; false after the reported failure. */
export async function replaceDaemonProcess(o: ReplaceOptions): Promise<boolean> {
  const { backend, names, host, port, token, io } = o;
  const deadlineS = Number(o.env["MCP_DAEMON_REPLACE_DEADLINE"] ?? "15") || 15;
  const portNum = Number(port);
  const listener = o.listener ?? ((p: number) => listenerPid(p, { env: o.env }));
  const sleep = o.sleep ?? realSleep;
  const now = o.now ?? Date.now;
  const kill = o.kill ?? ((pid, sig) => void process.kill(pid, sig));
  const accepts = (): Promise<boolean> => probeAccepts(host, port, token, o.probeFn);
  const expectedPid = (): number | null => {
    const s = backend.supervisorPid(names);
    return s.state === "pid" ? s.pid : null;
  };

  const initialListener = listener(portNum);
  const initialExpected = expectedPid();
  // A listener that is not the supervised process is a squatter: it gets no early accept.
  if (initialListener === null || initialExpected === null || initialListener === initialExpected) {
    if (await accepts()) return true;
  }

  for (const line of warningLines(host, port)) io.out(line);

  const status = backend.status(names);
  const loaded = backend.kind === "launchd" ? status.registered : status.running;
  if (!loaded) {
    const what =
      backend.kind === "launchd"
        ? `no launchd unit loaded for '${names.label}'`
        : `no ${backend.kind === "systemd" ? "systemd unit" : "Windows task"} active for '${names.unit}'`;
    io.err(`  WARNING: ${what} — issuing no restart request.`);
  } else {
    backend.stop(names);
  }

  const deadline = now() + deadlineS * 1000;
  while (now() < deadline) {
    let current = listener(portNum);
    const expected = expectedPid();
    if (current !== null && expected !== null && current !== expected) {
      io.err(
        `  WARNING: squatter PID ${current} detected on ${host}:${port} (expected PID ${expected}) — evicting.`,
      );
      const evictCmd = o.env["MEMPALACE_MCP_EVICT_CMD"];
      if (evictCmd !== undefined) {
        (o.evict ?? ((c) => void spawnSync(c, { shell: true, stdio: "ignore" })))(evictCmd);
      } else {
        try {
          kill(current, "SIGTERM");
        } catch {
          // already gone
        }
        await sleep(200);
        if (listener(portNum) === current) {
          try {
            kill(current, "SIGKILL");
          } catch {
            // already gone
          }
          await sleep(200);
        }
      }
      current = listener(portNum);
      if (current !== null && current !== expected) {
        io.err(`  ERROR: failed to evict squatter PID ${current} from ${host}:${port}.`);
        return false;
      }
    }
    // Probe only a verified listener, or when the supervisor's pid is unknown.
    if (expected === null || current === expected) {
      if (await accepts()) return true;
    }
    await sleep(300);
  }
  io.err(
    `  ERROR: daemon '${names.label}' ('${names.unit}') did not accept the current token within ${deadlineS}s.`,
  );
  io.err("         It may still be honouring a superseded one. Inspect");
  io.err(`         ${o.home}/.mempalace/mcp-server.log and retry.`);
  return false;
}
