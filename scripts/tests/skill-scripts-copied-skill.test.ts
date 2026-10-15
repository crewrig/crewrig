// skill-scripts-copied-skill.test.ts — `pr-reviewer/scripts/lint-skill.ts` shipped alone (spec 0258
// R2, R3). A skill is copied into a project with nothing above it, so `js-yaml` cannot resolve:
// the entry announces the line fallback once, still reports a missing key, exits 1 and never lets
// a module-resolution error escape. Run from a repository checkout, `js-yaml` resolves, the YAML
// leg runs and no note is printed.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { scriptFile } from "./lib/skill-scripts-observe.ts";

const NOTE =
  "lint-skill: js-yaml not found — using line fallback for the required keys and the version; run it from a CrewRig checkout after setup for the full check.\n";
const NO_NAME =
  "---\ndescription: d\nlicense: MIT\ncompatibility: c\nmetadata:\n  provenance:\n    version: 1.0.0\n---\nBody\n";

let root = "";
let work = "";
let copied = "";

function run(entry: string): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [entry, "SKILL.md"], {
    cwd: work,
    env: { HOME: root, TMPDIR: root, PATH: path.dirname(process.execPath), LC_ALL: "C" },
    encoding: "utf8",
    timeout: 30_000,
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

describe("pr-reviewer/lint-skill copied alone", () => {
  before(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "skill-copied-")));
    work = path.join(root, "work"); // a directory without node_modules, with none above it
    fs.mkdirSync(work);
    fs.writeFileSync(path.join(work, "SKILL.md"), NO_NAME);
    const alone = path.join(root, "alone");
    fs.mkdirSync(alone);
    copied = path.join(alone, "lint-skill.ts");
    fs.copyFileSync(scriptFile("pr-reviewer/lint-skill", "ts"), copied);
  });
  after(() => fs.rmSync(root, { recursive: true, force: true }));

  test("the copy alone prints the fallback note and reports the missing key", () => {
    const res = run(copied);
    assert.equal(res.status, 1);
    assert.equal(res.stderr, "");
    assert.equal(res.stdout, `${NOTE}SKILL.md: missing required frontmatter key: name\n`);
    assert.doesNotMatch(res.stdout + res.stderr, /ERR_MODULE_NOT_FOUND|Cannot find module/);
  });

  test("from the checkout js-yaml resolves: the YAML leg runs and prints no note", () => {
    const res = run(scriptFile("pr-reviewer/lint-skill", "ts"));
    assert.equal(res.status, 1);
    assert.equal(res.stderr, "");
    assert.ok(!res.stdout.includes("using line fallback"), res.stdout);
    assert.match(res.stdout, /^SKILL\.md: missing required frontmatter key: name$/m);
    assert.doesNotMatch(res.stdout + res.stderr, /ERR_MODULE_NOT_FOUND|Cannot find module/);
  });
});
