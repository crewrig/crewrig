// skill-scripts-github-actions-resolve-engine.test.ts — black-box test of
// github-actions/scripts/resolve-engine.ts (spec 0300 R11, R21), written from the spec.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  run,
  runJson,
  tempDir,
  WF_CLEAN,
  writeTree,
} from "./lib/skill-scripts-github-actions-cli.ts";

const tmp = tempDir("gha-resolve-engine-");
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
function repo(files: Record<string, string>, dirs: string[] = []): string {
  const root = path.join(tmp, `repo-${n++}`);
  fs.mkdirSync(root, { recursive: true });
  for (const d of dirs) fs.mkdirSync(path.join(root, d), { recursive: true });
  writeTree(root, files);
  return root;
}
const GL = { ".gitlab-ci.yml": "stages: [test]\n" };
const GH = { ".github/workflows/ci.yml": WF_CLEAN };
const text = (o: unknown): string => JSON.stringify(o);

describe("resolve-engine: inference", () => {
  test("only .github/workflows with a workflow file resolves to github-actions, inferred, exit 0", () => {
    const root = repo(GH);
    const { r, env } = runJson("resolve-engine", ["--root", root], { cwd: tmp });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(env.ok, true);
    assert.match(text(env.data), /github-actions/);
    assert.match(text(env.data), /inferred/);
  });
  test("a .yaml workflow file counts", () => {
    const root = repo({ ".github/workflows/ci.yaml": WF_CLEAN });
    assert.equal(run("resolve-engine", ["--root", root], { cwd: tmp }).status, 0);
  });
  test("only .gitlab-ci.yml resolves to gitlab-ci, inferred", () => {
    const { r, env } = runJson("resolve-engine", ["--root", repo(GL)], { cwd: tmp });
    assert.equal(r.status, 0);
    assert.match(text(env.data), /gitlab-ci/);
    assert.match(text(env.data), /inferred/);
  });
  test("an empty .github/workflows directory does not count: gitlab alone resolves", () => {
    const root = repo(GL, [".github/workflows"]);
    const { r, env } = runJson("resolve-engine", ["--root", root], { cwd: tmp });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(text(env.data), /gitlab-ci/);
  });
  test("the root defaults to the working directory", () => {
    const { r, env } = runJson("resolve-engine", [], { cwd: repo(GH) });
    assert.equal(r.status, 0);
    assert.match(text(env.data), /github-actions/);
  });
  test("the plain output names the engine and how it was resolved", () => {
    const r = run("resolve-engine", ["--root", repo(GH)], { cwd: tmp });
    assert.match(r.stdout, /github-actions/);
    assert.match(r.stdout, /inferred/);
  });
});

describe("resolve-engine: ambiguous and absent", () => {
  test("both engines present and no --engine: engine-ambiguous, exit 1, says not to guess", () => {
    const { r, env } = runJson("resolve-engine", ["--root", repo({ ...GH, ...GL })], { cwd: tmp });
    assert.equal(r.status, 1);
    assert.equal(env.ok, false);
    const f = env.findings.find((x) => x.rule === "engine-ambiguous");
    assert.ok(f, text(env.findings));
    assert.match(f.message, /--engine|name the target|ask/i);
    assert.match(f.message, /guess/i);
  });
  test("neither engine and no --engine: engine-absent, exit 1, says not to guess", () => {
    const { r, env } = runJson("resolve-engine", ["--root", repo({ "README.md": "x" })], {
      cwd: tmp,
    });
    assert.equal(r.status, 1);
    const f = env.findings.find((x) => x.rule === "engine-absent");
    assert.ok(f, text(env.findings));
    assert.match(f.message, /guess/i);
  });
  test("an empty .github/workflows alone is engine-absent", () => {
    const { r, env } = runJson("resolve-engine", ["--root", repo({}, [".github/workflows"])], {
      cwd: tmp,
    });
    assert.equal(r.status, 1);
    assert.ok(env.findings.some((x) => x.rule === "engine-absent"));
  });
});

describe("resolve-engine: explicit engine", () => {
  test("--engine wins over inference and reports explicit", () => {
    const root = repo({ ...GH, ...GL });
    for (const engine of ["gitlab-ci", "github-actions"]) {
      const { r, env } = runJson("resolve-engine", ["--engine", engine, "--root", root], {
        cwd: tmp,
      });
      assert.equal(r.status, 0, engine);
      assert.match(text(env.data), new RegExp(engine));
      assert.match(text(env.data), /explicit/);
    }
  });
  test("--engine overrides what the repository shows", () => {
    const { r, env } = runJson("resolve-engine", ["--engine", "gitlab-ci", "--root", repo(GH)], {
      cwd: tmp,
    });
    assert.equal(r.status, 0);
    assert.match(text(env.data), /gitlab-ci/);
    assert.doesNotMatch(text(env.data), /github-actions/);
  });
  test("--engine resolves even when the repository shows nothing", () => {
    assert.equal(
      run("resolve-engine", ["--engine", "github-actions", "--root", repo({})], { cwd: tmp })
        .status,
      0,
    );
  });
});

describe("resolve-engine: contract", () => {
  test("an unknown --engine value is a usage error, exit 2", () => {
    const { r, env } = runJson("resolve-engine", ["--engine", "jenkins", "--root", repo(GH)], {
      cwd: tmp,
    });
    assert.equal(r.status, 2);
    assert.equal(env.findings[0]?.rule, "usage");
  });
  test("usage errors exit 2: a missing --engine value, an unknown flag, a stray argument", () => {
    for (const args of [["--engine"], ["--root"], ["--bogus"], ["stray"]])
      assert.equal(run("resolve-engine", args, { cwd: tmp }).status, 2, args.join(" "));
  });
  test("usage is checked before the target: a bad engine with a missing root is exit 2", () => {
    assert.equal(
      run("resolve-engine", ["--engine", "x", "--root", path.join(tmp, "nope")], { cwd: tmp })
        .status,
      2,
    );
  });
  test("an unreadable root is a precondition failure, exit 3", () => {
    const { r, env } = runJson("resolve-engine", ["--root", path.join(tmp, "nope")], { cwd: tmp });
    assert.equal(r.status, 3);
    assert.equal(env.ok, false);
  });
  test("--json is one envelope {ok, data, findings}", () => {
    const { env } = runJson("resolve-engine", ["--root", repo(GH)], { cwd: tmp });
    assert.deepEqual(Object.keys(env).sort(), ["data", "findings", "ok"]);
  });
  test("--help prints usage on stdout, exit 0, empty stderr", () => {
    const r = run("resolve-engine", ["--help"], { cwd: tmp });
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
    assert.match(r.stdout, /^Usage: /);
  });
});
