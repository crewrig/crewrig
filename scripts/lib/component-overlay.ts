// component-overlay.ts — TypeScript twin of `ensure_overlay_tiers_fresh` in
// scripts/lib/component-resolve.sh (spec 0255, row F2 of spec 0215): empty the compiled
// staging root of each served overlay tier for one CLI, then rebuild those tiers.
//
// Twin of that function: change both, and keep them equal. Differences of form, none of
// behaviour:
//   - the repository directory is a field of `io`, not the `REPO_DIR` variable, and an
//     empty one (or an empty tier) throws, as the shell's `${...:?}` guards abort;
//   - the rebuild is a child `node scripts/build-components.ts ...` spawned with an
//     argument array, never in this process and never through a shell (spec R24). The
//     shell ran the `bash scripts/build-components.sh` shim, which only runs the Node.js
//     floor guard and then this same command; the floor is already met by this process;
//   - the child's standard output and standard error go to one log file, so their order
//     is kept as the shell's `>"$log" 2>&1` kept it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import type { TextSink } from "./component-resolve.ts";

/** The result of the rebuild child: its exit status and its two streams, interleaved. */
export interface SpawnResult {
  readonly status: number;
  readonly output: string;
}

/** Runs `command` with `args` (never a shell line) and captures both streams together. */
export type SpawnFn = (command: string, args: readonly string[]) => SpawnResult;

/** Everything the overlay refresh and the install drivers touch outside the filesystem. */
export interface OverlayIo {
  /** The repository root: `dist/<tier>/<cli-root>` and `scripts/build-components.ts` hang off it. */
  readonly repoDir: string;
  /** Where every report goes; default standard error. */
  readonly stderr?: TextSink;
  /** The child runner; default a real `node` child writing to a temporary log. */
  readonly spawn?: SpawnFn;
}

const CLI_ROOTS: Readonly<Record<string, string>> = {
  claude: ".claude",
  gemini: ".gemini",
  copilot: ".github",
  antigravity: ".agents",
};

/** The default sink, standard error. */
export const stderrSink: TextSink = (text) => {
  process.stderr.write(text);
};

/** A child's status the way a shell reports it: `128 + signal` when it was killed. */
function exitStatus(status: number | null, signal: NodeJS.Signals | null): number {
  if (status !== null) return status;
  return signal === null ? 1 : 128 + (os.constants.signals[signal] ?? 0);
}

/** The default `SpawnFn`: the current runtime, both streams into one temporary log. */
export const spawnToLog: SpawnFn = (command, args) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-overlay-rebuild-"));
  const log = path.join(dir, "log");
  const fd = fs.openSync(log, "w");
  try {
    const child = spawnSync(command, [...args], { stdio: ["inherit", fd, fd] });
    const status = child.error ? 1 : exitStatus(child.status, child.signal);
    return { status, output: fs.readFileSync(log, "utf8") };
  } finally {
    fs.closeSync(fd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

function nonEmpty(value: string, what: string): string {
  if (value === "") throw new Error(`component-overlay.ts requires a non-empty ${what}`);
  return value;
}

/**
 * `ensure_overlay_tiers_fresh`: prune `dist/<tier>/<cli-root>` for each tier, then rebuild
 * those tiers for `cli`. Returns 0 on success, 2 on an internal error (an unknown CLI, or
 * the `core` tier among `tiers`, refused before anything is removed), and otherwise the
 * rebuild's own status, reported as itself with the pruned roots and the build's output
 * so the operator is not left with an emptied staging tree nobody named.
 */
export function ensureOverlayTiersFresh(
  cli: string,
  tiers: readonly string[],
  io: OverlayIo,
): number {
  const stderr = io.stderr ?? stderrSink;
  const run = io.spawn ?? spawnToLog;
  const cliRoot = Object.hasOwn(CLI_ROOTS, cli) ? CLI_ROOTS[cli] : undefined;
  if (cliRoot === undefined) {
    stderr(`Internal error: no staging root is defined for CLI '${cli}'.\n`);
    return 2;
  }
  const repo = nonEmpty(io.repoDir, "repository directory");

  // Validate every tier BEFORE removing anything: rejecting `core` mid-loop would leave
  // the earlier tiers pruned, the silent half-done state the failure branch exists to stop.
  if (tiers.includes("core")) {
    stderr("Internal error: the 'core' tier is never pruned by an install command.\n");
    return 2;
  }

  const buildArgs: string[] = [];
  const pruned: string[] = [];
  for (const tier of tiers) {
    // Every interpolated component carries its own guard: guarding only the base would
    // still let an empty tier or root widen the removal by a whole directory level.
    const root = `${repo}/dist/${nonEmpty(tier, "tier")}/${nonEmpty(cliRoot, "CLI root")}`;
    fs.rmSync(root, { recursive: true, force: true });
    pruned.push(root);
    buildArgs.push("--tier", tier);
  }

  const result = run(process.execPath, [
    `${repo}/scripts/build-components.ts`,
    "--target",
    cli,
    ...buildArgs,
  ]);
  if (result.status !== 0) {
    let text = `The rebuild of the served overlay tiers was refused (exit ${result.status}).\n`;
    text += "Nothing has been installed. These staging roots were emptied before the\n";
    text += "rebuild was attempted, so they are empty now; the next rebuild that\n";
    text += "succeeds repopulates them, and nothing outside them was touched:\n";
    for (const root of pruned) text += `  - ${root}\n`;
    text += "The refused rebuild's own report follows verbatim.\n";
    stderr(text + result.output);
  }
  return result.status;
}
