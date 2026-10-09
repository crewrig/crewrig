// install.ts — the install orchestration (spec 0252 requirements 8 and 9;
// plan v2 D1 `install.ts`): ensure the MemPalace home, materialise the unit,
// register it through the backend, then poll the health function for 15
// seconds in 0.3 second steps, with the wording of `install_daemon_supervisor`
// and `ensure_mempalace_home` in scripts/lib/common.sh.
//
// The health function is a parameter, and so is the rollback: macOS and Linux
// keep the shell's behaviour (no rollback); the Windows path passes one that
// deletes the task and the files nothing else uses (requirement 8).

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { ServiceBackend, ServiceOutcome } from "./backend.ts";
import type { EnvLike, ServiceNames } from "./names.ts";

export const HEALTH_DEADLINE_MS = 15_000;
export const HEALTH_STEP_MS = 300;

export interface InstallResult {
  readonly ok: boolean;
  /** Every line shown to the operator, in order. */
  readonly lines: readonly string[];
}

export interface InstallOptions {
  readonly backend: ServiceBackend;
  readonly names: ServiceNames;
  /** Where the definition is materialised and loaded from. */
  readonly definitionPath: string;
  /** The shipped template; when given and absent the install stops first. */
  readonly templatePath?: string;
  /** Write `definitionPath` from the template, as the shell's materialise callback. */
  readonly materialise: (
    templatePath: string | undefined,
    definitionPath: string,
  ) => ServiceOutcome;
  /** Does the daemon answer? Called with no output wanted. */
  readonly health: () => boolean;
  /** The log path shown when the deadline expires. */
  readonly logHint: string;
  /** Runs after a failure that follows a registration; returns what it undid. */
  readonly rollback?: () => readonly string[];
  readonly deadlineMs?: number;
  readonly stepMs?: number;
  /** Test seams: a clock and a pause. */
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Create `~/.mempalace` and, when `MEMPALACE_PALACE_PATH` is unset or empty,
 * `~/.mempalace/palace` (`ensure_mempalace_home`, issue #1196). Idempotent.
 */
export function ensureMempalaceHome(home: string, env: EnvLike = process.env): ServiceOutcome {
  const homeDir = path.join(home, ".mempalace");
  if (!makeDir(homeDir)) {
    return {
      ok: false,
      reason:
        `  ERROR: could not create the MemPalace home directory ${homeDir}.\n` +
        "         The supervised daemons log there and use it as their working directory.",
    };
  }
  const override = env["MEMPALACE_PALACE_PATH"];
  if (override === undefined || override === "") {
    const palace = path.join(homeDir, "palace");
    if (!makeDir(palace)) {
      return {
        ok: false,
        reason: `  ERROR: could not create the default palace directory ${palace}.`,
      };
    }
  }
  return { ok: true };
}

function makeDir(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return false;
  }
  return existsSync(dir);
}

/** A rollback through the backend: uninstall, then the files nothing else uses. */
export function backendRollback(
  backend: ServiceBackend,
  names: ServiceNames,
  removeFiles: () => readonly string[] = () => [],
): () => readonly string[] {
  return () => {
    const out = backend.uninstall(names);
    const said = out.ok ? (out.detail ?? "") : out.reason;
    return [...(said === "" ? [] : said.split("\n")), ...removeFiles()];
  };
}

/** Install one daemon. Never throws on an operational failure: see `ok`. */
export async function installDaemon(opts: InstallOptions): Promise<InstallResult> {
  const lines: string[] = [];
  const say = (text: string): void => {
    lines.push(...text.split("\n"));
  };
  const fail = (): InstallResult => ({ ok: false, lines });
  const undo = (): void => {
    if (opts.rollback !== undefined) for (const l of opts.rollback()) say(l);
  };

  if (opts.templatePath !== undefined && !existsSync(opts.templatePath)) {
    say(`  ERROR: ${opts.templatePath} missing — daemon supervisor unit not shipped.`);
    return fail();
  }
  mkdirSync(path.dirname(opts.definitionPath), { recursive: true });
  const made = opts.materialise(opts.templatePath, opts.definitionPath);
  if (!made.ok) {
    say(made.reason);
    return fail();
  }
  say(`  Installed: ${opts.definitionPath}`);

  const loaded = opts.backend.install(opts.names, { definitionPath: opts.definitionPath });
  if (!loaded.ok) {
    say(loaded.reason);
    undo();
    return fail();
  }
  if (loaded.detail !== undefined) say(loaded.detail);

  // Health check — confirm the daemon answers before any MCP entry is written.
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? realSleep;
  const deadline = now() + (opts.deadlineMs ?? HEALTH_DEADLINE_MS);
  let healthy = false;
  while (now() < deadline) {
    if (opts.health()) {
      healthy = true;
      break;
    }
    await sleep(opts.stepMs ?? HEALTH_STEP_MS);
  }
  if (!healthy) {
    // Surface the health check's own diagnostics before the generic ERROR line.
    opts.health();
    say(`  ERROR: daemon '${opts.names.label}' did not become healthy.`);
    say(`         Inspect logs at ${opts.logHint} and retry.`);
    undo();
    return fail();
  }
  return { ok: true, lines };
}
