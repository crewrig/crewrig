// org-extensions.test.ts — spec 0311 (issue #2073), plan step 4: `scripts/org-extensions.ts
// <install|build|test> [<name>...]` installs, builds or tests org-tier extensions that sit outside
// the root workspace set. `REPO_DIR` overrides the root; `install` is the default action; no name
// means every org extension present (decision point E); an empty tier is a no-op.
//
// Every case runs the entry against a fixture root with an `npm` stub first on PATH that records
// each call's cwd and argv as a JSON line. Mode A = `extensions/org/package.json` exists (one npm
// call in that directory); Mode B = it does not (one `npm ci|install` + `npm run` per extension).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { REPO, treeDigest } from "./lib/extension-sandbox.ts";

const ENTRY = path.join(REPO, "scripts", "org-extensions.ts");
const ROOT_LOCK = '{"lockfileVersion":3,"packages":{}}\n';
const scratch: string[] = [];

after(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  scratch.push(dir);
  return dir;
}

function write(root: string, rel: string, content: string): void {
  const file = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

interface Fixture {
  readonly root: string;
  readonly orgDir: string;
  readonly bin: string;
  readonly log: string;
}

interface Options {
  /** Org extensions to create (each gets a `package.json`). */
  readonly extensions?: readonly string[];
  /** Mode A: write `extensions/org/package.json`. */
  readonly orgPackage?: boolean;
  /** Write `extensions/org/package-lock.json` (Mode A) or a lock beside each extension (Mode B). */
  readonly locks?: boolean;
}

function fixture(options: Options = {}): Fixture {
  const root = tempDir("org-ext-root");
  const bin = tempDir("org-ext-bin");
  const log = path.join(bin, "calls.jsonl");
  write(root, "package.json", '{"name":"fx","private":true,"workspaces":["extensions/core/*"]}\n');
  write(root, "package-lock.json", ROOT_LOCK);
  write(root, "extensions/org/README.md", "# org\n");
  write(root, "extensions/org/.gitkeep", "");
  const exts = options.extensions ?? [];
  for (const name of exts) {
    write(
      root,
      `extensions/org/${name}/package.json`,
      JSON.stringify({ name: `${name}-extension`, version: "0.1.0" }),
    );
    if (options.locks && !options.orgPackage)
      write(root, `extensions/org/${name}/package-lock.json`, "{}\n");
  }
  if (options.orgPackage) {
    write(
      root,
      "extensions/org/package.json",
      JSON.stringify({ name: "org", private: true, workspaces: [...exts] }),
    );
    if (options.locks) write(root, "extensions/org/package-lock.json", "{}\n");
  }
  const stub = path.join(bin, "npm");
  fs.writeFileSync(
    stub,
    `#!/usr/bin/env node\nrequire("node:fs").appendFileSync(${JSON.stringify(log)}, JSON.stringify({cwd: process.cwd(), argv: process.argv.slice(2)}) + "\\n");\nprocess.exit(Number(process.env.NPM_STUB_EXIT ?? 0));\n`,
  );
  fs.chmodSync(stub, 0o755);
  return { root, orgDir: path.join(root, "extensions", "org"), bin, log };
}

interface Call {
  readonly cwd: string;
  readonly argv: string[];
}

function calls(fx: Fixture): Call[] {
  if (!fs.existsSync(fx.log)) return [];
  return fs
    .readFileSync(fx.log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const call = JSON.parse(line) as Call;
      return { cwd: fs.realpathSync(call.cwd), argv: call.argv };
    });
}

function run(fx: Fixture, args: readonly string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [ENTRY, ...args], {
    cwd: REPO,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fx.bin}${path.delimiter}${process.env["PATH"] ?? ""}`,
      REPO_DIR: fx.root,
      LC_ALL: "C",
      ...env,
    },
  });
  if (result.error !== undefined) throw result.error;
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

const real = (p: string): string => fs.realpathSync(p);
const lockBytes = (fx: Fixture): string =>
  fs.readFileSync(path.join(fx.root, "package-lock.json"), "utf8");

describe("spec 0311 — org-extensions", () => {
  describe("empty org tier", () => {
    for (const args of [[], ["install"], ["install", "ghost"], ["build"], ["test", "ghost"]]) {
      test(`org-extensions::empty tier with args [${args.join(" ")}] is a no-op that exits 0`, () => {
        const fx = fixture();
        const before = treeDigest(fx.root);

        const result = run(fx, args);

        assert.equal(result.status, 0, `stderr:\n${result.stderr}`);
        assert.ok(
          `${result.stdout}${result.stderr}`.includes(
            "org-extensions: no org extension, nothing to do",
          ),
        );
        assert.deepEqual(calls(fx), []);
        assert.deepEqual(treeDigest(fx.root), before, "the tree changed");
      });
    }
  });

  describe("Mode A (extensions/org/package.json present)", () => {
    test("org-extensions::install of one of two names is a single npm ci carrying only that workspace", () => {
      const fx = fixture({
        extensions: ["a", "b"],
        orgPackage: true,
        locks: true,
      });

      const result = run(fx, ["install", "a"]);

      assert.equal(result.status, 0, `stderr:\n${result.stderr}`);
      const made = calls(fx);
      assert.equal(made.length, 1, JSON.stringify(made));
      assert.equal(made[0]!.cwd, real(fx.orgDir));
      assert.equal(made[0]!.argv[0], "ci");
      assert.deepEqual(made[0]!.argv.slice(1), ["--workspace", "a"]);
      assert.equal(lockBytes(fx), ROOT_LOCK);
    });

    test("org-extensions::install without a lockfile beside org package.json uses npm install", () => {
      const fx = fixture({
        extensions: ["a", "b"],
        orgPackage: true,
        locks: false,
      });

      const result = run(fx, ["install", "a"]);

      assert.equal(result.status, 0, `stderr:\n${result.stderr}`);
      assert.deepEqual(
        calls(fx).map((c) => c.argv),
        [["install", "--workspace", "a"]],
      );
    });

    test("org-extensions::no name installs every extension with npm ci and no --workspace flag (decision E)", () => {
      const fx = fixture({
        extensions: ["a", "b"],
        orgPackage: true,
        locks: true,
      });

      const result = run(fx, []);

      assert.equal(result.status, 0, `stderr:\n${result.stderr}`);
      assert.deepEqual(
        calls(fx).map((c) => c.argv),
        [["ci"]],
      );
    });

    test("org-extensions::several names go in one call, duplicates dropped", () => {
      const fx = fixture({
        extensions: ["a", "b"],
        orgPackage: true,
        locks: true,
      });

      const result = run(fx, ["install", "a", "b", "a"]);

      assert.equal(result.status, 0, `stderr:\n${result.stderr}`);
      assert.deepEqual(
        calls(fx).map((c) => c.argv),
        [["ci", "--workspace", "a", "--workspace", "b"]],
      );
    });

    test("org-extensions::build with a name runs npm run build --if-present --workspace a", () => {
      const fx = fixture({
        extensions: ["a", "b"],
        orgPackage: true,
        locks: true,
      });

      const result = run(fx, ["build", "a"]);

      assert.equal(result.status, 0, `stderr:\n${result.stderr}`);
      const made = calls(fx);
      assert.deepEqual(
        made.map((c) => c.argv),
        [["run", "build", "--if-present", "--workspace", "a"]],
      );
      assert.equal(made[0]!.cwd, real(fx.orgDir));
    });

    test("org-extensions::test with no name runs npm run test --if-present --workspaces", () => {
      const fx = fixture({
        extensions: ["a", "b"],
        orgPackage: true,
        locks: true,
      });

      const result = run(fx, ["test"]);

      assert.equal(result.status, 0, `stderr:\n${result.stderr}`);
      assert.deepEqual(
        calls(fx).map((c) => c.argv),
        [["run", "test", "--if-present", "--workspaces"]],
      );
    });

    test("org-extensions::an npm failure exit code is passed on", () => {
      const fx = fixture({ extensions: ["a"], orgPackage: true, locks: true });

      const result = run(fx, ["build", "a"], { NPM_STUB_EXIT: "7" });

      assert.equal(result.status, 7);
    });
  });

  describe("Mode B (no extensions/org/package.json)", () => {
    test("org-extensions::install of one of two names touches only that extension directory", () => {
      const fx = fixture({ extensions: ["a", "b"], locks: true });

      const result = run(fx, ["install", "a"]);

      assert.equal(result.status, 0, `stderr:\n${result.stderr}`);
      const made = calls(fx);
      assert.ok(made.length >= 1);
      assert.ok(
        made.every((c) => c.cwd === real(path.join(fx.orgDir, "a"))),
        JSON.stringify(made),
      );
      assert.equal(made[0]!.argv[0], "ci");
      assert.equal(lockBytes(fx), ROOT_LOCK);
    });

    test("org-extensions::install without a lockfile uses npm install in the extension directory", () => {
      const fx = fixture({ extensions: ["a"], locks: false });

      const result = run(fx, ["install", "a"]);

      assert.equal(result.status, 0, `stderr:\n${result.stderr}`);
      assert.deepEqual(
        calls(fx).map((c) => c.argv[0]),
        ["install"],
      );
    });

    test("org-extensions::no name covers both extension directories", () => {
      const fx = fixture({ extensions: ["a", "b"], locks: true });

      const result = run(fx, []);

      assert.equal(result.status, 0, `stderr:\n${result.stderr}`);
      const cwds = new Set(calls(fx).map((c) => c.cwd));
      assert.deepEqual(
        [...cwds].sort(),
        [real(path.join(fx.orgDir, "a")), real(path.join(fx.orgDir, "b"))].sort(),
      );
    });

    test("org-extensions::build installs then runs npm run build --if-present in the named directory only", () => {
      const fx = fixture({ extensions: ["a", "b"], locks: true });

      const result = run(fx, ["build", "a"]);

      assert.equal(result.status, 0, `stderr:\n${result.stderr}`);
      const made = calls(fx);
      assert.deepEqual(
        made.map((c) => c.argv),
        [["ci"], ["run", "build", "--if-present"]],
      );
      assert.ok(made.every((c) => c.cwd === real(path.join(fx.orgDir, "a"))));
    });
  });

  describe("selection errors", () => {
    for (const orgPackage of [true, false]) {
      test(`org-extensions::an unknown name exits 1, lists the available names, runs no npm (Mode ${orgPackage ? "A" : "B"})`, () => {
        const fx = fixture({ extensions: ["a", "b"], orgPackage, locks: true });

        const result = run(fx, ["install", "ghost"]);

        assert.equal(result.status, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
        assert.match(result.stderr, /ghost/);
        assert.match(result.stderr, /\ba\b/);
        assert.match(result.stderr, /\bb\b/);
        assert.deepEqual(calls(fx), []);
      });
    }

    test("org-extensions::an unknown name beside a valid one still exits 1 before any npm call", () => {
      const fx = fixture({
        extensions: ["a", "b"],
        orgPackage: true,
        locks: true,
      });

      const result = run(fx, ["install", "a", "ghost"]);

      assert.equal(result.status, 1);
      assert.match(result.stderr, /ghost/);
      assert.deepEqual(calls(fx), []);
    });
  });

  test("org-extensions::npm is never run at the repository root", () => {
    for (const orgPackage of [true, false]) {
      const fx = fixture({ extensions: ["a"], orgPackage, locks: true });

      run(fx, ["install"]);
      run(fx, ["build"]);

      assert.ok(calls(fx).length > 0, "npm was never called");
      assert.ok(calls(fx).every((c) => c.cwd !== real(fx.root)));
    }
  });
});
