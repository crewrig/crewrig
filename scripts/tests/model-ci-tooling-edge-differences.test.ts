// model-ci-tooling-edge-differences.test.ts — TS-only assertions of two edge differences between
// the shell scripts and their TypeScript twins (spec 0262 delta-06 item k). Everything written is
// inside a directory this file created with mkdtemp; nothing is derived from the caller's env.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const NODE_ARGS = ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"];
const posix = process.platform === "win32" ? { skip: "bash and a POSIX path needed" } : {};

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "edge-differences-"));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

let counter = 0;
function fresh(name: string): string {
  const dir = path.join(scratch, `${name}-${counter++}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// A yq stub on PATH: the twin only checks that yq exists and never spawns it.
const binDir = fresh("bin");
fs.writeFileSync(path.join(binDir, "yq"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
const BASE_ENV: NodeJS.ProcessEnv = {
  PATH: `${binDir}${path.delimiter}${process.env["PATH"] ?? ""}`,
};

describe("ci-changeset-coverage: gated commands run with a closed standard input", () => {
  function run(command: string, input: string | undefined) {
    const repo = fresh("repo");
    fs.mkdirSync(path.join(repo, "ci"));
    fs.writeFileSync(
      path.join(repo, "ci", "ci-capabilities.yml"),
      `capabilities:\n  - id: gated\n    changeset-gated: true\n    command:\n      - ${command}\n`,
    );
    return spawnSync(
      "node",
      [...NODE_ARGS, path.join(ROOT, "scripts", "ci-changeset-coverage.ts")],
      { env: { ...BASE_ENV, REPO_DIR: repo }, input, encoding: "utf8" },
    );
  }

  test("cat sees EOF immediately although the parent stdin carries data", posix, () => {
    const r = run("cat", "parent-data\n");
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /parent-data/);
    assert.match(r.stdout, /running \[gated\] cat/);
  });

  test("read returns at once with an empty value", posix, () => {
    const r = run("read x; echo got:$x", "parent-data\n");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^got:$/m);
    assert.doesNotMatch(r.stdout, /parent-data/);
  });
});

describe("ci-cache-guard: --key-env reads the process environment", () => {
  /** Key directory the guard names for one run, or null when no marker was written. */
  function keyFor(name: string, value: string | undefined): string {
    const cache = fresh("cache");
    const env = { ...BASE_ENV };
    if (value !== undefined) env[name] = value;
    const r = spawnSync(
      "node",
      [
        ...NODE_ARGS,
        path.join(ROOT, "scripts", "ci-cache-guard.ts"),
        "--cache-dir",
        cache,
        "--key-env",
        name,
        "--",
        "true",
      ],
      { env, encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
    const keys = fs.readdirSync(cache);
    assert.equal(keys.length, 1);
    return keys[0] as string;
  }

  // CACHE_DIR, KEY_ENV and KEY_FILES are variables the shell script sets internally; the shell
  // reads those internal values through ${!e}, the twin must read the process environment.
  for (const name of ["CACHE_DIR", "KEY_ENV", "KEY_FILES", "APP_CACHE_KEY"]) {
    test(`${name}: the key follows the process value`, posix, () => {
      const a = keyFor(name, "value-a");
      const b = keyFor(name, "value-b");
      const empty = keyFor(name, "");
      const unset = keyFor(name, undefined);
      assert.notEqual(a, b);
      assert.notEqual(a, unset);
      assert.equal(empty, unset);
      assert.equal(keyFor(name, "value-a"), a);
    });
  }
});
