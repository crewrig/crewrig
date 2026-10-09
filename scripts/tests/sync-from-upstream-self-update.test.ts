// sync-from-upstream-self-update.test.ts — spec 0253 R21, plan step D6: the sync rewrites
// files under scripts/, itself and its modules included, so it must load every module
// before its first write. POSIX only (the shim and the shell predecessor are bash).
//
//  A. Static contract: no module calls `import(` or `require(`; the entry has the one
//     dynamic import of run.ts and starts by removing the `warning` listeners; the only
//     program any module spawns is `git`.
//  B. Self-update: an upstream whose entry and `reconcile.ts` end with a top-level throw
//     replaces both in an adopter while running; a late module load would hit the throw.
//  C. First crossing (v1-F5): an adopter still holding the SHELL sync, with no .ts file,
//     syncs to the shim and the TypeScript command, and a second run changes nothing.
//  D. Fail closed: the shim with no `node` on PATH exits 1 with its one Error: line.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { createHermeticEnv, runBash } from "./lib/hermetic-env.ts";
import type { HermeticEnv, RunResult } from "./lib/hermetic-env.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE_SHELL_SYNC = path.join(
  REPO,
  "scripts",
  "tests",
  "fixtures",
  "sync-from-upstream",
  "base-shell-sync.txt",
);
const SCRIPTS = path.join(REPO, "scripts");
const MODULES = path.join(SCRIPTS, "lib", "sync-from-upstream");
const SKIP = process.platform === "win32" ? "POSIX only: the shim is a bash script" : false;
const SENTINEL = 'throw new Error("loaded-after-write");\n';
const FILES = ["sync-from-upstream.ts", "sync-from-upstream.sh", "lib/node-floor-guard.js"];

const cleanups: Array<() => void> = [];
after(() => cleanups.forEach((fn) => fn()));

/** Source text with block and line comments removed (enough for these modules). */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
}

const moduleFiles = (): string[] => fs.readdirSync(MODULES).filter((n) => n.endsWith(".ts"));

describe("sync-from-upstream static contract (R21)", { skip: SKIP }, () => {
  test("no module calls import( or require(", () => {
    assert.ok(moduleFiles().length > 0);
    for (const name of moduleFiles()) {
      const code = stripComments(fs.readFileSync(path.join(MODULES, name), "utf8"));
      assert.doesNotMatch(code, /\bimport\s*\(/, `${name} calls import(`);
      assert.doesNotMatch(code, /\brequire\s*\(/, `${name} calls require(`);
    }
  });

  test("the entry removes warning listeners first and has one dynamic import, of run.ts", () => {
    const text = fs.readFileSync(path.join(SCRIPTS, "sync-from-upstream.ts"), "utf8");
    const code = stripComments(text);
    assert.ok(code.trimStart().startsWith('process.removeAllListeners("warning")'));
    const calls = code.match(/\bimport\s*\(\s*[^)]*\)/g) ?? [];
    assert.deepEqual(calls, ['import("./lib/sync-from-upstream/run.ts")']);
  });

  test("git is the only program spawned, and only by git.ts", () => {
    for (const name of moduleFiles()) {
      const code = stripComments(fs.readFileSync(path.join(MODULES, name), "utf8"));
      const importsChild = /from\s+["'](?:node:)?child_process["']/.test(code);
      assert.equal(importsChild, name === "git.ts", `${name}: child_process import`);
      const calls = [
        ...code.matchAll(/\b(spawnSync|spawn|execFileSync|execFile|execSync)\s*\(\s*([^,)]*)/g),
      ];
      for (const [, fn, first] of calls) {
        assert.equal(first?.trim(), '"git"', `${name}: ${fn ?? ""} spawns ${first ?? ""}`);
      }
      assert.equal(calls.length > 0, name === "git.ts", `${name}: spawn call count`);
      assert.doesNotMatch(
        code,
        /["'`](?:grep|sed|sort|awk|cat|rm|mkdir|find|xargs|mktemp|ln|date|bash|sh)["'`]/,
      );
    }
  });
});

// ---------------------------------------------------------------------------- fixtures

function hermetic(): HermeticEnv {
  const h = createHermeticEnv();
  cleanups.push(h.dispose);
  const dirs = [...(process.env["PATH"] ?? "").split(path.delimiter), "/usr/bin", "/bin"];
  for (const tool of ["git", "sort", "mv", "ls", "cp", "env"]) {
    if (fs.existsSync(path.join(h.bin, tool))) continue;
    const found = dirs.find((d) => d !== "" && path.isAbsolute(d) && isExec(path.join(d, tool)));
    if (found === undefined) throw new Error(`no ${tool} on PATH`);
    fs.symlinkSync(path.join(found, tool), path.join(h.bin, tool));
  }
  const gitConfig = path.join(h.root, "gitconfig");
  fs.writeFileSync(
    gitConfig,
    "[user]\n\tname = T\n\temail = t@example.com\n[commit]\n\tgpgsign = false\n",
  );
  h.env["GIT_CONFIG_GLOBAL"] = gitConfig;
  h.env["GIT_CONFIG_NOSYSTEM"] = "1";
  return h;
}

function isExec(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function git(h: HermeticEnv, cwd: string, ...args: string[]): string {
  const r = spawnSync(path.join(h.bin, "git"), args, { cwd, env: h.env, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function tmpRepo(h: HermeticEnv, name: string): string {
  const dir = path.join(h.root, name);
  fs.mkdirSync(dir);
  git(h, dir, "init", "-q");
  return dir;
}

function write(root: string, rel: string, content: string | Buffer): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** Copy this repository's sync files (entry, shim, floor guard, modules) under `root/scripts`. */
function copySyncTree(
  root: string,
  edit: (rel: string, text: string) => string = (_, t) => t,
): void {
  const rels = [...FILES, ...moduleFiles().map((n) => `lib/sync-from-upstream/${n}`)];
  for (const rel of rels) {
    write(root, `scripts/${rel}`, edit(rel, fs.readFileSync(path.join(SCRIPTS, rel), "utf8")));
  }
}

function commitAll(h: HermeticEnv, dir: string): void {
  git(h, dir, "add", "-A");
  git(h, dir, "commit", "-q", "-m", "fixture");
}

/** An adopter pointing at `upstream`, the manifest marking `scripts` strict; not yet committed. */
function adopterOf(h: HermeticEnv, upstream: string): string {
  const adopter = tmpRepo(h, "adopter");
  write(adopter, "crewrig.config.toml", `canonical_repo = "${upstream}"\n`);
  write(adopter, ".crewrig/core-paths.txt", "scripts\tstrict\n");
  return adopter;
}

function runSync(h: HermeticEnv, adopter: string, entry: string): RunResult {
  const env = { ...h.env, CREWRIG_REPO_DIR: adopter };
  if (entry.endsWith(".sh")) return runBash(h, entry, [], { cwd: adopter, env });
  const r = spawnSync(path.join(h.bin, "node"), [entry], { cwd: adopter, env, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// ---------------------------------------------------------------------------- B, C, D

describe("sync-from-upstream self-update", { skip: SKIP }, () => {
  test("B: the sync replaces its entry and a module while running, loading nothing late", () => {
    const h = hermetic();
    const poisoned = new Set(["sync-from-upstream.ts", "lib/sync-from-upstream/reconcile.ts"]);
    const upstream = tmpRepo(h, "upstream");
    copySyncTree(upstream); // the version every adopter holds: the strict guard accepts it
    commitAll(h, upstream);
    const adopter = adopterOf(h, upstream);
    copySyncTree(adopter);
    commitAll(h, adopter);
    copySyncTree(upstream, (rel, text) => (poisoned.has(rel) ? text + SENTINEL : text));
    commitAll(h, upstream);

    const res = runSync(h, adopter, path.join(adopter, "scripts", "sync-from-upstream.ts"));
    assert.equal(res.status, 0, res.stderr + res.stdout);
    assert.doesNotMatch(res.stderr, /loaded-after-write/);
    for (const rel of poisoned) {
      const text = fs.readFileSync(path.join(adopter, "scripts", rel), "utf8");
      assert.ok(text.endsWith(SENTINEL), `${rel} was not replaced by the upstream text`);
    }
  });

  test("C: a shell-script adopter crosses to the shim and the TypeScript command, then no-ops", () => {
    const h = hermetic();
    // The shell script as it stood before this migration, kept as a fixture (the shebang line
    // is dropped so the ratchet, which reads shebangs, sees no shell file; it is put back here).
    const shell = {
      stdout: Buffer.from(`#!/bin/bash\n${fs.readFileSync(BASE_SHELL_SYNC, "utf8")}`, "utf8"),
    };
    assert.match(
      shell.stdout.toString("utf8"),
      /Pull core-layer files/,
      "the fixture is not the shell script",
    );

    const upstream = tmpRepo(h, "upstream");
    write(upstream, "scripts/sync-from-upstream.sh", shell.stdout); // upstream's own history
    commitAll(h, upstream);
    const adopter = adopterOf(h, upstream);
    write(adopter, "scripts/sync-from-upstream.sh", shell.stdout);
    commitAll(h, adopter);
    copySyncTree(upstream); // this PR: shim, entry, floor guard and every module
    commitAll(h, upstream);

    const sh = path.join(adopter, "scripts", "sync-from-upstream.sh");
    const first = runSync(h, adopter, sh);
    assert.equal(first.status, 0, first.stderr + first.stdout);
    assert.equal(
      fs.readFileSync(sh, "utf8"),
      fs.readFileSync(path.join(SCRIPTS, "sync-from-upstream.sh"), "utf8"),
    );
    for (const rel of [...FILES, ...moduleFiles().map((n) => `lib/sync-from-upstream/${n}`)]) {
      assert.ok(fs.existsSync(path.join(adopter, "scripts", rel)), `${rel} missing after sync`);
    }

    const before = git(h, adopter, "status", "--porcelain");
    const second = runSync(h, adopter, sh);
    assert.equal(second.status, 0, second.stderr + second.stdout);
    assert.equal(git(h, adopter, "status", "--porcelain"), before);
    assert.doesNotMatch(second.stdout, /^(Added|Removed|Restored)/m);
  });

  test("D: the shim fails closed with an Error: line when node is not on PATH", () => {
    const h = hermetic();
    const bin = path.join(h.root, "nonode");
    fs.mkdirSync(bin);
    for (const tool of ["bash", "dirname"]) {
      fs.symlinkSync(fs.realpathSync(path.join(h.bin, tool)), path.join(bin, tool));
    }
    const res = runBash(h, path.join(SCRIPTS, "sync-from-upstream.sh"), [], {
      env: { PATH: bin },
      cwd: os.tmpdir(),
    });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Error: node was not found on PATH/);
  });
});
