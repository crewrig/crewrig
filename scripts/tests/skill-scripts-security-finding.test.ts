// skill-scripts-security-finding.test.ts — security-finding.ts (spec 0303 R9, R13): every rule with
// its compliant counterpart, the unmodified template of the skill, standard input, --root, a path
// that escapes the root, a range, `No findings.`, an empty report, the usage error, the
// precondition, the --json shape on each exit and --help. From a copy of the built skill outside
// the repository, with no network.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { copySkill, envelope, run, tempDir, type Run } from "./lib/skill-scripts-security-cli.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const root = tempDir("security-finding-");
after(() => fs.rmSync(root, { recursive: true, force: true }));
assert.ok(!root.startsWith(REPO), "the copy must live outside the repository");
const skill = copySkill(root);
const checkout = path.join(root, "checkout");
fs.mkdirSync(path.join(checkout, "src"), { recursive: true });
fs.writeFileSync(path.join(checkout, "src", "a.ts"), "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n");
fs.writeFileSync(path.join(checkout, "src", "b.ts"), "x\ny\nz"); // no trailing newline: 3 lines
fs.mkdirSync(path.join(root, "outside"));
fs.writeFileSync(path.join(root, "outside", "o.ts"), "secret\n");
fs.symlinkSync(path.join(root, "outside", "o.ts"), path.join(checkout, "src", "link.ts"));

const block = (o: Partial<Record<string, string>> = {}, n = 1): string => {
  const v = {
    head: `[HIGH] SQL injection in the sort parameter`,
    Where: "src/a.ts:3",
    Threat: "An attacker orders by a subquery and reads other tables.",
    Evidence: "ORDER BY ${sort}",
    Fix: "Accept only an allow-list of column names.",
    ...o,
  };
  const lines = [`${n}. ${v.head}`];
  for (const f of ["Where", "Threat", "Evidence", "Fix"])
    if (v[f as "Where"] !== undefined && v[f as "Where"] !== "") lines.push(`   ${f}: ${v[f as "Where"]}`);
  return lines.join("\n");
};
let counter = 0;
function check(report: string, args: string[] = []): Run {
  const file = path.join(root, `report-${(counter += 1)}.md`);
  fs.writeFileSync(file, report);
  return run(skill, "security-finding", ["--root", checkout, ...args, file], { cwd: root });
}
const rules = (r: Run): string[] => envelope(r).findings.map((f) => f.rule);
const rulesOf = (report: string): string[] => rules(check(report, ["--json"]));

describe("well formed reports", () => {
  test("one finding: exit 0, text confirms on stdout", () => {
    const r = check(`${block()}\n`);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.stdout, "security-finding: the report is well formed\n");
    assert.equal(r.stderr, "");
  });
  test("--json: one line {ok, data, findings}, severities counted, the text on stderr", () => {
    const r = check(
      `${block()}\n\n${block({ head: "[LOW] Missing header", Where: "src/b.ts:1-3" }, 2)}\n`,
      ["--json"],
    );
    assert.equal(r.status, 0, r.stderr);
    const e = envelope(r);
    assert.deepEqual(Object.keys(e), ["ok", "data", "findings"]);
    assert.equal(e.ok, true);
    assert.deepEqual(e.data, {
      checked: 2,
      severities: { BLOCKER: 0, HIGH: 1, MED: 0, LOW: 1, INFO: 0 },
    });
    assert.equal(r.stderr, "security-finding: the report is well formed\n");
  });
  test("a range inside the file, a value continued on indented lines, a last line without newline", () => {
    const report = `${block({ Where: "src/a.ts:2-10", Threat: "first part\n      second part" })}\n\n${block({ Where: "src/b.ts:3" }, 2)}\n`;
    assert.equal(check(report).status, 0);
  });
  test("No findings. is a clean report", () => {
    const r = check("No findings.\nExamined: src/a.ts:3, the parameterized query.\n", ["--json"]);
    assert.equal(r.status, 0);
    assert.deepEqual(envelope(r).data, {
      checked: 0,
      severities: { BLOCKER: 0, HIGH: 0, MED: 0, LOW: 0, INFO: 0 },
    });
  });
  test("a header inside a code fence is not a finding", () => {
    assert.equal(check("No findings.\n```text\n1. [SEV] <x>\n```\n").status, 0);
  });
});

describe("each rule fires, and its compliant counterpart passes", () => {
  const cases: [string, string, string][] = [
    ["severity-missing", block({ head: "SQL injection" }), block()],
    ["severity-unknown", block({ head: "[CRITICAL] SQL injection" }), block({ head: "[BLOCKER] SQL injection" })],
    ["field-missing", block({ Fix: "" }), block()],
    ["placeholder", block({ Threat: "<what an attacker would do>" }), block()],
    ["where-format", block({ Where: "src/a.ts" }), block({ Where: "src/a.ts:3" })],
    ["where-file-missing", block({ Where: "src/none.ts:1" }), block({ Where: "src/a.ts:1" })],
    ["where-line-out-of-range", block({ Where: "src/a.ts:11" }), block({ Where: "src/a.ts:10" })],
    ["where-outside-root", block({ Where: "../outside/o.ts:1" }), block({ Where: "src/a.ts:1" })],
  ];
  for (const [rule, bad, good] of cases)
    test(rule, () => {
      const r = check(`${bad}\n`, ["--json"]);
      assert.equal(r.status, 1, r.stdout);
      const e = envelope(r);
      assert.ok(e.findings.some((f) => f.rule === rule), `${rule} in ${JSON.stringify(e.findings)}`);
      assert.ok(e.findings.every((f) => typeof f.message === "string" && f.message !== ""));
      assert.equal(check(`${good}\n`).status, 0, `the compliant counterpart of ${rule}`);
    });

  test("a finding carries its number and line", () => {
    const e = envelope(check(`${block()}\n\n${block({ Fix: "" }, 2)}\n`, ["--json"]));
    assert.deepEqual(e.findings.map((f) => [f.rule, f.finding, f.line]), [["field-missing", 2, 7]]);
  });
  test("a range that ends before it starts, or ends past the file, is out of range", () => {
    assert.deepEqual(rulesOf(`${block({ Where: "src/a.ts:5-3" })}\n`), ["where-line-out-of-range"]);
    assert.deepEqual(rulesOf(`${block({ Where: "src/a.ts:8-11" })}\n`), ["where-line-out-of-range"]);
    assert.deepEqual(rulesOf(`${block({ Where: "src/a.ts:0" })}\n`), ["where-line-out-of-range"]);
  });
  test("a link that leads out of the root is outside the root", () => {
    assert.deepEqual(rulesOf(`${block({ Where: "src/link.ts:1" })}\n`), ["where-outside-root"]);
  });
  test("numbering is reported once, at the first finding out of order", () => {
    const report = `${block({}, 1)}\n\n${block({}, 3)}\n\n${block({}, 4)}\n`;
    assert.deepEqual(rulesOf(report), ["numbering"]);
    assert.equal(check(`${block({}, 1)}\n\n${block({}, 2)}\n`).status, 0);
  });
  test("no-findings-block: an empty report, or one with prose only, cannot pass for a clean review", () => {
    for (const report of ["", "\n\n", "The code looks fine to me.\n"]) {
      const r = check(report, ["--json"]);
      assert.equal(r.status, 1, JSON.stringify(report));
      assert.deepEqual(rules(r), ["no-findings-block"]);
    }
  });
  test("the unmodified template of the skill reports findings", () => {
    const skillMd = fs.readFileSync(path.join(skill, "SKILL.md"), "utf8");
    const template = /```text\n(1\. \[SEV\][\s\S]*?)```/.exec(skillMd)?.[1];
    assert.ok(template, "the report format block of SKILL.md");
    const r = check(template, ["--json"]);
    assert.equal(r.status, 1);
    const got = new Set(rules(r));
    for (const rule of ["severity-unknown", "placeholder", "where-format"])
      assert.ok(got.has(rule), `${rule} in ${[...got].join(", ")}`);
  });
});

describe("input, root and options", () => {
  test("standard input with -", () => {
    const ok = run(skill, "security-finding", ["--root", checkout, "-"], { cwd: root, input: `${block()}\n` });
    assert.equal(ok.status, 0, ok.stderr);
    const bad = run(skill, "security-finding", ["--root", checkout, "-"], { cwd: root, input: "" });
    assert.equal(bad.status, 1);
  });
  test("--root decides where Where: resolves; the default is the working directory", () => {
    const file = path.join(root, "rel-report.md");
    fs.writeFileSync(file, `${block()}\n`);
    assert.equal(run(skill, "security-finding", [file], { cwd: checkout }).status, 0);
    assert.equal(run(skill, "security-finding", [file], { cwd: root }).status, 1);
    assert.equal(run(skill, "security-finding", [`--root=${checkout}`, file], { cwd: root }).status, 0);
  });
  test("--help: usage on stdout, exit 0, no stderr, lists every rule", () => {
    const r = run(skill, "security-finding", ["--help"], { cwd: root });
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
    for (const rule of [
      "severity-missing", "severity-unknown", "field-missing", "placeholder", "where-format",
      "where-file-missing", "where-line-out-of-range", "where-outside-root", "numbering",
      "no-findings-block", "precondition",
    ])
      assert.ok(r.stdout.includes(rule), rule);
  });
});

describe("exit 2 and exit 3", () => {
  for (const [name, args] of [
    ["no report", []],
    ["two reports", ["a.md", "b.md"]],
    ["an unknown option", ["--nope", "a.md"]],
    ["--root without a value", ["--root"]],
  ] as [string, string[]][])
    test(`usage error, exit 2: ${name}`, () => {
      const r = run(skill, "security-finding", args, { cwd: root });
      assert.equal(r.status, 2);
      assert.equal(r.stdout, "");
      assert.match(r.stderr, /usage/);
    });
  test("--json on exit 2 and 3: data null, one finding, ok false", () => {
    const usage = run(skill, "security-finding", ["--json"], { cwd: root });
    assert.equal(usage.status, 2);
    assert.deepEqual([envelope(usage).ok, envelope(usage).data, rules(usage)], [false, null, ["usage"]]);
    const missing = run(skill, "security-finding", ["--json", path.join(root, "nope.md")], { cwd: root });
    assert.equal(missing.status, 3);
    assert.deepEqual([envelope(missing).data, rules(missing)], [null, ["precondition"]]);
  });
  test("an unreadable report, or a root that is not a directory, is exit 3", () => {
    const dir = run(skill, "security-finding", [root], { cwd: root });
    assert.equal(dir.status, 3);
    const file = path.join(root, "r.md");
    fs.writeFileSync(file, `${block()}\n`);
    const badRoot = run(skill, "security-finding", ["--root", path.join(root, "nope"), file], { cwd: root });
    assert.equal(badRoot.status, 3);
    assert.match(badRoot.stderr, /--root is not a directory/);
  });
});
