// skill-scripts-secrets-engine-platform.test.ts — the --platform option of the secrets-exposure engine
// on the three copies (spec 0303 R7, R8, R13): the security copy has no default and requires it, a
// sibling copy defaults to its own platform and keeps its legacy help text, and both profiles answer
// as their former scripts did. From a copy of each skill outside the repository.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { SKILLS_ROOT } from "./lib/skill-scripts-observe.ts";
import { copySkill, run, tempDir, type Run } from "./lib/skill-scripts-security-cli.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const root = tempDir("secrets-engine-platform-");
after(() => fs.rmSync(root, { recursive: true, force: true }));
assert.ok(!root.startsWith(REPO), "the copies must live outside the repository");

const security = copySkill(root, "security");
const gha = copySkill(
  path.join(root, "gha"),
  "github-actions",
  path.join(SKILLS_ROOT, "github-actions"),
);
const glc = copySkill(path.join(root, "glc"), "gitlab-ci", path.join(SKILLS_ROOT, "gitlab-ci"));
const work = path.join(root, "work");
fs.mkdirSync(work);
// a GitHub workflow that echoes a secret, a GitLab pipeline with an inline credential, a clean file
fs.writeFileSync(
  path.join(work, "wf.yml"),
  "jobs:\n  a:\n    steps:\n      - run: echo ${{ secrets.TOKEN }}\n",
);
fs.writeFileSync(path.join(work, "pipe.yml"), "variables:\n  PASSWORD: hunter2\n");
fs.writeFileSync(path.join(work, "clean.yml"), "build:\n  script: make\n");

const check = (dir: string, args: string[]): Run =>
  run(dir, "check-secrets-exposure", args, { cwd: work });
const RISK = /\[RISK\]/;

describe("the security copy (no default platform)", () => {
  test("no --platform is a usage error, exit 2, whatever the target", () => {
    for (const args of [["wf.yml"], [], ["clean.yml", "pipe.yml"]]) {
      const r = check(security, args);
      assert.equal(r.status, 2, args.join(" "));
      assert.equal(r.stdout, "");
      assert.match(r.stderr, /--platform <github\|gitlab> is required; no platform is guessed/);
    }
  });
  test("--platform github scans a workflow, --platform gitlab a pipeline", () => {
    const gh = check(security, ["--platform", "github", "wf.yml"]);
    assert.equal(gh.status, 1);
    assert.match(gh.stdout, /wf\.yml:4: echo \$\{\{ secrets\.\* \}\}/);
    const gl = check(security, ["--platform", "gitlab", "pipe.yml"]);
    assert.equal(gl.status, 1);
    assert.match(gl.stdout, RISK);
    assert.equal(check(security, ["--platform", "github", "clean.yml"]).status, 0);
  });
  test("a profile does not apply the other profile's patterns", () => {
    assert.equal(check(security, ["--platform", "gitlab", "wf.yml"]).status, 0);
    assert.equal(check(security, ["--platform", "github", "pipe.yml"]).status, 0);
  });
  test("--platform=<x> is the same as --platform <x>; the option may follow the target", () => {
    const a = check(security, ["--platform", "github", "wf.yml"]);
    const b = check(security, ["--platform=github", "wf.yml"]);
    const c = check(security, ["wf.yml", "--platform", "github"]);
    assert.deepEqual([b.status, b.stdout, b.stderr], [a.status, a.stdout, a.stderr]);
    assert.deepEqual([c.status, c.stdout, c.stderr], [a.status, a.stdout, a.stderr]);
  });
  for (const [name, args, message] of [
    ["a missing value", ["--platform"], /--platform takes one of: github, gitlab \(got nothing\)/],
    ["an unknown value", ["--platform", "jenkins", "wf.yml"], /\(got jenkins\)/],
    ["an empty value", ["--platform=", "wf.yml"], /--platform takes one of/],
    [
      "a repeated option",
      ["--platform", "github", "--platform", "gitlab", "wf.yml"],
      /more than once/,
    ],
    [
      "a repeated option, same value",
      ["--platform=github", "--platform=github", "wf.yml"],
      /more than once/,
    ],
  ] as [string, string[], RegExp][])
    test(`exit 2: ${name}`, () => {
      const r = check(security, args);
      assert.equal(r.status, 2);
      assert.match(r.stderr, message);
    });
  test("two targets, or none, with a platform is still a usage error naming the platform's argument", () => {
    const r = check(security, ["--platform", "github", "a.yml", "b.yml"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /<workflow-file-or-directory>/);
    assert.match(check(security, ["--platform", "gitlab"]).stderr, /<pipeline-file-or-directory>/);
  });
  test("--help alone prints the engine usage, exit 0; with a platform it wins over everything else", () => {
    const alone = check(security, ["--help"]);
    assert.equal(alone.status, 0);
    assert.equal(alone.stderr, "");
    assert.match(alone.stdout, /--platform/);
    const withPlatform = check(security, ["--platform", "bogus", "--help"]);
    assert.equal(withPlatform.status, 0);
    assert.equal(withPlatform.stdout, alone.stdout);
    assert.equal(check(security, ["wf.yml", "--platform", "github", "--help"]).status, 0);
  });
});

describe("a sibling copy keeps its own legacy behaviour", () => {
  test("github-actions: the one-argument form scans a workflow without --platform", () => {
    const r = check(gha, ["wf.yml"]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /wf\.yml:4: echo/);
    assert.equal(check(gha, []).status, 2);
  });
  test("gitlab-ci: the one-argument form scans a pipeline without --platform", () => {
    assert.equal(check(glc, ["pipe.yml"]).status, 1);
    assert.equal(check(glc, ["clean.yml"]).status, 0);
    assert.equal(check(glc, []).status, 2);
  });
  test("an explicit --platform switches the profile on a sibling copy", () => {
    assert.equal(check(gha, ["--platform", "gitlab", "pipe.yml"]).status, 1);
    assert.equal(check(glc, ["--platform", "github", "wf.yml"]).status, 1);
    assert.equal(check(gha, ["--platform", "github", "pipe.yml"]).status, 0);
  });
  test("--help prints the default profile's legacy text, even with --platform given", () => {
    const ghHelp = check(gha, ["--help"]);
    assert.equal(ghHelp.status, 0);
    assert.match(ghHelp.stdout, /^Usage: check-secrets-exposure\.ts <workflow-file-or-directory>/);
    assert.equal(check(gha, ["--platform", "gitlab", "--help"]).stdout, ghHelp.stdout);
    assert.equal(check(gha, ["--platform", "x", "--help"]).stdout, ghHelp.stdout);
    const glHelp = check(glc, ["--help"]);
    assert.match(
      glHelp.stdout,
      /^Usage: node scripts\/check-secrets-exposure\.ts <pipeline-file-or-directory>/,
    );
    assert.equal(check(glc, ["--platform", "github", "--help"]).stdout, glHelp.stdout);
    assert.notEqual(ghHelp.stdout, glHelp.stdout);
  });
  test("gitlab-ci: --help beside another argument is not the help flag (legacy)", () => {
    assert.equal(check(glc, ["clean.yml", "--help"]).status, 2);
  });
  test("a bad --platform value on a sibling copy is exit 2, like on the security copy", () => {
    for (const dir of [gha, glc])
      assert.equal(check(dir, ["--platform", "bogus", "clean.yml"]).status, 2);
  });
});
