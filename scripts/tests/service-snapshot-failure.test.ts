// service-snapshot-failure.test.ts — a failed task snapshot makes the answer
// UNDETERMINED and the owner verdict UNVERIFIABLE, never USURPED, and leaves
// install, rollback, ownership, uninstall and the mutations alone (spec 0252
// requirement 16 as modified by delta-01; plan v3 D5 *State source* (3)).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { ownerVerdict } from "../lib/service/owner-check.ts";
import { setInspectRunnerForTests, type InspectRunner } from "../lib/service/os-inspect.ts";
import { createBackend } from "../lib/service/schtasks.ts";
import { readTaskSnapshot } from "../lib/service/task-snapshot.ts";
import {
  mcpChain,
  renderTaskFile,
  renderTaskXml,
  type RenderInput,
} from "../lib/service/windows-task-xml.ts";
import { installFakeSchtasks, type FakeSchtasks } from "./lib/fake-schtasks.ts";

const skip = process.platform === "win32";
const TASK = "\\CrewRig\\mempalace-test-mcp";
const names = { kind: "mcp", label: "x", unit: "mempalace-test-mcp" } as const;
const input: RenderInput = { chain: mcpChain("n", "C:\\h\\l.ts"), taskUri: TASK, userId: "H\\d" };

const FAILURES: Record<string, InspectRunner> = {
  absent: () => ({ ok: false, reason: "absent" }),
  refused: () => ({ ok: false, reason: "refused" }),
  timeout: () => ({ ok: false, reason: "timeout" }),
  garbage: () => ({ ok: true, stdout: "this is not json {" }),
  "wrong shape": () => ({ ok: true, stdout: '{"task":{"present":"yes"},"processes":[]}' }),
};

let fake: FakeSchtasks;
let dir: string;
beforeEach(() => {
  fake = installFakeSchtasks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "snap-failure-"));
});
afterEach(() => {
  fake.cleanup();
  setInspectRunnerForTests(undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

for (const [label, runner] of Object.entries(FAILURES)) {
  test(`snapshot ${label}: the snapshot fails, never succeeds with invented numbers`, () => {
    setInspectRunnerForTests(runner);
    assert.equal(readTaskSnapshot(TASK).ok, false);
  });

  test(
    `snapshot ${label}: UNDETERMINED state, presence from /Query, owner UNVERIFIABLE`,
    { skip },
    () => {
      setInspectRunnerForTests(runner);
      fake.seed(TASK, renderTaskXml(input));
      const backend = createBackend();
      const status = backend.status(names);
      assert.equal(status.registered, true, "presence comes from the /Query exit status");
      assert.match(status.detail ?? "", /state UNDETERMINED, last result UNDETERMINED/);
      const sup = backend.supervisorPid(names);
      assert.deepEqual(sup, {
        state: "unverifiable",
        reason: sup.state === "unverifiable" ? sup.reason : "",
      });
      const expectedPid: number | null = null;
      const verdict = ownerVerdict({
        listenerPid: 4242,
        expectedPid,
        parents: null,
        host: "127.0.0.1",
        port: 41893,
      });
      assert.equal(verdict.kind, "UNVERIFIABLE");
      assert.notEqual(verdict.kind, "USURPED");
    },
  );

  test(
    `snapshot ${label}: install, ownership, uninstall and the mutations are unaffected`,
    { skip },
    () => {
      setInspectRunnerForTests(runner);
      const reports: string[] = [];
      const backend = createBackend({ report: (l) => reports.push(l) });
      const definitionPath = path.join(dir, "task.xml");
      fs.writeFileSync(definitionPath, renderTaskFile(input));
      assert.equal(backend.install(names, { definitionPath }).ok, true);
      assert.equal(
        backend.install(names, { definitionPath }).ok,
        true,
        "re-run: own, deleted then created",
      );
      assert.equal(backend.start(names).ok, true);
      assert.equal(backend.stop(names).ok, true, "/End still runs");
      assert.match(reports.join("\n"), /UNDETERMINED/);
      assert.equal(backend.uninstall(names).ok, true);
      assert.equal(fake.has(TASK), false);
      assert.deepEqual(backend.uninstall(names), { ok: true, detail: "was not loaded" });
    },
  );
}
