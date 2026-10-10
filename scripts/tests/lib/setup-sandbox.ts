// setup-sandbox.ts — a hermetic sandbox for the four setup entry points (spec 0256): a throwaway
// root holding `home/` (HOME and USERPROFILE), a repository checkout fixture and a `bin/` of stubs
// first on PATH. No setup script ever sees the real home; a test that runs one still checks the
// real home with `real-home-guard.ts`. Builds on `build-fixture-tree.ts` (scripts, `.git`,
// package.json) and `hermetic-env.ts` (HOME, PATH, coreutils, `node`).
// API: createSetupSandbox(options) -> SetupSandbox {root, home, repo, bin, env, stub, run, dispose};
// IMPL = the legs whose entry exists (`shell` now, `ts` once the `.ts` files exist).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after } from "node:test";

import { createFixtureTree, REPO } from "./build-fixture-tree.ts";
import type { RunResult } from "./build-fixture-tree.ts";
import { createHermeticEnv, writeStub } from "./hermetic-env.ts";

export type Leg = "shell" | "ts";

const AVAILABLE: readonly Leg[] = fs.existsSync(
  path.join(REPO, "scripts/setup-claude-interactive.ts"),
)
  ? ["shell", "ts"]
  : ["shell"];

/**
 * The legs available now, by file existence in the real repository (one entry name suffices).
 * `SETUP_GOLDEN_LEGS` (`shell`, `ts` or `shell,ts`) narrows them, to run one leg of the golden
 * suites alone; unset, every available leg runs.
 */
export const IMPL: readonly Leg[] = ((): readonly Leg[] => {
  const wanted = (process.env["SETUP_GOLDEN_LEGS"] ?? "")
    .split(",")
    .map((leg) => leg.trim())
    .filter((leg) => leg !== "");
  return wanted.length === 0 ? AVAILABLE : AVAILABLE.filter((leg) => wanted.includes(leg));
})();

export interface SetupSandboxOptions {
  /** No `config/SOUL.md` and `config/PROFILE.md` (the missing-prerequisite case). */
  readonly omitIdentity?: boolean;
  /** No `node_modules/js-yaml` and `node_modules/argparse` (the missing-dependency case). */
  readonly omitNodeModules?: boolean;
}

export interface SetupRunOptions {
  readonly leg?: Leg;
  readonly stdin?: string;
  /** Extra environment; an `undefined` value removes the variable. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
}

export interface SetupSandbox {
  readonly root: string;
  readonly home: string;
  readonly repo: string;
  readonly bin: string;
  readonly env: Readonly<Record<string, string>>;
  /** Write an executable `#!/bin/sh` stub into `bin`; returns its path. */
  stub(name: string, body: string): string;
  /** Run `scripts/<entry>.sh` (leg `shell`, default) or `scripts/<entry>.ts` (leg `ts`) in the repo. */
  run(entry: string, args?: readonly string[], options?: SetupRunOptions): RunResult;
  dispose(): void;
}

const live = new Set<() => void>();
after(() => live.forEach((dispose) => dispose()));

const copy = (from: string, to: string, filter?: (src: string) => boolean): void => {
  const options = { recursive: true, dereference: true, ...(filter ? { filter } : {}) };
  fs.cpSync(path.join(REPO, from), path.join(to, from), options);
};

function buildRepo(repo: string, options: SetupSandboxOptions): void {
  // scripts/** (minus tests), `.git` and package.json come from the fixture tree; refresh `.git`.
  fs.rmSync(path.join(repo, ".git"), { recursive: true, force: true });
  const init = spawnSync("git", ["init", "-q", repo], { encoding: "utf8" });
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
  fs.copyFileSync(path.join(REPO, "package-lock.json"), path.join(repo, "package-lock.json"));
  const identity = /\/config\/(SOUL|PROFILE)\.md$/;
  copy("config", repo, (src) => !identity.test(src));
  copy("hooks", repo);
  fs.mkdirSync(path.join(repo, "artifacts/core/rules"), { recursive: true });
  fs.copyFileSync(
    path.join(REPO, "artifacts/core/rules/60-tools.md"),
    path.join(repo, "artifacts/core/rules/60-tools.md"),
  );
  copy("artifacts/core/system-context", repo);
  if (options.omitIdentity !== true) {
    for (const name of ["SOUL", "PROFILE"]) {
      fs.copyFileSync(
        path.join(REPO, `config/${name}.md.template`),
        path.join(repo, `config/${name}.md`),
      );
    }
  }
  if (options.omitNodeModules === true) return;
  for (const name of ["js-yaml", "argparse"]) {
    copy(`node_modules/${name}`, repo);
  }
}

export function createSetupSandbox(options: SetupSandboxOptions = {}): SetupSandbox {
  const tree = createFixtureTree({ deps: "no-packages" });
  const hermetic = createHermeticEnv({ poisonPython: false });
  const repo = tree.root;
  buildRepo(repo, options);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(hermetic.env))
    if (value !== undefined) env[key] = value;
  env["LC_ALL"] = "C";
  const dispose = (): void => {
    tree.dispose();
    hermetic.dispose();
    live.delete(dispose);
  };
  live.add(dispose);
  return {
    root: hermetic.root,
    home: hermetic.home,
    repo,
    bin: hermetic.bin,
    env,
    stub: (name, body) => writeStub(hermetic, name, body),
    run(entry, args = [], run = {}) {
      const leg = run.leg ?? "shell";
      const child: Record<string, string | undefined> = { ...env, ...run.env };
      const file = path.join(repo, "scripts", `${entry}.${leg === "shell" ? "sh" : "ts"}`);
      if (!fs.existsSync(file)) throw new Error(`setup-sandbox: ${file} does not exist`);
      const cmd = leg === "shell" ? path.join(hermetic.bin, "bash") : process.execPath;
      const res = spawnSync(cmd, [path.join("scripts", path.basename(file)), ...args], {
        cwd: repo,
        encoding: "utf8",
        input: run.stdin ?? "",
        timeout: run.timeoutMs ?? 60_000,
        env: Object.fromEntries(Object.entries(child).filter(([, v]) => v !== undefined)),
      });
      return { status: res.status, stdout: res.stdout, stderr: res.stderr };
    },
    dispose,
  };
}
