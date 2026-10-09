// chroma-windows-reinstall.test.ts — what happens to a RUNNING instance of an own
// task when the task is replaced or deleted (spec 0252, review finding i1-F17). The
// ChromaDB chain is installed through the real installer under a throwaway task
// name, as chroma-windows-task.test.ts does; the daemon is the Node stand-in. Two
// MEASURE lines record the outcome and nothing asserts on them: whether the old
// daemon survives a re-install over it (delete, then create) and how long the new
// one takes to come up, and whether it survives `/Delete` alone. The one assertion
// is that the final uninstall leaves no task. Skipped off win32.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { createBackend } from "../lib/service/schtasks.ts";
import {
  alive,
  clearState,
  disposeChain,
  makeChain,
  measure,
  readState,
  runId,
  waitFor,
  type StandInChain,
} from "./lib/windows-service-fixture.ts";

const skip = process.platform !== "win32" && "Windows Task Scheduler only";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-chroma-reinstall-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const taskQuery = (c: StandInChain) =>
  spawnSync("schtasks.exe", ["/Query", "/TN", c.task], { windowsHide: true, timeout: 30_000 });

function kill(pid: number): void {
  try {
    process.kill(pid);
  } catch {
    /* already gone */
  }
}

test("a re-install over the running own task: does the old daemon survive?", { skip }, async () => {
  const c = await makeChain("chroma", root, `${runId()}-re`, "chroma-reinstall");
  const backend = createBackend({ programPathOf: () => c.program });
  const pids: number[] = [];
  try {
    const first = backend.install(c.names, { definitionPath: c.definitionPath });
    assert.equal(first.ok, true, JSON.stringify(first));
    const old = await waitFor("first daemon", () => readState(c), 90_000);
    pids.push(old.pid);
    clearState(c);

    const t0 = Date.now();
    const again = backend.install(c.names, { definitionPath: c.definitionPath });
    assert.equal(again.ok, true, JSON.stringify(again));
    // The old daemon holds the port while it lives; a new one only writes its state
    // once it listens, so a missing state within the wait means the old one survived.
    const fresh = await waitFor(
      "new daemon after the re-install",
      () => readState(c),
      30_000,
    ).catch(() => null);
    if (fresh !== null) pids.push(fresh.pid);
    measure(
      `reinstall-over-running oldPidAlive=${alive(old.pid)} newDaemonAfterMs=${fresh === null ? -1 : Date.now() - t0}`,
    );
    // Measured on windows-latest before the fix (`/Delete` alone leaves the old instance
    // running): a re-install now ends the old daemon and a new one takes its place.
    assert.equal(alive(old.pid), false, "the old daemon is ended by the re-install");
    assert.notEqual(fresh, null, "a new daemon serves after the re-install");
  } finally {
    backend.uninstall(c.names);
    for (const pid of pids) kill(pid);
    assert.notEqual(taskQuery(c).status, 0, "the final uninstall leaves no task");
    await disposeChain(c);
  }
});

test("`/Delete` alone on a running own task: does the daemon survive?", { skip }, async () => {
  const c = await makeChain("chroma", root, `${runId()}-del`, "chroma-delete");
  const backend = createBackend({ programPathOf: () => c.program });
  let pid = 0;
  try {
    const installed = backend.install(c.names, { definitionPath: c.definitionPath });
    assert.equal(installed.ok, true, JSON.stringify(installed));
    pid = (await waitFor("daemon", () => readState(c), 90_000)).pid;

    spawnSync("schtasks.exe", ["/Delete", "/TN", c.task, "/F"], {
      windowsHide: true,
      timeout: 30_000,
    });
    await wait(3000);
    measure(`delete-running oldPidAlive=${alive(pid)}`);
  } finally {
    backend.uninstall(c.names);
    if (pid > 0) kill(pid);
    assert.notEqual(taskQuery(c).status, 0, "the final uninstall leaves no task");
    await disposeChain(c);
  }
});
