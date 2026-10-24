// release-driver-sandbox.ts — a hermetic repository the monorepo release driver can be run in,
// from either implementation (spec 0257 R22): `scripts/monorepo-release.sh` or the TypeScript
// entry `scripts/monorepo-release.ts`. A sandbox is a `createFixtureTree` root holding a real git repository
// (branch `main`, a bare `origin`, one tag per released extension), a copy of `scripts/`, two
// extensions, and REAL copies of `js-yaml` and `argparse` (the builders refuse a link, spec 0240
// R7). The engine and the forge CLI never run: `release-capture-stubs.ts` puts capturing stand-ins
// in their place, so no case can reach a network or a real forge.
//
// API: createReleaseSandbox(opts?) -> { root, originBare, captureDir, env(extra), run(entry,
// extraEnv?), readJsonl(name), scriptNpx, scriptRehearse, mutate(file, fn), dispose }. The child environment starts
// EMPTY: PATH (stubs first, then the parent PATH read before narrowing), an isolated HOME and git
// config, CAPTURE_DIR and GITHUB_API_URL pointing at a closed loopback port: a GitHub publish run
// reaches the release-PR sync, which would otherwise call the real API (an earlier run sent a
// sentinel token there). No other CI, GITHUB_*, GITLAB_*, CI_* or credential variable survives
// from the parent; each case adds its own through `extraEnv` (the flows start a forge stub and
// override the API URL). The driver reads no GitLab API URL: only the release-PR sync calls a
// forge API, and it is GitHub-only.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";

import { REPO, createFixtureTree } from "./build-fixture-tree.ts";
import type { FixtureTree, RunResult } from "./build-fixture-tree.ts";
import { installBinStubs, installRehearseStub, writeScript } from "./release-capture-stubs.ts";
import type { NpxScript, RehearseScript } from "./release-capture-stubs.ts";

export type { RunResult };
export type Entry = "shell" | "ts";

export interface ReleaseSandboxOptions {
  /** Extensions to add besides `hello-world` (default: `second-ext` 0.4.0). */
  readonly extraExtensions?: readonly { readonly name: string; readonly version: string }[];
}

export interface ReleaseSandbox {
  readonly root: string;
  readonly originBare: string;
  readonly captureDir: string;
  readonly tree: FixtureTree;
  /** The child environment: the isolated base plus `extra` (an `undefined` value removes). */
  env(extra?: Readonly<Record<string, string | undefined>>): Record<string, string>;
  run(entry: Entry, extraEnv?: Readonly<Record<string, string | undefined>>): RunResult;
  /** The JSON lines a stub recorded (`npx`, `rehearse`, `gh`), oldest first; empty when none. */
  readJsonl(name: string): Record<string, unknown>[];
  scriptNpx(script: NpxScript): void;
  scriptRehearse(script: RehearseScript): void;
  /**
   * Rewrite one file of the sandbox's own copy (a path relative to `root`) so a case can prove the
   * oracle goes red on a broken driver. Throws when `fn` leaves the content unchanged: a mutation
   * that did not apply would "prove" nothing.
   */
  mutate(file: string, fn: (content: string) => string): void;
  dispose(): void;
}

const live = new Set<string>();
after(() => {
  for (const dir of live) fs.rmSync(dir, { recursive: true, force: true });
  live.clear();
});

/** Port 1 is never listened on: connecting is refused at once, on this machine only. */
export const OFFLINE_API_URL = "http://127.0.0.1:1";

const TS_ENTRY = path.join("scripts", "monorepo-release.ts");

function git(cwd: string, args: readonly string[], env: Record<string, string>): void {
  const res = spawnSync("git", args, { cwd, env, encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${res.stderr}${res.stdout}`);
  }
}

/** Copy the real js-yaml and argparse as directories: the sandbox's builders refuse a link. */
function copyRealDeps(root: string): void {
  for (const name of ["js-yaml", "argparse"]) {
    const from = path.join(REPO, "node_modules", name);
    if (!fs.existsSync(from)) throw new Error(`${from} is missing: run the setup dependency step`);
    fs.cpSync(from, path.join(root, "node_modules", name), { recursive: true, dereference: true });
  }
}

function writeExtension(root: string, name: string, version: string): void {
  const dir = path.join(root, "extensions", "core", name);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = {
    name,
    version,
    description: `Minimal ${name} extension.`,
    context: { source: "CONTEXT.md" },
  };
  fs.writeFileSync(path.join(dir, "extension.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    `${JSON.stringify({ name: `${name}-extension`, version, type: "module" }, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(dir, "CONTEXT.md"), `# ${name}\n`);
}

/** hello-world, copied from the repository without its build output or installed packages. */
function copyHelloWorld(root: string): string {
  const from = path.join(REPO, "extensions", "core", "hello-world");
  const skip = new Set(["node_modules", "dist"]);
  fs.cpSync(from, path.join(root, "extensions", "core", "hello-world"), {
    recursive: true,
    filter: (src) => !skip.has(path.basename(src)),
  });
  const pkg = JSON.parse(fs.readFileSync(path.join(from, "package.json"), "utf8")) as {
    version: string;
  };
  return pkg.version;
}

export function createReleaseSandbox(opts: ReleaseSandboxOptions = {}): ReleaseSandbox {
  const tree = createFixtureTree({ deps: "none" });
  const root = tree.root;
  const aux = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "release-sandbox-")));
  live.add(aux);
  const originBare = path.join(aux, "origin.git");
  const captureDir = path.join(aux, "capture");
  const binDir = path.join(aux, "bin");
  const home = path.join(aux, "home");
  for (const dir of [captureDir, home]) fs.mkdirSync(dir, { recursive: true });
  const globalConfig = path.join(home, "gitconfig");
  // No background maintenance: a detached `git maintenance`/`repack` (gc.auto, which the copied tree sits at
  // the threshold of) would still be writing into the repository while `dispose()` removes it.
  fs.writeFileSync(globalConfig, "[gc]\n\tauto = 0\n[maintenance]\n\tauto = false\n");

  fs.copyFileSync(path.join(REPO, "package.json"), path.join(root, "package.json"));
  fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
  copyRealDeps(root);
  fs.writeFileSync(path.join(root, ".gitignore"), "node_modules/\ndist/\n");
  const helloVersion = copyHelloWorld(root);
  const extras = opts.extraExtensions ?? [{ name: "second-ext", version: "0.4.0" }];
  for (const ext of extras) writeExtension(root, ext.name, ext.version);

  // The parent PATH is read before narrowing: jq, bash, node and git must stay reachable.
  const parentPath = process.env["PATH"] ?? "";
  installBinStubs(binDir);
  const base: Record<string, string> = {
    PATH: [binDir, parentPath].filter((p) => p !== "").join(path.delimiter),
    HOME: home,
    USERPROFILE: home,
    // An empty real file, not the null device: on Windows `os.devNull` is `\\.\nul`, which git cannot open as a
    // config file. `GIT_CONFIG_NOSYSTEM` is git's own portable switch to skip the system config.
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    CAPTURE_DIR: captureDir,
    // Closed loopback port: an unscripted GitHub publish fails offline instead of reaching the API.
    GITHUB_API_URL: OFFLINE_API_URL,
  };
  if (process.platform === "win32" && process.env["SystemRoot"] !== undefined) {
    base["SystemRoot"] = process.env["SystemRoot"];
  }
  const identity = {
    GIT_AUTHOR_NAME: "Release Sandbox",
    GIT_AUTHOR_EMAIL: "sandbox@example.invalid",
    GIT_COMMITTER_NAME: "Release Sandbox",
    GIT_COMMITTER_EMAIL: "sandbox@example.invalid",
  };
  const setup = { ...base, ...identity };
  git(aux, ["init", "--bare", "-q", "-b", "main", originBare], setup);
  git(root, ["init", "-q", "-b", "main"], setup);
  git(root, ["add", "-A"], setup);
  git(root, ["commit", "-q", "--no-verify", "-m", "Initial commit"], setup);
  git(root, ["tag", `hello-world-v${helloVersion}`], setup);
  git(root, ["remote", "add", "origin", originBare], setup);
  git(root, ["push", "-q", "--no-verify", "origin", "main", "--tags"], setup);
  // After the commit: the stub exists in the working tree only, never in a clone's history.
  installRehearseStub(root);

  const env = (
    extra: Readonly<Record<string, string | undefined>> = {},
  ): Record<string, string> => {
    const out: Record<string, string> = { ...base };
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined) delete out[key];
      else out[key] = value;
    }
    return out;
  };

  return {
    root,
    originBare,
    captureDir,
    tree,
    env,
    run(entry, extraEnv = {}) {
      const childEnv = env(extraEnv);
      const [cmd, args] = [
        process.execPath,
        ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", TS_ENTRY],
      ] as const;
      const res = spawnSync(cmd, args, { cwd: root, env: childEnv, encoding: "utf8" });
      return { status: res.status, stdout: res.stdout, stderr: res.stderr };
    },
    readJsonl(name) {
      const file = path.join(captureDir, name.endsWith(".jsonl") ? name : `${name}.jsonl`);
      if (!fs.existsSync(file)) return [];
      return fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    },
    scriptNpx: (script) => writeScript(captureDir, "npx", script),
    scriptRehearse: (script) => writeScript(captureDir, "rehearse", script),
    mutate(file, fn) {
      const target = path.join(root, file);
      const before = fs.readFileSync(target, "utf8");
      const after = fn(before);
      if (after === before) throw new Error(`mutate(${file}): the mutation changed nothing`);
      fs.writeFileSync(target, after);
    },
    dispose() {
      tree.dispose();
      fs.rmSync(aux, { recursive: true, force: true });
      live.delete(aux);
    },
  };
}
