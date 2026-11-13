// skill-scripts-gitlab-ci-copied.test.ts — the four gitlab-ci scripts run from a copy of the WHOLE
// skill directory placed outside the repository, under every package layout (spec 0301 R10): no
// Node warning on stderr, `--help` clean, and the exit-code contract of each script holds.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { copySkill, envelope, glabStub, run, tempDir, type ScriptName } from "./lib/skill-scripts-gitlab-ci-cli.ts";
import { type Layout, LAYOUT_PACKAGE } from "./lib/skill-scripts-observe.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const root = tempDir("gitlab-ci-copied-");
after(() => fs.rmSync(root, { recursive: true, force: true }));
assert.ok(!root.startsWith(REPO), "the copies must live outside the repository");

const WARNING = /\bWarning\b|MODULE_TYPELESS_PACKAGE_JSON|ExperimentalWarning|DeprecationWarning/;
const SCRIPTS: ScriptName[] = [
  "lint-gitlab-ci",
  "check-rules",
  "check-pinned-images",
  "check-secrets-exposure",
];
const glab = glabStub(root);

describe("gitlab-ci scripts from a copy of the whole skill directory", () => {
  for (const layout of Object.keys(LAYOUT_PACKAGE) as Layout[]) {
    describe(`layout ${layout}`, () => {
      const base = path.join(root, layout);
      fs.mkdirSync(base, { recursive: true });
      const dir = copySkill(base);
      const pkg = LAYOUT_PACKAGE[layout];
      if (pkg !== undefined) fs.writeFileSync(path.join(dir, "package.json"), pkg);
      assert.ok(!fs.existsSync(path.join(dir, "evals")), "the built skill ships no evals/");
      const work = path.join(base, "work");
      fs.mkdirSync(work);
      fs.writeFileSync(path.join(work, "ci.yml"), "workflow:\n  rules:\n    - if: $X\nbuild:\n  script: make\n");

      test("--help of each script: usage on stdout, exit 0, no stderr", () => {
        for (const s of SCRIPTS) {
          const r = run(dir, s, ["--help"], { cwd: work });
          assert.equal(r.status, 0, s);
          assert.equal(r.stderr, "", s);
          assert.notEqual(r.stdout, "", s);
        }
      });
      test("lint-gitlab-ci: valid via the stub exits 0, a missing file exits 3, no warning", () => {
        const ok = run(dir, "lint-gitlab-ci", ["ci.yml", "--json"], { cwd: work, env: glab.replay("valid") });
        assert.equal(ok.status, 0, ok.stdout + ok.stderr);
        assert.doesNotMatch(ok.stderr, WARNING);
        const bad = run(dir, "lint-gitlab-ci", ["nope.yml"], { cwd: work, env: glab.replay("valid") });
        assert.equal(bad.status, 3);
        assert.doesNotMatch(bad.stderr, WARNING);
      });
      test("check-rules: clean exits 0, a missing target exits 3, no warning", () => {
        const ok = run(dir, "check-rules", ["ci.yml", "--json"], { cwd: work });
        assert.equal(ok.status, 0, ok.stdout + ok.stderr);
        assert.equal(envelope(ok).ok, true);
        assert.doesNotMatch(ok.stderr, WARNING);
        assert.equal(run(dir, "check-rules", ["nope.yml"], { cwd: work }).status, 3);
      });
      test("legacy scripts keep their legacy exit codes: 0 clean, 1 missing target, 2 usage", () => {
        for (const s of ["check-pinned-images", "check-secrets-exposure"] as const) {
          const ok = run(dir, s, ["ci.yml"], { cwd: work });
          assert.equal(ok.status, 0, `${s}: ${ok.stdout}${ok.stderr}`);
          assert.doesNotMatch(ok.stderr, WARNING);
          assert.equal(run(dir, s, ["nope.yml"], { cwd: work }).status, 1, s);
          assert.equal(run(dir, s, [], { cwd: work }).status, 2, s);
        }
      });
    });
  }
});
