// check-launcher-types.test.ts — the strict type check of the organization launcher (spec 0314 R12;
// plan of issue #2101, steps 11 to 13): scripts/check-launcher-types.ts and scripts/lib/launcher-types.ts.
//
// The launcher has no extension, so the check copies it to crewrig.js in a temporary directory and runs
// the repository's tsc there. These cases prove that the shipped launcher passes and that the check fails
// when it should: a type error (reported against the `--file` path and the right line, never the
// temporary directory), a top-level await, a missing `// @ts-check` or leading "use strict", and, with
// status 2, a missing tsc or @types/node. Run `npm ci` first: tsc and @types/node come from node_modules.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { checkLauncher } from "../lib/launcher-types.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const CHECK = path.join(REPO, "scripts", "check-launcher-types.ts");
const SHIPPED = path.join(REPO, "templates", "org-repo", "crewrig");
const NODE_OPTIONS_OFF = "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON";

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix)));
  temps.push(dir);
  return dir;
}

interface Run {
  status: number | null;
  out: string;
}

/** Run the CLI; `root` is the repository root it uses, `scratch` the temporary directory it may use. */
function check(args: string[], root: string = REPO, scratch?: string): Run {
  const env: NodeJS.ProcessEnv = { ...process.env, CREWRIG_REPO_DIR: root };
  for (const key of Object.keys(env)) if (/^git_/i.test(key)) delete env[key];
  if (scratch !== undefined) {
    env.TMPDIR = scratch;
    env.TEMP = scratch;
    env.TMP = scratch;
  }
  const res = spawnSync(process.execPath, [NODE_OPTIONS_OFF, CHECK, ...args], {
    cwd: REPO,
    env,
    encoding: "utf8",
  });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
}

/** A copy of the shipped launcher, changed by `edit`, in a directory of its own; returns its path. */
function variant(edit: (lines: string[]) => string[]): string {
  const lines = fs.readFileSync(SHIPPED, "utf8").split("\n");
  const file = path.join(tempDir("launcher-types-test-"), "crewrig");
  fs.writeFileSync(file, edit(lines).join("\n"));
  return file;
}

const appended = (extra: string[]) => (lines: string[]) => [...lines, ...extra];

describe("the shipped launcher", () => {
  test("passes the strict type check, and the check leaves no temporary directory behind", () => {
    const scratch = tempDir("launcher-types-scratch-");

    const run = check([], REPO, scratch);

    assert.equal(run.status, 0, run.out);
    assert.match(run.out, /check-launcher-types: OK/);
    assert.deepEqual(fs.readdirSync(scratch), []);
  });
});

describe("a type error", () => {
  test("exits 1 and names the --file path and the injected line, not the temporary directory", () => {
    const scratch = tempDir("launcher-types-scratch-");
    const file = variant(appended(["/** @type {number} */", 'const injected = "x";', ""]));
    const line = fs.readFileSync(file, "utf8").split("\n").indexOf('const injected = "x";') + 1;

    const run = check(["--file", file], REPO, scratch);

    assert.equal(run.status, 1, run.out);
    assert.ok(run.out.includes(`${file}:${line}:`), `names ${file}:${line}: ${run.out}`);
    assert.match(run.out, /error TS2322/);
    assert.ok(!run.out.includes(scratch), "the temporary directory is not named");
    assert.ok(!/crewrig\.js\(/.test(run.out), "tsc's own file name is mapped back");
    assert.match(run.out, /check-launcher-types: FAILED/);
    assert.deepEqual(fs.readdirSync(scratch), [], "the copy is deleted even on failure");
  });

  test("the --file=<path> form is accepted too", () => {
    const file = variant(appended(["/** @type {number} */", 'const injected = "x";', ""]));

    const run = check([`--file=${file}`]);

    assert.equal(run.status, 1, run.out);
    assert.ok(run.out.includes(`${file}:`), run.out);
  });

  test("a missing property is reported, so the check is a real type check", () => {
    const file = variant(appended(["const probe = { a: 1 };", "probe.nope;", ""]));

    const run = check(["--file", file]);

    assert.equal(run.status, 1, run.out);
    assert.match(run.out, /error TS2339/);
  });

  test("an implicit any is an error: the check is strict", () => {
    const file = variant(appended(["function untyped(x) { return x; }", "untyped(1);", ""]));

    const run = check(["--file", file]);

    assert.equal(run.status, 1, run.out);
    assert.match(run.out, /error TS7006/);
  });

  test("a top-level await fails", () => {
    const file = variant(appended(["await Promise.resolve();", ""]));

    const run = check(["--file", file]);

    assert.equal(run.status, 1, run.out);
    assert.match(run.out, /error TS/);
  });
});

describe("header defects exit 1", () => {
  test("a missing // @ts-check on line 2", () => {
    const file = variant((lines) => [lines[0] ?? "", "// not the check", ...lines.slice(2)]);

    const run = check(["--file", file]);

    assert.equal(run.status, 1, run.out);
    assert.match(run.out, /line 2 must be '\/\/ @ts-check'/);
  });

  test("a first statement that is not use strict", () => {
    const file = variant((lines) => [...lines.slice(0, 2), "const early = 1;", ...lines.slice(2)]);

    const run = check(["--file", file]);

    assert.equal(run.status, 1, run.out);
    assert.match(run.out, /first statement must be '"use strict";'/);
  });

  test("no use strict at all", () => {
    const file = variant((lines) => lines.filter((line) => line !== '"use strict";'));

    const run = check(["--file", file]);

    assert.equal(run.status, 1, run.out);
    assert.match(run.out, /use strict/);
  });

  test("a missing shebang", () => {
    const file = variant((lines) => lines.slice(1));

    const run = check(["--file", file]);

    assert.equal(run.status, 1, run.out);
    assert.match(run.out, /line 1 must be '#!\/usr\/bin\/env node'/);
  });

  test("a launcher that does not exist", () => {
    const run = check(["--file", path.join(tempDir("launcher-types-test-"), "absent")]);

    assert.equal(run.status, 1, run.out);
    assert.match(run.out, /absent or unreadable/);
  });
});

describe("a wiring fault exits 2", () => {
  /** A repository root holding the launcher, and optionally the real typescript, but no @types/node. */
  function fakeRoot(withTypescript: boolean): string {
    const root = tempDir("launcher-types-root-");
    const dest = path.join(root, "templates", "org-repo");
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(SHIPPED, path.join(dest, "crewrig"));
    if (withTypescript) {
      fs.mkdirSync(path.join(root, "node_modules"));
      fs.symlinkSync(
        path.join(REPO, "node_modules", "typescript"),
        path.join(root, "node_modules", "typescript"),
        "junction",
      );
    }
    return root;
  }

  test("a missing tsc: status 2, through the CLI and through the library", () => {
    const root = fakeRoot(false);

    const cli = check([], root);
    const lib = checkLauncher(root);

    assert.equal(cli.status, 2, cli.out);
    assert.match(cli.out, /tsc not found/);
    assert.match(cli.out, /check-launcher-types: ERROR/);
    assert.equal(lib.status, 2);
  });

  test("a missing @types/node: status 2", () => {
    const root = fakeRoot(true);

    const cli = check([], root);
    const lib = checkLauncher(root);

    assert.equal(cli.status, 2, cli.out);
    assert.match(cli.out, /@types\/node not found/);
    assert.equal(lib.status, 2);
  });

  for (const args of [["--bogus"], ["--file"], ["--file", ""], ["a", "b"], ["--file=", "x"]]) {
    test(`a usage error (${JSON.stringify(args)}) is status 2`, () => {
      const run = check(args);

      assert.equal(run.status, 2, run.out);
      assert.match(run.out, /usage/);
    });
  }
});
