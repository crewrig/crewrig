// skill-scripts-github-actions-check-expression-injection.test.ts — black-box test of
// github-actions/scripts/check-expression-injection.ts (spec 0300 R8, R9, R21).

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
} from "./lib/skill-scripts-github-actions-cli.ts";

const tmp = tempDir("gha-check-injection-");
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
const check = (text: string) => {
  const p = `wf-${n++}.yml`;
  fs.writeFileSync(path.join(tmp, p), text);
  return runJson("check-expression-injection", [p], { cwd: tmp });
};
const lineOf = (text: string, needle: string): number =>
  text.split("\n").findIndex((l) => l.includes(needle)) + 1;

const HEAD = "name: t\non: push\njobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n";
const runStep = (cmd: string): string => `${HEAD}      - run: ${cmd}\n`;
const expr = (path_: string): string => `echo "\${{ ${path_} }}"`;

describe("check-expression-injection: attacker-controllable fields", () => {
  const fields = [
    "github.event.issue.title",
    "github.event.issue.body",
    "github.event.pull_request.title",
    "github.event.pull_request.body",
    "github.event.pull_request.head.ref",
    "github.event.pull_request.head.label",
    "github.event.comment.body",
    "github.event.review.body",
    "github.event.head_commit.message",
    "github.event.commits[0].message",
    "github.event.commits[3].author.name",
    "github.event.commits[0].author.email",
    "github.event.head_commit.author.name",
    "github.event.head_commit.author.email",
    "github.head_ref",
    // any other event path ending in .body, .title, .message or .label
    "github.event.discussion.title",
    "github.event.release.body",
    "github.event.workflow_run.head_commit.message",
    "github.event.pull_request.base.label",
    // .name / .email under an author or committer object
    "github.event.workflow_run.head_commit.committer.name",
    "github.event.pull_request.head.commit.committer.email",
  ];
  for (const f of fields)
    test(`${f} in a run: value is an error on its line, exit 1`, () => {
      const text = runStep(expr(f));
      const { r, env } = check(text);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      const finding = env.findings.find((x) => x.rule === "expression-injection");
      assert.ok(finding, JSON.stringify(env.findings));
      assert.equal(finding.line, lineOf(text, "run:"));
      assert.notEqual(finding.severity, "warning");
    });

  test('the message tells the fix: bind under env: and read "$VAR"', () => {
    const { env } = check(runStep(expr("github.event.pull_request.title")));
    const m = env.findings[0]?.message ?? "";
    assert.match(m, /env:/);
    assert.match(m, /\$[A-Z_{]|"\$VAR"|\$VAR/);
  });
  test("a multi-line run: block reports the line of the expression, not of run:", () => {
    const text = `${HEAD}      - run: |\n          echo start\n          echo "\${{ github.event.issue.title }}"\n`;
    const { env } = check(text);
    assert.equal(env.findings[0]?.line, lineOf(text, "issue.title"));
  });
  test("each expression is reported: two in one step make two findings", () => {
    const text = runStep('echo "${{ github.event.issue.title }} ${{ github.event.issue.body }}"');
    assert.equal(
      check(text).env.findings.filter((f) => f.rule === "expression-injection").length,
      2,
    );
  });
  test("the body of an actions/github-script script: input is checked", () => {
    const text = `${HEAD}      - uses: actions/github-script@v7\n        with:\n          script: |\n            const t = "\${{ github.event.pull_request.title }}";\n            core.info(t);\n`;
    const { r, env } = check(text);
    assert.equal(r.status, 1);
    assert.equal(env.findings[0]?.rule, "expression-injection");
    assert.equal(env.findings[0]?.line, lineOf(text, "pull_request.title"));
  });
  test("whitespace and a function wrapper in the expression do not hide the field", () => {
    const text = runStep(
      'echo "${{github.event.issue.title}}" "${{ contains(github.event.issue.body, \'x\') }}"',
    );
    assert.ok(check(text).env.findings.length >= 1);
  });
});

describe("check-expression-injection: compliant", () => {
  const cases: [string, string][] = [
    [
      'the same expression bound under env: and read as "$VAR"',
      `${HEAD}      - env:\n          PR_TITLE: \${{ github.event.pull_request.title }}\n        run: echo "$PR_TITLE"\n`,
    ],
    ["github.sha", runStep(expr("github.sha"))],
    ["github.run_id", runStep(expr("github.run_id"))],
    ["github.repository", runStep(expr("github.repository"))],
    ["secrets.*", runStep(expr("secrets.TOKEN"))],
    // spec R8: other .name paths are not attacker-controlled per event
    ["github.event.repository.name", runStep(expr("github.event.repository.name"))],
    ["github.event.sender.login", runStep(expr("github.event.sender.login"))],
    [
      "a tainted field in a with: input that is not a script",
      `${HEAD}      - uses: actions/cache@v4\n        with:\n          key: \${{ github.event.pull_request.title }}\n`,
    ],
    [
      "a tainted field in a name: label",
      `${HEAD}      - name: \${{ github.event.pull_request.title }}\n        run: ls\n`,
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
  test("a composite action with no jobs: key passes with no finding", () => {
    const { r, env } = check(ACTION_YML);
    assert.equal(r.status, 0);
    assert.deepEqual(env.findings, []);
  });
});

describe("check-expression-injection: inputs.* (expression-injection-input)", () => {
  test("inputs.* in a run: value is a warning whatever the trigger, exit 0", () => {
    for (const on of [
      "on: push",
      "on: workflow_call",
      "on:\n  workflow_dispatch:\n    inputs:\n      x: {}",
    ]) {
      const text = `name: t\n${on}\njobs:\n  b:\n    runs-on: x\n    steps:\n      - run: echo "\${{ inputs.x }}"\n`;
      const { r, env } = check(text);
      assert.equal(r.status, 0, on);
      const f = env.findings.find((x) => x.rule === "expression-injection-input");
      assert.ok(f, on);
      assert.equal(f.severity, "warning");
      assert.equal(f.line, lineOf(text, "inputs.x"));
      assert.match(f.message, /env:/);
    }
  });
  test("inputs.* bound under env: is not reported", () => {
    const text = `${HEAD}      - env:\n          X: \${{ inputs.x }}\n        run: echo "$X"\n`;
    assert.deepEqual(check(text).env.findings, []);
  });
  test("a warning-only result keeps ok true", () => {
    const { env } = check(runStep(expr("inputs.x")));
    assert.equal(env.ok, true);
  });
});

describe("check-expression-injection: unsupported YAML (R9) and contract", () => {
  test("an anchor on a step gives an unparsed warning naming the line", () => {
    const text = `${HEAD}      - &s\n        run: echo hi\n`;
    const f = check(text).env.findings.find((x) => x.rule === "unparsed");
    assert.ok(f);
    assert.equal(f.severity, "warning");
    assert.equal(f.line, lineOf(text, "&s"));
  });
  test("standard input, directory expansion, several files", () => {
    const bad = runStep(expr("github.event.issue.title"));
    assert.equal(
      run("check-expression-injection", ["-", "--json"], { cwd: tmp, input: bad }).status,
      1,
    );
    fs.mkdirSync(path.join(tmp, "d"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "d", "b.yml"), bad);
    fs.writeFileSync(path.join(tmp, "d", "a.yml"), WF_CLEAN);
    const r = run("check-expression-injection", ["d", "--json"], { cwd: tmp });
    assert.equal(r.status, 1);
    assert.deepEqual(
      parseEnvelope(r).findings.map((f) => path.basename(f.path ?? "")),
      ["b.yml"],
    );
  });
  test("an empty directory is exit 2 with the named stderr line; unreadable is exit 3", () => {
    fs.mkdirSync(path.join(tmp, "e"), { recursive: true });
    const r = run("check-expression-injection", ["e"], { cwd: tmp });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /\[FAIL\] no workflow files found under: e/);
    assert.equal(run("check-expression-injection", ["nope.yml"], { cwd: tmp }).status, 3);
    assert.equal(
      run("check-expression-injection", ["--bogus", "nope.yml"], { cwd: tmp }).status,
      2,
    );
  });
  test("usage errors exit 2 with rule usage; --json is a single envelope", () => {
    const { r, env } = runJson("check-expression-injection", [], { cwd: tmp });
    assert.equal(r.status, 2);
    assert.equal(env.findings[0]?.rule, "usage");
    assert.deepEqual(Object.keys(env).sort(), ["data", "findings", "ok"]);
  });
  test("--help prints usage on stdout, exit 0, empty stderr", () => {
    const r = run("check-expression-injection", ["--help"], { cwd: tmp });
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
    assert.match(r.stdout, /^Usage: /);
  });
});
