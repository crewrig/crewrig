// launchd.ts — the macOS service backend (spec 0252 requirements 5, 8, 9).
//
// The legacy verb pairs stay on purpose: `launchctl load -w` / `unload -w`.
// The messages are the shell's (scripts/stop-mcp-server.sh and
// `install_daemon_supervisor` / `uninstall_daemon_supervisor` of
// scripts/lib/common.sh). Every spawn goes through exec.ts `runManager`.

import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type {
  InstallSpec,
  ServiceBackend,
  ServiceOutcome,
  ServiceStatus,
  SupervisorPid,
} from "./backend.ts";
import { runManager } from "./exec.ts";
import type { ExecResult } from "./exec.ts";
import type { ServiceNames } from "./names.ts";
import { lookupSupervisorPid } from "./supervisor-pid.ts";

/** `~/Library/LaunchAgents/<label>.plist`. */
export function plistPathFor(names: ServiceNames, home: string): string {
  return path.join(home, "Library", "LaunchAgents", `${names.label}.plist`);
}

/** `launchctl list` mentions the label (the shell's `grep -q`: a substring match). */
function listing(label: string): { readonly loaded: boolean; readonly line?: string } {
  const r = runManager("launchctl", ["list"]);
  if (r.kind !== "ok") return { loaded: false };
  const line = r.stdout.split("\n").find((l) => l.includes(label));
  return line === undefined ? { loaded: false } : { loaded: true, line: line.trim() };
}

function why(r: ExecResult): string {
  return r.kind === "nonzero" ? r.stderr.trim() || `exit ${r.status}` : r.kind;
}

export function createBackend(home: string = homedir()): ServiceBackend {
  return {
    kind: "launchd",

    install(names: ServiceNames, spec: InstallSpec): ServiceOutcome {
      if (listing(names.label).loaded) {
        return { ok: true, detail: "  launchd agent already loaded — skipping load." };
      }
      const r = runManager("launchctl", ["load", "-w", spec.definitionPath]);
      if (r.kind !== "ok") return { ok: false, reason: "  ERROR: launchctl load failed." };
      return { ok: true, detail: `  Loaded launchd agent: ${names.label}` };
    },

    start(names: ServiceNames): ServiceOutcome {
      const r = runManager("launchctl", ["start", names.label]);
      return r.kind === "ok"
        ? { ok: true }
        : { ok: false, reason: `launchctl start ${names.label} failed: ${why(r)}` };
    },

    // A restart request under KeepAlive: never `unload -w` (spec 0113).
    stop(names: ServiceNames): ServiceOutcome {
      if (!listing(names.label).loaded) {
        return { ok: true, detail: `MCP daemon: no supervisor unit loaded (${names.label})` };
      }
      runManager("launchctl", ["stop", names.label]);
      return {
        ok: true,
        detail: [
          `MCP daemon: restart requested (${names.label})`,
          "  Under KeepAlive the supervisor brings it straight back.",
          "  To end it: bash scripts/uninstall-mcp-daemon.sh",
        ].join("\n"),
      };
    },

    status(names: ServiceNames): ServiceStatus {
      const { loaded, line } = listing(names.label);
      if (!loaded || line === undefined) return { registered: false, running: false };
      // `launchctl list` columns: PID (or "-"), last exit status, label.
      const running = /^[0-9]+\s/.test(line);
      return { registered: true, running, detail: line };
    },

    uninstall(names: ServiceNames): ServiceOutcome {
      const plist = plistPathFor(names, home);
      const lines: string[] = [];
      let removed = false;
      if (listing(names.label).loaded) {
        // Loaded with no plist on disk: remove by label so it stops respawning.
        const r = existsSync(plist)
          ? runManager("launchctl", ["unload", "-w", plist])
          : runManager("launchctl", ["remove", names.label]);
        removed = r.kind === "ok";
      }
      if (existsSync(plist)) {
        rmSync(plist, { force: true });
        lines.push(`  Removed unit: ${plist}`);
      }
      lines.push(
        removed
          ? `  Supervisor stopped and disabled: ${names.label}`
          : `  Supervisor was not loaded: ${names.label}`,
      );
      return { ok: true, detail: lines.join("\n") };
    },

    supervisorPid(names: ServiceNames): SupervisorPid {
      return lookupSupervisorPid("launchd", names);
    },
  };
}
