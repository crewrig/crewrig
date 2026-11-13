// skill-scripts-github-actions-check-pull-request-target.test.ts — black-box test of
// github-actions/scripts/check-pull-request-target.ts (spec 0300 R7, R9, R21).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  ACTION_YML,
  parseEnvelope,
  run,
  runJson,
  SHA,
  tempDir,
  WF_CLEAN,
} from "./lib/skill-scripts-github-actions-cli.ts";

const tmp = tempDir("gha-check-prt-");
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
const check = (text: string) => {
  const p = `wf-${n++}.yml`;
  fs.writeFileSync(path.join(tmp, p), text);
  return runJson("check-pull-request-target", [p], { cwd: tmp });
};
const lineOf = (text: string, needle: string): number =>
  text.split("\n").findIndex((l) => l.includes(needle)) + 1;

const ON_MAP = "on:\n  pull_request_target:\n    types: [opened]\n";
const jobWith = (withBlock: string, uses = "actions/checkout@v4"): string =>
  `jobs:\n  b:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ${uses}\n        with:\n${withBlock}      - run: ls\n`;
const wfOn = (on: string, withBlock: string, uses?: string): string =>
  `name: t\n${on}${jobWith(withBlock, uses)}`;

describe("check-pull-request-target: prt-head-checkout", () => {
  const heads = [
    "${{ github.event.pull_request.head.sha }}",
    "${{ github.event.pull_request.head.ref }}",
    "${{ github.head_ref }}",
    "refs/pull/${{ github.event.number }}/merge",
    "refs/pull/42/head",
    "refs/pull/42/merge",
  ];
  for (const ref of heads)
    test(`ref: ${ref} under a mapping trigger is reported on the checkout, exit 1`, () => {
      const text = wfOn(ON_MAP, `          ref: ${ref}\n`);
      const { r, env } = check(text);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      const f = env.findings.find((x) => x.rule === "prt-head-checkout");
      assert.ok(f, JSON.stringify(env.findings));
      assert.notEqual(f.severity, "warning");
      assert.ok(f.line !== undefined && f.line >= 1);
    });

  test("the message names the permitted routes: base checkout, pull_request plus workflow_run", () => {
    const { env } = check(
      wfOn(ON_MAP, "          ref: ${{ github.event.pull_request.head.sha }}\n"),
    );
    const m = env.findings.find((x) => x.rule === "prt-head-checkout")?.message ?? "";
    assert.match(m, /base/i);
    assert.match(m, /workflow_run/);
    assert.match(m, /pull_request\b/);
  });
  test("repository: github.event.pull_request.head.repo.full_name is reported", () => {
    const { r, env } = check(
      wfOn(ON_MAP, "          repository: ${{ github.event.pull_request.head.repo.full_name }}\n"),
    );
    assert.equal(r.status, 1);
    assert.ok(env.findings.some((f) => f.rule === "prt-head-checkout"));
  });
  test("the trigger as a string, a list item and a mapping key are all recognised", () => {
    const ref = "          ref: ${{ github.event.pull_request.head.sha }}\n";
    for (const on of [
      "on: pull_request_target\n",
      "on: [push, pull_request_target]\n",
      "on:\n  - push\n  - pull_request_target\n",
      "on:\n  push:\n  pull_request_target:\n",
    ]) {
      const { r } = check(wfOn(on, ref));
      assert.equal(r.status, 1, on);
    }
  });
  test("a checkout pinned by SHA is still an actions/checkout step", () => {
    const { r } = check(
      wfOn(
        ON_MAP,
        "          ref: ${{ github.event.pull_request.head.sha }}\n",
        `actions/checkout@${SHA}`,
      ),
    );
    assert.equal(r.status, 1);
  });
  test("the finding line is that of the offending ref or the checkout step", () => {
    const text = wfOn(ON_MAP, "          ref: ${{ github.event.pull_request.head.sha }}\n");
    const f = check(text).env.findings.find((x) => x.rule === "prt-head-checkout");
    assert.ok(
      [lineOf(text, "uses: actions/checkout"), lineOf(text, "ref:")].includes(f?.line ?? -1),
    );
  });
});

describe("check-pull-request-target: compliant forms", () => {
  const cases: [string, string][] = [
    ["a prt checkout with no ref and no repository", wfOn(ON_MAP, "          fetch-depth: 0\n")],
    ["a prt checkout of a fixed branch", wfOn(ON_MAP, "          ref: main\n")],
    [
      "a prt checkout of the base sha",
      wfOn(ON_MAP, "          ref: ${{ github.event.pull_request.base.sha }}\n"),
    ],
    [
      "the head sha under a plain pull_request trigger",
      wfOn("on: pull_request\n", "          ref: ${{ github.event.pull_request.head.sha }}\n"),
    ],
    [
      "a ref under prt on a step of another action",
      wfOn(
        ON_MAP,
        "          ref: ${{ github.event.pull_request.head.sha }}\n",
        "actions/cache@v4",
      ),
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

describe("check-pull-request-target: unsupported YAML (R9)", () => {
  test("an anchor in the trigger area gives an unparsed warning naming the line", () => {
    const text = `name: t\non:\n  pull_request_target: &t\n    types: [opened]\n${jobWith("          ref: main\n")}`;
    const f = check(text).env.findings.find((x) => x.rule === "unparsed");
    assert.ok(f);
    assert.equal(f.severity, "warning");
    assert.equal(f.line, lineOf(text, "&t"));
  });
  test("a multi-line flow mapping for with: gives an unparsed warning", () => {
    const text = `name: t\n${ON_MAP}jobs:\n  b:\n    runs-on: x\n    steps:\n      - uses: actions/checkout@v4\n        with: {\n          ref: x\n        }\n`;
    const f = check(text).env.findings.find((x) => x.rule === "unparsed");
    assert.ok(f);
    assert.equal(f.severity, "warning");
  });
});

describe("check-pull-request-target: inputs and contract", () => {
  const BAD = wfOn(ON_MAP, "          ref: ${{ github.event.pull_request.head.sha }}\n");
  test("standard input with -, several files, directory expansion", () => {
    assert.equal(
      run("check-pull-request-target", ["-", "--json"], { cwd: tmp, input: BAD }).status,
      1,
    );
    fs.mkdirSync(path.join(tmp, "d"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "d", "z.yml"), BAD);
    fs.writeFileSync(path.join(tmp, "d", "a.yaml"), WF_CLEAN);
    const r = run("check-pull-request-target", ["d", "--json"], { cwd: tmp });
    assert.equal(r.status, 1);
    assert.deepEqual(
      parseEnvelope(r).findings.map((f) => path.basename(f.path ?? "")),
      ["z.yml"],
    );
  });
  test("an empty directory is exit 2 with the named stderr line", () => {
    fs.mkdirSync(path.join(tmp, "e"), { recursive: true });
    const r = run("check-pull-request-target", ["e"], { cwd: tmp });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /\[FAIL\] no workflow files found under: e/);
  });
  test("an unreadable path is exit 3; usage precedes target", () => {
    assert.equal(run("check-pull-request-target", ["nope.yml"], { cwd: tmp }).status, 3);
    assert.equal(run("check-pull-request-target", ["--bogus", "nope.yml"], { cwd: tmp }).status, 2);
  });
  test("usage errors exit 2 with rule usage; --json is a single envelope", () => {
    const { r, env } = runJson("check-pull-request-target", [], { cwd: tmp });
    assert.equal(r.status, 2);
    assert.equal(env.findings[0]?.rule, "usage");
    assert.deepEqual(Object.keys(env).sort(), ["data", "findings", "ok"]);
  });
  test("--help prints usage on stdout, exit 0, empty stderr", () => {
    const r = run("check-pull-request-target", ["--help"], { cwd: tmp });
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
    assert.match(r.stdout, /^Usage: /);
  });
});
