// service-task-snapshot.test.ts — the Task Scheduler snapshot parse (PLAN v3 D5
// *State source* (2) and (3)): success, absent task HRESULT, garbage JSON, and a
// refused or timed-out call, all through the os-inspect runner seam.
//
// Run: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/service-task-snapshot.test.ts

import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { setInspectRunnerForTests } from "../lib/service/os-inspect.ts";
import { parseSnapshot, readTaskSnapshot } from "../lib/service/task-snapshot.ts";

afterEach(() => setInspectRunnerForTests(undefined));

const TASK = "\\CrewRig\\mempalace-mcp-server";
const stdout = (o: unknown) => ({ ok: true as const, stdout: JSON.stringify(o) });

describe("task-snapshot: parse", () => {
  test("a running task: presence, state 4, 0x41301, EnginePID and the process table", () => {
    const seen: string[] = [];
    setInspectRunnerForTests((spec) => {
      seen.push(spec.env.CREWRIG_TASK_PATH ?? "");
      return stdout({
        task: { present: true, hresult: 0, state: 4, lastResult: 0x41301, enginePid: 4321 },
        processes: [
          { pid: 4321, ppid: 4 },
          { pid: 4400, ppid: 4321, start: 1760000000000 },
        ],
      });
    });
    const snap = readTaskSnapshot(TASK);
    assert.deepEqual(seen, [TASK]);
    assert.ok(snap.ok);
    assert.deepEqual(snap.task, {
      present: true,
      hresult: 0,
      state: 4,
      lastResult: 0x41301,
      enginePid: 4321,
    });
    assert.deepEqual(snap.processes[1], { pid: 4400, ppid: 4321, start: 1760000000000 });
  });

  test("a stopped task has a null EnginePID; a negative failure HRESULT becomes unsigned", () => {
    setInspectRunnerForTests(() =>
      stdout({
        task: { present: true, hresult: 0, state: 3, lastResult: -2147020576, enginePid: null },
        processes: [],
      }),
    );
    const snap = readTaskSnapshot(TASK);
    assert.ok(snap.ok && snap.task !== null);
    assert.equal(snap.task.enginePid, null);
    assert.equal(snap.task.lastResult, 0x800710e0);
  });

  test("an absent task carries the failure HRESULT of GetTask (0x80070002)", () => {
    setInspectRunnerForTests(() =>
      stdout({
        task: { present: false, hresult: -2147024894, state: 0, lastResult: 0, enginePid: null },
        processes: [{ pid: 4, ppid: 0 }],
      }),
    );
    const snap = readTaskSnapshot(TASK);
    assert.ok(snap.ok && snap.task !== null);
    assert.equal(snap.task.present, false);
    assert.equal(snap.task.hresult, 0x80070002);
  });
});

describe("task-snapshot: failure", () => {
  test("garbage JSON, wrong shapes and a missing task are all `garbage`", () => {
    for (const text of [
      "",
      "not json",
      "[]",
      "null",
      '{"processes":[]}',
      '{"task":{"present":"yes"},"processes":[]}',
      '{"task":{"present":true,"hresult":0,"state":"4","lastResult":0,"enginePid":null},"processes":[]}',
      '{"task":{"present":true,"hresult":0,"state":4,"lastResult":0,"enginePid":"7"},"processes":[]}',
      '{"task":null,"processes":[{"pid":1}]}',
      '{"task":null,"processes":{}}',
    ]) {
      setInspectRunnerForTests(() => ({ ok: true, stdout: text }));
      assert.deepEqual(readTaskSnapshot(TASK), { ok: false, reason: "garbage" }, text);
    }
  });

  test("a snapshot without a task section is garbage for readTaskSnapshot, fine for parseSnapshot", () => {
    const text = JSON.stringify({ task: null, processes: [{ pid: 1, ppid: 0 }] });
    assert.deepEqual(parseSnapshot(text), {
      ok: true,
      task: null,
      processes: [{ pid: 1, ppid: 0 }],
    });
    setInspectRunnerForTests(() => ({ ok: true, stdout: text }));
    assert.deepEqual(readTaskSnapshot(TASK), { ok: false, reason: "garbage" });
  });

  test("refused, absent and timeout pass through unchanged", () => {
    for (const reason of ["refused", "absent", "timeout"] as const) {
      setInspectRunnerForTests(() => ({ ok: false, reason }));
      assert.deepEqual(readTaskSnapshot(TASK), { ok: false, reason });
    }
  });
});
