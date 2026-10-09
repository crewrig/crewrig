// systemd.ts — the Linux service backend (spec 0252 requirements 5, 8, 9).
//
// The legacy verb pairs stay on purpose: `systemctl --user enable --now` /
// `disable --now`. The messages are the shell's (scripts/stop-mcp-server.sh and
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

/** `~/.config/systemd/user/<unit>.service`. */
export function unitPathFor(names: ServiceNames, home: string): string {
  return path.join(home, ".config", "systemd", "user", `${names.unit}.service`);
}

function systemctl(...args: string[]): ExecResult {
  return runManager("systemctl", ["--user", ...args]);
}

function why(r: ExecResult): string {
  return r.kind === "nonzero" ? r.stderr.trim() || `exit ${r.status}` : r.kind;
}

export function createBackend(home: string = homedir()): ServiceBackend {
  return {
    kind: "systemd",

    install(names: ServiceNames, _spec: InstallSpec): ServiceOutcome {
      const ok =
        systemctl("daemon-reload").kind === "ok" &&
        systemctl("enable", "--now", names.unit).kind === "ok";
      return ok
        ? { ok: true, detail: `  Enabled and started: ${names.unit}.service` }
        : { ok: false, reason: "  ERROR: systemctl --user enable --now failed." };
    },

    start(names: ServiceNames): ServiceOutcome {
      const r = systemctl("start", names.unit);
      return r.kind === "ok"
        ? { ok: true }
        : { ok: false, reason: `systemctl --user start ${names.unit} failed: ${why(r)}` };
    },

    // A restart request under Restart=always: never `disable --now` (spec 0113).
    stop(names: ServiceNames): ServiceOutcome {
      if (systemctl("is-active", "--quiet", names.unit).kind !== "ok") {
        return { ok: true, detail: `MCP daemon: no supervisor unit active (${names.unit})` };
      }
      systemctl("restart", names.unit);
      return {
        ok: true,
        detail: [
          `MCP daemon: restart requested (${names.unit})`,
          "  Under Restart=always the supervisor brings it straight back.",
          "  To end it: bash scripts/uninstall-mcp-daemon.sh",
        ].join("\n"),
      };
    },

    status(names: ServiceNames): ServiceStatus {
      const enabled = systemctl("is-enabled", names.unit);
      const active = systemctl("is-active", names.unit);
      const running = active.kind === "ok";
      const state = active.stdout.trim();
      return {
        registered: enabled.kind === "ok" || running,
        running,
        ...(state === "" ? {} : { detail: state }),
      };
    },

    uninstall(names: ServiceNames): ServiceOutcome {
      const unitFile = unitPathFor(names, home);
      const lines: string[] = [];
      let removed = false;
      if (
        systemctl("is-enabled", "--quiet", names.unit).kind === "ok" ||
        systemctl("is-active", "--quiet", names.unit).kind === "ok"
      ) {
        removed = systemctl("disable", "--now", names.unit).kind === "ok";
      }
      if (existsSync(unitFile)) {
        rmSync(unitFile, { force: true });
        systemctl("daemon-reload");
        lines.push(`  Removed unit: ${unitFile}`);
      }
      lines.push(
        removed
          ? `  Supervisor stopped and disabled: ${names.label}`
          : `  Supervisor was not loaded: ${names.label}`,
      );
      return { ok: true, detail: lines.join("\n") };
    },

    supervisorPid(names: ServiceNames): SupervisorPid {
      return lookupSupervisorPid("systemd", names);
    },
  };
}
