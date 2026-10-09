// build-components-differential-real.test.ts — the unchanged shell script against the entry on
// the REAL corpus (spec 0250 R13, R14, R33(a), R33(c); plan step 22). Linux gate or
// CREWRIG_SHELL_PARITY=1; retires in PR D.
//
// Two scratch roots hold the committed `artifacts/`, `model-mappings/` and `crewrig.config.toml`;
// the shell builds one and the entry the other, and `diff -r` plus a mode-and-hash snapshot say
// they are identical. `--check` runs once per implementation on the checkout itself (read-only:
// `git status` is compared before and after). The shell's real-tree runs cost about two and a
// half minutes each (a `yq` process per field), so the four runs go in parallel and the
// `--check` of the shell is run ONCE. The shell's `--check` also runs the assembly test
// (R33(c)); the entry's does not, and the transform of differential-compare.ts accounts for it.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { expectSame } from "./fixtures/build-components/differential-compare.ts";
import { mkdir, normalise, REPO, runAsync } from "./fixtures/build-components/differential-kit.ts";
import { parityGate } from "./lib/shell-resolve-harness.ts";

const SKIP = parityGate();
const INPUTS = ["artifacts", "model-mappings", "crewrig.config.toml"];

function scratchRoot(): string {
  const root = mkdir("real");
  for (const entry of INPUTS)
    fs.cpSync(path.join(REPO, entry), path.join(root, entry), { recursive: true });
  return root;
}

const status = (): string =>
  spawnSync("git", ["status", "--porcelain", "--", ".claude", ".gemini", ".github", ".agents"], {
    cwd: REPO,
    encoding: "utf8",
  }).stdout;

describe("the real tree: build and --check, shell against entry", { skip: SKIP }, () => {
  test("a build into a scratch root is identical (diff -r, modes, stdout, stderr); --check agrees up to R33(c)", async () => {
    const [a, b, tmpA, tmpB] = [scratchRoot(), scratchRoot(), mkdir("ta"), mkdir("tb")];
    const [tmpC, tmpD] = [mkdir("tc"), mkdir("td")];
    const before = status();
    const started = Date.now();
    const [shell, ts, shellCheck, tsCheck] = await Promise.all([
      runAsync("shell", a, tmpA, ["--target", "all"]),
      runAsync("ts", b, tmpB, ["--target", "all"]),
      runAsync("shell", REPO, tmpC, ["--target", "all", "--check"], false),
      runAsync("ts", REPO, tmpD, ["--target", "all", "--check"], false),
    ]);
    console.log(
      `real-tree differential: four runs in parallel, ${Math.round((Date.now() - started) / 1000)} s`,
    );

    assert.equal(shell.status, 0, shell.stderr);
    assert.equal(ts.status, 0, ts.stderr);
    expectSame("real build", normalise(shell, [a], [tmpA]), normalise(ts, [b], [tmpB]));
    const diff = spawnSync("diff", ["-r", a, b], { encoding: "utf8" });
    assert.equal(diff.status, 0, `diff -r: ${diff.stdout.slice(0, 600)}`);
    const produced = ts.tree.filter((r) => /^F \.(claude|gemini|github|agents)\//.test(r)).length;
    assert.ok(produced > 150, `the build produced the corpus (${produced} files)`);

    assert.equal(shellCheck.status, 0, shellCheck.stderr);
    assert.equal(tsCheck.status, 0, tsCheck.stderr);
    assert.match(tsCheck.stdout, /OK: All generated files match source\.\n$/);
    expectSame(
      "real --check",
      normalise(shellCheck, [REPO], [tmpC]),
      normalise(tsCheck, [REPO], [tmpD]),
      ["c"],
    );
    assert.equal(status(), before, "--check is read-only on the checkout");
  });
});
