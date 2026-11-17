// skill-scripts-github-actions-check-permissions.test.ts — black-box test of
// github-actions/scripts/check-permissions.ts (spec 0300 R6, R9, R21), written from the spec.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  ACTION_YML,
  parseEnvelope,
  run,
  runJson,
  tempDir,
  WF_CLEAN,
  writeTree,
} from "./lib/skill-scripts-github-actions-cli.ts";

const tmp = tempDir("gha-check-permissions-");
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
function wf(text: string): string {
  const p = `wf-${n++}.yml`;
  fs.writeFileSync(path.join(tmp, p), text);
  return p;
}
const check = (text: string) => runJson("check-permissions", [wf(text)], { cwd: tmp });
const lineOf = (text: string, needle: string): number =>
  text.split("\n").findIndex((l) => l.includes(needle)) + 1;

const HEAD = "name: t\non: push\n";
const JOB = (id: string, extra = ""): string =>
  `  ${id}:\n    runs-on: ubuntu-latest\n${extra}    steps:\n      - run: echo hi\n`;

describe("check-permissions: permissions-missing", () => {
  test("no top-level permissions and a job without its own: finding on that job id line, exit 1", () => {
    const text = `${HEAD}jobs:\n${JOB("build")}`;
    const { r, env } = check(text);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(env.ok, false);
    const f = env.findings.find((x) => x.rule === "permissions-missing");
    assert.ok(f, JSON.stringify(env.findings));
    assert.equal(f.line, lineOf(text, "  build:"));
    assert.notEqual(f.severity, "warning");
    assert.match(f.message, /permissions/);
  });
  test("with two jobs the first job lacking permissions carries the line", () => {
    const text = `${HEAD}jobs:\n${JOB("lint", "    permissions: { contents: read }\n")}${JOB("deploy")}${JOB("later")}`;
    const { r, env } = check(text);
    assert.equal(r.status, 1);
    const f = env.findings.filter((x) => x.rule === "permissions-missing");
    assert.equal(f.length, 1);
    assert.equal(f[0]?.line, lineOf(text, "  deploy:"));
  });
});

describe("check-permissions: compliant forms", () => {
  const cases: [string, string][] = [
    ["top-level empty flow mapping", `${HEAD}permissions: {}\njobs:\n${JOB("a")}`],
    [
      "top-level single-line read-only flow mapping",
      `${HEAD}permissions: { contents: read, pull-requests: read }\njobs:\n${JOB("a")}`,
    ],
    [
      "top-level block read-only mapping",
      `${HEAD}permissions:\n  contents: read\n  checks: none\njobs:\n${JOB("a")}`,
    ],
    ["top-level read-all", `${HEAD}permissions: read-all\njobs:\n${JOB("a")}`],
    [
      "a job-level permissions key on every job",
      `${HEAD}jobs:\n${JOB("a", "    permissions: {}\n")}${JOB("b", "    permissions:\n      contents: read\n")}`,
    ],
    ["the clean fixture", WF_CLEAN],
  ];
  for (const [name, text] of cases)
    test(name, () => {
      const { r, env } = check(text);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(env.ok, true);
      assert.deepEqual(env.findings, []);
    });
});

describe("check-permissions: write-all and broad grants", () => {
  test("workflow-level write-all is an error", () => {
    const text = `${HEAD}permissions: write-all\njobs:\n${JOB("a")}`;
    const { r, env } = check(text);
    assert.equal(r.status, 1);
    const f = env.findings.find((x) => x.rule === "permissions-write-all");
    assert.ok(f, JSON.stringify(env.findings));
    assert.equal(f.line, lineOf(text, "write-all"));
  });
  test("job-level write-all is an error on the job's permissions line", () => {
    const text = `${HEAD}permissions: { contents: read }\njobs:\n${JOB("a", "    permissions: write-all\n")}`;
    const { r, env } = check(text);
    assert.equal(r.status, 1);
    assert.equal(
      env.findings.find((x) => x.rule === "permissions-write-all")?.line,
      lineOf(text, "write-all"),
    );
  });
  test("a top-level mapping granting write is a warning, not an error: exit 0", () => {
    const { r, env } = check(`${HEAD}permissions:\n  contents: write\njobs:\n${JOB("a")}`);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const f = env.findings.find((x) => x.rule === "permissions-broad");
    assert.equal(f?.severity, "warning");
    assert.equal(env.ok, true);
  });
  test("the single-line flow form is read as well", () => {
    const { r, env } = check(
      `${HEAD}permissions: { contents: write, id-token: write }\njobs:\n${JOB("a")}`,
    );
    assert.equal(r.status, 0);
    assert.equal(env.findings[0]?.rule, "permissions-broad");
  });
});

describe("check-permissions: composite action and unsupported YAML (R9)", () => {
  test("a composite action with no jobs: key passes with no finding", () => {
    const { r, env } = check(ACTION_YML);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(env.findings, []);
  });
  for (const [name, text, needle] of [
    [
      "an anchor",
      `${HEAD}defaults: &d\n  run:\n    shell: bash\njobs:\n${JOB("a", "    permissions: {}\n")}`,
      "&d",
    ],
    ["a merge key", `${HEAD}jobs:\n${JOB("a", "    permissions: {}\n")}  b:\n    <<: *x\n`, "<<"],
    [
      "a multi-line flow mapping for permissions",
      `${HEAD}permissions: {\n  contents: read\n}\njobs:\n${JOB("a")}`,
      "permissions: {",
    ],
  ] as const)
    test(`${name} gives an unparsed warning on its line and is not reported compliant on it`, () => {
      const { env } = check(text);
      const f = env.findings.find((x) => x.rule === "unparsed");
      assert.ok(f, JSON.stringify(env.findings));
      assert.equal(f.severity, "warning");
      assert.equal(f.line, lineOf(text, needle));
    });
  test("unparsed alone is a warning: exit stays 0 when nothing else is reported", () => {
    const text = `${HEAD}defaults: &d\n  run:\n    shell: bash\npermissions: {}\njobs:\n${JOB("a")}`;
    assert.equal(check(text).r.status, 0);
  });
});

describe("check-permissions: inputs", () => {
  test("a directory means every yml and yaml file directly under it, sorted, not nested ones", () => {
    const dir = path.join(tmp, "dirA");
    writeTree(dir, {
      "b.yaml": `${HEAD}jobs:\n${JOB("x")}`,
      "a.yml": `${HEAD}jobs:\n${JOB("x")}`,
      "c.txt": "not a workflow",
      "nested/d.yml": `${HEAD}jobs:\n${JOB("x")}`,
    });
    const { r, env } = runJson("check-permissions", ["dirA"], { cwd: tmp });
    assert.equal(r.status, 1);
    const files = env.findings.map((f) => path.basename(f.path ?? ""));
    assert.deepEqual(files, ["a.yml", "b.yaml"]);
  });
  test("several inputs are all checked", () => {
    const a = wf(`${HEAD}jobs:\n${JOB("x")}`);
    const b = wf(WF_CLEAN);
    const r = run("check-permissions", [a, b, "--json"], { cwd: tmp });
    assert.equal(r.status, 1);
    assert.equal(parseEnvelope(r).findings.length, 1);
  });
  test("standard input is read with -", () => {
    const bad = run("check-permissions", ["-", "--json"], {
      cwd: tmp,
      input: `${HEAD}jobs:\n${JOB("x")}`,
    });
    assert.equal(bad.status, 1);
    assert.equal(
      run("check-permissions", ["-", "--json"], { cwd: tmp, input: WF_CLEAN }).status,
      0,
    );
  });
  test("a directory with no workflow file is a usage-level refusal: exit 2, named on stderr", () => {
    fs.mkdirSync(path.join(tmp, "empty"), { recursive: true });
    const r = run("check-permissions", ["empty"], { cwd: tmp });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /\[FAIL\] no workflow files found under: empty/);
  });
  test("an unreadable path is a precondition failure: exit 3", () => {
    const r = run("check-permissions", ["missing.yml"], { cwd: tmp });
    assert.equal(r.status, 3);
    assert.equal(
      parseEnvelope(run("check-permissions", ["missing.yml", "--json"], { cwd: tmp })).ok,
      false,
    );
  });
  test("usage is checked before the target: a bad flag with a missing path is exit 2", () => {
    assert.equal(run("check-permissions", ["--bogus", "missing.yml"], { cwd: tmp }).status, 2);
  });
});

describe("check-permissions: contract", () => {
  test("--json is one envelope line {ok, data, findings}", () => {
    const { r, env } = check(`${HEAD}jobs:\n${JOB("a")}`);
    assert.deepEqual(Object.keys(env).sort(), ["data", "findings", "ok"]);
    for (const f of env.findings) {
      assert.equal(typeof f.rule, "string");
      assert.equal(typeof f.message, "string");
      assert.equal(typeof f.path, "string");
      assert.equal(typeof f.line, "number");
    }
  });
  test("usage errors exit 2 and name the rule usage", () => {
    for (const args of [[], ["--bogus"]]) {
      const { r, env } = runJson("check-permissions", args, { cwd: tmp });
      assert.equal(r.status, 2, args.join(" "));
      assert.equal(env.findings[0]?.rule, "usage");
    }
  });
  test("--help prints usage on stdout, exit 0, empty stderr", () => {
    const r = run("check-permissions", ["--help"], { cwd: tmp });
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
    assert.match(r.stdout, /^Usage: /);
  });
});
