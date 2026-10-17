// windows-e2e-run.ts — how the Windows proof of the end-to-end harness entries runs one entry and
// keeps its books (spec 0261 R17, R20, R21). Importable on any host. An entry runs as
// `node <entry>.ts` through the leg's interpreter (pwsh or cmd.exe on Windows, resolved from the
// PARENT PATH before the child PATH is narrowed) or directly on any other host. The child PATH holds
// an empty scratch `bin` plus the node and system directories: never docker, claude, gemini, copilot,
// agy or gh. `System32\bash.exe` (WSL) cannot be removed from a runner PATH and is never used.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { spawnEntry, why } from "./windows-proof-support.ts";
import type { Interpreters, Run, Shell } from "./windows-proof-support.ts";

export type Leg = "direct" | Shell;

/**
 * The per-entry time bound: generous, so only a hang or a pathological slowdown fails.
 * Observed (spec 0264 R12): the job log prints no per-entry time, so no per-entry maximum
 * is known; the whole three-leg suite took 17.7 s, 18.0 s and 18.4 s on three green
 * windows-latest runs (2026-10-16: 38950701304, 38954471090, 38942071274), the job being
 * absent from green release-branch runs. Value unchanged.
 */
export const BOUND_MS = 10_000;

export interface Ctx {
  readonly leg: Leg;
  readonly interpreters: Interpreters;
  /** Real path of the scratch root (8.3 names resolved). */
  readonly root: string;
  readonly bin: string;
  readonly home: string;
  readonly failures: string[];
  /** Landing zones the entries wrote: scanned for a carriage return at the end. */
  readonly landed: string[];
}

export const REPO = path.resolve(import.meta.dirname, "..", "..", "..");

/** A path as wired into an entry argument or a config value: forward slashes. */
export const fwd = (p: string): string => p.replaceAll("\\", "/");

export function makeCtx(leg: Leg, interpreters: Interpreters): Ctx {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "windows-e2e-")));
  const bin = path.join(root, "bin");
  const home = path.join(root, "home");
  fs.mkdirSync(bin);
  fs.mkdirSync(home);
  return { leg, interpreters, root, bin, home, failures: [], landed: [] };
}

/** A fresh scratch directory under the root. */
export function scratch(c: Ctx, name: string): string {
  const dir = path.join(c.root, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Run an entry (repo-relative path) with arguments and extra env; the run keeps its diagnostic. */
export function run(
  c: Ctx,
  entry: string,
  args: readonly string[],
  env: Record<string, string> = {},
): Run {
  const shell: Shell = c.leg === "cmd" ? "cmd" : "pwsh";
  return spawnEntry({
    entry,
    script: path.join(REPO, entry),
    args: [...args],
    shell,
    env: { GIT_CONFIG_NOSYSTEM: "1", ...env },
    home: c.home,
    bin: c.bin,
    interpreters: c.interpreters,
  });
}

/** Assert `body` on a run; a failure, a thrown mismatch or a blown time bound is recorded, never thrown. */
export function check(c: Ctx, r: Run, body: (r: Run) => void): void {
  try {
    assert.ok(r.ms < BOUND_MS, why(r, `took ${r.ms} ms, over the ${BOUND_MS} ms bound`));
    body(r);
  } catch (e) {
    c.failures.push(`[${c.leg}] ${(e as Error).message}\n${r.detail}`);
  }
}

/** Record a failure of a non-spawned check (in-process or file scan). */
export function guard(c: Ctx, name: string, body: () => void): void {
  try {
    body();
  } catch (e) {
    c.failures.push(`[${c.leg}] ${name}: ${(e as Error).message}`);
  }
}

/** No carriage return in any file under a directory the entries wrote (never AppData). */
export function noCarriageReturn(c: Ctx): void {
  for (const dir of c.landed)
    for (const file of fs.readdirSync(dir, { recursive: true, encoding: "utf8" })) {
      const full = path.join(dir, file);
      if (!fs.statSync(full).isFile()) continue;
      guard(c, `landing zone ${fwd(full)}`, () =>
        assert.ok(!fs.readFileSync(full, "utf8").includes("\r"), "contains a carriage return"),
      );
    }
}
