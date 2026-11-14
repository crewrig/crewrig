// Black-box tests of scripts/rules-split-ab.ts. Each child gets an explicit environment: CI is deleted
// for --dry-run cases and set to "true" for the refusal case; a claude stub on PATH fails the test if spawned.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const runner = path.resolve(here, "..", "rules-split-ab.ts");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ab-runner-test-"));
const sentinel = path.join(tmp, "claude-was-spawned");
fs.mkdirSync(path.join(tmp, "bin"));
fs.writeFileSync(path.join(tmp, "bin", "claude"), `#!/bin/sh\necho spawned > '${sentinel}'\nexit 99\n`, { mode: 0o755 });
const toolsFile = path.join(tmp, "60-tools.md");
const memoryFile = path.join(tmp, "60-memory.md");
fs.writeFileSync(toolsFile, "# tools\n");
fs.writeFileSync(memoryFile, "# memory\n");
const rules = ["--arm-a-rule", toolsFile, "--arm-b-rule", toolsFile, "--arm-b-rule", memoryFile];

function run(args: string[], env: Record<string, string | undefined>) {
  const e: Record<string, string | undefined> = { ...process.env, PATH: `${path.join(tmp, "bin")}${path.delimiter}${process.env.PATH}`, ...env };
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", runner, ...args], {
    encoding: "utf8",
    env: e as NodeJS.ProcessEnv,
    timeout: 30000,
  });
}

describe("rules-split-ab runner", () => {
  test("--dry-run lists the plan and spawns nothing (CI unset)", () => {
    fs.rmSync(sentinel, { force: true });
    const r = run(["--dry-run", ...rules], { CI: undefined });
    assert.equal(r.status, 0, r.stderr);
    for (let n = 1; n <= 8; n++) assert.match(r.stdout, new RegExp(`scenario ${n}\\b`));
    assert.match(r.stdout, /arm A/);
    assert.match(r.stdout, /arm B/);
    assert.match(r.stdout, /claude-sonnet-5-5/);
    assert.match(r.stdout, /--max-budget-usd 0\.6/);
    assert.match(r.stdout, /cap 12/);
    assert.equal(fs.existsSync(sentinel), false);
  });

  test("--dry-run is not affected by CI", () => {
    fs.rmSync(sentinel, { force: true });
    const r = run(["--dry-run", ...rules], { CI: "true" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(sentinel), false);
  });

  test("the dry-run passes --settings for scenario 2 only", () => {
    const r = run(["--dry-run", ...rules, "--worker-settings", "/w/worker.settings.json"], { CI: undefined });
    const lines = r.stdout.split("\n").filter((l) => l.includes("--settings"));
    assert.ok(lines.length > 0);
    assert.ok(lines.every((l) => /scenario 2\b/.test(l)));
  });

  test("--scenarios narrows the plan", () => {
    const r = run(["--dry-run", ...rules, "--scenarios", "1,8"], { CI: undefined });
    assert.match(r.stdout, /scenario 1\b/);
    assert.match(r.stdout, /scenario 8\b/);
    assert.doesNotMatch(r.stdout, /scenario 2\b/);
  });

  test("a paid run under CI is refused with exit 3 and claude is never spawned", () => {
    fs.rmSync(sentinel, { force: true });
    const r = run([...rules, "--out", path.join(tmp, "out")], { CI: "true" });
    assert.equal(r.status, 3);
    assert.match(r.stderr, /CI/);
    assert.equal(fs.existsSync(sentinel), false);
  });

  test("an unknown scenario is a usage error (exit 2)", () => {
    const r = run(["--dry-run", ...rules, "--scenarios", "9"], { CI: undefined });
    assert.equal(r.status, 2);
  });

  test("a missing rule file is a usage error (exit 2)", () => {
    const r = run(["--dry-run", "--arm-a-rule", path.join(tmp, "nope.md"), "--arm-b-rule", toolsFile], { CI: undefined });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /nope\.md/);
  });

  test("an unknown option is a usage error (exit 2)", () => {
    assert.equal(run(["--bogus"], { CI: undefined }).status, 2);
  });
});
