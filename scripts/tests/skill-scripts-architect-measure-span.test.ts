// skill-scripts-architect-measure-span.test.ts — black-box test of architect/scripts/measure-span.ts
// (spec 0299 R5, R14), run from a copy of the skill directory placed outside the repository, with
// no network: exact byte counts, the margin and its findings, the usage and precondition exits,
// the --json envelope and --help.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const SOURCE = path.join(REPO, "artifacts", "core", "skills", "architect");
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "architect-measure-span-")));
after(() => fs.rmSync(root, { recursive: true, force: true }));
assert.ok(!root.startsWith(REPO), "the copy must live outside the repository");
const skill = path.join(root, "architect");
fs.cpSync(SOURCE, skill, { recursive: true, filter: (src) => !src.includes(`${path.sep}evals`) });
const work = path.join(root, "work");
fs.mkdirSync(work);

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}
const measure = (args: string[]): Run => {
  const res = spawnSync(
    process.execPath,
    [path.join(skill, "scripts", "measure-span.ts"), ...args],
    {
      cwd: work,
      env: { HOME: os.tmpdir(), PATH: path.dirname(process.execPath), LC_ALL: "C" },
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
};
const file = (name: string, content: string | Buffer): string => {
  const p = path.join(work, name);
  fs.writeFileSync(p, content);
  return p;
};
interface Envelope {
  ok: boolean;
  data: {
    ranges: { first: number; last: number; bytes: number }[];
    total: number;
    projected: number | null;
    margin: number | null;
  } | null;
  findings: { rule: string; message: string }[];
}
const envelope = (r: Run): Envelope => {
  const lines = r.stdout.split("\n").filter((l) => l !== "");
  assert.equal(lines.length, 1, `one stdout line expected, got: ${r.stdout}`);
  return JSON.parse(lines[0] as string) as Envelope;
};

// 10 bytes per line: "123456789\n"
const TEN = Array.from({ length: 40 }, () => "123456789\n").join("");

describe("measure-span: byte counts", () => {
  const f = file("ten.txt", TEN);
  test("an inclusive range counts its lines and their newlines", () => {
    const r = measure(["--json", f, "3-5"]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(envelope(r).data?.ranges, [{ first: 3, last: 5, bytes: 30 }]);
    assert.equal(envelope(r).data?.total, 30);
  });
  test("a multibyte character counts its UTF-8 bytes", () => {
    const r = measure(["--json", file("utf8.txt", "é\nab\n"), "1-1"]);
    assert.equal(envelope(r).data?.total, 3);
  });
  test("a last line without a trailing newline counts the bytes it has", () => {
    const r = measure(["--json", file("noeol.txt", "aa\nbb"), "2-2"]);
    assert.equal(envelope(r).data?.total, 2);
  });
  test("a CRLF line counts both bytes", () => {
    const r = measure(["--json", file("crlf.txt", "aa\r\nbb\r\n"), "1-1"]);
    assert.equal(envelope(r).data?.total, 4);
  });
  test("overlapping and repeated ranges count each line once in the total", () => {
    const r = measure(["--json", f, "1-3", "3-4", "1-3"]);
    const data = envelope(r).data;
    assert.equal(data?.total, 40);
    assert.deepEqual(
      data?.ranges.map((x) => x.bytes),
      [30, 20, 30],
    );
  });
  test("without --current and --budget, projected and margin are null", () => {
    const data = envelope(measure(["--json", f, "1-2"])).data;
    assert.equal(data?.projected, null);
    assert.equal(data?.margin, null);
  });
});

describe("measure-span: budget and margin", () => {
  const f = file("budget.txt", TEN);
  test("a comfortable margin exits 0 and reports the projected size and the margin", () => {
    const r = measure([
      "--json",
      f,
      "1-10",
      "--current",
      "1000",
      "--budget",
      "950",
      "--margin",
      "40",
    ]);
    assert.equal(r.status, 0, r.stderr);
    const data = envelope(r).data;
    assert.equal(data?.projected, 900);
    assert.equal(data?.margin, 50);
  });
  test("a margin smaller than the threshold is a thin-margin finding (exit 1)", () => {
    const r = measure([
      "--json",
      f,
      "1-10",
      "--current",
      "1000",
      "--budget",
      "903",
      "--margin",
      "200",
    ]);
    assert.equal(r.status, 1);
    const env = envelope(r);
    assert.equal(env.ok, false);
    assert.equal(env.findings[0]?.rule, "thin-margin");
    assert.equal(env.data?.margin, 3);
  });
  test("a projected size over the budget is an over-budget finding (exit 1)", () => {
    const r = measure(["--json", f, "1-1", "--current", "1000", "--budget", "900"]);
    assert.equal(r.status, 1);
    assert.equal(envelope(r).findings[0]?.rule, "over-budget");
  });
  test("a margin of exactly the threshold is not a finding", () => {
    const r = measure([f, "1-10", "--current", "1000", "--budget", "950", "--margin", "50"]);
    assert.equal(r.status, 0, r.stdout);
  });
});

describe("measure-span: usage and precondition exits, help", () => {
  const f = file("exits.txt", TEN);
  for (const [label, args] of [
    ["a reversed range", ["5-3"]],
    ["a malformed range", ["abc"]],
    ["a zero line number", ["0-3"]],
    ["no range", []],
    ["--current without --budget", ["1-2", "--current", "100"]],
    ["--budget without --current", ["1-2", "--budget", "100"]],
    ["an option with no value", ["1-2", "--margin"]],
    ["a non-numeric value", ["1-2", "--current", "x", "--budget", "1"]],
    ["an unknown option", ["1-2", "--wat"]],
  ] as const) {
    test(`${label} exits 2 with an ok:false envelope`, () => {
      const r = measure(["--json", f, ...args]);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      const env = envelope(r);
      assert.equal(env.ok, false);
      assert.equal(env.data, null);
      assert.equal(env.findings[0]?.rule, "usage");
    });
  }
  test("no file exits 2", () => {
    assert.equal(measure(["--json"]).status, 2);
  });
  test("an unreadable file exits 3 with data null", () => {
    const r = measure(["--json", path.join(work, "nope.txt"), "1-2"]);
    assert.equal(r.status, 3);
    assert.equal(envelope(r).findings[0]?.rule, "precondition");
    assert.equal(envelope(r).data, null);
  });
  test("a range past the last line exits 3 and names the last line", () => {
    const r = measure(["--json", file("forty.txt", TEN), "30-50"]);
    assert.equal(r.status, 3);
    assert.match(envelope(r).findings[0]?.message ?? "", /last line \(40\)/);
  });
  test("--help prints the usage on stdout and exits 0, with no Node warning", () => {
    const r = measure(["--help"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /Usage:/);
    assert.doesNotMatch(r.stderr, /Warning|MODULE_TYPELESS_PACKAGE_JSON/);
  });
  test("it writes nothing: the file is unchanged after a run", () => {
    const before = fs.readFileSync(f);
    measure([f, "1-2"]);
    assert.deepEqual(fs.readFileSync(f), before);
  });
});
