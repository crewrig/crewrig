// skill-scripts-github-actions-copied.test.ts — the github-actions scripts run from a copy of the
// WHOLE skill directory placed outside the repository, under every package layout (spec 0300
// R21): a script that imports a repository file fails, and none prints a Node warning.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  ACTION_YML,
  ALL_SCRIPTS,
  checkStates,
  parseEnvelope,
  run,
  SKILL_DIR,
  tempDir,
  WF_CLEAN,
  writeTree,
} from "./lib/skill-scripts-github-actions-cli.ts";
import { type Layout, LAYOUT_PACKAGE } from "./lib/skill-scripts-observe.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const root = tempDir("gha-copied-");
after(() => fs.rmSync(root, { recursive: true, force: true }));
assert.ok(!root.startsWith(REPO), "the copies must live outside the repository");

const WARNING = /\bWarning\b|MODULE_TYPELESS_PACKAGE_JSON|ExperimentalWarning|DeprecationWarning/;
const BAD = "name: t\non: push\njobs:\n  b:\n    runs-on: x\n    steps:\n      - run: echo hi\n";

describe("github-actions scripts from a copy of the whole skill directory", () => {
  for (const layout of Object.keys(LAYOUT_PACKAGE) as Layout[]) {
    describe(`layout ${layout}`, () => {
      const dir = path.join(root, layout, "github-actions");
      fs.mkdirSync(dir, { recursive: true });
      fs.cpSync(SKILL_DIR, dir, { recursive: true });
      const pkg = LAYOUT_PACKAGE[layout];
      if (pkg !== undefined) fs.writeFileSync(path.join(dir, "package.json"), pkg);
      const work = path.join(root, layout, "work");
      writeTree(work, {
        "ok.yml": WF_CLEAN,
        "bad.yml": BAD,
        "action.yml": ACTION_YML,
        "repo/.github/workflows/ci.yml": WF_CLEAN,
      });

      test("--help of every script is clean from the copy", () => {
        for (const s of ALL_SCRIPTS) {
          const r = run(s, ["--help"], { cwd: work, skillDir: dir });
          assert.equal(r.status, 0, s);
          assert.equal(r.stderr, "", s);
        }
      });
      test("the three new checks: exit 0 on a clean file, exit 1 on a finding, no warning", () => {
        for (const s of [
          "check-permissions",
          "check-pull-request-target",
          "check-expression-injection",
        ] as const) {
          const ok = run(s, ["ok.yml", "--json"], { cwd: work, skillDir: dir });
          assert.equal(ok.status, 0, ok.stdout + ok.stderr);
          assert.doesNotMatch(ok.stderr, WARNING);
          assert.equal(parseEnvelope(ok).ok, true);
        }
        const bad = run("check-permissions", ["bad.yml"], { cwd: work, skillDir: dir });
        assert.equal(bad.status, 1);
        assert.doesNotMatch(bad.stderr, WARNING);
      });
      test("check-pinned-actions and check-secrets-exposure run from the copy", () => {
        for (const s of ["check-pinned-actions", "check-secrets-exposure"] as const) {
          const r = run(s, ["ok.yml"], { cwd: work, skillDir: dir });
          assert.equal(r.status, 0, s + r.stdout + r.stderr);
          assert.doesNotMatch(r.stderr, WARNING);
        }
      });
      test("resolve-engine resolves a repository from the copy", () => {
        const r = run("resolve-engine", ["--root", path.join(work, "repo"), "--json"], {
          cwd: work,
          skillDir: dir,
        });
        assert.equal(r.status, 0, r.stdout + r.stderr);
        assert.doesNotMatch(r.stderr, WARNING);
        assert.match(JSON.stringify(parseEnvelope(r).data), /github-actions/);
      });
      test("validate-pipeline finds its sibling checks in the copy: clean exit 0, bad exit 1", () => {
        const ok = run("validate-pipeline", [path.join(work, "repo"), "--json"], {
          cwd: work,
          skillDir: dir,
        });
        assert.equal(ok.status, 0, ok.stdout + ok.stderr);
        assert.doesNotMatch(ok.stderr, WARNING);
        const states = checkStates(parseEnvelope(ok));
        for (const c of [
          "check-pinned-actions",
          "check-permissions",
          "check-pull-request-target",
          "check-expression-injection",
          "check-secrets-exposure",
        ])
          assert.equal(states.get(c), "ran", c);
        const bad = run("validate-pipeline", [path.join(work, "bad.yml")], {
          cwd: work,
          skillDir: dir,
        });
        assert.equal(bad.status, 1);
        assert.doesNotMatch(bad.stderr, WARNING);
      });
      test("every script is one file that imports nothing from the repository", () => {
        for (const s of ALL_SCRIPTS) {
          const src = fs.readFileSync(path.join(dir, "scripts", `${s}.ts`), "utf8");
          assert.doesNotMatch(src, /^\s*import\s[^(]*from\s/m, `${s} has a static import`);
          assert.doesNotMatch(
            src,
            /\bimport\((?!["']node:)|\brequire\(/,
            `${s} has a dynamic import`,
          );
        }
      });
    });
  }
});
