// Spec 0302 R7/R11: scripts/classify-ci-drift.ts over the real harness output frozen in
// scripts/tests/fixtures/classify-ci-drift-*.txt (captured with `2>&1` from check-ci-parity.ts on
// mutated temporary trees) and over small hand-built inputs that reuse real message prefixes.
// Offline: the script reads one file or standard input and calls nothing else.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const SCRIPT = path.join(REPO, "scripts", "classify-ci-drift.ts");
const FIX = path.join(import.meta.dirname, "fixtures");
const fixture = (name: string) =>
  path.join(FIX, `classify-ci-drift-${name}.txt`);

const OK_LINE =
  "OK: reference, GitHub Actions, GitLab agree on the portable capability set; every pipeline job is traceable.";
const QUESTION = (id: string) =>
  `Is the reference or the pipeline job the intended truth for capability '${id}'?`;
const FOOTER = (n: number) =>
  `\nFAILED: ${n} CI parity violation(s) detected (spec 0049).\n`;
const VALIDITY_HEAD =
  "FAILED: 1 reference-validity violation(s) in /repo/ci/ci-capabilities.yml:";

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}
interface Rec {
  kind: string;
  id: string | null;
  engine: string | null;
  action: string;
  ambiguous: boolean;
  question: string | null;
  guidance: string;
  text: string;
}
interface Report {
  ok: boolean;
  data:
    { count: number; records: Rec[] } | { kinds: { kind: string }[] } | null;
  findings: { rule: string; message: string; severity?: string }[];
}

function run(args: readonly string[], stdin?: string): Run {
  const r = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", SCRIPT, ...args],
    { encoding: "utf8", input: stdin ?? "" },
  );
  if (r.error) throw r.error;
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

/** `--json` over `text` fed on standard input. */
function classify(text: string): { status: number; report: Report; run: Run } {
  const r = run(["--json", "-"], text);
  return { status: r.status, report: JSON.parse(r.stdout) as Report, run: r };
}
function records(text: string): Rec[] {
  const { report } = classify(text);
  assert.ok(
    report.data !== null && "records" in report.data,
    `no records for: ${text}`,
  );
  return report.data.records;
}
function fromFixture(name: string) {
  return classify(fs.readFileSync(fixture(name), "utf8"));
}
const drift = (msg: string) => `  DRIFT: ${msg}\n`;
const bullet = (msg: string) => `${VALIDITY_HEAD}\n  - ${msg}\n`;

// ---------------------------------------------------------------------------
// A fixture per kind, taken from real harness output
// ---------------------------------------------------------------------------

test("the clean OK run has no record and exits 0", () => {
  const { status, report } = fromFixture("clean");
  assert.equal(status, 0);
  assert.equal(report.ok, true);
  assert.deepEqual(report.data, { count: 0, records: [] });
  assert.deepEqual(report.findings, []);
  assert.ok(
    fs.readFileSync(fixture("clean"), "utf8").includes(OK_LINE),
    "fixture is the OK run",
  );
});

test("stale derived pipeline: one record, auto, the nested DRIFT/FAILED dump stays inside it", () => {
  const { status, report } = fromFixture("stale-derived-pipeline");
  assert.equal(status, 1);
  assert.ok(report.data && "records" in report.data);
  const [r, ...more] = report.data.records;
  assert.equal(more.length, 0, "footer and dump lines are not records");
  assert.equal(report.data.count, 1);
  assert.ok(r);
  assert.equal(r.kind, "stale-derived-pipeline");
  assert.equal(r.engine, "gitlab");
  assert.equal(r.id, null);
  assert.equal(r.action, "auto");
  assert.equal(r.ambiguous, false);
  assert.equal(r.question, null);
  assert.ok(
    r.text.includes("# hand-edited drift"),
    "the dump is part of the verbatim record",
  );
  assert.ok(
    r.text.includes("    FAILED: run 'node"),
    "the indented FAILED line is a continuation",
  );
});

test("reference drift: an invalid reference (validity bullet) names the capability, engine reference", () => {
  const { status, report } = fromFixture("reference-drift-validity");
  assert.equal(status, 1);
  assert.ok(report.data && "records" in report.data);
  assert.equal(report.data.count, 1);
  const r = report.data.records[0];
  assert.ok(r);
  assert.equal(r.kind, "reference-drift");
  assert.equal(r.id, "build");
  assert.equal(r.engine, "reference");
  assert.equal(r.action, "propose");
  assert.equal(r.ambiguous, false);
  assert.match(r.text, /validity rule 2/);
});

test("reference drift: a capability without group, then the stale pipeline it causes", () => {
  const { status, report } = fromFixture("reference-drift-group");
  assert.equal(status, 1);
  assert.ok(report.data && "records" in report.data);
  assert.deepEqual(
    report.data.records.map((r) => [r.kind, r.id, r.engine]),
    [
      ["reference-drift", "lint-specs", "reference"],
      ["stale-derived-pipeline", null, "gitlab"],
    ],
  );
});

test("hand-authored drift: ambiguous is true with the fixed question", () => {
  const { status, report } = fromFixture("hand-authored-drift");
  assert.equal(status, 1);
  assert.ok(report.data && "records" in report.data);
  const [r] = report.data.records;
  assert.ok(r);
  assert.equal(r.kind, "hand-authored-drift");
  assert.equal(r.id, "build");
  assert.equal(r.engine, "github-actions");
  assert.equal(r.action, "propose");
  assert.equal(r.ambiguous, true);
  assert.equal(r.question, QUESTION("build"));
});

test("evidence-less exception is not classified reference-drift", () => {
  const { status, report } = fromFixture("evidence-less-exception");
  assert.equal(status, 1);
  assert.ok(report.data && "records" in report.data);
  assert.ok(report.data.count >= 1);
  for (const r of report.data.records) {
    assert.equal(r.kind, "evidence-less-exception");
    assert.equal(r.engine, "reference");
    assert.equal(r.id, "pages-deploy");
    assert.equal(r.ambiguous, false);
  }
});

test("untraceable job: id and engine come from the record", () => {
  const { status, report } = fromFixture("untraceable-job");
  assert.equal(status, 1);
  assert.ok(report.data && "records" in report.data);
  const [r] = report.data.records;
  assert.ok(r);
  assert.deepEqual(
    [r.kind, r.id, r.engine, r.action, r.ambiguous],
    ["untraceable-job", "mystery", "github-actions", "propose", false],
  );
});

test("validity run: header, prose and blank lines are structural; two bullets, two kinds", () => {
  const { status, report } = fromFixture("validity-run");
  assert.equal(status, 1);
  assert.ok(report.data && "records" in report.data);
  assert.deepEqual(
    report.data.records.map((r) => [r.kind, r.id]),
    [
      ["reference-drift", "build"],
      ["evidence-less-exception", "pages-deploy"],
    ],
  );
  assert.ok(!report.data.records.some((r) => r.kind === "unclassified"));
});

test("full real-shaped run: header, continuation and footer lines yield only the three records", () => {
  const { status, report } = fromFixture("full-run");
  const text = fs.readFileSync(fixture("full-run"), "utf8");
  assert.match(text, /FAILED: 3 CI parity violation\(s\) detected/);
  assert.equal(status, 1);
  assert.ok(report.data && "records" in report.data);
  assert.equal(report.data.count, 3, "the count matches the harness footer");
  assert.deepEqual(
    report.data.records.map((r) => r.kind),
    ["untraceable-job", "hand-authored-drift", "stale-derived-pipeline"],
  );
  assert.ok(!report.data.records.some((r) => r.kind === "unclassified"));
  assert.equal(
    report.findings.filter((f) => f.rule !== "mixed-input").length,
    3,
    "one error finding per record",
  );
});

test("ambiguous is true exactly for hand-authored-drift, over every fixture record", () => {
  for (const name of [
    "stale-derived-pipeline",
    "reference-drift-validity",
    "reference-drift-group",
    "hand-authored-drift",
    "evidence-less-exception",
    "untraceable-job",
    "validity-run",
    "full-run",
    "aborted-shell",
  ]) {
    const { report } = fromFixture(name);
    assert.ok(report.data && "records" in report.data, name);
    for (const r of report.data.records) {
      assert.equal(
        r.ambiguous,
        r.kind === "hand-authored-drift",
        `${name}: ${r.kind}`,
      );
      assert.equal(r.question !== null, r.ambiguous, `${name}: ${r.kind}`);
      assert.equal(
        r.action === "auto",
        r.kind === "stale-derived-pipeline",
        `${name}: ${r.kind}`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Exit 3: the harness aborted, or the input is not harness output
// ---------------------------------------------------------------------------

test("an unindented Error: line (harness abort) exits 3 with a precondition finding", () => {
  for (const name of ["aborted-error", "reference-missing"]) {
    const { status, report } = fromFixture(name);
    assert.equal(status, 3, name);
    assert.equal(report.ok, false);
    assert.equal(report.data, null);
    assert.equal(report.findings.length, 1);
    assert.equal(report.findings[0]?.rule, "precondition");
    assert.match(report.findings[0]?.message ?? "", /Error:/);
  }
});

test("a DRIFT record plus an unindented Error: line exits 3, data null, and counts the records seen", () => {
  const text =
    drift(
      "capability 'build' (github-actions): job 'build' exhibits 1 of 2 declared business steps (R3)",
    ) +
    "Error: /repo/.gitlab-ci.yml: more than one YAML document is not supported\n";
  const { status, report } = classify(text);
  assert.equal(status, 3);
  assert.equal(report.data, null);
  assert.equal(report.findings[0]?.rule, "precondition");
  assert.match(report.findings[0]?.message ?? "", /after 1 record\(s\)/);
  assert.match(
    report.findings[0]?.message ?? "",
    /Error: \/repo\/\.gitlab-ci\.yml/,
  );
});

test("an indented Error: text inside a continuation is part of the record and has no effect", () => {
  const text =
    drift(
      "reference↔GitLab divergence (gitlab) — composed 'build-ci.ts --check' failed (R5):",
    ) +
    "    Error: cannot read the reference\n    Error: second line\n" +
    FOOTER(1);
  const { status, report } = classify(text);
  assert.equal(status, 1);
  assert.ok(report.data && "records" in report.data);
  assert.equal(report.data.count, 1);
  assert.equal(report.data.records[0]?.kind, "stale-derived-pipeline");
  assert.match(report.data.records[0]?.text ?? "", /Error: second line/);
});

test("a run aborted by ShellAbort keeps its records, has no footer and exits 1 (partial set)", () => {
  const text = fs.readFileSync(fixture("aborted-shell"), "utf8");
  assert.ok(
    !/^FAILED:/m.test(text) && !/^Error:/m.test(text) && !/^OK:/m.test(text),
  );
  const { status, report } = classify(text);
  assert.equal(status, 1);
  assert.ok(report.data && "records" in report.data);
  assert.equal(report.data.count, 1);
  assert.equal(report.data.records[0]?.kind, "untraceable-job");
});

test("a FAILED footer with no record exits 3 with a precondition finding (fail closed)", () => {
  const { status, report } = classify(FOOTER(2));
  assert.equal(status, 3);
  assert.equal(report.data, null);
  assert.equal(report.findings[0]?.rule, "precondition");
  assert.match(report.findings[0]?.message ?? "", /FAILED/);
});

test("a validity header with no bullet exits 3 as well", () => {
  const { status, report } = classify(`${VALIDITY_HEAD}\n`);
  assert.equal(status, 3);
  assert.equal(report.findings[0]?.rule, "precondition");
});

test("non-harness input (no record, no OK, no FAILED) exits 3 and prints no record", () => {
  const { status, report } = classify("hello\nthis is not harness output\n");
  assert.equal(status, 3);
  assert.equal(report.data, null);
  assert.equal(report.findings[0]?.rule, "precondition");
  assert.equal(classify("").status, 3, "empty input");
});

test("an unreadable path exits 3 and names the path", () => {
  const missing = path.join(
    os.tmpdir(),
    "crewrig-classify-ci-drift-no-such-file.txt",
  );
  const r = run(["--json", missing]);
  assert.equal(r.status, 3);
  const report = JSON.parse(r.stdout) as Report;
  assert.equal(report.ok, false);
  assert.equal(report.data, null);
  assert.equal(report.findings[0]?.rule, "precondition");
  assert.ok(report.findings[0]?.message.includes(missing));
  assert.ok(r.stderr.length > 0, "human text goes to standard error");
});

// ---------------------------------------------------------------------------
// Mixed input, unclassified, rule order
// ---------------------------------------------------------------------------

test("a mixed OK and DRIFT input exits 1 with the mixed-input warning", () => {
  const text =
    OK_LINE +
    "\n" +
    drift(
      "capability 'build' (github-actions): job 'build' exhibits 1 of 2 declared business steps (R3)",
    );
  const { status, report } = classify(text);
  assert.equal(status, 1);
  assert.equal(report.ok, false);
  assert.ok(report.data && "records" in report.data);
  assert.equal(report.data.count, 1);
  const warn = report.findings.filter((f) => f.rule === "mixed-input");
  assert.equal(warn.length, 1);
  assert.equal(warn[0]?.severity, "warning");
  assert.equal(
    report.findings.length,
    2,
    "the record finding plus the warning",
  );
});

test("a record that matches no rule is unclassified, exit 1; structural lines never are", () => {
  const text =
    drift("a brand new harness message nobody classified") + FOOTER(1);
  const { status, report } = classify(text);
  assert.equal(status, 1);
  assert.ok(report.data && "records" in report.data);
  assert.equal(report.data.count, 1, "the footer is not a record");
  const [r] = report.data.records;
  assert.ok(r);
  assert.deepEqual(
    [r.kind, r.id, r.engine, r.action, r.ambiguous, r.question],
    ["unclassified", null, null, "propose", false, null],
  );
  assert.equal(report.findings[0]?.rule, "unclassified");
});

test("rules match the first line only: a continuation never changes the kind", () => {
  const text =
    drift("a brand new harness message") +
    "    untraceable job 'x' in a.yml (gitlab) is in the reference portable set but absent from gitlab\n";
  assert.equal(records(text)[0]?.kind, "unclassified");
});

// One record that matches two adjacent rules of the order: the earlier rule wins.
const ADJACENT: ReadonlyArray<{
  name: string;
  input: string;
  kind: string;
  engine: string | null;
}> = [
  {
    name: "DRIFT 1 over 2: untraceable job in a composed generator failure line",
    input: drift(
      "reference↔GitLab divergence (gitlab) — composed 'build-ci.ts --check' failed (R5): untraceable job 'x'",
    ),
    kind: "untraceable-job",
    engine: "gitlab",
  },
  {
    name: "DRIFT 2 over 3: composed generator failure that also carries (reference)",
    input: drift(
      "reference↔GitLab divergence (gitlab) — composed 'build-ci.ts --check' failed (R5): (reference)",
    ),
    kind: "stale-derived-pipeline",
    engine: "gitlab",
  },
  {
    name: "DRIFT 3 over 4: (reference) tag together with an engine tag",
    input: drift(
      "capability 'x' (reference): trigger path is wrong for (github-actions)",
    ),
    kind: "reference-drift",
    engine: "reference",
  },
  {
    name: "DRIFT 4 over 5: engine tag together with an absent-from-platform statement",
    input: drift(
      "capability 'x' (github-actions): is in the reference portable set but absent from gitlab",
    ),
    kind: "hand-authored-drift",
    engine: "github-actions",
  },
  {
    name: "DRIFT 5 over 6: absent from a platform together with a group statement",
    input: drift(
      "capability 'x' is in the reference portable set but absent from gitlab and has no 'group' (R11)",
    ),
    kind: "hand-authored-drift",
    engine: "gitlab",
  },
  {
    name: "DRIFT 6 over 7: no group together with a placement statement",
    input: drift(
      "capability 'x' has no 'group': job 'x' is in build.yml but its group belongs elsewhere",
    ),
    kind: "reference-drift",
    engine: "reference",
  },
  {
    name: "DRIFT 7 over 8: a placement record is not unclassified",
    input: drift(
      "job 'lint-specs' is in _ci-modules.yml but its group 'governance' belongs in _ci-governance.yml (R11)",
    ),
    kind: "hand-authored-drift",
    engine: "github-actions",
  },
  {
    name: "bullet 1 over 2: exception.evidence in a bullet is not reference-drift",
    input: bullet(
      "capability 'x': engine-specific capability with empty exception.evidence (validity rule 3)",
    ),
    kind: "evidence-less-exception",
    engine: "reference",
  },
  {
    name: "bullet 2: any other bullet is reference-drift",
    input: bullet(
      "capability 'x': trigger kind 'y' is outside the neutral vocabulary (validity rule 2)",
    ),
    kind: "reference-drift",
    engine: "reference",
  },
];
for (const c of ADJACENT) {
  test(`rule order: ${c.name}`, () => {
    const [r, ...rest] = records(c.input);
    assert.equal(rest.length, 0);
    assert.equal(r?.kind, c.kind);
    assert.equal(r?.engine, c.engine);
  });
}

test("the DRIFT-record rules 7 and 3 carry the job key and capability id as the first quoted name", () => {
  const [placement] = records(
    drift(
      "job 'lint-specs' is in _ci-modules.yml but its group 'governance' belongs in _ci-governance.yml (R11)",
    ),
  );
  assert.equal(placement?.id, "lint-specs");
  const [ref] = records(
    drift(
      "capability 'figure-labels' (reference): trigger 'push' declares a paths value that is not a list (R17)",
    ),
  );
  assert.equal(ref?.id, "figure-labels");
});

// ---------------------------------------------------------------------------
// CLI surface: --json shape, usage, --help, --kinds, standard input, file path
// ---------------------------------------------------------------------------

test("--json prints one {ok, data, findings} object on standard output on each of exits 0, 1, 2, 3", () => {
  const cases: Array<[number, readonly string[], string]> = [
    [0, ["--json", "-"], OK_LINE + "\n"],
    [
      1,
      ["--json", "-"],
      drift(
        "capability 'build' (github-actions): job 'build' exhibits 1 of 2 declared business steps (R3)",
      ),
    ],
    [2, ["--json", "--bogus"], ""],
    [3, ["--json", "-"], "not harness output\n"],
  ];
  for (const [code, args, input] of cases) {
    const r = run(args, input);
    assert.equal(r.status, code);
    const lines = r.stdout.trimEnd().split("\n");
    assert.equal(
      lines.length,
      1,
      `exit ${code}: one JSON line on standard output`,
    );
    const o = JSON.parse(lines[0] as string) as Report;
    assert.deepEqual(Object.keys(o).sort(), ["data", "findings", "ok"]);
    assert.equal(o.ok, code === 0);
    assert.ok(Array.isArray(o.findings));
    assert.ok(
      r.stderr.length > 0,
      `exit ${code}: human text on standard error`,
    );
    if (code === 2 || code === 3) {
      assert.equal(o.data, null);
      assert.equal(o.findings.length, 1);
      assert.equal(o.findings[0]?.rule, code === 2 ? "usage" : "precondition");
    }
    if (code === 1) {
      assert.ok(o.data && "count" in o.data && "records" in o.data);
      assert.equal(o.data.count, o.data.records.length);
      assert.equal(o.findings[0]?.rule, "hand-authored-drift");
    }
    if (code === 0) assert.deepEqual(o.data, { count: 0, records: [] });
  }
});

test("without --json the verdict goes to stdout (0, 1) or stderr (2, 3) and standard output stays clean", () => {
  const ok = run(["-"], OK_LINE + "\n");
  assert.equal(ok.status, 0);
  assert.ok(ok.stdout.length > 0);
  const bad = run(["-"], "nonsense\n");
  assert.equal(bad.status, 3);
  assert.equal(bad.stdout, "");
  assert.match(bad.stderr, /^Error:/);
  const rec = run(["-"], drift("a brand new harness message"));
  assert.equal(rec.status, 1);
  assert.match(rec.stdout, /kind: unclassified/);
});

test("usage errors exit 2: no operand, two operands, unknown option, --kinds with an operand", () => {
  for (const args of [
    [],
    ["a", "b"],
    ["--nope", "-"],
    ["--kinds", "x"],
  ] as const) {
    const r = run(args);
    assert.equal(r.status, 2, JSON.stringify(args));
    assert.match(r.stderr, /Usage:/);
  }
});

test("--help prints the usage and exits 0", () => {
  const r = run(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage: classify-ci-drift\.ts/);
  assert.match(r.stdout, /--kinds/);
  assert.match(r.stdout, /Exit:/);
});

test("--kinds prints the five kinds with definition and guidance, exit 0; --json lists them", () => {
  const kinds = [
    "stale-derived-pipeline",
    "reference-drift",
    "hand-authored-drift",
    "evidence-less-exception",
    "untraceable-job",
  ];
  const r = run(["--kinds"]);
  assert.equal(r.status, 0);
  for (const k of kinds) assert.ok(r.stdout.includes(k), k);
  assert.ok(
    !r.stdout.includes("unclassified"),
    "unclassified is not one of the five kinds",
  );
  const j = run(["--json", "--kinds"]);
  assert.equal(j.status, 0);
  const o = JSON.parse(j.stdout) as Report;
  assert.equal(o.ok, true);
  assert.ok(o.data && "kinds" in o.data);
  assert.deepEqual(
    o.data.kinds.map((k) => k.kind),
    kinds,
  );
});

test("a file path and standard input give the same classification", () => {
  const p = fixture("full-run");
  const viaPath = run(["--json", p]);
  const viaStdin = run(["--json", "-"], fs.readFileSync(p, "utf8"));
  assert.equal(viaPath.status, 1);
  assert.equal(viaStdin.status, 1);
  assert.equal(viaPath.stdout, viaStdin.stdout);
});
