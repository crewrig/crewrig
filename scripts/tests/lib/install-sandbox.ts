// install-sandbox.ts — a hermetic sandbox for the install, manage and link entry points (spec 0255
// R26): a `createFixtureTree` root plus a `createHermeticEnv` child environment, i.e. a throwaway
// HOME/USERPROFILE and a PATH of ONE directory holding stub CLIs and coreutils; no jq, no Python.
// API: createInstallSandbox, stubCli, cliCalls (recorded argv), runEntry (one leg), runLegs (every
// existing leg), listTree (sorted relative paths, `/` after directories, ` -> target` on links).
// IMPL is the only switch between legs (`shell`: `bash scripts/<name>.sh`, now a fail-closed shim
// forwarding to the TypeScript entry; `node`: `node scripts/<name>.ts` directly). Both are real user
// paths, so both stay; `runLegs` skips a leg whose file is absent.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after } from "node:test";

import { createFixtureTree } from "./build-fixture-tree.ts";
import type { FixtureTree, FixtureTreeOptions, RunResult } from "./build-fixture-tree.ts";
import { createHermeticEnv, runBash, writeStub } from "./hermetic-env.ts";
import type { HermeticEnv } from "./hermetic-env.ts";
import { which } from "./worktree-fixtures.ts";

export type Leg = "shell" | "node";

export const IMPL: readonly Leg[] = ["shell", "node"];

export const DEFAULT_CLIS: readonly string[] = ["claude", "copilot", "agy", "gemini"];

export interface InstallSandbox {
  readonly tree: FixtureTree;
  readonly hermetic: HermeticEnv;
  readonly home: string;
  readonly callsDir: string;
}

export interface SandboxOptions extends FixtureTreeOptions {
  /** Stub CLIs to install (default: all four), each recording argv. */
  readonly clis?: readonly string[];
  /** Host commands to link into the sandbox PATH (e.g. `git`). */
  readonly links?: readonly string[];
}

/** `body` is `sh` run before the exit; it sees the stub's `$@`. */
export interface StubOptions {
  readonly status?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly body?: string;
}

export interface RunOptions {
  readonly leg?: Leg;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
}

export type LegResult = RunResult & { readonly leg: Leg };
const live = new Set<HermeticEnv>();
after(() => live.forEach((h) => h.dispose()));

const quote = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`;

/** A CLI stub: appends its tab-joined argv as one line to `calls/<name>`, prints, exits `status`. */
export function stubCli(sandbox: InstallSandbox, name: string, opts: StubOptions = {}): string {
  const log = path.join(sandbox.callsDir, name);
  const record = `{ a=''; for x in "$@"; do a="$a\t$x"; done; printf '%s\\n' "\${a#\t}"; }`;
  const out = (text: string | undefined, fd: string): string =>
    text === undefined ? "" : `printf '%s' ${quote(text)}${fd}\n`;
  const body = `${record} >> ${quote(log)}\n${opts.body ?? ""}\n`;
  const tail = out(opts.stdout, "") + out(opts.stderr, " >&2") + `exit ${opts.status ?? 0}\n`;
  return writeStub(sandbox.hermetic, name, body + tail);
}

/** The calls a stub recorded, oldest first (arguments must not contain tabs or newlines). */
export function cliCalls(sandbox: InstallSandbox, name: string): string[][] {
  const file = path.join(sandbox.callsDir, name);
  if (!fs.existsSync(file)) return [];
  const lines = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l !== "");
  return lines.map((l) => l.split("\t"));
}

export function createInstallSandbox(opts: SandboxOptions = {}): InstallSandbox {
  const tree = createFixtureTree(opts.deps === undefined ? {} : { deps: opts.deps });
  const hermetic = createHermeticEnv({ poisonPython: false });
  live.add(hermetic);
  const callsDir = fs.mkdirSync(path.join(hermetic.root, "calls"), { recursive: true }) as string;
  for (const name of opts.links ?? []) {
    const real = which(name);
    if (real === null) throw new Error(`${name} is needed by this test`);
    const dest = path.join(hermetic.bin, name);
    fs.rmSync(dest, { force: true });
    fs.symlinkSync(real, dest);
  }
  const sandbox = { tree, hermetic, home: hermetic.home, callsDir };
  (opts.clis ?? DEFAULT_CLIS).forEach((name) => stubCli(sandbox, name));
  return sandbox;
}

/** Run `scripts/<name>` through one leg (default `shell`); cwd is the tree root. */
export function runEntry(
  sandbox: InstallSandbox,
  name: string,
  args: readonly string[],
  opts: RunOptions = {},
): RunResult {
  const env = { ...opts.env, REPO_DIR: undefined, LC_ALL: "C" };
  const cwd = opts.cwd ?? sandbox.tree.root;
  if ((opts.leg ?? "shell") === "shell") {
    return runBash(sandbox.hermetic, sandbox.tree.resolve(`scripts/${name}.sh`), args, {
      env,
      cwd,
    });
  }
  const merged: NodeJS.ProcessEnv = { ...sandbox.hermetic.env, ...env };
  delete merged["REPO_DIR"];
  const argv = [sandbox.tree.resolve(`scripts/${name}.ts`), ...args];
  const res = spawnSync(process.execPath, argv, { encoding: "utf8", env: merged, cwd });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** Every leg of IMPL whose entry file exists in the tree, each run once. */
export function runLegs(
  sandbox: InstallSandbox,
  name: string,
  args: readonly string[],
  opts: Omit<RunOptions, "leg"> = {},
): LegResult[] {
  const file = (leg: Leg): string => `scripts/${name}.${leg === "shell" ? "sh" : "ts"}`;
  return IMPL.filter((leg) => sandbox.tree.exists(file(leg))).map((leg) => ({
    leg,
    ...runEntry(sandbox, name, args, { ...opts, leg }),
  }));
}

/** A placed tree: sorted `/`-relative paths, directories end in `/`, symbolic links read ` -> target`. */
export function listTree(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string, rel: string): void => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = rel === "" ? entry.name : `${rel}/${entry.name}`;
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) out.push(`${next} -> ${fs.readlinkSync(full)}`);
      else if (entry.isDirectory()) (out.push(`${next}/`), walk(full, next));
      else out.push(next);
    }
  };
  walk(dir, "");
  return out.sort();
}
