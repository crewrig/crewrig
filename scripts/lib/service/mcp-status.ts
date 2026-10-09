// mcp-status.ts — the status report of the shared MemPalace MCP HTTP daemon
// (spec 0252 requirements 15 and 16; spec 0113 R10, R16; PLAN v3 D1 row
// mcp-status). Ports scripts/status-mcp-server.sh with its sections, messages
// and exit status kept: endpoint, /healthz, the unauthenticated /mcp probe that
// must answer 401, the listener owner, the launcher drift (plus, on Windows,
// the `task:` line) and the assistant registrations. Exit 0 only when every
// section passes. The probe carries no token and no authorization header.

import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { launcherPath, parseLauncher } from "../mempalace-registration.ts";
import { backendKindFor } from "./backend.ts";
import { ownerCheck } from "./owner-check.ts";
import { probe } from "./probe.ts";
import { serviceNames } from "./names.ts";
import { assistantSection, launcherSection, taskSection } from "./status-report.ts";
import { lookupSupervisorPid } from "./supervisor-pid.ts";

export interface McpStatusOptions {
  env: NodeJS.ProcessEnv;
  /** Defaults to the user's home directory. */
  home?: string;
  repoRoot: string;
  platform: NodeJS.Platform;
  io: { out: (line: string) => void; err?: (line: string) => void };
}

const OCTET = "(0|[1-9][0-9]{0,2})";
const QUAD = new RegExp(`^127\\.${OCTET}\\.${OCTET}\\.${OCTET}$`);

/** The shell's `_status_loopback_host`: the host to probe, or null when it is not loopback. */
export function loopbackProbeHost(host: string): string | null {
  if (host === "localhost" || host === "[::1]") return host;
  if (host === "::1") return "[::1]";
  const m = QUAD.exec(host);
  if (m === null) return null;
  return [m[1], m[2], m[3]].every((o) => Number(o) <= 255) ? host : null;
}

function nonEmpty(value: string | undefined, fallback: string): string {
  return value !== undefined && value !== "" ? value : fallback;
}

function readRegular(file: string): string | null {
  try {
    return statSync(file).isFile() ? readFileSync(file, "utf8") : null;
  } catch {
    return null;
  }
}

function bracket(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

/** The last 20 lines of the log, each indented by two spaces (`tail -n 20 | sed 's/^/  /'`). */
function logTail(log: string): string[] {
  const lines = readFileSync(log, "utf8").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.slice(-20).map((l) => `  ${l}`);
}

/** Print the report; resolves to the exit status. */
export async function statusMcp(o: McpStatusOptions): Promise<number> {
  const { env, io } = o;
  const home = o.home ?? homedir();
  const launcher = launcherPath(env, home);
  const launcherText = readRegular(launcher);
  const installed = launcherText === null ? null : parseLauncher(launcherText);
  let host: string;
  let port: string;
  if (installed !== null) {
    host = loopbackProbeHost(installed.host) ?? nonEmpty(env["MEMPALACE_MCP_HOST"], "127.0.0.1");
    port = String(installed.port);
  } else {
    host = nonEmpty(env["MEMPALACE_MCP_HOST"], "127.0.0.1");
    port = nonEmpty(env["MEMPALACE_MCP_PORT"], "41893");
  }
  const installedEndpoint = installed?.url ?? "";
  const log = path.join(home, ".mempalace", "mcp-server.log");
  const base = `http://${bracket(host)}:${port}`;
  let rc = 0;

  io.out("MemPalace MCP HTTP daemon");
  io.out(`  endpoint: http://${host}:${port}/mcp`);

  // 1. Liveness
  const health = await probe({ url: `${base}/healthz`, timeoutMs: 3000, maxBodyBytes: 4096 });
  if ("status" in health && health.status < 400) {
    io.out("  state:    HEALTHY");
  } else {
    io.out("  state:    NOT SERVING");
    rc = 1;
    if (existsSync(log)) {
      io.out("");
      io.out(`  --- last 20 lines of ${log} ---`);
      for (const line of logTail(log)) io.out(line);
      io.out("  --- end of log ---");
    } else {
      io.out(`  (no log at ${log})`);
    }
  }

  // 2. Authentication actually enforced: no token, no authorization header.
  if (rc === 0) {
    const res = await probe({
      url: `${base}/mcp`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
      timeoutMs: 3000,
      maxBodyBytes: 4096,
    });
    const code = "status" in res ? String(res.status) : "000";
    if (code === "401") {
      io.out("  auth:     ENFORCED (unauthenticated /mcp refused)");
    } else {
      io.out(
        `  auth:     *** NOT ENFORCED *** (unauthenticated /mcp returned ${code}, expected 401)`,
      );
      io.out("            The daemon is serving without a bearer token. Every client");
      io.out("            reaches it unauthenticated. Re-run setup to provision one.");
      rc = 1;
    }
  }

  // 3. Listener owner (spec 0158)
  const names = serviceNames("mcp", env);
  const kind = backendKindFor(o.platform);
  if (rc === 0) {
    const verdict = ownerCheck({
      host,
      port: Number(port),
      platform: o.platform,
      env,
      lookupExpected: () => {
        if (kind === null) return null;
        const sup = lookupSupervisorPid(kind, names, env);
        return sup.state === "pid" ? sup.pid : null;
      },
    });
    for (const line of verdict.lines) io.out(line);
    if (verdict.exitCode !== 0) rc = 1;
  }

  // 4. Launcher drift, then the Windows task line
  const drift = launcherSection({
    env,
    home,
    repoRoot: o.repoRoot,
    platform: o.platform,
    names,
    launcher,
    write: io.out,
  });
  if (drift !== 0) rc = 1;
  if (o.platform === "win32" && taskSection({ names, write: io.out }) !== 0) rc = 1;

  // 5. Per-assistant arrangement (R16)
  if (assistantSection(rc, installedEndpoint, env, home, io.out) !== 0) rc = 1;
  return rc;
}
