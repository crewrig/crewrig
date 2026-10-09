// service-windows.test.ts — the Windows proof of spec 0252 requirement 24 (plan
// v3 D5 *Windows proof job*): both task chains installed through the real
// schtasks backend and the real XML renderer under throwaway leaves
// `\CrewRig\mempalace-test-mcp-<run id>` and `\CrewRig\mempalace-test-chroma-<run id>`,
// against the real Task Scheduler. Skipped off win32. The program of each task is
// the REAL installed launcher (MCP) or the REAL trust wrapper with the flag
// (ChromaDB), put in place by program-install.ts; only the daemon is a stand-in
// (tests/lib/windows-service-fixture.ts) that serves /healthz and records its
// pid and ppid. Measurements are printed as one greppable `MEASURE:` line each.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { runManager } from "../lib/service/exec.ts";
import { createBackend } from "../lib/service/schtasks.ts";
import { readTaskSnapshot } from "../lib/service/task-snapshot.ts";
import type { DaemonKind } from "../lib/service/names.ts";
import { chromaChain, mcpChain, renderTaskFile } from "../lib/service/windows-task-xml.ts";
import {
  alive,
  clearState,
  commandLineOf,
  disposeChain,
  healthz,
  makeChain,
  measure,
  readState,
  runId,
  waitFor,
  type StandInChain,
} from "./lib/windows-service-fixture.ts";

const skip = process.platform !== "win32";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-service-win-"));
const id = runId();
after(() => fs.rmSync(root, { recursive: true, force: true }));

const backendFor = (c: StandInChain): ReturnType<typeof createBackend> =>
  createBackend({ programPathOf: () => c.program });
const absent = (c: StandInChain): boolean =>
  runManager("schtasks", ["/Query", "/TN", c.task]).kind === "nonzero";
const SAME = (a: string, b: string): boolean => a.toLowerCase().includes(b.toLowerCase());
const snap = (c: StandInChain) => {
  const s = readTaskSnapshot(c.task);
  assert.ok(s.ok && s.task !== null, `snapshot of ${c.task}`);
  return s.task;
};

async function lifecycle(kind: DaemonKind): Promise<void> {
  const c = await makeChain(kind, root, id);
  const backend = backendFor(c);
  try {
    assert.equal(absent(c), true, "no task before install");
    measure(
      `query-absent kind=${kind} status=${runManager("schtasks", ["/Query", "/TN", c.task]).status}`,
    );
    const installed = backend.install(c.names, { definitionPath: c.definitionPath });
    measure(`run-from-runner-session kind=${kind} installOk=${installed.ok}`);
    assert.equal(installed.ok, true, JSON.stringify(installed));
    const t0 = Date.now();
    const first = await waitFor("daemon state", () => readState(c), 90_000);
    measure(`daemon-state kind=${kind} afterMs=${Date.now() - t0} port=${first.port}`);
    let healthy = await healthz(first.port);
    for (let i = 0; i < 60 && !healthy; i++) {
      await new Promise((r) => setTimeout(r, 500));
      healthy = await healthz(first.port);
    }
    measure(`healthz kind=${kind} ok=${healthy} afterMs=${Date.now() - t0}`);
    assert.equal(healthy, true, "the daemon answers /healthz");
    const t1 = Date.now();
    const probeSnap = readTaskSnapshot(c.task);
    measure(
      `snapshot kind=${kind} ok=${probeSnap.ok} reason=${probeSnap.ok ? "-" : probeSnap.reason} state=${probeSnap.ok ? probeSnap.task?.state : "-"} lastResult=${probeSnap.ok ? probeSnap.task?.lastResult : "-"} ms=${Date.now() - t1}`,
    );
    const t2 = Date.now();
    const status = backend.status(c.names);
    measure(`status kind=${kind} ${JSON.stringify(status)} ms=${Date.now() - t2}`);
    assert.equal(status.registered, true);
    assert.equal(status.running, true, JSON.stringify(status));

    const running = snap(c);
    assert.equal(running.state, 4, "State 4 (running)");
    assert.equal(running.lastResult, 0x41301, "LastTaskResult 0x41301 while running");
    // The first-argument program is the process the daemon's ppid names: it runs the installed program.
    const launcher = first.ppid;
    const cmd = commandLineOf(launcher);
    measure(
      `engine-pid kind=${kind} enginePid=${running.enginePid} launcherPid=${launcher} daemonPid=${first.pid} equal=${running.enginePid === launcher} cmd=${JSON.stringify(cmd)}`,
    );
    assert.ok(SAME(cmd, c.program), `the ppid ${launcher} runs ${c.program}: ${cmd}`);
    assert.deepEqual(backend.supervisorPid(c.names), { state: "pid", pid: launcher });

    const stopped = backend.stop(c.names);
    assert.equal(stopped.ok, true, JSON.stringify(stopped));
    measure(
      `end-kills-tree kind=${kind} detail=${JSON.stringify(stopped.ok ? stopped.detail : "")}`,
    );
    await waitFor("daemon tree gone", () => !alive(first.pid) && !alive(first.ppid), 15_000);
    assert.equal(
      await healthz(first.port),
      false,
      "no process of the daemon tree remains after stop",
    );
    const ended = snap(c);
    assert.notEqual(ended.state, 4, "the state changed with stop");
    assert.equal(ended.lastResult, 0x41306, "LastTaskResult 0x41306 after stop");
    assert.equal(backend.status(c.names).running, false);

    clearState(c);
    assert.equal(backend.start(c.names).ok, true);
    const second = await waitFor("daemon restarted by start", () => readState(c), 60_000);
    assert.notEqual(second.pid, first.pid);
    assert.equal(snap(c).state, 4);
  } finally {
    const gone = backend.uninstall(c.names);
    assert.equal(gone.ok, true, JSON.stringify(gone));
    await disposeChain(c);
  }
  assert.equal(absent(c), true, "uninstall removes the task");
  assert.deepEqual(backend.uninstall(c.names), { ok: true, detail: "was not loaded" });
  const last = readState(c);
  if (last !== null) await waitFor("no daemon after uninstall", () => !alive(last.pid), 15_000);
}

test(
  "MCP chain: install, status, stop, start, uninstall, second uninstall",
  { skip, timeout: 300_000 },
  () => lifecycle("mcp"),
);
test(
  "ChromaDB chain: install, status, stop, start, uninstall, second uninstall",
  { skip, timeout: 300_000 },
  () => lifecycle("chroma"),
);

test(
  "ownership on the real Task Scheduler: re-run is own, foreign and cross-leaf are refused",
  { skip, timeout: 300_000 },
  async () => {
    const c = await makeChain("mcp", root, id, "own");
    const other = await makeChain("chroma", root, id, "own-chroma");
    const backend = backendFor(c);
    try {
      assert.equal(backend.install(c.names, { definitionPath: c.definitionPath }).ok, true);
      assert.equal(
        backend.install(c.names, { definitionPath: c.definitionPath }).ok,
        true,
        "re-run of our own task",
      );
      assert.equal(backend.uninstall(c.names).ok, true);

      // Foreign: same leaf, another Description, created behind the installer's back.
      const foreign = path.join(c.dir, "foreign.xml");
      const bytes = renderTaskFile(c.input);
      const text = bytes
        .subarray(2)
        .toString("utf16le")
        .replace(/<Description>[^<]*</, "<Description>Somebody else<");
      fs.writeFileSync(
        foreign,
        Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]),
      );
      assert.equal(runManager("schtasks", ["/Create", "/TN", c.task, "/XML", foreign]).kind, "ok");
      const refused = backend.install(c.names, { definitionPath: c.definitionPath });
      assert.equal(refused.ok, false);
      assert.equal(absent(c), false, "the foreign task is intact");
      const left = backend.uninstall(c.names);
      assert.equal(left.ok, false, "uninstall leaves a foreign task");
      assert.equal(absent(c), false);
      runManager("schtasks", ["/Delete", "/TN", c.task, "/F"]);

      // Cross-leaf: our marker and URI, but the other chain's program as first argument.
      const swapped = path.join(c.dir, "swapped.xml");
      fs.writeFileSync(
        swapped,
        renderTaskFile({
          ...c.input,
          chain: chromaChain({
            nodePath: process.execPath,
            wrapper: other.program,
            python: process.execPath,
            chroma: other.program,
            palacePath: c.dir,
          }),
        }),
      );
      assert.equal(runManager("schtasks", ["/Create", "/TN", c.task, "/XML", swapped]).kind, "ok");
      assert.equal(
        backend.install(c.names, { definitionPath: c.definitionPath }).ok,
        false,
        "cross-leaf program path is foreign",
      );
      assert.equal(mcpChain(process.execPath, c.program).programPath, c.program);
    } finally {
      runManager("schtasks", ["/Delete", "/TN", c.task, "/F"]);
      runManager("schtasks", ["/Delete", "/TN", other.task, "/F"]);
      await disposeChain(c);
      await disposeChain(other);
    }
  },
);
