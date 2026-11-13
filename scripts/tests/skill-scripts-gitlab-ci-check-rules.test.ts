// skill-scripts-gitlab-ci-check-rules.test.ts — check-rules.ts (spec 0301 R7, R10): the text scan for
// only:/except: and a missing workflow:rules, from a copy of the built skill outside the repository.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { copySkill, envelope, run, tempDir } from "./lib/skill-scripts-gitlab-ci-cli.ts";

const root = tempDir("gitlab-ci-rules-");
after(() => fs.rmSync(root, { recursive: true, force: true }));
const skill = copySkill(root);
let n = 0;
/** A fresh working directory holding `files` (relative path -> rows joined with `|`). */
function fixture(files: Record<string, string>): string {
  const dir = path.join(root, `case-${n++}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [rel, rows] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), `${rows.split("|").join("\n")}\n`);
  }
  return dir;
}
const scan = (dir: string, target: string, extra: string[] = []) => {
  const r = run(skill, "check-rules", [target, ...extra, "--json"], { cwd: dir });
  return { r, env: envelope(r) };
};
const WORKFLOW = "workflow:|  rules:|    - if: $CI_COMMIT_BRANCH";
const rules = (env: ReturnType<typeof envelope>, rule: string) =>
  env.findings.filter((f) => f.rule === rule);

describe("findings", () => {
  test("clean: workflow:rules and jobs using rules only: exit 0, no finding, counts stated", () => {
    const dir = fixture({
      "ci.yml": `${WORKFLOW}|build:|  script: make|  rules:|    - if: $CI_COMMIT_BRANCH|test:|  script: make`,
    });
    const { r, env } = scan(dir, "ci.yml");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(env.ok, true);
    assert.deepEqual(env.findings, []);
    assert.deepEqual(env.data, { files: 1, jobs: 2 });
  });
  test("two legacy jobs and no workflow: two only-except, one missing-workflow-rules error, exit 1", () => {
    const dir = fixture({
      "ci.yml": "a:|  script: x|  only:|    - main|b:|  script: y|  except:|    - tags",
    });
    const { r, env } = scan(dir, "ci.yml");
    assert.equal(r.status, 1);
    assert.equal(env.ok, false);
    const oe = rules(env, "only-except");
    assert.equal(oe.length, 2);
    assert.ok(oe.every((f) => (f.severity ?? "error") === "error"));
    assert.match(oe[0]?.message ?? "", /\ba\b/);
    assert.match(oe[0]?.message ?? "", /\b3\b/, "names the line of only:");
    assert.match(oe[1]?.message ?? "", /\bb\b/);
    assert.match(oe[1]?.message ?? "", /\b7\b/, "names the line of except:");
    const mw = rules(env, "missing-workflow-rules");
    assert.equal(mw.length, 1);
    assert.equal(mw[0]?.severity ?? "error", "error");
  });
  test("a fragment that has an include: gets missing-workflow-rules as a warning, exit 0", () => {
    const dir = fixture({ "ci.yml": "include:|  - local: other.yml|build:|  script: make" });
    const { r, env } = scan(dir, "ci.yml");
    assert.equal(r.status, 0);
    assert.equal(env.ok, true);
    const mw = rules(env, "missing-workflow-rules");
    assert.equal(mw.length, 1);
    assert.equal(mw[0]?.severity, "warning");
  });
  test("a workflow: without rules: under it still lacks workflow:rules", () => {
    const dir = fixture({ "ci.yml": "workflow:|  name: nightly|build:|  script: make" });
    const { r, env } = scan(dir, "ci.yml");
    assert.equal(r.status, 1);
    assert.equal(rules(env, "missing-workflow-rules").length, 1);
  });
  test("nested keys: only:/except: under rules:, variables:, cache:, needs: or a script: block scalar are not findings", () => {
    const dir = fixture({
      "ci.yml": [
        WORKFLOW,
        "build:",
        "  script:",
        "    - |",
        "      echo only: main",
        "      except: nothing",
        "  rules:",
        "    - if: $X",
        "      only: ignored",
        "  variables:",
        "    only: main",
        "    except: tags",
        "  cache:",
        "    only: x",
        "  needs:",
        "    - job: a",
        "      except: y",
      ].join("|"),
    });
    const { r, env } = scan(dir, "ci.yml");
    assert.equal(r.status, 0, JSON.stringify(env));
    assert.deepEqual(rules(env, "only-except"), []);
  });
  test("an only: at the job's first child indentation counts at any indent width, hidden jobs included", () => {
    const dir = fixture({
      "ci.yml": `${WORKFLOW}|.tpl:|    script: x|    only:|      - main|real:|\tscript: y`,
    });
    const { env } = scan(dir, "ci.yml");
    const oe = rules(env, "only-except");
    assert.equal(oe.length, 1);
    assert.match(oe[0]?.message ?? "", /\.tpl/);
  });
  test("reserved keywords and scalar or list values are not jobs", () => {
    const dir = fixture({
      "ci.yml": [
        "default:",
        "  only: main",
        "variables:",
        "  only: main",
        "stages:",
        "  - build",
        "scalar: value",
        "listy:",
        "  - only: main",
      ].join("|"),
    });
    const { r, env } = scan(dir, "ci.yml");
    assert.equal(r.status, 0);
    assert.deepEqual(env.findings, []);
    assert.deepEqual(env.data, { files: 1, jobs: 0 });
  });
  test("anchors, merge keys and extends are not followed: the template carries the finding, once", () => {
    const dir = fixture({
      "ci.yml": [
        WORKFLOW,
        ".base: &base",
        "  script: x",
        "  only:",
        "    - main",
        "a:",
        "  <<: *base",
        "b:",
        "  extends: .base",
        "  script: y",
      ].join("|"),
    });
    const { env } = scan(dir, "ci.yml");
    const oe = rules(env, "only-except");
    assert.equal(oe.length, 1);
    assert.match(oe[0]?.message ?? "", /\.base/);
  });
});

describe("nothing to scan", () => {
  for (const [title, rows] of [
    ["an empty file", ""],
    ["stages, variables and include entries only", "stages:|  - build|variables:|  A: b|include:|  - local: x.yml"],
  ] as [string, string][])
    test(`${title}: no missing-workflow-rules, zero jobs, exit 0`, () => {
      const dir = fixture({ "ci.yml": rows });
      const { r, env } = scan(dir, "ci.yml");
      assert.equal(r.status, 0);
      assert.deepEqual(env.findings, []);
      assert.equal(env.data?.["jobs"], 0);
    });
  test("an empty directory: exit 0, zero files and jobs stated", () => {
    const dir = fixture({});
    fs.mkdirSync(path.join(dir, "empty"));
    const { r, env } = scan(dir, "empty");
    assert.equal(r.status, 0);
    assert.deepEqual(env.data, { files: 0, jobs: 0 });
  });
});

describe("directory mode", () => {
  test("scans .gitlab-ci.yml plus the YAML under .gitlab/, ignores the rest, counts both", () => {
    const dir = fixture({
      "repo/.gitlab-ci.yml": `${WORKFLOW}|build:|  script: make`,
      "repo/.gitlab/deep/jobs.yaml": "legacy:|  script: x|  only:|    - main",
      "repo/.gitlab/notes.txt": "bad:|  only:|    - main",
      "repo/other.yml": "bad:|  only:|    - main",
    });
    const { r, env } = scan(dir, "repo");
    assert.equal(r.status, 1);
    assert.deepEqual(env.data, { files: 2, jobs: 2 });
    assert.equal(rules(env, "only-except").length, 1);
    assert.match(rules(env, "only-except")[0]?.message ?? "", /legacy/);
  });
  test("the workflow may live in another file of the scanned set", () => {
    const dir = fixture({
      "repo/.gitlab-ci.yml": WORKFLOW,
      "repo/.gitlab/jobs.yml": "build:|  script: make",
    });
    const { r, env } = scan(dir, "repo");
    assert.equal(r.status, 0);
    assert.deepEqual(rules(env, "missing-workflow-rules"), []);
  });
});

describe("arguments, targets and output", () => {
  test("missing target: exit 3, precondition, ok false, data null", () => {
    const dir = fixture({});
    const { r, env } = scan(dir, "absent.yml");
    assert.equal(r.status, 3);
    assert.equal(env.ok, false);
    assert.equal(env.data, null);
    assert.equal(env.findings[0]?.rule, "precondition");
    assert.match(env.findings[0]?.message ?? "", /absent\.yml/);
  });
  for (const [title, args] of [
    ["unknown option", ["ci.yml", "--frobnicate"]],
    ["two targets", ["a.yml", "b.yml"]],
  ] as [string, string[]][])
    test(`usage error (${title}): exit 2, rule usage under --json`, () => {
      const dir = fixture({ "ci.yml": "", "a.yml": "", "b.yml": "" });
      assert.equal(run(skill, "check-rules", args, { cwd: dir }).status, 2);
      const j = run(skill, "check-rules", [...args, "--json"], { cwd: dir });
      assert.equal(j.status, 2);
      const env = envelope(j);
      assert.equal(env.ok, false);
      assert.equal(env.data, null);
      assert.equal(env.findings[0]?.rule, "usage");
    });
  test("the usage error is reported before a missing target", () => {
    const dir = fixture({});
    assert.equal(run(skill, "check-rules", ["absent.yml", "--frobnicate"], { cwd: dir }).status, 2);
  });
  test("--json prints one object on stdout; human mode prints the findings and keeps the exit code", () => {
    const dir = fixture({ "ci.yml": "a:|  script: x|  only:|    - main" });
    const j = run(skill, "check-rules", ["ci.yml", "--json"], { cwd: dir });
    assert.equal(j.stdout.trimEnd().split("\n").length, 1);
    const h = run(skill, "check-rules", ["ci.yml"], { cwd: dir });
    assert.equal(h.status, 1);
    assert.match(h.stdout + h.stderr, /only-except/);
  });
  test("--help: usage, exit 0, and the sentence that anchors, merge keys and extends are not followed", () => {
    const r = run(skill, "check-rules", ["--help"], { cwd: root });
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
    assert.match(r.stdout, /anchors/i);
    assert.match(r.stdout, /merge keys/i);
    assert.match(r.stdout, /extends/);
    assert.match(r.stdout.replace(/\s+/g, " "), /neither[^.]*anchors[^.]*merge keys[^.]*extends/i);
  });
});
