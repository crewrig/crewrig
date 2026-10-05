// guard-wiring-fixtures.ts — a throwaway checkout and the wiring tool's runner,
// for the guard's wiring suites (spec 0248 R28-R32; plan step 19).
//
// A checkout holds the real transcript manifests and stub entries
// `hooks/worktree-git-guard.{ts,sh}`: what `hook-wiring.ts --repo` needs. The
// physical path of the checkout is what the tool writes (spec 0169 R2).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { realTmp, REPO, type Result } from "./worktree-fixtures.ts";

export const WIRING = path.join(REPO, "scripts", "hook-wiring.ts");
export const CLIS = ["claude", "gemini", "copilot", "antigravity"] as const;
export type GuardCli = (typeof CLIS)[number];

export interface Checkout {
  readonly repo: string;
  /** The physical path of the guard entry, as the tool writes it. */
  readonly guard: string;
  readonly manifest: (cli: GuardCli) => string;
}

/** A checkout named `name` (default `co`) under a fresh temporary directory. */
export function makeCheckout(name = "co", options: { entry?: boolean } = {}): Checkout {
  const root = realTmp("crewrig-guard-wiring-");
  const repo = path.join(root, name);
  fs.mkdirSync(path.join(repo, "hooks"), { recursive: true });
  for (const cli of CLIS) {
    fs.copyFileSync(
      path.join(REPO, "hooks", `${cli}-transcript-hooks.json`),
      path.join(repo, "hooks", `${cli}-transcript-hooks.json`),
    );
  }
  if (options.entry !== false) {
    fs.writeFileSync(path.join(repo, "hooks", "worktree-git-guard.ts"), "// entry\n");
  }
  fs.writeFileSync(path.join(repo, "hooks", "worktree-git-guard.sh"), "#!/bin/bash\n");
  return {
    repo,
    guard: path.join(repo, "hooks", "worktree-git-guard.ts"),
    manifest: (cli) => path.join(repo, "hooks", `${cli}-transcript-hooks.json`),
  };
}

/** Run `node scripts/hook-wiring.ts <args>` with the two silencing flags the Bash callers pass. */
export function wiring(...args: string[]): Result {
  const res = spawnSync(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      WIRING,
      ...args,
    ],
    { encoding: "utf8" },
  );
  return { status: res.status, signal: res.signal, stdout: res.stdout, stderr: res.stderr };
}

export type Json = Record<string, unknown>;

/** Every handler object (`type: "command"` with a string command) of a configuration, in order. */
export function handlers(node: unknown, found: Json[] = []): Json[] {
  if (Array.isArray(node)) {
    for (const item of node) handlers(item, found);
  } else if (typeof node === "object" && node !== null) {
    const record = node as Json;
    if (typeof record["command"] === "string") found.push(record);
    for (const value of Object.values(record)) handlers(value, found);
  }
  return found;
}

/** The commands of every handler whose command names the guard. */
export const guardCommands = (config: unknown): string[] =>
  handlers(config)
    .map((handler) => handler["command"] as string)
    .filter((command) => command.includes("worktree-git-guard"));

export const mode = (file: string): number => fs.statSync(file).mode & 0o777;
export const backups = (file: string): string[] =>
  fs
    .readdirSync(path.dirname(file))
    .filter((name) => name.startsWith(`${path.basename(file)}.bak.`));
