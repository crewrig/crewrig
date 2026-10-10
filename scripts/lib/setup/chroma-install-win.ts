// chroma-install-win.ts — the Windows twin of `install_chroma_daemon` (spec 0256 requirement 25 as
// replaced by delta-01, deviation (n); scenario "On Windows the Chroma daemon is a scheduled task").
// Where the shell stops with `ERROR: unsupported OS`, the Chroma daemon is registered as a per-user
// scheduled task through the existing service layer (scripts/lib/service/*, spec 0252): the trust
// wrapper program is installed (`installTrustWrapperProgram`), the task XML is rendered from
// `chromaChain`, registered by the schtasks backend through `installDaemon`, and the 2-second
// `/api/v2/heartbeat` probe is polled for the shell's 15 seconds. A failed registration or a
// heartbeat that never answers is rolled back by `installDaemon` (the task, its XML and the wrapper
// this install put there), never leaving a half-registered task. A failure returns `ok: false`
// after the install's own `ERROR:` lines; the caller exits 1.
//
// Every child process is the schtasks backend's (exec.ts, behind `setExecutableOverride` in tests);
// the injected `Spawner` of `ChromaInstallArgs` is not needed here and nothing else is spawned.

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ServiceBackend } from "../service/backend.ts";
import { heartbeatOk, chromaEndpoint, chromaPaths } from "../service/chroma-state.ts";
import type { Endpoint } from "../service/chroma-state.ts";
import { backendRollback, ensureMempalaceHome, installDaemon } from "../service/install.ts";
import { serviceNames, taskPathOf } from "../service/names.ts";
import type { DaemonKind } from "../service/names.ts";
import { installTrustWrapperProgram, installedPaths } from "../service/program-install.ts";
import { uninstallPrograms } from "../service/program-install.ts";
import type { ProgramOptions } from "../service/program-install.ts";
import { createBackend } from "../service/schtasks.ts";
import { chromaChain, currentUserId, renderTaskFile } from "../service/windows-task-xml.ts";
import { chromaBinaryFor, materialiseChromaUnit } from "./chroma-unit.ts";
import type { ChromaInstallArgs, ChromaInstallResult } from "./chroma-types.ts";

/** The bound of one heartbeat inside the poll, in milliseconds. */
const HEARTBEAT_BOUND_MS = 2000;

/** Seams for the tests; the production call passes none. */
export interface ChromaWinDeps {
  /** The service backend; the schtasks backend owning the wrapper program by default. */
  readonly backend?: ServiceBackend;
  /** Install the trust wrapper program and its bundle files. */
  readonly installWrapper?: (opts: ProgramOptions) => void;
  /** One heartbeat probe; the 2-second `/api/v2/heartbeat` probe by default. */
  readonly healthz?: (endpoint: Endpoint) => Promise<boolean>;
  /** The task's `Command`: the installer's `process.execPath` by default. */
  readonly nodePath?: string;
  /** The poll deadline and step; the shell's 15 s and 0.3 s by default. */
  readonly deadlineMs?: number;
  readonly stepMs?: number;
}

const defaultHealthz = (endpoint: Endpoint): Promise<boolean> =>
  heartbeatOk(endpoint, HEARTBEAT_BOUND_MS);

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Install the Chroma daemon as a scheduled task. Every line shown goes through `ctx.io.out`. */
export async function installChromaDaemonWin(
  args: ChromaInstallArgs,
  deps: ChromaWinDeps = {},
): Promise<ChromaInstallResult> {
  const { ctx, python } = args;
  const { io, home, env } = ctx;
  const names = serviceNames("chroma", env);
  const paths = installedPaths(home, env);
  const mempalace = chromaPaths(env, home);
  const endpoint = chromaEndpoint(env);

  io.out("");
  io.out("Installing shared ChromaDB HTTP daemon supervisor (issue #98)...");

  const made = ensureMempalaceHome(home, env);
  if (!made.ok) {
    for (const line of made.reason.split("\n")) io.out(line);
    return { ok: false };
  }

  // The interpreter and the `<venv>\Scripts\chroma.exe` pre-flight, with the shell's messages;
  // on win32 `materialiseChromaUnit` checks and writes nothing.
  const preflight = materialiseChromaUnit({ ctx, template: "", target: "", python });
  if (!preflight.ok || python === undefined || python === "") return { ok: false };
  const chroma = chromaBinaryFor(python, "win32");

  // The wrapper first: the task's first argument is the installed program. A wrapper that was
  // already there (stdio entries of an earlier run name it) is not removed by a rollback.
  const wrapperExisted = existsSync(paths.wrapper);
  try {
    (deps.installWrapper ?? installTrustWrapperProgram)({ paths });
  } catch (error) {
    io.out(`  ERROR: ${messageOf(error)}`);
    return { ok: false };
  }
  io.out(`  Installed trust wrapper: ${paths.wrapper}`);

  const backend = deps.backend ?? createBackend({ programPathOf: () => paths.wrapper });
  const definitionPath = path.join(home, ".crewrig", "service", `${names.unit}.xml`);
  const nodePath = deps.nodePath ?? process.execPath;

  const materialise = (_template: string | undefined, target: string) => {
    try {
      mkdirSync(path.dirname(target), { recursive: true });
      const bytes = renderTaskFile({
        chain: chromaChain({
          nodePath,
          wrapper: paths.wrapper,
          python,
          chroma,
          palacePath: mempalace.palaceDir,
          host: endpoint.host,
          port: endpoint.port,
        }),
        taskUri: taskPathOf(names),
        userId: currentUserId(env),
      });
      writeFileSync(target, bytes);
      return { ok: true } as const;
    } catch (error) {
      return { ok: false, reason: `  ERROR: ${messageOf(error)}` } as const;
    }
  };

  const healthz = deps.healthz ?? defaultHealthz;
  let healthy = false;
  const result = await installDaemon({
    backend,
    names,
    definitionPath,
    materialise,
    health: () => healthy,
    logHint: mempalace.logFile,
    ...(deps.deadlineMs === undefined ? {} : { deadlineMs: deps.deadlineMs }),
    ...(deps.stepMs === undefined ? {} : { stepMs: deps.stepMs }),
    sleep: async (ms) => {
      healthy = await healthz(endpoint);
      await pause(ms);
    },
    rollback: backendRollback(backend, names, () => {
      rmSync(definitionPath, { force: true });
      if (wrapperExisted) return [];
      const others: readonly DaemonKind[] = backend.status(serviceNames("mcp", env)).registered
        ? ["mcp"]
        : [];
      return uninstallPrograms("chroma", paths, others).map((f) => `  Removed: ${f}`);
    }),
  });
  for (const line of result.lines) io.out(line);
  return { ok: result.ok };
}
