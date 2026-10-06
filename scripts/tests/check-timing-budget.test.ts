// check-timing-budget.test.ts — tests for scripts/check-timing-budget.ts (spec 0240 R13).
//
// The logic is driven through an injected runner and clock, so the budget
// verdict is deterministic; one case runs the real CLI end to end.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  evaluate,
  main,
  measure,
  parseArgs,
  type Clock,
  type RunExtras,
  type Runner,
} from "../check-timing-budget.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HARNESS = path.join(REPO, "scripts", "check-timing-budget.ts");
const GUARD = path.join(REPO, "scripts", "lib", "node-floor-guard.js");

/** A clock whose successive run durations are `durations` (two reads per run). */
function fakeClock(durations: number[]): Clock {
  const stamps: number[] = [];
  let t = 0;
  for (const d of durations) {
    stamps.push(t, t + d);
    t += d + 1;
  }
  let i = 0;
  return () => stamps[i++] ?? t;
}

const exitWith =
  (status: number): Runner =>
  () =>
    status;

const BASE = ["--runs", "3", "--budget-ms", "100", "--", "script.js"];

describe("parseArgs", () => {
  test("reads runs, budget, expected exit and the node argv", () => {
    assert.deepEqual(
      parseArgs(["--runs", "2", "--budget-ms", "50", "--expect-exit", "1", "--", "a.js", "x"]),
      {
        runs: 2,
        budgetMs: 50,
        expectExit: 1,
        argv: ["a.js", "x"],
      },
    );
  });

  test("rejects a missing separator or budget", () => {
    assert.throws(() => parseArgs(["--runs", "2", "--budget-ms", "50"]), /missing '--/);
    assert.throws(() => parseArgs(["--runs", "2", "--", "a.js"]), /--budget-ms/);
  });
});

describe("--stdin-file and --env-tmpdir", () => {
  test("parseArgs reads both options and omits them when absent", () => {
    const opts = parseArgs([
      "--runs",
      "1",
      "--budget-ms",
      "5",
      "--stdin-file",
      "in.json",
      "--env-tmpdir",
      "CREWRIG_USAGE_ROOT",
      "--",
      "a.js",
    ]);
    assert.equal(opts.stdinFile, "in.json");
    assert.equal(opts.envTmpdir, "CREWRIG_USAGE_ROOT");
    assert.equal("stdinFile" in parseArgs(BASE), false);
  });

  test("rejects an empty file name and a non-identifier variable name", () => {
    assert.throws(
      () => parseArgs(["--runs", "1", "--budget-ms", "5", "--stdin-file", "", "--", "a"]),
      /needs a value/,
    );
    assert.throws(
      () => parseArgs(["--runs", "1", "--budget-ms", "5", "--env-tmpdir", "A-B", "--", "a"]),
      /environment variable name/,
    );
  });

  test("every run gets the stdin bytes and a fresh empty directory, removed afterwards", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "timing-test-"));
    try {
      const stdinFile = path.join(tmp, "payload.json");
      fs.writeFileSync(stdinFile, '{"a":1}');
      const opts = parseArgs([
        "--runs",
        "3",
        "--budget-ms",
        "100",
        "--stdin-file",
        stdinFile,
        "--env-tmpdir",
        "USAGE_DIR",
        "--",
        "s.js",
      ]);
      const seen: string[] = [];
      const run: Runner = (_argv, extras: RunExtras = {}) => {
        assert.equal(extras.stdin?.toString("utf8"), '{"a":1}');
        const dir = extras.env?.USAGE_DIR ?? "";
        assert.ok(fs.statSync(dir).isDirectory());
        assert.deepEqual(fs.readdirSync(dir), [], "the directory starts empty");
        fs.writeFileSync(path.join(dir, "left-behind"), "x");
        seen.push(dir);
        return 0;
      };
      measure(opts, run, fakeClock([1, 1, 1]));
      assert.equal(new Set(seen).size, 3, "a distinct directory per run");
      for (const dir of seen) assert.equal(fs.existsSync(dir), false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("the directory is removed when the runner throws", () => {
    const opts = parseArgs(["--runs", "1", "--budget-ms", "5", "--env-tmpdir", "D", "--", "s.js"]);
    let dir = "";
    const run: Runner = (_argv, extras) => {
      dir = extras?.env?.D ?? "";
      throw new Error("boom");
    };
    assert.throws(() => measure(opts, run), /boom/);
    assert.equal(fs.existsSync(dir), false);
  });

  test("without the options a run gets no extras", () => {
    let got: RunExtras | undefined;
    measure(parseArgs(BASE), (_argv, extras) => ((got = extras), 0), fakeClock([1, 1, 1]));
    assert.deepEqual(got, {});
  });

  test("CLI end to end: the child reads stdin and sees an empty per-run directory", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "timing-e2e-"));
    try {
      const stdinFile = path.join(tmp, "in.txt");
      fs.writeFileSync(stdinFile, "hello");
      const child = path.join(tmp, "child.js");
      fs.writeFileSync(
        child,
        [
          "const fs = require('node:fs');",
          "const dir = process.env.RUN_DIR;",
          "const input = fs.readFileSync(0, 'utf8');",
          "process.exit(input === 'hello' && dir && fs.readdirSync(dir).length === 0 ? 0 : 3);",
        ].join("\n"),
      );
      const res = spawnSync(
        process.execPath,
        [
          "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
          HARNESS,
          "--runs",
          "2",
          "--budget-ms",
          "60000",
          "--stdin-file",
          stdinFile,
          "--env-tmpdir",
          "RUN_DIR",
          "--",
          child,
        ],
        { encoding: "utf8" },
      );
      assert.equal(res.status, 0, res.stderr);
      assert.match(res.stdout, /child\.js within 60000 ms over 2 runs/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("--cwd", () => {
  test("parseArgs reads it and omits it when absent", () => {
    const opts = parseArgs(["--runs", "1", "--budget-ms", "5", "--cwd", "/some/dir", "--", "a.js"]);
    assert.equal(opts.cwd, "/some/dir");
    assert.equal("cwd" in parseArgs(BASE), false);
  });

  test("rejects an empty directory", () => {
    assert.throws(
      () => parseArgs(["--runs", "1", "--budget-ms", "5", "--cwd", "", "--", "a"]),
      /--cwd needs a value/,
    );
  });

  test("every run receives the directory, next to stdin when both are given", () => {
    const opts = parseArgs(["--runs", "2", "--budget-ms", "100", "--cwd", "/work", "--", "s.js"]);
    const seen: (string | undefined)[] = [];
    measure(opts, (_argv, extras) => (seen.push(extras?.cwd), 0), fakeClock([1, 1]));
    assert.deepEqual(seen, ["/work", "/work"]);
  });

  test("CLI end to end: the child's working directory is the one given", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "timing-cwd-"));
    try {
      const real = fs.realpathSync(tmp);
      const child = path.join(real, "child.js");
      fs.writeFileSync(
        child,
        `process.exit(require("node:fs").realpathSync(process.cwd()) === ${JSON.stringify(real)} ? 0 : 3);`,
      );
      const res = spawnSync(
        process.execPath,
        [
          "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
          HARNESS,
          "--runs",
          "2",
          "--budget-ms",
          "60000",
          "--cwd",
          real,
          "--",
          child,
        ],
        { encoding: "utf8", cwd: REPO },
      );
      assert.equal(res.status, 0, res.stderr);
      assert.match(res.stdout, /within 60000 ms over 2 runs/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("evaluate", () => {
  test("over budget: names the script, budget, measured time and run", () => {
    const opts = parseArgs(BASE);
    const verdict = evaluate(opts, measure(opts, exitWith(0), fakeClock([40, 250, 60])));
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.lines, [
      "timing-budget: script.js exceeded 100 ms: measured 250.0 ms (run 2/3)",
    ]);
  });

  test("within budget: reports min, median and max", () => {
    const opts = parseArgs(BASE);
    const verdict = evaluate(opts, measure(opts, exitWith(0), fakeClock([40, 90, 60])));
    assert.equal(verdict.ok, true);
    assert.match(verdict.lines[0] ?? "", /min 40\.0 ms, median 60\.0 ms, max 90\.0 ms/);
  });

  test("wrong exit code fails even within budget", () => {
    const opts = parseArgs(BASE);
    const verdict = evaluate(opts, measure(opts, exitWith(1), fakeClock([10, 10, 10])));
    assert.equal(verdict.ok, false);
    assert.equal(verdict.lines.length, 3);
    assert.match(verdict.lines[0] ?? "", /exited 1, expected 0 \(run 1\/3\)/);
  });

  test("--expect-exit accepts a deliberate non-zero exit", () => {
    const opts = parseArgs([
      "--runs",
      "1",
      "--budget-ms",
      "100",
      "--expect-exit",
      "1",
      "--",
      "s.js",
    ]);
    assert.equal(evaluate(opts, measure(opts, exitWith(1), fakeClock([5]))).ok, true);
  });
});

describe("main", () => {
  test("returns 2 on a usage error", () => {
    assert.equal(main(["--runs", "1"]), 2);
  });

  test("returns 1 over budget and 0 within it", () => {
    assert.equal(main(BASE, exitWith(0), fakeClock([1, 500, 1])), 1);
    assert.equal(main(BASE, exitWith(0), fakeClock([1, 2, 3])), 0);
  });

  test("CLI end to end against the floor guard", () => {
    const res = spawnSync(
      process.execPath,
      [
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        HARNESS,
        "--runs",
        "2",
        "--budget-ms",
        "60000",
        "--",
        GUARD,
      ],
      { encoding: "utf8" },
    );
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /node-floor-guard\.js within 60000 ms over 2 runs/);
  });
});

describe("--case (spec 0247 R19, delta-01)", () => {
  const CASED = ["--runs", "3", "--budget-ms", "100", "--case", "a-posttooluse", "--", "s.js"];

  test("parseArgs reads the label and omits it when absent", () => {
    assert.equal(parseArgs(CASED).caseLabel, "a-posttooluse");
    assert.equal("caseLabel" in parseArgs(BASE), false);
  });

  test("rejects an empty label", () => {
    assert.throws(
      () => parseArgs(["--runs", "1", "--budget-ms", "5", "--case", "", "--", "a"]),
      /--case needs a value/,
    );
  });

  test("the failure line names the script, the case, the budget and the measured time", () => {
    const opts = parseArgs(CASED);
    const verdict = evaluate(opts, measure(opts, exitWith(0), fakeClock([40, 250, 60])));
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.lines, [
      "timing-budget: s.js [case a-posttooluse] exceeded 100 ms: measured 250.0 ms (run 2/3)",
    ]);
  });

  test("an unexpected exit and the summary line name the case too", () => {
    const opts = parseArgs(CASED);
    const failed = evaluate(opts, measure(opts, exitWith(4), fakeClock([1, 1, 1])));
    assert.match(failed.lines[0] ?? "", /^timing-budget: s\.js \[case a-posttooluse\] exited 4/);
    const passed = evaluate(opts, measure(opts, exitWith(0), fakeClock([1, 2, 3])));
    assert.match(
      passed.lines[0] ?? "",
      /^timing-budget: s\.js \[case a-posttooluse\] within 100 ms/,
    );
  });

  test("the option does not change what a run receives", () => {
    let got: RunExtras | undefined;
    measure(parseArgs(CASED), (_argv, extras) => ((got = extras), 0), fakeClock([1, 1, 1]));
    assert.deepEqual(got, {});
  });

  test("CLI end to end: the case reaches the failure line on standard error, exit 1", () => {
    const res = spawnSync(
      process.execPath,
      [
        "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
        HARNESS,
        "--runs",
        "1",
        "--budget-ms",
        "0",
        "--case",
        "d-closed-port",
        "--",
        GUARD,
      ],
      { encoding: "utf8" },
    );
    assert.equal(res.status, 1, res.stderr);
    assert.match(
      res.stderr,
      /^timing-budget: \S*node-floor-guard\.js \[case d-closed-port\] exceeded 0 ms: measured [\d.]+ ms \(run 1\/1\)$/m,
    );
  });
});
