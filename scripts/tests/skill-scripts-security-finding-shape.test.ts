// skill-scripts-security-finding-shape.test.ts — how security-finding.ts reads the shape of a report
// (spec 0303 R9, review finding i1-F6): a blank line or an unindented fence after a label keeps the
// field open, and prose or a numbered list after the findings is not another finding. No network,
// from a copy of the skill outside the repository.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { copySkill, envelope, run, tempDir } from "./lib/skill-scripts-security-cli.ts";

const root = tempDir("security-finding-shape-");
after(() => fs.rmSync(root, { recursive: true, force: true }));
const skill = copySkill(root);
const checkout = path.join(root, "checkout");
fs.mkdirSync(path.join(checkout, "src"), { recursive: true });
fs.writeFileSync(path.join(checkout, "src", "a.ts"), "1\n2\n3\n4\n5\n");

let counter = 0;
function check(report: string) {
  const file = path.join(root, `report-${(counter += 1)}.md`);
  fs.writeFileSync(file, report);
  return run(skill, "security-finding", ["--root", checkout, "--json", file], { cwd: root });
}
const HEAD = "1. [HIGH] SQL injection in the sort parameter\n   Where: src/a.ts:3\n   Threat: t\n";

describe("the open field", () => {
  for (const [name, evidence] of [
    [
      "a blank line then an indented fence",
      "   Evidence:\n\n   ```js\n   ORDER BY ${sort}\n   ```\n",
    ],
    ["an unindented fence", "   Evidence:\n```js\nORDER BY ${sort}\n```\n"],
    ["an unindented fence after a blank line", "   Evidence:\n\n```\nORDER BY ${sort}\n```\n"],
    [
      "a fence holding a numbered line and a label",
      "   Evidence:\n```\n2. not a finding\nFix: not a field\n```\n",
    ],
  ] as [string, string][])
    test(`${name}: no false field-missing`, () => {
      const r = check(`${HEAD}${evidence}   Fix: use an allow-list\n`);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(envelope(r).data?.["checked"], 1);
    });
  test("an empty Evidence label is still field-missing", () => {
    const r = check(`${HEAD}   Evidence:\n   Fix: use an allow-list\n`);
    assert.equal(r.status, 1);
    assert.deepEqual(
      envelope(r).findings.map((f) => f.rule),
      ["field-missing"],
    );
  });
});

describe("after the findings", () => {
  test("a numbered list after a prose line is not read as findings", () => {
    const r = check(
      `${HEAD}   Evidence: e\n   Fix: f\n\nSummary:\n1. first point\n2. second point\n`,
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(envelope(r).data?.["checked"], 1);
  });
  test("two consecutive findings are still both read", () => {
    const second = HEAD.replace("1.", "2.");
    const r = check(`${HEAD}   Evidence: e\n   Fix: f\n\n${second}   Evidence: e\n   Fix: f\n`);
    assert.equal(envelope(r).data?.["checked"], 2);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
});

describe("no silent pass", () => {
  const second = (where: string, n = 2): string =>
    `${n}. [LOW] Second finding\n   Where: ${where}\n   Threat: t\n   Evidence: e\n   Fix: f\n`;
  const first = `${HEAD}   Evidence: e\n   Fix: f\n`;
  test("a finding after a prose line is still checked: line 99 of a 5-line file is reported", () => {
    const r = check(`${first}\nSummary of the review\n\n${second("src/a.ts:99")}`);
    assert.equal(r.status, 1);
    const found = envelope(r).findings;
    assert.deepEqual(
      found.map((f) => [f.rule, f.finding]),
      [["where-line-out-of-range", 2]],
    );
    assert.equal(envelope(r).data?.["checked"], 2);
  });
  test("a valid second finding after a heading is counted", () => {
    const r = check(`${first}\n## Second part\n${second("src/a.ts:2")}`);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(envelope(r).data?.["checked"], 2);
  });
  test("an indented header with a bracketed severity is a finding, not a continuation", () => {
    const r = check(`${first}   ${second("src/a.ts:99")}`);
    assert.deepEqual(
      envelope(r).findings.map((f) => f.rule),
      ["where-line-out-of-range"],
    );
  });
  test("a label given twice is field-duplicate", () => {
    const r = check(`${HEAD}   Where: src/a.ts:99\n   Evidence: e\n   Fix: f\n`);
    assert.deepEqual(
      envelope(r).findings.map((f) => f.rule),
      ["field-duplicate", "where-line-out-of-range"],
    );
  });
  test("a header with no summary is field-missing", () => {
    const r = check(first.replace("SQL injection in the sort parameter", ""));
    assert.deepEqual(
      envelope(r).findings.map((f) => f.rule),
      ["field-missing"],
    );
  });
  test("an unclosed fence is reported, since it swallows the findings after it", () => {
    const r = check(`${HEAD}   Evidence:\n   \`\`\`js\n   x\n   Fix: f\n${second("src/a.ts:99")}`);
    assert.equal(r.status, 1);
    assert.ok(envelope(r).findings.some((f) => f.rule === "fence-unclosed"));
  });
});

// The parser fails closed: every non-blank line is classified, and a line it does not understand is
// an error, never a pass (review passes 1 to 3). Each row: the report, then the rules it must report
// (an empty list means well formed).
const OK = "   Where: src/a.ts:2\n   Threat: t\n   Evidence: e\n   Fix: f\n";
const BAD = "   Where: src/a.ts:99\n   Threat: t\n   Evidence: e\n   Fix: f\n";
const one = `1. [HIGH] First\n${OK}`;
const TABLE: [string, string, string[]][] = [
  ["a clean report", "No findings.\nExamined: src/a.ts:2, the query is parameterized\n", []],
  ["No findings. beside a finding", `${one}\nNo findings.\n`, ["no-findings-conflict"]],
  ["prose before the first finding", `Review of the handler\n\n${one}`, []],
  ["a heading between findings", `${one}\n## Next\n2. [LOW] Second\n${OK}`, []],
  ["prose and a numbered list after the findings", `${one}\nSummary:\n1. a\n2. b\n`, []],
  ["a code fence in prose after the findings", `${one}\nNotes:\n\`\`\`\n1. [X] y\n\`\`\`\n`, []],
  ["header shape 2)", `${one}2) [LOW] Second\n${BAD}`, ["unrecognized-line"]],
  ["header shape **2.**", `${one}**2.** [LOW] Second\n${BAD}`, ["unrecognized-line"]],
  ["header shape - [LOW]", `${one}- [LOW] Second\n${BAD}`, ["unrecognized-line"]],
  ["header shape [LOW] at line start", `${one}[LOW] Second\n${BAD}`, ["unrecognized-line"]],
  [
    "header shape 2) after prose",
    `${one}\nNotes\n\n2) [LOW] Second\n${BAD}`,
    ["unrecognized-line"],
  ],
  ["labels after a prose line", `${one}\nNotes\n${BAD}`, ["unrecognized-line"]],
  ["an orphan label before the first header", `Where: src/a.ts:2\n${one}`, ["unrecognized-line"]],
  ["an orphan label after a heading", `${one}\n## Next\n${BAD}`, ["unrecognized-line"]],
  [
    "a column-0 continuation of Threat",
    `1. [HIGH] First\n   Where: src/a.ts:2\n   Threat: t\ncontinued\n   Evidence: e\n   Fix: f\n`,
    ["unrecognized-line"],
  ],
  [
    "an indented line with no open field",
    `1. [HIGH] First\n   stray text\n${OK}`,
    ["unrecognized-line"],
  ],
  [
    "a fence under the header, outside a field",
    `1. [HIGH] First\n   \`\`\`\n   x\n   \`\`\`\n${OK}`,
    ["unrecognized-line"],
  ],
  [
    "a finding after prose is still checked",
    `${one}\nNotes\n\n2. [LOW] Second\n${BAD}`,
    ["where-line-out-of-range"],
  ],
  [
    "an indented header is a finding",
    `${one}   2. [LOW] Second\n${BAD}`,
    ["where-line-out-of-range"],
  ],
  [
    "a label given twice",
    `1. [HIGH] First\n${OK}   Where: src/a.ts:99\n`,
    ["field-duplicate", "where-line-out-of-range"],
  ],
  [
    "an unclosed fence",
    `1. [HIGH] First\n   Where: src/a.ts:2\n   Threat: t\n   Evidence:\n   \`\`\`\n   x\n   Fix: f\n`,
    ["fence-unclosed"],
  ],
  [
    "a blank line then an indented fence",
    `1. [HIGH] First\n   Where: src/a.ts:2\n   Threat: t\n   Evidence:\n\n   \`\`\`\n   x\n   \`\`\`\n   Fix: f\n`,
    [],
  ],
  [
    "an unindented fence in Evidence",
    `1. [HIGH] First\n   Where: src/a.ts:2\n   Threat: t\n   Evidence:\n\`\`\`\n2. [X] not a header\nFix: not a field\n\`\`\`\n   Fix: f\n`,
    [],
  ],
  [
    "a 4-space indented header after a finding",
    `${one}    2. [LOW] Second\n`,
    ["unrecognized-line"],
  ],
  [
    "a header with no space after the dot, after a blank line",
    `${one}\n2.[LOW] Second\n`,
    ["unrecognized-line"],
  ],
  [
    "a Summary list with 1) items",
    `${one}\nSummary:\n1) first\n2) second\n`,
    ["unrecognized-line"],
  ],
  [
    "a Summary list restating a finding",
    `${one}\nSummary:\n1. [LOW] first\n`,
    ["numbering", "field-missing"],
  ],
  [
    "prose only, no finding and no No findings. line",
    "The code looks fine.\n",
    ["no-findings-block"],
  ],
];
describe("fail closed: every line is classified", () => {
  for (const [name, report, expected] of TABLE)
    test(name, () => {
      const r = check(report);
      const found = envelope(r).findings.map((f) => f.rule);
      if (expected.length === 0) assert.deepEqual(found, [], r.stdout + r.stderr);
      for (const rule of expected) assert.ok(found.includes(rule), `${rule} in ${found.join(",")}`);
      assert.equal(r.status, expected.length === 0 ? 0 : 1);
    });
  test("an unrecognized line names its line number and what was expected", () => {
    const f = envelope(check(`${one}2) [LOW] Second\n${BAD}`)).findings.find(
      (x) => x.rule === "unrecognized-line",
    );
    assert.equal(f?.["line"], 6);
    assert.match(f?.message ?? "", /line 6 .*N\. \[SEV\]/);
  });
});

describe("messages say what is wrong and what to write", () => {
  const msg = (report: string, rule: string): string =>
    envelope(check(report)).findings.find((f) => f.rule === rule)?.message ?? "";
  test("a header-like line that is not accepted says how to write a header, or to reword prose", () => {
    const m = msg(`${one}\nSummary:\n1) first\n`, "unrecognized-line");
    assert.match(m, /looks like a finding header but is not one: write N\. \[SEV\] <summary>/);
    assert.match(m, /reword the line if it is prose/);
  });
  test("a restated finding is blamed on the summary list, not on the numbering alone", () => {
    const found = envelope(check(`${one}\nSummary:\n1. [LOW] first\n`)).findings;
    assert.match(
      found.find((f) => f.rule === "numbering")?.message ?? "",
      /do not restate findings in a summary list/,
    );
    const missing = found.filter((f) => f.rule === "field-missing");
    assert.equal(missing.length, 1, "one message for a header with no field lines, not four");
    assert.match(
      missing[0]?.message ?? "",
      /no Where:, Threat:, Evidence: or Fix: line under this header/,
    );
  });
  test("a report-level rule has no finding number, and --help says so", () => {
    const f = envelope(check("The code looks fine.\n")).findings[0];
    assert.equal(f?.rule, "no-findings-block");
    assert.equal(f?.["finding"], undefined);
    const help = run(skill, "security-finding", ["--help"], { cwd: root }).stdout;
    assert.match(help, /names the finding number where there is one/);
  });
});
