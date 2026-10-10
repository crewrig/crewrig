// daemon-install.ts — install the shared MCP daemon and its launcher (spec 0252
// requirements 8, 9, 10 and 18). Ports `install_mcp_daemon` of
// scripts/lib/common.sh: ensure the MemPalace home, provision the token BEFORE the
// launcher exists (it refuses to serve without one), install the launcher program
// (program-install.ts), then materialise and register the supervisor definition
// through install.ts and the backend and poll `/healthz`.
//
// install.ts takes a synchronous health function while the probe is
// asynchronous, so the poll's `sleep` refreshes a cached result before every
// pause: the health function returns the last answer, and the deadline and the
// 0.3 s step stay those of install.ts.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { detectMempalacePython } from "../mempalace-python.ts";
import type { ServiceBackend } from "./backend.ts";
import { backendRollback, ensureMempalaceHome, installDaemon } from "./install.ts";
import type { InstallResult } from "./install.ts";
import { daemonEndpoint, serviceNames, taskPathOf } from "./names.ts";
import type { EnvLike, ServiceNames } from "./names.ts";
import { probe } from "./probe.ts";
import { installLauncherProgram, installedPaths, uninstallPrograms } from "./program-install.ts";
import { mcpChain, currentUserId, renderTaskFile } from "./windows-task-xml.ts";
import { materialiseUnit } from "./unit-render.ts";
import { readOrCreateToken } from "./token.ts";

export interface DaemonInstallOptions {
  readonly repoDir: string;
  readonly home: string;
  readonly env: EnvLike;
  readonly platform: string;
  readonly backend: ServiceBackend;
  readonly names?: ServiceNames;
  /** Test seam: the health probe of one poll step. */
  readonly healthz?: (url: string) => Promise<boolean>;
}

async function realHealthz(url: string): Promise<boolean> {
  const res = await probe({ url, timeoutMs: 3000 });
  return "status" in res && res.status >= 200 && res.status < 300;
}

/** Install the daemon. Every line shown to the operator is in `lines`. */
export async function installMcpDaemon(o: DaemonInstallOptions): Promise<InstallResult> {
  const lines: string[] = [
    "",
    "Installing shared MemPalace MCP HTTP daemon supervisor (spec 0113)...",
  ];
  const fail = (...more: string[]): InstallResult => ({ ok: false, lines: [...lines, ...more] });
  const names = o.names ?? serviceNames("mcp", o.env);

  const home = ensureMempalaceHome(o.home, o.env);
  if (!home.ok) return fail(...home.reason.split("\n"));
  try {
    readOrCreateToken();
  } catch {
    return fail(
      "  ERROR: could not provision the MCP bearer token.",
      "         Refusing to install a daemon that would serve unauthenticated.",
    );
  }

  const paths = installedPaths(o.home, o.env);
  const { host, port } = daemonEndpoint();
  const python = o.env["MEMPALACE_PYTHON"] ?? detectMempalacePython(o.env as NodeJS.ProcessEnv);
  if (python === undefined || python === "") {
    return fail(
      "  ERROR: cannot detect mempalace pipx python — install mempalace first.",
      "         (set MEMPALACE_PYTHON to override detection)",
    );
  }
  try {
    installLauncherProgram({
      paths,
      repoDir: o.repoDir,
      host,
      port,
      chromaHost: o.env["MEMPALACE_CHROMA_HOST"] || "127.0.0.1",
      chromaPort: o.env["MEMPALACE_CHROMA_PORT"] || "8001",
      python,
      palacePath: o.env["MEMPALACE_PALACE_PATH"] ?? "",
    });
  } catch (error) {
    return fail(`  ERROR: ${error instanceof Error ? error.message : String(error)}`);
  }
  lines.push(`  Installed launcher: ${paths.launcher}`);

  const win = o.platform === "win32";
  let definitionPath: string;
  let templatePath: string | undefined;
  if (o.platform === "darwin") {
    definitionPath = path.join(o.home, "Library", "LaunchAgents", `${names.label}.plist`);
    templatePath = path.join(o.repoDir, "config", "launchd", `${names.label}.plist`);
  } else if (o.platform === "linux") {
    definitionPath = path.join(o.home, ".config", "systemd", "user", `${names.unit}.service`);
    templatePath = path.join(o.repoDir, "config", "systemd", `${names.unit}.service`);
  } else if (win) {
    definitionPath = path.join(o.home, ".crewrig", "service", `${names.unit}.xml`);
  } else {
    return fail(`  ERROR: unsupported OS '${o.platform}' — install the daemon manually.`);
  }

  const materialise = (template: string | undefined, target: string) => {
    try {
      if (win) {
        mkdirSync(path.dirname(target), { recursive: true });
        const bytes = renderTaskFile({
          chain: mcpChain(process.execPath, paths.launcher),
          taskUri: taskPathOf(names),
          userId: currentUserId(o.env),
        });
        writeFileSync(target, bytes);
        return { ok: true } as const;
      }
      const made = materialiseUnit(
        template ?? "",
        target,
        { mempalaceHome: path.join(o.home, ".mempalace"), launcherPath: paths.launcher },
        process.execPath,
      );
      return made.ok
        ? ({ ok: true } as const)
        : ({ ok: false, reason: `  ERROR: ${made.reason}` } as const);
    } catch (error) {
      return {
        ok: false,
        reason: `  ERROR: ${error instanceof Error ? error.message : String(error)}`,
      } as const;
    }
  };

  const healthz = o.healthz ?? realHealthz;
  const url = `http://${host}:${port}/healthz`;
  let healthy = false;
  const result = await installDaemon({
    backend: o.backend,
    names,
    definitionPath,
    ...(templatePath === undefined ? {} : { templatePath }),
    materialise,
    health: () => healthy,
    logHint: `${o.home}/.mempalace/mcp-server.log`,
    sleep: async (ms) => {
      healthy = await healthz(url);
      await new Promise((r) => setTimeout(r, ms));
    },
    ...(win
      ? {
          rollback: backendRollback(o.backend, names, () => {
            rmSync(definitionPath, { force: true });
            return uninstallPrograms("mcp", paths, []).map((f) => `  Removed: ${f}`);
          }),
        }
      : {}),
  });
  return { ok: result.ok, lines: [...lines, ...result.lines] };
}
