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
import { bestOf } from "./lib/bounded-wall-clock.ts";

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

describe("tolerance (spec 0264 R1-R5)", () => {
  const TEN = ["--runs", "10", "--budget-ms", "550", "--", "s.js"];
  const near = (...over: number[]): number[] => [
    ...Array<number>(10 - over.length).fill(150),
    ...over,
  ];
  const verdictOf = (args: string[], durations: number[], status = 0) => {
    const opts = parseArgs(args);
    return evaluate(opts, measure(opts, exitWith(status), fakeClock(durations)));
  };

  test("one slow run among ten passes, is labelled tolerated and the second-worst is shown", () => {
    const v = verdictOf(TEN, near(681));
    assert.equal(v.ok, true);
    assert.deepEqual(v.lines.slice(0, 1), [
      "timing-budget: s.js exceeded 550 ms: measured 681.0 ms (run 10/10) tolerated",
    ]);
    assert.match(v.lines.at(-1) ?? "", /max 681\.0 ms, second-worst 150\.0 ms$/);
  });

  test("two runs over budget fail and both are printed as before", () => {
    const v = verdictOf(TEN, near(600, 700));
    assert.equal(v.ok, false);
    assert.deepEqual(v.lines, [
      "timing-budget: s.js exceeded 550 ms: measured 600.0 ms (run 9/10)",
      "timing-budget: s.js exceeded 550 ms: measured 700.0 ms (run 10/10)",
    ]);
  });

  test("the case label reaches every failing line", () => {
    const v = verdictOf(["--case", "c", ...TEN], near(600, 700));
    assert.equal(v.lines.length, 2);
    for (const line of v.lines)
      assert.match(line, /^timing-budget: s\.js \[case c\] exceeded 550 ms/);
  });

  test("a run over three times the budget fails, whatever the tolerance", () => {
    const v = verdictOf(TEN, near(1700));
    assert.equal(v.ok, false);
    assert.deepEqual(v.lines, [
      "timing-budget: s.js exceeded 550 ms: measured 1700.0 ms (run 10/10)",
    ]);
    assert.equal(verdictOf(["--tolerate", "5", ...TEN], near(1700)).ok, false);
  });

  test("a wrong exit status in one run fails and names the run", () => {
    const opts = parseArgs(["--expect-exit", "1", ...TEN]);
    const statuses = [1, 1, 1, 0, 1, 1, 1, 1, 1, 1];
    let i = 0;
    const v = evaluate(
      opts,
      measure(opts, () => statuses[i++] ?? 1, fakeClock(near())),
    );
    assert.equal(v.ok, false);
    assert.deepEqual(v.lines, ["timing-budget: s.js exited 0, expected 1 (run 4/10)"]);
  });

  test("--tolerate 0 is strict", () => {
    assert.equal(verdictOf(["--tolerate", "0", ...TEN], near(681)).ok, false);
  });

  test("fewer than five runs are strict by default", () => {
    const four = ["--runs", "4", "--budget-ms", "550", "--", "s.js"];
    assert.equal(verdictOf(four, [150, 150, 150, 681]).ok, false);
    assert.equal(verdictOf(["--tolerate", "1", ...four], [150, 150, 150, 681]).ok, true);
  });

  test("every run at 1.5 times the budget fails", () => {
    const v = verdictOf(TEN, Array<number>(10).fill(825));
    assert.equal(v.ok, false);
    assert.equal(v.lines.length, 10);
  });

  test("a malformed --tolerate is a usage error with exit 2", () => {
    assert.throws(
      () => parseArgs(["--tolerate", "abc", ...TEN]),
      /--tolerate needs a non-negative integer/,
    );
    assert.throws(() => parseArgs(["--tolerate", "-1", ...TEN]), /--tolerate/);
    assert.equal(main(["--tolerate", "abc", ...TEN]), 2);
  });

  test("a tolerance at or above the run count prints one notice and exits 0", () => {
    const five = ["--runs", "5", "--tolerate", "5", "--budget-ms", "550", "--", "s.js"];
    const v = verdictOf(five, [150, 600, 700, 800, 900]);
    assert.equal(v.ok, true);
    assert.equal(v.lines.filter((l) => /ceiling/.test(l)).length, 1);
    assert.match(
      v.lines[0] ?? "",
      /only the 1650 ms ceiling and the exit status can fail the step/,
    );
    assert.equal(main(five, exitWith(0), fakeClock([1, 1, 1, 1, 1])), 0);
  });

  test("the success line carries the second-worst run", () => {
    const v = verdictOf(BASE, [40, 90, 60]);
    assert.match(v.lines[0] ?? "", /max 90\.0 ms, second-worst 60\.0 ms/);
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

describe("bestOf: a best-of-N upper wall-clock bound (spec 0264 R10)", () => {
  const sample = (ok: boolean, message: string) => ({ ok, message, value: message });

  test("a stall on attempt 1 passes", () => {
    const seen: number[] = [];
    const v = bestOf((n) => (seen.push(n), sample(n > 0, `attempt ${n}`)));
    assert.equal(v, "attempt 1");
    assert.deepEqual(seen, [0, 1]);
  });

  test("a slowdown on every attempt fails with every message", () => {
    assert.throws(
      () => bestOf((n) => sample(false, `slow ${n}`)),
      (e: Error) =>
        /attempt 1: slow 0/.test(e.message) &&
        /attempt 2: slow 1/.test(e.message) &&
        /attempt 3: slow 2/.test(e.message),
    );
  });

  test("the attempt count is configurable", () => {
    let runs = 0;
    assert.throws(() => bestOf(() => (runs++, sample(false, "x")), 5));
    assert.equal(runs, 5);
  });

  test("the third attempt is not run once the second passed", () => {
    let runs = 0;
    bestOf(() => sample(++runs === 2, "x"));
    assert.equal(runs, 2);
  });

  test("an asynchronous measurement works, passing and failing", async () => {
    let runs = 0;
    const v = await bestOf(async () => sample(++runs === 2, `run ${runs}`));
    assert.equal(v, "run 2");
    await assert.rejects(
      bestOf(async (n) => sample(false, `async slow ${n}`)),
      /attempt 3: async slow 2/,
    );
  });

  test("a hang is still bounded by the caller's own abort", async () => {
    const hang = async () => {
      await new Promise((_, reject) => setTimeout(() => reject(new Error("aborted")), 20));
      return sample(true, "unreachable");
    };
    let runs = 0;
    await assert.rejects(
      bestOf(() => (runs++, hang())),
      /aborted/,
    );
    assert.equal(runs, 1, "a thrown abort is not retried");
  });

  test("a lower bound is not softened: a violation inside measure fails at once", () => {
    let runs = 0;
    assert.throws(
      () =>
        bestOf(() => {
          runs++;
          assert.ok(false, "under the lower bound");
          return sample(true, "x");
        }),
      /under the lower bound/,
    );
    assert.equal(runs, 1);
  });
});
