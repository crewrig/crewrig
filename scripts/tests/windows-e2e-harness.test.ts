// windows-e2e-harness.test.ts — the cross-system proof of the end-to-end harness entries (spec 0261
// R17, R20, R21): the runner dry run, toml_merge, report, the verdict publisher dry run, the docker
// diagnostics and the three probes without a vendor CLI each run as `node <entry>.ts` from PowerShell
// and from `cmd.exe` on Windows, against scratch HOME/USERPROFILE and a PATH with no docker or CLI.
// The `direct` leg runs the same assertions on any host; the shell legs skip off Windows. The
// Docker-driving scenarios and the live probes are POSIX only (R21) and are not run here.
// The per-entry time bound and its timing line are unit checks on synthetic runs through `check()`:
// they spawn nothing. The `windows-e2e-harness` job runs this file.

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import type { TestContext } from "node:test";

import { defaultIsFile } from "../lib/worktree-claim/launch-windows.ts";
import {
  dockerless,
  probesWithoutCli,
  publishDryRun,
  reportCli,
  runnerDryRun,
  tomlMergeCli,
} from "./lib/windows-e2e-cases.ts";
import { inProcess } from "./lib/windows-e2e-inproc.ts";
import { check, makeCtx, noCarriageReturn } from "./lib/windows-e2e-run.ts";
import type { Ctx, Leg } from "./lib/windows-e2e-run.ts";
import { resolveInterpreters, WIN } from "./lib/windows-proof-support.ts";
import type { Run } from "./lib/windows-proof-support.ts";

/** Run every case on one leg; the failures come back with their command, stdout and stderr. */
function runLeg(leg: Leg): string[] {
  const interpreters = resolveInterpreters({
    platform: process.platform,
    env: process.env,
    isFile: defaultIsFile,
  });
  console.log(`windows-e2e-harness: ${leg}: ${interpreters.notes.join("; ")}`);
  const c = makeCtx(leg, interpreters);
  try {
    for (const cases of [
      runnerDryRun,
      tomlMergeCli,
      reportCli,
      publishDryRun,
      dockerless,
      probesWithoutCli,
    ])
      cases(c);
    if (leg === "direct") inProcess(c);
    noCarriageReturn(c);
    return c.failures;
  } finally {
    fs.rmSync(c.root, { recursive: true, force: true });
  }
}

describe("windows e2e harness proof", () => {
  const legs: [Leg, string][] = [
    ["direct", "node runs each entry directly (any host)"],
    ["pwsh", "each entry runs from PowerShell"],
    ["cmd", "each entry runs from cmd.exe"],
  ];
  for (const [leg, title] of legs)
    it(title, { skip: leg !== "direct" && !WIN }, () => {
      const failures = runLeg(leg);
      assert.deepEqual(failures, [], failures.map((f, i) => `${i + 1}. ${f}`).join("\n"));
    });
});

describe("per-entry time bound and timing line (spec 0264 R12, R21)", () => {
  const entry = "scripts/e2e-capture-versions.ts";
  const synthetic = (ms: number): Run => ({
    entry,
    status: 0,
    out: "",
    err: "",
    ms,
    detail: `synthetic run of ${ms} ms`,
  });
  const context = (leg: Leg): Ctx => ({
    leg,
    interpreters: { pwsh: "", cmd: "", notes: [] },
    root: "",
    bin: "",
    home: "",
    failures: [],
    landed: [],
  });
  /** Capture every console.log line of the test; the mock is restored when the test ends. */
  const captureLog = (t: TestContext): (() => string[]) => {
    const log = t.mock.method(console, "log", () => {});
    return () => log.mock.calls.map((call) => String(call.arguments[0]));
  };

  it("an entry at 10 019 ms passes and logs its time", (t) => {
    const lines = captureLog(t);
    const c = context("direct");
    check(c, synthetic(10_019), () => {});
    assert.deepEqual(c.failures, []);
    assert.deepEqual(lines(), [`windows-e2e-harness: direct: ${entry}: 10019 ms`]);
  });

  it("an entry at 30 001 ms fails naming the leg and the bound, and logs its time", (t) => {
    const lines = captureLog(t);
    const c = context("pwsh");
    const r = synthetic(30_001);
    check(c, r, () => {});
    assert.equal(c.failures.length, 1);
    assert.match(c.failures[0], /^\[pwsh\] .*reached or exceeded the 30000 ms bound/);
    assert.ok(c.failures[0].includes(r.detail), "the failure carries the run's diagnostic");
    assert.deepEqual(lines(), [`windows-e2e-harness: pwsh: ${entry}: 30001 ms`]);
  });

  it("an entry at exactly 30 000 ms fails: the bound is strict", (t) => {
    const lines = captureLog(t);
    const c = context("cmd");
    check(c, synthetic(30_000), () => {});
    assert.equal(c.failures.length, 1);
    assert.match(c.failures[0], /^\[cmd\] .*reached or exceeded the 30000 ms bound/);
    assert.deepEqual(lines(), [`windows-e2e-harness: cmd: ${entry}: 30000 ms`]);
  });

  it("one timing line per checked run, pass or fail", (t) => {
    const lines = captureLog(t);
    const c = context("cmd");
    check(c, synthetic(120), () => {});
    check(c, synthetic(250), () => {
      throw new Error("body mismatch");
    });
    assert.deepEqual(lines(), [
      `windows-e2e-harness: cmd: ${entry}: 120 ms`,
      `windows-e2e-harness: cmd: ${entry}: 250 ms`,
    ]);
    assert.equal(c.failures.length, 1);
    assert.match(c.failures[0], /body mismatch/);
  });
});
