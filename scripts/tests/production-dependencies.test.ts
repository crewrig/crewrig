// production-dependencies.test.ts — verifies the closure property of the
// production-dependency command `npm ci --omit=dev --workspaces=false`
// (spec 0240 R4 as reworded by delta-01; parent 0215 R6 as reworded by delta-03).
//
// Needs the npm registry: every case is skipped, with a message, when
// `npm ping` fails. Each case runs the real command in a throwaway directory,
// never in this repository, and compares what landed under node_modules/
// against reachability closures computed from the lockfile's `packages` map:
//   (a) installed ⊇ closure(root dependencies);
//   (b) installed ∩ (closure(root devDependencies) − closure(workspaces) − closure(root dependencies)) = ∅;
//   (c) installed ∩ (closure(workspaces) − closure(root devDependencies) − closure(root dependencies)) = ∅,
//       and no node_modules/<workspace name> link exists.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

interface LockEntry {
  name?: string;
  optional?: boolean;
  link?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}
type Packages = Record<string, LockEntry>;

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

const NPM_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  npm_config_audit: "false",
  npm_config_fund: "false",
  npm_config_update_notifier: "false",
  npm_config_ignore_scripts: "true",
};

function npm(cwd: string, ...args: string[]): void {
  const res = spawnSync("npm", args, { cwd, env: NPM_ENV, encoding: "utf8", timeout: 300_000 });
  assert.equal(res.status, 0, `npm ${args.join(" ")}: ${res.stderr}`);
}

const offline =
  spawnSync("npm", ["ping"], { env: NPM_ENV, encoding: "utf8", timeout: 30_000 }).status !== 0;
const skip = offline
  ? "npm registry unreachable (npm ping failed); R4 closure check skipped"
  : false;

/** Where npm resolves `dep` required from the package at `from` (node_modules walk-up). */
function resolveLocation(pkgs: Packages, from: string, dep: string): string | undefined {
  let base = from;
  for (;;) {
    const candidate = base === "" ? `node_modules/${dep}` : `${base}/node_modules/${dep}`;
    if (pkgs[candidate]) return candidate;
    if (base === "") return undefined;
    const cut = base.lastIndexOf("/node_modules/");
    base = cut === -1 ? "" : base.slice(0, cut);
  }
}

/** Every lockfile location reachable from `from` through `deps`, following all runtime edges. */
function closure(
  pkgs: Packages,
  from: string,
  deps: Record<string, string> | undefined,
): Set<string> {
  const seen = new Set<string>();
  const queue: [string, string][] = Object.keys(deps ?? {}).map((d) => [from, d]);
  while (queue.length > 0) {
    const [origin, dep] = queue.shift() as [string, string];
    const loc = resolveLocation(pkgs, origin, dep);
    if (loc === undefined || seen.has(loc)) continue;
    seen.add(loc);
    const entry = pkgs[loc] ?? {};
    const edges = {
      ...entry.dependencies,
      ...entry.optionalDependencies,
      ...entry.peerDependencies,
    };
    for (const next of Object.keys(edges)) queue.push([loc, next]);
  }
  return seen;
}

/** Every installed package location under `root`, in lockfile key form. */
function installedLocations(root: string): Set<string> {
  const found = new Set<string>();
  const walk = (rel: string): void => {
    const dir = path.join(root, rel, "node_modules");
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(".")) continue;
      const names = name.startsWith("@")
        ? fs.readdirSync(path.join(dir, name)).map((s) => `${name}/${s}`)
        : [name];
      for (const n of names) {
        const loc = rel === "" ? `node_modules/${n}` : `${rel}/node_modules/${n}`;
        found.add(loc);
        walk(loc);
      }
    }
  };
  walk("");
  return found;
}

const minus = (a: Set<string>, ...others: Set<string>[]): Set<string> =>
  new Set([...a].filter((x) => !others.some((o) => o.has(x))));
const intersect = (a: Set<string>, b: Set<string>): string[] => [...a].filter((x) => b.has(x));

/** Run the R4 command in `dir` and assert delta-01 R4 (a)-(c); return the installed set. */
function assertR4(dir: string): Set<string> {
  npm(dir, "ci", "--omit=dev", "--workspaces=false");
  const lock = JSON.parse(fs.readFileSync(path.join(dir, "package-lock.json"), "utf8")) as {
    packages: Packages;
  };
  const pkgs = lock.packages;
  const root = pkgs[""] ?? {};
  const workspaces = Object.keys(pkgs).filter((k) => k !== "" && !k.includes("node_modules/"));
  const prod = closure(pkgs, "", root.dependencies);
  const dev = closure(pkgs, "", root.devDependencies);
  const ws = new Set(workspaces.flatMap((w) => [...closure(pkgs, w, pkgs[w]?.dependencies)]));
  const installed = installedLocations(dir);

  const required = [...prod].filter((loc) => pkgs[loc]?.optional !== true);
  assert.deepEqual(
    minus(new Set(required), installed),
    new Set(),
    "(a) a root dependency is missing",
  );
  assert.deepEqual(
    intersect(installed, minus(dev, ws, prod)),
    [],
    "(b) a dev-only package was installed",
  );
  assert.deepEqual(
    intersect(installed, minus(ws, dev, prod)),
    [],
    "(c) a workspace-only package was installed",
  );
  for (const w of workspaces) {
    const name = pkgs[w]?.name ?? path.basename(w);
    assert.equal(
      fs.existsSync(path.join(dir, "node_modules", name)),
      false,
      `(c) workspace ${name} linked`,
    );
  }
  return installed;
}

/** A fixture root with `ms` as its dependency, `semver` as its devDependency and one workspace. */
function fixture(workspaceDeps: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-r4-"));
  temps.push(dir);
  const manifest = {
    name: "fixture",
    version: "1.0.0",
    private: true,
    workspaces: ["extensions/*/*"],
    dependencies: { ms: "2.1.3" },
    devDependencies: { semver: "7.5.4" },
  };
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest, null, 2));
  const wsDir = path.join(dir, "extensions", "x", "y");
  fs.mkdirSync(wsDir, { recursive: true });
  const wsManifest = { name: "y", version: "1.0.0", dependencies: workspaceDeps };
  fs.writeFileSync(path.join(wsDir, "package.json"), JSON.stringify(wsManifest, null, 2));
  npm(dir, "install", "--package-lock-only");
  return dir;
}

describe("npm ci --omit=dev --workspaces=false (spec 0240 R4, delta-01)", { skip }, () => {
  test("disjoint fixture: exactly the root dependency is installed", () => {
    const installed = assertR4(fixture({ "is-number": "7.0.0" }));
    assert.deepEqual([...installed].sort(), ["node_modules/ms"]);
  });

  test("overlap fixture: dev/workspace overlap packages are tolerated", () => {
    const installed = assertR4(fixture({ semver: "7.5.4" }));
    for (const loc of [
      "node_modules/ms",
      "node_modules/semver",
      "node_modules/lru-cache",
      "node_modules/yallist",
    ]) {
      assert.ok(installed.has(loc), `${loc} expected (root dependency or tolerated overlap)`);
    }
  });

  test("a copy of the real root manifests and lockfile satisfies (a)-(c)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-r4-real-"));
    temps.push(dir);
    for (const file of ["package.json", "package-lock.json"]) {
      fs.copyFileSync(path.join(REPO, file), path.join(dir, file));
    }
    const lock = JSON.parse(fs.readFileSync(path.join(REPO, "package-lock.json"), "utf8")) as {
      packages: Packages;
    };
    for (const w of Object.keys(lock.packages).filter(
      (k) => k !== "" && !k.includes("node_modules/"),
    )) {
      fs.mkdirSync(path.join(dir, w), { recursive: true });
      fs.copyFileSync(path.join(REPO, w, "package.json"), path.join(dir, w, "package.json"));
    }
    assertR4(dir);
  });
});
