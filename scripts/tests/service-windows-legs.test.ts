// service-windows-legs.test.ts — the restart proof and the refusal legs of spec
// 0252 requirement 24 (plan v3 D5 *Restart proof*, *GPO-refusal leg*), on the
// real Task Scheduler. Skipped off win32. Split from service-windows.test.ts
// for the 300-line cap; shares its fixtures (tests/lib/windows-service-fixture.ts):
// the REAL launcher / flagged trust wrapper, a stand-in daemon.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { runManager, setExecutableOverride } from "../lib/service/exec.ts";
import type { DaemonKind } from "../lib/service/names.ts";
import {
  DOCTOR_POINTER,
  GROUP_POLICY_SENTENCE,
  STDIO_ADVICE,
  createBackend,
} from "../lib/service/schtasks.ts";
import { readTaskSnapshot } from "../lib/service/task-snapshot.ts";
import {
  alive,
  clearState,
  crewrigHomeListing,
  commandLineOf,
  disposeChain,
  makeChain,
  measure,
  readState,
  runId,
  waitFor,
  type StandInChain,
} from "./lib/windows-service-fixture.ts";

const skip = process.platform !== "win32";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-service-legs-"));
const id = runId();
const RESTART_BOUND_MS = 150_000;
after(() => fs.rmSync(root, { recursive: true, force: true }));

const lastResult = (c: StandInChain): number | null => {
  const s = readTaskSnapshot(c.task);
  return s.ok && s.task !== null ? s.task.lastResult : null;
};

/** Cause the daemon to end (killed from outside, or exiting 0) and time the restart. */
async function restartLeg(kind: DaemonKind, how: "kill" | "exit0"): Promise<void> {
  const c = await makeChain(kind, root, id, `${kind}-${how}`);
  const backend = createBackend({ programPathOf: () => c.program });
  try {
    assert.equal(backend.install(c.names, { definitionPath: c.definitionPath }).ok, true);
    const first = await waitFor("daemon", () => readState(c), 90_000);
    // The first-argument program (real launcher or flagged wrapper) is the daemon's parent.
    const launcher = first.ppid;
    assert.ok(commandLineOf(launcher).toLowerCase().includes(c.program.toLowerCase()));
    clearState(c);
    const t0 = Date.now();
    if (how === "kill") process.kill(first.pid);
    else fs.writeFileSync(path.join(c.stateDir, "exit0"), "");
    await waitFor("the first-argument program ended", () => !alive(launcher), 30_000, 250);
    const endedAfter = Date.now() - t0;
    // With the repeating keep-alive trigger the last result may already be 0x800710e0 (a new
    // instance ignored while the daemon runs) by the time the snapshot answers; the non-zero
    // end itself is asserted by the launcher unit tests. Here the result is only measured.
    const last = lastResult(c);
    measure(
      `restart kind=${kind} how=${how} launcherEndedMs=${endedAfter} lastResult=${last === null ? "-" : "0x" + last.toString(16)}`,
    );
    const again = await waitFor("task restarted", () => readState(c), RESTART_BOUND_MS, 1000);
    measure(
      `restart kind=${kind} how=${how} restartedAfterMs=${Date.now() - t0} newPid=${again.pid}`,
    );
    assert.notEqual(again.pid, first.pid);
  } finally {
    assert.equal(backend.uninstall(c.names).ok, true);
    await disposeChain(c);
  }
}

for (const kind of ["mcp", "chroma"] as const) {
  test(
    `${kind} chain: a killed child ends the program non-zero and the task restarts`,
    { skip, timeout: 420_000 },
    () => restartLeg(kind, "kill"),
  );
  test(
    `${kind} chain: a child exiting 0 ends the program non-zero and the task restarts`,
    { skip, timeout: 420_000 },
    () => restartLeg(kind, "exit0"),
  );
}

function assertRefusal(reason: string, extra: string[]): void {
  for (const part of [...extra, GROUP_POLICY_SENTENCE, STDIO_ADVICE, DOCTOR_POINTER])
    assert.ok(reason.includes(part), `${part} in: ${reason}`);
}

test("GPO leg (a): mechanism unavailable through the exec.ts seam", { skip }, async (t) => {
  const c = await makeChain("mcp", root, id, "gpo-a");
  t.after(() => disposeChain(c));
  const before = crewrigHomeListing();
  setExecutableOverride("schtasks", path.join(root, "no-such-schtasks.exe"));
  try {
    const out = createBackend().install(c.names, { definitionPath: c.definitionPath });
    assert.equal(out.ok, false);
    assertRefusal(out.ok ? "" : out.reason, ["schtasks.exe", "is unavailable"]);
  } finally {
    setExecutableOverride("schtasks", null);
  }
  assert.equal(
    runManager("schtasks", ["/Query", "/TN", c.task]).kind,
    "nonzero",
    "/Query shows no task",
  );
  assert.deepEqual(crewrigHomeListing(), before, "nothing left under ~/.crewrig/");
});

test("GPO leg (b): a schtasks that answers 'Access is denied' to /Create", { skip }, async (t) => {
  // A compiled stub: the exec.ts seam runs one executable, no shell, so a script cannot stand in.
  const csc = path.join(
    process.env["SystemRoot"] ?? "C:\\Windows",
    "Microsoft.NET",
    "Framework64",
    "v4.0.30319",
    "csc.exe",
  );
  const src = path.join(root, "stub.cs");
  const exe = path.join(root, "stub-schtasks.exe");
  fs.writeFileSync(
    src,
    'class S { static int Main(string[] a) { if (a.Length > 0 && a[0] == "/Query") return 1; System.Console.Error.Write("ERROR: Access is denied."); return 1; } }',
  );
  if (!fs.existsSync(csc) || spawnSync(csc, ["/nologo", `/out:${exe}`, src]).status !== 0) {
    measure("gpo-stub skipped: csc.exe unavailable, the Access is denied leg is a recorded gap");
    t.skip("csc.exe unavailable");
    return;
  }
  const c = await makeChain("chroma", root, id, "gpo-b");
  t.after(() => disposeChain(c));
  const installedFile = path.join(c.dir, "installed.txt");
  fs.writeFileSync(installedFile, "x");
  const before = crewrigHomeListing();
  setExecutableOverride("schtasks", exe);
  try {
    const out = createBackend({ cleanupFiles: () => [installedFile] }).install(c.names, {
      definitionPath: c.definitionPath,
    });
    assert.equal(out.ok, false);
    assertRefusal(out.ok ? "" : out.reason, ["ERROR: Access is denied.", "/Create"]);
  } finally {
    setExecutableOverride("schtasks", null);
  }
  assert.equal(fs.existsSync(installedFile), false);
  assert.equal(
    runManager("schtasks", ["/Query", "/TN", c.task]).kind,
    "nonzero",
    "/Query shows no task",
  );
  assert.deepEqual(crewrigHomeListing(), before, "nothing left under ~/.crewrig/");
});
