// windows-service-fixture-wait.test.ts — portable proof (issue 2007) of the restart wait of
// service-windows.test.ts: a daemon restarted by the keep-alive trigger BEFORE the test's `start`
// must be found. The former pattern (clear state.json, call start, wait for a state file) hangs in
// that case; waitForNewInstance does not. Runs on every OS, no Task Scheduler involved.

import assert from "node:assert/strict";
import { test } from "node:test";
import { waitFor, type DaemonState } from "./lib/windows-service-fixture.ts";
import { waitForNewInstance } from "./lib/wait-for-instance.ts";

const st = (instance: string, port = 1): DaemonState => ({ pid: 1, ppid: 0, port, instance });
const up = () => Promise.resolve(true);

test("former pattern: a restart that landed before the state was cleared is never seen", async () => {
  let state: DaemonState | null = st("B"); // the keep-alive restart already wrote its state
  state = null; // clearState(c)
  await assert.rejects(
    waitFor("daemon restarted by start", () => state, 300, 20),
    /timed out/,
  );
});

test("new wait: finds the instance the keep-alive trigger started before `start`", async () => {
  const got = await waitForNewInstance(() => st("B"), "A", up, 300, 20);
  assert.equal(got.instance, "B");
});

test("new wait: finds an instance that becomes ready after a delay, once healthy", async () => {
  const t0 = Date.now();
  const read = () => (Date.now() - t0 > 150 ? st("B") : st("A"));
  const probe = () => Promise.resolve(Date.now() - t0 > 250);
  const got = await waitForNewInstance(read, "A", probe, 2000, 20);
  assert.equal(got.instance, "B");
  assert.ok(Date.now() - t0 >= 250, "waited for the healthz probe");
});

test("new wait: bounded, and names what it saw", async () => {
  await assert.rejects(
    waitForNewInstance(() => st("A"), "A", up, 150, 20),
    /no new instance/,
  );
  await assert.rejects(
    waitForNewInstance(
      () => st("B"),
      "A",
      () => Promise.resolve(false),
      150,
      20,
    ),
    /not healthy/,
  );
});
