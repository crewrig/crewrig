// Replaces artifacts/library/skills/harness-curator/scripts/test.sh groups G8 (schedule-curator
// --uninstall) and G12 (setup-labels --dry-run), spec 0265 row J2. Also byte-pinned by the
// differential golden (schedule-curator-uninstall-clean, setup-labels-dry-run*); these field-level
// assertions survive a regenerated golden. Each run is `observe`d: a fresh sandbox HOME, PATH holding
// only stub tools (crontab, systemctl, launchctl, schtasks, gh), so the real scheduler is unreachable.
// POSIX only.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { observe, scriptFile } from "./lib/harness-curator-observe.ts";
import type { HcCase } from "./lib/harness-curator-observe.ts";
import {
  assertNoRealState,
  python3,
  SKIP_WIN32,
  snapshotRealState,
} from "./lib/harness-curator-py.ts";
import { crontabStub, ghStub, managerStub, stub, unameStub } from "./lib/harness-curator-stubs.ts";

const skip = SKIP_WIN32 ?? (python3() === undefined ? "python3 not found" : undefined);
const GOLDENS = path.join(import.meta.dirname, "fixtures", "harness-curator");
const realBefore = skip === undefined ? snapshotRealState() : {};
// observe() always runs the child with HOME inside its own os.tmpdir() sandbox; this nominal env lets
// the guard check the call log and the real state without owning the sandbox.
const nominal = { HOME: path.join(fs.realpathSync(os.tmpdir()), "hc-diff-home") };
const allCalls: string[] = [];

after(() => {
  if (skip === undefined) assertNoRealState(nominal, allCalls.join(""), realBefore);
});

const run = (c: Omit<HcCase, "name" | "tools">, name: string) => {
  const out = observe({ ...c, name, tools: ["node"] }, "shell");
  allCalls.push(out.calls);
  return out;
};
const golden = (c: string, f: string): string =>
  fs.readFileSync(path.join(GOLDENS, c, `${f}.golden`), "latin1");

describe("G8 schedule-curator.sh", { skip }, () => {
  const stubs = [
    unameStub(),
    crontabStub(),
    ghStub(),
    managerStub("systemctl"),
    managerStub("launchctl"),
    stub("schtasks", "exit 0\n"),
  ];

  test("G8 exists: schedule-curator.sh exists and is executable", () => {
    const file = scriptFile("schedule-curator", "sh");
    assert.ok(fs.existsSync(file), `missing: ${file}`);
    if (process.platform !== "win32")
      assert.ok((fs.statSync(file).mode & 0o111) !== 0, "no exec bit");
  });

  test("G8 uninstall: exit 0 and 'nothing to remove' or 'removed' on a clean machine", () => {
    const out = run({ script: "schedule-curator", args: ["--uninstall"], stubs }, "g8-uninstall");
    assert.equal(out.status, "0", out.stderr);
    assert.match(out.stdout + out.stderr, /nothing to remove|removed/i);
  });

  test("G8 uninstall: the clean-machine message says 'nothing to remove' on Linux and Darwin", () => {
    // The Linux cron note ('is not removed by this command') alone satisfies /removed/, so the
    // exact phrase is asserted per platform.
    for (const os of ["Linux", "Darwin"]) {
      const darwinStubs = [unameStub(os), ...stubs.slice(1)];
      const out = run(
        { script: "schedule-curator", args: ["--uninstall"], stubs: darwinStubs },
        `g8-uninstall-${os}`,
      );
      assert.equal(out.status, "0", out.stderr);
      assert.match(out.stdout + out.stderr, /nothing to remove/, os);
    }
  });

  test("G8 uninstall: any path in the message is inside the sandbox, only read-only calls", () => {
    const out = run({ script: "schedule-curator", args: ["--uninstall"], stubs }, "g8-paths");
    const text = out.stdout + out.stderr;
    for (const p of text.match(/(?:^|\s)\/[\w.\-/<>]+/g) ?? [])
      assert.match(p.trim(), /^<(?:HOME|SANDBOX|TMP)>/, `path outside the sandbox: ${p}`);
    for (const line of out.calls.split("\n").filter((l) => l !== ""))
      assert.match(line, /^crontab <-l>$/, `unexpected scheduler call: ${line}`);
  });
});

describe("G12 setup-labels.sh --dry-run", { skip }, () => {
  const stubs = [ghStub()];
  let plan: ReturnType<typeof run>;
  const lines = (): string[] =>
    plan.stdout.split("\n").filter((l) => l.startsWith("would create: "));
  const first = (): ReturnType<typeof run> =>
    (plan ??= run(
      { script: "setup-labels", args: ["--repo", "crewrig/crewrig", "--dry-run"], stubs },
      "g12-plan",
    ));

  test("G12 plan: exit code 0 and gh never asked to create a label", () => {
    assert.equal(first().status, "0");
    assert.doesNotMatch(plan.calls, /label create/);
  });

  test("G12 plan: exactly 9 'would create:' lines", () => {
    first();
    assert.equal(lines().length, 9);
  });

  for (const [family, prefix] of [
    ["feedback", "would create: harness-feedback "],
    ["room", "would create: room:"],
    ["severity", "would create: severity:"],
  ] as const)
    test(`G12 family ${family}: at least one ${prefix.trim()} line`, () => {
      first();
      assert.ok(lines().filter((l) => l.startsWith(prefix)).length >= 1);
    });

  test("G12 line_shape: every plan line ends (color=<6hex>, description=...)", () => {
    first();
    const bad = lines().filter((l) => !/ \(color=[0-9A-Fa-f]{6}, description=.+\)$/.test(l));
    assert.deepEqual(bad, []);
  });

  for (const [label, args, goldenCase] of [
    ["usage bogus_flag", ["--bogus"], "setup-labels-bogus-argument"],
    ["usage repo_no_value", ["--repo"], "setup-labels-repo-without-value"],
  ] as const)
    test(`G12 ${label}: non-zero exit equal to the entry's usage code`, () => {
      const out = run({ script: "setup-labels", args, stubs }, `g12-${goldenCase}`);
      assert.notEqual(out.status, "0");
      assert.equal(out.status, golden(goldenCase, "status").trim());
    });
});
