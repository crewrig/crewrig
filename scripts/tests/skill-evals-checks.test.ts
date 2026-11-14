// skill-evals-checks.test.ts — deterministic checks (spec 0290 R4, R12, R25).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { checkText, resolveInside, runCheck } from "../lib/skill-evals/checks.ts";
import { tmpDir } from "./lib/skill-evals-fixtures.ts";

function dirs() {
  const root = tmpDir("skill-evals-checks-");
  const outputsDir = path.join(root, "outputs");
  const skillDir = path.join(root, "skill");
  fs.mkdirSync(outputsDir, { recursive: true });
  fs.mkdirSync(path.join(skillDir, "scripts"), { recursive: true });
  return { root, outputsDir, skillDir };
}

test("file_exists and file_contains report the observed value", async () => {
  const d = dirs();
  try {
    fs.writeFileSync(path.join(d.outputsDir, "pr-body.md"), "## How to test this PR?\nrun it\n");
    const ctx = { outputsDir: d.outputsDir, skillDir: d.skillDir };
    assert.equal((await runCheck({ type: "file_exists", path: "pr-body.md" }, ctx)).passed, true);
    const missing = await runCheck({ type: "file_exists", path: "nope.md" }, ctx);
    assert.equal(missing.passed, false);
    assert.match(missing.evidence, /observed: file "nope\.md" was not produced/);
    assert.equal(
      (
        await runCheck(
          { type: "file_contains", path: "pr-body.md", pattern: "How to test this PR\\?" },
          ctx,
        )
      ).passed,
      true,
    );
    const no = await runCheck(
      { type: "file_contains", path: "pr-body.md", pattern: "absent" },
      ctx,
    );
    assert.equal(no.passed, false);
    assert.match(no.evidence, /does not match \/absent\//);
    assert.equal(
      checkText({ type: "file_contains", path: "a", pattern: "b" }),
      "check file_contains: a matches /b/",
    );
  } finally {
    fs.rmSync(d.root, { recursive: true, force: true });
  }
});

test("a path may not escape the outputs directory, lexically or through a symlink", async () => {
  const d = dirs();
  try {
    fs.writeFileSync(path.join(d.root, "secret.txt"), "secret");
    fs.symlinkSync(path.join(d.root, "secret.txt"), path.join(d.outputsDir, "link.txt"));
    const ctx = { outputsDir: d.outputsDir, skillDir: d.skillDir };
    for (const p of ["../secret.txt", "link.txt", "/etc/passwd"]) {
      const r = await runCheck({ type: "file_exists", path: p }, ctx);
      assert.equal(r.passed, false, p);
      assert.match(r.evidence, /escapes/);
    }
    assert.equal(resolveInside(d.outputsDir, "a/../b.txt")?.endsWith("outputs/b.txt"), true);
  } finally {
    fs.rmSync(d.root, { recursive: true, force: true });
  }
});

test("exit_code runs the head script with a minimal environment: no credential variable, a throwaway HOME", async () => {
  const d = dirs();
  const saved = { t: process.env["CLAUDE_CODE_OAUTH_TOKEN"], k: process.env["ANTHROPIC_API_KEY"] };
  process.env["CLAUDE_CODE_OAUTH_TOKEN"] = "tok";
  process.env["ANTHROPIC_API_KEY"] = "key";
  try {
    const script = path.join(d.skillDir, "scripts", "probe.sh");
    fs.writeFileSync(
      script,
      '#!/bin/sh\n[ -z "$CLAUDE_CODE_OAUTH_TOKEN" ] && [ -z "$ANTHROPIC_API_KEY" ] || exit 9\n[ "$HOME" != "' +
        (process.env["HOME"] ?? "") +
        '" ] || exit 8\nexit "${1:-0}"\n',
      { mode: 0o755 },
    );
    const ctx = { outputsDir: d.outputsDir, skillDir: d.skillDir };
    const ok = await runCheck(
      { type: "exit_code", script: "scripts/probe.sh", args: ["3"], expected: 3 },
      ctx,
    );
    assert.equal(ok.passed, true, ok.evidence);
    assert.match(ok.evidence, /exit code 3 \(expected 3\)/);
    const bad = await runCheck(
      { type: "exit_code", script: "scripts/probe.sh", args: [], expected: 1 },
      ctx,
    );
    assert.equal(bad.passed, false);
    assert.match(bad.evidence, /exit code 0 \(expected 1\)/);
    const gone = await runCheck(
      { type: "exit_code", script: "scripts/missing.sh", args: [], expected: 0 },
      ctx,
    );
    assert.equal(gone.passed, false);
    assert.equal(
      checkText({ type: "exit_code", script: "scripts/probe.sh", args: ["3"], expected: 3 }),
      "check exit_code: scripts/probe.sh 3 exits with 3",
    );
  } finally {
    for (const [k, v] of [
      ["CLAUDE_CODE_OAUTH_TOKEN", saved.t],
      ["ANTHROPIC_API_KEY", saved.k],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(d.root, { recursive: true, force: true });
  }
});

test("file_not_contains grades an absence deterministically: the file must exist and the pattern must not occur (#1963)", async () => {
  const d = dirs();
  try {
    fs.writeFileSync(
      path.join(d.outputsDir, "ci.yml"),
      "on: push\npermissions:\n  contents: read\n",
    );
    const ctx = { outputsDir: d.outputsDir, skillDir: d.skillDir };
    const absent = await runCheck(
      { type: "file_not_contains", path: "ci.yml", pattern: "pull_request_target" },
      ctx,
    );
    assert.equal(absent.passed, true);
    assert.match(absent.evidence, /does not match \/pull_request_target\//);
    const present = await runCheck(
      { type: "file_not_contains", path: "ci.yml", pattern: "contents: read" },
      ctx,
    );
    assert.equal(present.passed, false);
    assert.match(present.evidence, /matches \/contents: read\/ at "contents: read"/);
    const missing = await runCheck(
      { type: "file_not_contains", path: "nope.yml", pattern: "x" },
      ctx,
    );
    assert.equal(missing.passed, false, "an absence in a file that was never produced is no pass");
    assert.match(missing.evidence, /was not produced/);
    assert.equal(
      checkText({ type: "file_not_contains", path: "a", pattern: "b" }),
      "check file_not_contains: a does not match /b/",
    );
  } finally {
    fs.rmSync(d.root, { recursive: true, force: true });
  }
});
