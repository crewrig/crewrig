// service-schtasks-uninstall.test.ts — the uninstall order of the Windows backend
// (spec 0252 requirement 5 and delta-02): disable, end and sweep, then delete; a failed
// disable is reported. Driven through the fake schtasks behind the exec.ts seam, so it
// runs on macOS and Linux. Split from service-schtasks.test.ts (300-line threshold).

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { setExecutableOverride } from "../lib/service/exec.ts";
import type { ServiceNames } from "../lib/service/names.ts";
import { setInspectRunnerForTests } from "../lib/service/os-inspect.ts";
import { createBackend } from "../lib/service/schtasks.ts";
import { mcpChain, renderTaskXml, type RenderInput } from "../lib/service/windows-task-xml.ts";
import { installFakeSchtasks, type FakeSchtasks } from "./lib/fake-schtasks.ts";

const skip = process.platform === "win32";
const names: ServiceNames = { kind: "mcp", label: "x", unit: "mempalace-test-mcp" };
const TASK = "\\CrewRig\\mempalace-test-mcp";
const input = (): RenderInput => ({
  chain: mcpChain("C:\\node\\node.exe", "C:\\h\\launcher.ts"),
  taskUri: TASK,
  userId: "H\\dev",
});

let fake: FakeSchtasks;
beforeEach(() => {
  fake = installFakeSchtasks();
  setInspectRunnerForTests(() => ({ ok: false, reason: "refused" }));
});
afterEach(() => {
  fake.cleanup();
  setInspectRunnerForTests(undefined);
  setExecutableOverride("schtasks", null);
});

test("uninstall: absent is success, own is ended then deleted, foreign is left", { skip }, () => {
  const lines: string[] = [];
  const backend = createBackend({ report: (l) => lines.push(l) });
  const absent = backend.uninstall(names);
  assert.deepEqual(absent, { ok: true, detail: "was not loaded" });
  fake.seed(TASK, renderTaskXml(input()));
  fake.calls().length = 0;
  assert.equal(backend.uninstall(names).ok, true);
  assert.deepEqual(fake.calls().slice(-3), [
    ["/Change", "/TN", TASK, "/DISABLE"],
    ["/End", "/TN", TASK],
    ["/Delete", "/TN", TASK, "/F"],
  ]);
  assert.match(lines.join("\n"), /UNDETERMINED/);
  assert.deepEqual(backend.uninstall(names), { ok: true, detail: "was not loaded" });
  fake.seed(TASK, renderTaskXml(input()).replace(/<Description>[^<]*</, "<Description>Not ours<"));
  const foreign = backend.uninstall(names);
  assert.equal(foreign.ok, false);
  assert.equal(fake.has(TASK), true);
});

test("uninstall: a failed disable is reported, then it still ends and deletes", { skip }, () => {
  const lines: string[] = [];
  fake.seed(TASK, renderTaskXml(input()));
  fake.setMode({ changeFail: true });
  const r = createBackend({ report: (l) => lines.push(l) }).uninstall(names);
  fake.setMode({});
  assert.ok(r.ok && /may still run/.test(r.detail ?? ""));
  assert.match(lines.join("\n"), /could not disable the task/);
  assert.deepEqual(
    fake
      .calls()
      .slice(-2)
      .map((c) => c[0]),
    ["/End", "/Delete"],
  );
});
