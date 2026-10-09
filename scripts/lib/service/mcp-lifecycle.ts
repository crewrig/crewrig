// mcp-lifecycle.ts — `stop` and `uninstall` of the shared MemPalace MCP HTTP
// daemon (spec 0252 requirements 1 to 5, 22 and 23; plan v3 PR D steps 27 to
// 31). Port of scripts/stop-mcp-server.sh and scripts/uninstall-mcp-daemon.sh
// with every message and exit status kept.
//
// `stop` is a restart request under supervision and never disables autostart;
// on Windows it ends the task and runs it again at once. `uninstall` is the
// only operation that ends the daemon: it removes the unit or task through the
// backend, the launcher program, its record and the bundle files, and leaves
// the bearer token in place.

import { homedir } from "node:os";
import path from "node:path";
import { tokenPathNoCreate } from "../usage-store/mcp.js";
import { assistantArrangement, assistantConfigPath } from "./assistant-arrangement.ts";
import type { Cli } from "./assistant-arrangement.ts";
import { backendKindFor, selectBackend, UnsupportedOsError } from "./backend.ts";
import { serviceNames, taskPathOf } from "./names.ts";
import { installedPaths, uninstallPrograms } from "./program-install.ts";

export interface LifecycleOptions {
  env: NodeJS.ProcessEnv;
  /** Defaults to the user's home directory. */
  home?: string;
  platform: NodeJS.Platform;
  io: { out: (line: string) => void; err: (line: string) => void };
}

/** `stop`: restart request (macOS, Linux) or end-and-run-again (Windows). Resolves to the exit status. */
export async function stopMcp(o: LifecycleOptions): Promise<number> {
  const names = serviceNames("mcp", o.env);
  let backend;
  try {
    backend = await selectBackend(o.platform);
  } catch (error) {
    if (error instanceof UnsupportedOsError) {
      o.io.err(error.message);
      return 1;
    }
    throw error;
  }
  if (backend.kind !== "schtasks") {
    const outcome = backend.stop(names);
    if (outcome.ok) {
      if (outcome.detail !== undefined) o.io.out(outcome.detail);
      return 0;
    }
    o.io.err(outcome.reason);
    return 1;
  }
  const task = taskPathOf(names);
  if (!backend.status(names).registered) {
    o.io.out(`MCP daemon: no supervisor unit loaded (${task})`);
    return 0;
  }
  const ended = backend.stop(names);
  if (!ended.ok) {
    o.io.err(ended.reason);
    return 1;
  }
  const started = backend.start(names);
  if (!started.ok) {
    o.io.err(started.reason);
    return 1;
  }
  o.io.out(`MCP daemon: restart requested (${task})`);
  o.io.out("  The task was ended and run again at once.");
  o.io.out("  To end it: bash scripts/uninstall-mcp-daemon.sh");
  return 0;
}

const UNAME_NAMES: Readonly<Record<string, string>> = {
  freebsd: "FreeBSD",
  openbsd: "OpenBSD",
  netbsd: "NetBSD",
  sunos: "SunOS",
  aix: "AIX",
};

/** The `uname -s` spelling of a `process.platform` value, as the shell printed it. */
function unameName(platform: string): string {
  return UNAME_NAMES[platform] ?? platform;
}

const CLIS: readonly Cli[] = ["claude", "gemini", "copilot", "antigravity"];

/** `uninstall`: end the daemon, remove its unit and files, then report what is left. */
export async function uninstallMcp(o: LifecycleOptions): Promise<number> {
  const { io, env } = o;
  const home = o.home ?? homedir();
  const names = serviceNames("mcp", env);
  io.out("Uninstalling the shared MemPalace MCP HTTP daemon...");
  let stillInstalled: "chroma"[] = [];
  let failed = false;
  if (backendKindFor(o.platform) === null) {
    io.out(
      `  ERROR: unsupported OS '${unameName(o.platform)}' — remove the supervisor unit manually.`,
    );
  } else {
    const backend = await selectBackend(o.platform);
    const outcome = backend.uninstall(names);
    if (outcome.ok) {
      if (outcome.detail !== undefined) {
        const text = outcome.detail;
        io.out(backend.kind === "schtasks" ? `  Task ${taskPathOf(names)}: ${text}` : text);
      }
    } else {
      io.out(`  ERROR: ${outcome.reason}`);
      failed = true;
    }
    if (backend.status(serviceNames("chroma", env)).registered) stillInstalled = ["chroma"];
  }
  const paths = installedPaths(home, env);
  for (const file of uninstallPrograms("mcp", paths, stillInstalled)) {
    if (file === paths.record) io.out(`  Removed launcher: ${file}`);
    else io.out(`  Removed: ${file}`);
  }

  io.out("");
  const stillHttp = CLIS.filter((cli) => assistantArrangement(cli, env, home) === "http");
  if (stillHttp.length > 0) {
    io.out("WARNING: these assistants still point at the daemon you just removed:");
    for (const cli of stillHttp) io.out(`    - ${cli}  (${assistantConfigPath(cli, home)})`);
    io.out("");
    io.out("  The port is now free. Any local process that binds it receives your");
    io.out("  bearer token in the first request and can answer your agents with");
    io.out("  fabricated memory. Re-point them before that matters:");
    io.out("    re-run the setup script for each, or 'task mempalace:switch-http'");
    io.out("    to bring the daemon back.");
    io.out("");
  }

  io.out("The bearer token is left in place: it is per-palace and a later install");
  io.out("reuses it.");
  io.out("");
  io.out("To ROTATE it (do this if you have any reason to think it leaked):");
  io.out("  task mempalace:rotate-token");
  io.out("  # or: bash scripts/switch-mempalace-http.sh --rotate");
  io.out("");
  io.out("  This removes the old token, mints a new one, replaces the daemon process");
  io.out("  (spec 0139), purges stale .bak backups, and re-registers every assistant.");
  io.out("  Then restart every running session to pick up the new value.");
  io.out("");
  io.out("To DECOMMISSION this palace entirely, remove the token by hand:");
  io.out(`  rm -rf ${path.dirname(tokenPathNoCreate())}`);
  return failed ? 1 : 0;
}
