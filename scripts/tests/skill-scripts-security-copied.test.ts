// skill-scripts-security-copied.test.ts — the three security scripts run from a copy of the WHOLE
// skill directory placed outside the repository, under every package layout (spec 0303 R13): no
// Node warning on stderr, `--help` clean, and the exit-code contract of each script holds. A script
// that imports a repository file fails here.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  copySkill,
  envelope,
  run,
  tempDir,
  toolStubs,
  type ScriptName,
} from "./lib/skill-scripts-security-cli.ts";
import { type Layout, LAYOUT_PACKAGE } from "./lib/skill-scripts-observe.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const root = tempDir("security-copied-");
after(() => fs.rmSync(root, { recursive: true, force: true }));
assert.ok(!root.startsWith(REPO), "the copies must live outside the repository");

const WARNING = /\bWarning\b|MODULE_TYPELESS_PACKAGE_JSON|ExperimentalWarning|DeprecationWarning/;
const SCRIPTS: ScriptName[] = ["security-finding", "dep-audit", "check-secrets-exposure"];
const tools = toolStubs(root);

describe("security scripts from a copy of the whole skill directory", () => {
  for (const layout of Object.keys(LAYOUT_PACKAGE) as Layout[]) {
    describe(`layout ${layout}`, () => {
      const base = path.join(root, layout);
      fs.mkdirSync(base, { recursive: true });
      const dir = copySkill(base);
      const pkg = LAYOUT_PACKAGE[layout];
      if (pkg !== undefined) fs.writeFileSync(path.join(dir, "package.json"), pkg);
      assert.ok(!fs.existsSync(path.join(dir, "evals")), "the built skill ships no evals/");
      const work = path.join(base, "work");
      fs.mkdirSync(path.join(work, "empty"), { recursive: true });
      fs.writeFileSync(path.join(work, "ci.yml"), "build:\n  script: make\n");
      fs.writeFileSync(path.join(work, "a.ts"), "one\n");
      fs.writeFileSync(path.join(work, "report.md"), "No findings.\nExamined: a.ts:1.\n");
      fs.writeFileSync(path.join(work, "bad.md"), "1. [HIGH] x\n");

      test("--help of each script: usage on stdout, exit 0, no stderr", () => {
        for (const s of SCRIPTS) {
          const r = run(dir, s, ["--help"], { cwd: work });
          assert.equal(r.status, 0, s);
          assert.equal(r.stderr, "", s);
          assert.notEqual(r.stdout, "", s);
        }
      });
      test("security-finding: a clean report exits 0, a defective one 1, a missing one 3", () => {
        const ok = run(dir, "security-finding", ["--json", "report.md"], { cwd: work });
        assert.equal(ok.status, 0, ok.stdout + ok.stderr);
        assert.equal(envelope(ok).ok, true);
        assert.doesNotMatch(ok.stderr, WARNING);
        assert.equal(run(dir, "security-finding", ["bad.md"], { cwd: work }).status, 1);
        assert.equal(run(dir, "security-finding", ["nope.md"], { cwd: work }).status, 3);
      });
      test("dep-audit: no manifest exits 0 (nothing-to-audit), a bad root 3, a bad option 2", () => {
        const ok = run(dir, "dep-audit", ["--json", "--root", "empty"], {
          cwd: work,
          env: tools.replay({}),
        });
        assert.equal(ok.status, 0, ok.stdout + ok.stderr);
        assert.equal(envelope(ok).findings[0]?.rule, "nothing-to-audit");
        assert.equal(run(dir, "dep-audit", ["--root", "nope"], { cwd: work }).status, 3);
        assert.equal(run(dir, "dep-audit", ["--nope"], { cwd: work }).status, 2);
      });
      test("check-secrets-exposure: needs --platform (2), scans with it (0), a missing target is 1", () => {
        const noPlatform = run(dir, "check-secrets-exposure", ["ci.yml"], { cwd: work });
        assert.equal(noPlatform.status, 2);
        assert.match(noPlatform.stderr, /--platform <github\|gitlab> is required/);
        const ok = run(dir, "check-secrets-exposure", ["--platform", "gitlab", "ci.yml"], {
          cwd: work,
        });
        assert.equal(ok.status, 0, ok.stdout + ok.stderr);
        assert.doesNotMatch(ok.stderr, WARNING);
        const miss = run(dir, "check-secrets-exposure", ["--platform", "github", "nope.yml"], {
          cwd: work,
        });
        assert.equal(miss.status, 1);
      });
    });
  }
});
