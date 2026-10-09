// build-fixture-tree.ts — a throwaway repository root a TypeScript build can run in
// (spec 0250 R4, R26, scenario 21).
//
// `loadDependency` (scripts/lib/require-dependency.ts) anchors on the nearest ancestor
// holding a `.git` entry (scripts/lib/paths.ts), reads that root's `package.json` for
// the declared dependencies, and refuses a package whose real path is not inside that
// root's OWN `node_modules`. A tree that builds more than `--list-output-dirs` therefore
// carries three things, all REAL: a `.git` directory, the root `package.json`, and a
// copy (never a link) of the production closure of `js-yaml`. The closure is COMPUTED
// from `package-lock.json` (`productionClosure`); no package name is written here.
//
// API (small on purpose):
//   createFixtureTree(options?)  -> FixtureTree
//   FixtureTree.write / read / exists / remove   files under the root, `/`-separated
//   FixtureTree.artifact / mapping / config      sugar for `artifacts/`, `model-mappings/`,
//                                                `crewrig.config.toml`
//   FixtureTree.run(args, options?)              the entry in this tree, as a child process
//   productionClosure()                          top-level package names, sorted
// Every tree is removed when the importing test file finishes (an `after` hook registered
// on import); `dispose()` removes one earlier. `scripts/tests/` is not copied (the build
// never reads it, and it is the bulk of `scripts/`).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import { fileURLToPath } from "node:url";

/** The repository this helper lives in. */
export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

interface LockEntry {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}
interface Lockfile {
  packages: Record<string, LockEntry>;
}

/** Where npm placed `dep` when required from the package at `from` (node_modules walk-up). */
function locate(packages: Lockfile["packages"], from: string, dep: string): string | undefined {
  let base = from;
  for (;;) {
    const candidate = base === "" ? `node_modules/${dep}` : `${base}/node_modules/${dep}`;
    if (packages[candidate] !== undefined) return candidate;
    if (base === "") return undefined;
    const cut = base.lastIndexOf("/node_modules/");
    base = cut === -1 ? "" : base.slice(0, cut);
  }
}

/**
 * The top-level package names the root `dependencies` need at run time: the lockfile's
 * root entry, closed over `dependencies`, `optionalDependencies` and `peerDependencies`
 * (the edges `npm ci --omit=dev` follows). Sorted, one name per top-level directory of
 * `node_modules` (a nested package travels inside its parent's directory).
 */
export function productionClosure(repo: string = REPO): string[] {
  const lock = JSON.parse(
    fs.readFileSync(path.join(repo, "package-lock.json"), "utf8"),
  ) as Lockfile;
  const root = lock.packages[""];
  const queue: [string, string][] = Object.keys(root?.dependencies ?? {}).map((d) => ["", d]);
  const seen = new Set<string>();
  for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
    const location = locate(lock.packages, item[0], item[1]);
    if (location === undefined || seen.has(location)) continue;
    seen.add(location);
    const entry = lock.packages[location];
    const edges = {
      ...entry?.dependencies,
      ...entry?.optionalDependencies,
      ...entry?.peerDependencies,
    };
    for (const next of Object.keys(edges)) queue.push([location, next]);
  }
  const top = [...seen].map((loc) => /^node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(loc)?.[1] ?? loc);
  return [...new Set(top)].sort();
}

/** What a child run of the entry returned. */
export interface RunResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunOptions {
  /** Extra environment; a `undefined` value removes the variable. `REPO_DIR` is NOT inherited. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Working directory; default: the tree root. */
  readonly cwd?: string;
  /** The file to run, relative to the root; default `scripts/build-components.ts`. */
  readonly entry?: string;
  /** Node.js flags placed before the entry; none by default (the entry must be silent without any, R3). */
  readonly nodeFlags?: readonly string[];
}

export interface FixtureTree {
  /** Absolute path of the root (its physical path: symbolic links in the temporary directory resolved). */
  readonly root: string;
  /** Absolute path of `rel`. */
  resolve(rel: string): string;
  /** Write a file (parents created); `mode` is applied with `chmod` when given. Returns the path. */
  write(rel: string, content: string | Uint8Array, mode?: number): string;
  read(rel: string): string;
  exists(rel: string): boolean;
  /** Remove a file or directory tree under the root. */
  remove(rel: string): void;
  /** `write("artifacts/" + rel, ...)`. */
  artifact(rel: string, content: string | Uint8Array, mode?: number): string;
  /** `write("model-mappings/" + rel, ...)`. */
  mapping(rel: string, content: string): string;
  /** Write `crewrig.config.toml`. */
  config(toml: string): string;
  /** Run the entry here: `node <flags> <root>/scripts/build-components.ts <args>`. */
  run(args: readonly string[], options?: RunOptions): RunResult;
  /** Remove the whole tree now. */
  dispose(): void;
}

export interface FixtureTreeOptions {
  /**
   * `"full"` (default): `.git`, `package.json` and the closure. `"no-packages"`: `.git` and
   * `package.json`, no `node_modules` (the missing-dependency case). `"none"`: `scripts/` only
   * (what `--list-output-dirs` and the floor diagnostic need).
   */
  readonly deps?: "full" | "no-packages" | "none";
}

const live = new Set<string>();
after(() => {
  for (const dir of live) fs.rmSync(dir, { recursive: true, force: true });
  live.clear();
});

function copyScripts(root: string): void {
  const source = path.join(REPO, "scripts");
  const tests = path.join(source, "tests");
  fs.cpSync(source, path.join(root, "scripts"), {
    recursive: true,
    filter: (entry) => entry !== tests,
  });
}

function copyClosure(root: string): void {
  fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
  for (const name of productionClosure()) {
    const from = path.join(REPO, "node_modules", name);
    if (!fs.existsSync(from)) throw new Error(`${from} is missing: run the setup dependency step`);
    fs.cpSync(from, path.join(root, "node_modules", name), { recursive: true, dereference: true });
  }
}

/** Create a throwaway root (`scripts/` copy, plus `.git`, `package.json`, closure by default). */
export function createFixtureTree(options: FixtureTreeOptions = {}): FixtureTree {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "build-fixture-")));
  live.add(root);
  copyScripts(root);
  const deps = options.deps ?? "full";
  if (deps !== "none") {
    fs.mkdirSync(path.join(root, ".git"));
    fs.copyFileSync(path.join(REPO, "package.json"), path.join(root, "package.json"));
    if (deps === "full") copyClosure(root);
  }
  const resolve = (rel: string): string => path.join(root, ...rel.split("/"));
  const write = (rel: string, content: string | Uint8Array, mode?: number): string => {
    const file = resolve(rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    if (mode !== undefined) fs.chmodSync(file, mode);
    return file;
  };
  return {
    root,
    resolve,
    write,
    read: (rel) => fs.readFileSync(resolve(rel), "utf8"),
    exists: (rel) => fs.existsSync(resolve(rel)),
    remove: (rel) => fs.rmSync(resolve(rel), { recursive: true, force: true }),
    artifact: (rel, content, mode) => write(`artifacts/${rel}`, content, mode),
    mapping: (rel, content) => write(`model-mappings/${rel}`, content),
    config: (toml) => write("crewrig.config.toml", toml),
    run(args, run = {}) {
      const env: Record<string, string | undefined> = { ...process.env, REPO_DIR: undefined };
      for (const [key, value] of Object.entries(run.env ?? {})) env[key] = value;
      const entry = resolve(run.entry ?? "scripts/build-components.ts");
      const res = spawnSync(process.execPath, [...(run.nodeFlags ?? []), entry, ...args], {
        cwd: run.cwd ?? root,
        env: Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)),
        encoding: "utf8",
      });
      return { status: res.status, stdout: res.stdout, stderr: res.stderr };
    },
    dispose() {
      fs.rmSync(root, { recursive: true, force: true });
      live.delete(root);
    },
  };
}
