// chroma-install.ts — `install_chroma_daemon` and `install_daemon_supervisor` of scripts/lib/common.sh
// in TypeScript (spec 0256 requirement 25 as replaced by delta-01, deviation (n)). The dispatcher prints
// the shell's header, creates the MemPalace home, then installs the supervisor unit of the platform:
// a launchd LaunchAgent on macOS, a systemd user unit on Linux, and on win32 the scheduled task of
// `chroma-install-win.ts`, called before anything is printed because it prints its own header and
// creates the home (no `unsupported OS` line there). A failure returns `{ ok: false }` after the
// install's own `ERROR:` lines; the caller exits 1 and no later step runs.
//
// The service managers are spawned through the `Spawner` seam, never directly: the executable is the
// one `service/exec.ts` `executableFor` names (so `CREWRIG_TEST_SERVICE_BIN_DIR` stubs apply) and the
// platform honours `CREWRIG_TEST_SERVICE_PLATFORM`. The verb pairs are the shell's (`launchctl load -w`,
// `systemctl --user enable --now`). The health check polls the heartbeat of `status-chroma-server`
// (`statusChroma` of service/chroma-state.ts) for 15 seconds in 0.3 second steps, on an injectable clock.

import { statSync } from "node:fs";
import { mkdirSync } from "node:fs";
import path from "node:path";

import type { ChromaInstallArgs, ChromaInstallCtx, ChromaInstallResult } from "./chroma-types.ts";
import { materialiseChromaUnit } from "./chroma-unit.ts";
import type { Spawner } from "./context.ts";
import { statusChroma } from "../service/chroma-state.ts";
import { executableFor, servicePlatform } from "../service/exec.ts";
import { HEALTH_DEADLINE_MS, HEALTH_STEP_MS, ensureMempalaceHome } from "../service/install.ts";
import { plistPathFor } from "../service/launchd.ts";
import { CHROMA_LABEL_DEFAULT, CHROMA_UNIT_DEFAULT, serviceNames } from "../service/names.ts";
import { unitPathFor } from "../service/systemd.ts";

/** Where a health probe writes the diagnostics of `status-chroma-server` (a sink during the poll). */
export interface HealthSink {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/** Does the daemon answer? Writes its status line to `sink`. */
export type HealthProbe = (sink: HealthSink) => Promise<boolean>;

/** Machine seams, injected by tests. */
export interface ChromaInstallSeams {
  readonly health?: HealthProbe;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** The Windows installer; loaded from `chroma-install-win.ts` when absent. */
  readonly installWin?: (
    args: ChromaInstallArgs,
  ) => ChromaInstallResult | Promise<ChromaInstallResult>;
}

const NULL_SINK: HealthSink = { out: () => {}, err: () => {} };
const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const UNAME: Readonly<Record<string, string>> = {
  freebsd: "FreeBSD",
  openbsd: "OpenBSD",
  netbsd: "NetBSD",
  sunos: "SunOS",
  aix: "AIX",
};

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** The platform the install branches on: the seam of `exec.ts` when set (POSIX only), else the context's. */
export function installPlatform(ctx: Pick<ChromaInstallCtx, "env" | "platform">): NodeJS.Platform {
  if (ctx.platform === "win32") return "win32";
  const seam = ctx.env["CREWRIG_TEST_SERVICE_PLATFORM"];
  return seam === undefined || seam === "" ? ctx.platform : servicePlatform(ctx.env);
}

function defaultHealth(ctx: ChromaInstallCtx): HealthProbe {
  return async (sink) => (await statusChroma({ env: ctx.env, io: sink, home: ctx.home })) === 0;
}

/** The shell's `status-chroma-server` poll: `deadline` and `step` in milliseconds. */
async function waitHealthy(
  health: HealthProbe,
  now: () => number,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  const deadline = now() + HEALTH_DEADLINE_MS;
  while (now() < deadline) {
    if (await health(NULL_SINK)) return true;
    await sleep(HEALTH_STEP_MS);
  }
  return false;
}

interface Unit {
  readonly template: string;
  readonly target: string;
}

async function loadWin(): Promise<NonNullable<ChromaInstallSeams["installWin"]>> {
  const mod = await import("./chroma-install-win.ts");
  return mod.installChromaDaemonWin;
}

function launchdLoaded(spawn: Spawner, exe: string, label: string): boolean {
  return spawn([exe, "list"]).stdout.includes(label);
}

function loadLaunchd(args: ChromaInstallArgs, exe: string, target: string): boolean {
  const { ctx, spawn } = args;
  if (launchdLoaded(spawn, exe, CHROMA_LABEL_DEFAULT)) {
    ctx.io.out("  launchd agent already loaded — skipping load.");
    return true;
  }
  if (spawn([exe, "load", "-w", target]).status !== 0) {
    ctx.io.out("  ERROR: launchctl load failed.");
    return false;
  }
  ctx.io.out(`  Loaded launchd agent: ${CHROMA_LABEL_DEFAULT}`);
  return true;
}

function loadSystemd(args: ChromaInstallArgs, exe: string): boolean {
  const { ctx, spawn } = args;
  const ok =
    spawn([exe, "--user", "daemon-reload"]).status === 0 &&
    spawn([exe, "--user", "enable", "--now", CHROMA_UNIT_DEFAULT]).status === 0;
  ctx.io.out(
    ok
      ? `  Enabled and started: ${CHROMA_UNIT_DEFAULT}.service`
      : "  ERROR: systemctl --user enable --now failed.",
  );
  return ok;
}

/** Template check, unit materialisation and registration of the supervisor of one POSIX platform. */
function installUnit(args: ChromaInstallArgs, platform: "darwin" | "linux"): boolean {
  const { ctx } = args;
  const names = serviceNames("chroma", ctx.env);
  const unit: Unit =
    platform === "darwin"
      ? {
          template: path.join(ctx.repoDir, "config", "launchd", `${names.label}.plist`),
          target: plistPathFor(names, ctx.home),
        }
      : {
          template: path.join(ctx.repoDir, "config", "systemd", `${names.unit}.service`),
          target: unitPathFor(names, ctx.home),
        };
  if (!isFile(unit.template)) {
    ctx.io.out(`  ERROR: ${unit.template} missing — daemon supervisor unit not shipped.`);
    return false;
  }
  mkdirSync(path.dirname(unit.target), { recursive: true });
  const made = materialiseChromaUnit({
    ctx: { ...ctx, platform },
    template: unit.template,
    target: unit.target,
    python: args.python,
  });
  if (!made.ok) return false;
  ctx.io.out(`  Installed: ${unit.target}`);
  return platform === "darwin"
    ? loadLaunchd(args, executableFor("launchctl", platform, ctx.env), unit.target)
    : loadSystemd(args, executableFor("systemctl", platform, ctx.env));
}

export async function installChromaDaemon(
  args: ChromaInstallArgs,
  seams: ChromaInstallSeams = {},
): Promise<ChromaInstallResult> {
  const { ctx } = args;
  const platform = installPlatform(ctx);
  // The Windows installer prints the header and creates the MemPalace home itself.
  if (platform === "win32") return await (seams.installWin ?? (await loadWin()))(args);
  ctx.io.out("");
  ctx.io.out("Installing shared ChromaDB HTTP daemon supervisor (issue #98)...");
  const home = ensureMempalaceHome(ctx.home, ctx.env);
  if (!home.ok) {
    for (const line of home.reason.split("\n")) ctx.io.err(line);
    return { ok: false };
  }
  if (platform !== "darwin" && platform !== "linux") {
    ctx.io.out(
      `  ERROR: unsupported OS '${UNAME[platform] ?? platform}' — install the daemon manually.`,
    );
    return { ok: false };
  }
  if (!installUnit(args, platform)) return { ok: false };

  // Health check — confirm the daemon answers before any MCP entry is written.
  const health = seams.health ?? defaultHealth(ctx);
  if (await waitHealthy(health, seams.now ?? Date.now, seams.sleep ?? realSleep)) {
    return { ok: true };
  }
  await health({ out: (line) => ctx.io.out(line), err: (line) => ctx.io.err(line) });
  ctx.io.out(`  ERROR: daemon '${CHROMA_LABEL_DEFAULT}' did not become healthy.`);
  ctx.io.out(
    `         Inspect logs at ${path.join(ctx.home, ".mempalace", "chroma-server.log")} and retry.`,
  );
  return { ok: false };
}
