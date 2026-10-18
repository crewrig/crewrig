// check-test-strays.test.ts — edge cases the retired Bash suite did not cover (spec 0259):
// the win32 skip branch (injected platform), a missing bash, and the options.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { runTestStrays } from "../lib/governance/test-strays.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECK = path.join(REPO, "scripts", "check-test-strays.ts");
const roots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "strays-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "scripts", "tests"), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, "scripts", "tests", name), body);
  }
  return root;
}

function run(args: string[], root: string, env: NodeJS.ProcessEnv = {}) {
  const res = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", CHECK, ...args],
    {
      encoding: "utf8",
      env: { ...process.env, CREWRIG_REPO_DIR: root, ...env },
    },
  );
  return { code: res.status, out: res.stdout, err: res.stderr };
}

after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

describe("check-test-strays", () => {
  test("win32 prints one SKIP line and exits 0 without spawning bash", () => {
    const root = fixture({ "test-bad.sh": "if then\n" });
    const res = runTestStrays([], { repoDir: root, platform: "win32" });
    assert.equal(res.code, 0);
    assert.equal(res.stderr, "");
    assert.match(res.stdout, /^SKIP: .*Linux only.*row J4.*\n$/);
    assert.equal(res.stdout.split("\n").length, 2);
  });

  test("a missing bash is an Error line with exit 2", () => {
    const root = fixture({ "test-a.sh": "true\n" });
    const r = run([], root, { PATH: path.join(root, "nowhere") });
    assert.equal(r.code, 2);
    assert.match(r.err, /^Error: cannot run bash: /);
    assert.equal(r.out, "");
  });

  test("the three options consume a value and are ignored", () => {
    const root = fixture({ "test-a.sh": "true\n" });
    const r = run(["--base-ref", "x", "--cache-dir", "y", "--jobs", "3"], root);
    assert.equal(r.code, 0);
    assert.equal(r.out, "OK: 1 test suites pass the static syntax check; none executed.\n");
  });

  test("an option without a value exits 2", () => {
    const root = fixture({});
    const r = run(["--jobs"], root);
    assert.equal(r.code, 2);
    assert.equal(r.err, "Error: option '--jobs' requires a value\n");
  });

  test("an unknown argument exits 2", () => {
    const root = fixture({});
    const r = run(["foo"], root);
    assert.equal(r.code, 2);
    assert.equal(r.err, "Error: unknown option or argument 'foo'\n");
  });

  test("a syntax error stops at the first failing suite in order", () => {
    const root = fixture({ "test-b.sh": "if then\n", "test-a.sh": "fi\n", "test-c.sh": "true\n" });
    const r = run([], root);
    assert.equal(r.code, 1);
    assert.match(r.err, /^FAILED: test-a\.sh has syntax errors:\n.*test-a\.sh: line 1/);
  });
});
