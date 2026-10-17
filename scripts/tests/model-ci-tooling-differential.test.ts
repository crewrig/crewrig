// bash-suite-differential.test.ts — positive controls of the shell-versus-TS differential helper
// (spec 0262 req 21, 22, 28). Fixture scripts are generated at runtime; shell legs are POSIX only.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import {
  createDifferential,
  installWrapper,
  runDifferential,
  type SideCtx,
} from "./lib/bash-suite-differential.ts";
import {
  assertNoHomeLeak,
  assertRemotesUnderScratch,
  createScratchRemote,
  git,
  listRealHome,
} from "./lib/scratch-remote.ts";

const posix = process.platform === "win32" ? { skip: "shell legs need bash" } : {};

function put(ctx: SideCtx, rel: string, body: string): void {
  const file = path.join(ctx.root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { mode: 0o755 });
}

const HELLO_SH = 'echo "hello from $PWD"\n';
const helloTs = (text: string): string =>
  `console.log(${JSON.stringify(text)} + " from " + process.cwd());\n`;

describe("bash-suite-differential positive controls", posix, () => {
  test("control 1: mutating ONE implementation's output reports a DIFF", () => {
    const base = { script: "scripts/fx.sh", args: [] as string[] };
    const clean = runDifferential({
      ...base,
      setup: (ctx) => {
        put(ctx, "scripts/fx.sh", HELLO_SH);
        put(ctx, "scripts/fx.ts", helloTs("hello"));
      },
    });
    assert.deepEqual(clean.diffs, [], "unmutated pair must agree (root normalised)");
    const mutated = runDifferential({
      ...base,
      setup: (ctx) => {
        put(ctx, "scripts/fx.sh", HELLO_SH);
        put(ctx, "scripts/fx.ts", helloTs(ctx.side === "ts" ? "hello!" : "hello"));
      },
    });
    assert.equal(mutated.equal, false);
    assert.match(mutated.diffs.join("\n"), /stdout differs/);
  });

  test("control 2: a marker written only on the second run is a state DIFF", () => {
    const d = createDifferential(
      { script: "scripts/fx.sh" },
      {
        setup: (ctx) => {
          put(ctx, "scripts/fx.sh", "[ -e .ran ] && echo second > .marker\ntouch .ran\n");
          put(ctx, "scripts/fx.ts", 'require("node:fs").writeFileSync(".ran", "");\n');
        },
      },
    );
    try {
      const first = d.run({ script: "scripts/fx.sh" });
      assert.deepEqual(first.diffs, [], "first run leaves identical state");
      const second = d.run({ script: "scripts/fx.sh" });
      assert.equal(second.equal, false);
      assert.match(second.diffs.join("\n"), /tree state differs[\s\S]*\.marker/);
    } finally {
      d.cleanup();
    }
  });

  test("control 3: self-comparison of identical copies reports no diff", () => {
    const res = runDifferential({
      script: "scripts/fx.sh",
      tsScript: "scripts/fx.sh",
      tsCommand: ["bash"],
      args: ["{ROOT}/x"],
      env: { WHERE: "{ROOT}" },
      setup: (ctx) =>
        put(ctx, "scripts/fx.sh", 'echo "$PWD $1 $WHERE $HOME"; echo e >&2; exit 3\n'),
    });
    assert.deepEqual(res.diffs, []);
    assert.equal(res.shell.status, 3);
  });

  test("the wrapper drives an unchanged suite, exits with the shell result and records diffs", () => {
    const d = createDifferential(
      { script: "scripts/fx.sh" },
      {
        setup: (ctx) => {
          put(ctx, "scripts/fx.sh", 'echo "arg=$1"; exit 4\n');
          put(
            ctx,
            "scripts/fx.ts",
            `console.log("arg=" + process.argv[2]);\nprocess.exitCode = ${ctx.side === "ts" ? 5 : 4};\n`,
          );
        },
      },
    );
    try {
      const record = installWrapper(d, "fx");
      assert.ok(fs.existsSync(path.join(d.a, "scripts", "fx.sh.shell")));
      const run = spawnSync("bash", ["scripts/fx.sh", "one"], { cwd: d.a, encoding: "utf8" });
      assert.equal(run.status, 4, run.stderr);
      assert.equal(run.stdout, "arg=one\n");
      const lines = fs.readFileSync(record, "utf8").trim().split("\n");
      assert.equal(lines.length, 1);
      const entry = JSON.parse(lines[0] ?? "{}") as { equal: boolean; diffs: string[] };
      assert.equal(entry.equal, false);
      assert.match(entry.diffs.join("\n"), /status differs: shell=4 ts=5/);
    } finally {
      d.cleanup();
    }
  });
});

describe("scratch-remote guards", posix, () => {
  test("a remote URL outside the scratch directory throws (req 22)", () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "scratch-guard-")));
    try {
      const sc = createScratchRemote(tmp);
      const repo = path.join(tmp, "repo");
      fs.mkdirSync(repo);
      git(repo, ["init", "--quiet"]);
      git(repo, ["remote", "add", "origin", sc.bare]);
      assertRemotesUnderScratch(repo, sc.root);
      git(repo, ["remote", "set-url", "origin", "https://example.invalid/x.git"]);
      assert.throws(() => assertRemotesUnderScratch(repo, sc.root), /escapes the scratch/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("the real-HOME leak check fails on a new file only (req 28)", () => {
    const before = listRealHome("/nonexistent-home");
    assertNoHomeLeak(before, new Set(before));
    assert.throws(() => assertNoHomeLeak(before, new Set([...before, "/x/.claude/new"])), /gained/);
  });
});
