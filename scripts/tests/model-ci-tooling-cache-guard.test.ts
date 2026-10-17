// model-ci-tooling-cache-guard.test.ts — shell versus TypeScript twin of ci-cache-guard (spec 0262
// req 10, 21, 23): same key, marker, log lines, option rejections and passed-through status, on
// scratch sandboxes only (the cache directory is inside each sandbox). Shell legs are POSIX only.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import {
  createDifferential,
  type Differential,
  type DiffCase,
  type SideCtx,
} from "./lib/bash-suite-differential.ts";

const posix = process.platform === "win32" ? { skip: "shell legs need bash" } : {};
const CASE: DiffCase = { script: "scripts/ci-cache-guard.sh" };

function put(ctx: SideCtx, rel: string, body: string): void {
  const file = path.join(ctx.root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

function seed(ctx: SideCtx): void {
  put(ctx, "k/a.txt", "alpha\n");
  put(ctx, "k/sub/b.md", "beta\n");
  put(ctx, "k/sub/deep/c.md", "gamma\n");
  put(ctx, "k/.hidden.md", "dot\n");
  put(ctx, "k/Z.md", "upper\n");
}

// ONE pair of sandboxes for the whole file: building them is the cost. Cases that write a marker
// use their own cache directory.
let shared: Differential | undefined;
function diff(): Differential {
  shared ??= createDifferential(CASE, { setup: seed });
  return shared;
}
after(() => shared?.cleanup());

function agree(args: string[], env: Record<string, string> = {}, compareState?: boolean) {
  const r = diff().run({
    ...CASE,
    args,
    env,
    ...(compareState === undefined ? {} : { compareState }),
  });
  assert.deepEqual(r.diffs, []);
  return r;
}

describe("ci-cache-guard twin: option rejections", posix, () => {
  const rows: Array<[string, string[], number]> = [
    ["unknown option", ["--bogus", "--", "true"], 2],
    ["no command", ["--cache-dir", "c", "--"], 2],
    ["no arguments", [], 2],
    ["stray-scan with cache-dir", ["--stray-scan", "--cache-dir", "c", "--", "true"], 2],
    ["stray-scan with key-files", ["--key-files", "a", "--stray-scan", "--", "true"], 2],
    ["stray-scan with key-env", ["--stray-scan", "--key-env", "A", "--", "true"], 2],
  ];
  for (const [name, args, status] of rows) {
    test(name, () => assert.equal(agree(args).shell.status, status));
  }
});

describe("ci-cache-guard twin: cache mode", posix, () => {
  test("miss, then hit, then a changed key file misses again", () => {
    const d = diff();
    {
      const args = [
        "--cache-dir",
        "cache-mh",
        "--key-files",
        "k/a.txt,k/**/*.md,none*,absent.txt",
        "--key-env",
        "FOO,BAR",
        "--",
        "bash",
        "-c",
        "echo ran",
      ];
      const env = { FOO: "1" };
      const miss = d.run({ ...CASE, args, env });
      assert.deepEqual(miss.diffs, []);
      assert.match(
        miss.shell.stdout,
        /cache miss, running: bash -c echo ran\nran\nci-cache-guard: wrote marker cache-mh\/[0-9a-f]{64}\/[0-9a-f]{64}\.marker\n/,
      );
      const hit = d.run({ ...CASE, args, env });
      assert.deepEqual(hit.diffs, []);
      assert.match(hit.shell.stdout, /^ci-cache-guard: cache hit for: /);
      const other = d.run({ ...CASE, args, env: { FOO: "2" } });
      assert.deepEqual(other.diffs, []);
      assert.match(other.shell.stdout, /cache miss/);
      for (const ctx of Object.values(d.ctx)) put(ctx, "k/sub/deep/c.md", "changed\n");
      const changed = d.run({ ...CASE, args, env });
      assert.deepEqual(changed.diffs, []);
      assert.match(changed.shell.stdout, /cache miss/);
    }
  });

  test("a failing command passes its status through and writes no marker", () => {
    const r = agree([
      "--cache-dir",
      "cache-fail",
      "--",
      "bash",
      "-c",
      "echo out; echo err >&2; exit 7",
    ]);
    assert.equal(r.shell.status, 7);
    assert.doesNotMatch(r.shell.stdout, /wrote marker/);
  });

  test("builtins and a missing command behave as under the shell", () => {
    assert.equal(agree(["--cache-dir", "cache-b1", "--", "exit", "3"]).shell.status, 3);
    const r = agree(["--cache-dir", "cache-b2", "--", "no_such_command_xyz"]);
    assert.equal(r.shell.status, 127);
    assert.match(r.shell.stderr, /line 218: no_such_command_xyz: command not found/);
  });

  test("glob forms: hidden names, character classes and a trailing **", () => {
    agree([
      "--cache-dir",
      "cache-glob",
      "--key-files",
      "k/*.md,k/.*.md,k/[a-z]*,k/**,k/sub/?.md",
      "--",
      "true",
    ]);
  });
});

describe("ci-cache-guard twin: real capability key-file lists", posix, () => {
  test("every --key-files list of .github/workflows/build.yml derives the same marker", () => {
    const ref = fs.readFileSync(
      path.join(import.meta.dirname, "..", "..", ".github", "workflows", "build.yml"),
      "utf8",
    );
    const lists = [
      ...new Set([...ref.matchAll(/--key-files "([^"]*)"/g)].map((m) => m[1] as string)),
    ];
    assert.ok(lists.length > 5, "the reference declares key-file lists");
    lists.forEach((list, n) =>
      agree(["--cache-dir", `cache-real-${n}`, "--key-files", list, "--", "true"], {}, false),
    );
  });
});

describe("ci-cache-guard twin: TS-only diagnostics (spec 0262 req 24 (c))", () => {
  test("an option without a value prints one Error line and exits 1", () => {
    const r = spawnSync(
      process.execPath,
      [
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        path.join(import.meta.dirname, "..", "ci-cache-guard.ts"),
        "--cache-dir",
      ],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^Error: .*ci-cache-guard\.sh: option '--cache-dir' needs a value\n$/);
    assert.equal(r.stdout, "");
  });
});

describe("ci-cache-guard twin: --stray-scan", posix, () => {
  const scan = (...cmd: string[]) => agree(["--stray-scan", "--", ...cmd]);
  test("a clean command passes its output and status through", () => {
    const r = scan("bash", "-c", "echo out; echo err >&2; exit 4");
    assert.equal(r.shell.status, 4);
  });
  test("a stray after a clean command exits 70 with the report", () => {
    const r = scan("bash", "-c", "bogus_cmd_q || true");
    assert.equal(r.shell.status, 70);
    assert.match(
      r.shell.stderr,
      /STRAY in: bash -c bogus_cmd_q \|\| true\n  bash: line 1: bogus_cmd_q: command not found/,
    );
  });
  test("a stray after a failing command keeps its status", () => {
    assert.equal(scan("bash", "-c", "bogus_cmd_q").shell.status, 127);
  });
  test("a command missing from the guard's own shell names line 143", () => {
    const r = scan("no_such_command_xyz");
    assert.match(r.shell.stderr, /line 143: no_such_command_xyz: command not found/);
  });
  test("the exit builtin leaves no status: 1, as the shell reads it", () => {
    assert.equal(scan("exit", "3").shell.status, 1);
  });
});
