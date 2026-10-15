// service-schedule-schtasks.test.ts — scripts/lib/service/schedule-schtasks.ts (spec 0258
// requirement 15; PLAN v2 step 17), driven through the fake schtasks behind the exec.ts
// seam so it runs on macOS and Linux: no `/Run`, a foreign task is refused untouched, and
// nothing is left on a failure. Throwaway leaves only; no real task is ever registered.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { setExecutableOverride } from "../lib/service/exec.ts";
import { curatorNames } from "../lib/service/schedule-names.ts";
import { renderCalendarTaskXml } from "../lib/service/schedule-render.ts";
import { createScheduleBackend } from "../lib/service/schedule-schtasks.ts";
import type { ScheduleSpec } from "../lib/service/schedule-spec.ts";
import { installFakeSchtasks } from "./lib/fake-schtasks.ts";
import type { FakeSchtasks } from "./lib/fake-schtasks.ts";

const names = curatorNames("crewrig-test-schedule");
const TASK = names.taskPath;
const spec: ScheduleSpec = {
  frequency: "daily",
  hour: 7,
  nodePath: "C:\\node\\node.exe",
  entry: "C:\\repo\\curate.ts",
  args: ["--auto"],
  pathValue: "C:\\Windows",
  logFile: "C:\\logs\\curator.log",
};

let fake: FakeSchtasks;
let savedUser: string | undefined;
beforeEach(() => {
  fake = installFakeSchtasks();
  savedUser = process.env["USERNAME"];
  process.env["USERNAME"] = "dev";
});
afterEach(() => {
  fake.cleanup();
  if (savedUser === undefined) delete process.env["USERNAME"];
  else process.env["USERNAME"] = savedUser;
});

const storePath = (): string => path.join(fake.dir, `t_${Buffer.from(TASK).toString("hex")}`);
const verbs = (): string[] => fake.calls().map((c) => c[0] ?? "");
const opts = process.platform === "win32" ? { skip: "the fake is a POSIX script" } : {};

describe("schtasks schedule backend", opts, () => {
  it("install creates the task from a 0600 UTF-16LE file, confirms it, and never runs it", () => {
    const out = createScheduleBackend().install(names, spec);
    assert.equal(out.ok, true);
    assert.deepEqual(verbs(), ["/Query", "/Create", "/Query"]);
    assert.equal(fake.has(TASK), true);
    assert.deepEqual(fake.creates(), [{ mode: 0o600, bom: true }]);
    assert.equal(verbs().includes("/Run"), false);
  });

  it("a foreign task is refused and left untouched", () => {
    fake.seed(TASK, "<Task><Description>Not ours</Description></Task>");
    const out = createScheduleBackend().install(names, spec);
    assert.ok(!out.ok && /is not CrewRig's/.test(out.reason));
    assert.deepEqual(verbs(), ["/Query"]);
    assert.equal(fake.has(TASK), true);
  });

  it("an own task is disabled, ended and deleted before the new one is created", () => {
    fake.seed(
      TASK,
      renderCalendarTaskXml(names, { ...spec, entry: "C:\\other\\curate.ts" }, "dev"),
    );
    assert.equal(createScheduleBackend().install(names, spec).ok, true);
    assert.deepEqual(verbs(), ["/Query", "/Change", "/End", "/Delete", "/Create", "/Query"]);
    assert.deepEqual(fake.calls()[1], ["/Change", "/TN", TASK, "/DISABLE"]);
    assert.equal(verbs().includes("/Run"), false);
  });

  it("a reinstall with another hour deletes the own task before creating the new one", () => {
    const backend = createScheduleBackend();
    assert.equal(backend.install(names, spec).ok, true);
    const later: ScheduleSpec = { ...spec, frequency: "weekly", hour: 14 };
    const before = fake.calls().length;
    assert.equal(backend.install(names, later).ok, true);
    assert.deepEqual(verbs().slice(before), [
      "/Query",
      "/Change",
      "/End",
      "/Delete",
      "/Create",
      "/Query",
    ]);
    const stored = readFileSync(storePath(), "utf8");
    assert.equal(stored, renderCalendarTaskXml(names, later, "dev"));
    assert.doesNotMatch(stored, /T07:00:00|ScheduleByDay/);
    assert.equal(verbs().includes("/Run"), false);
  });

  it("a refused create on a reinstall leaves no task", () => {
    const backend = createScheduleBackend();
    backend.install(names, spec);
    fake.setMode({ createFail: "ERREUR : Acces refuse.\n" });
    assert.equal(backend.install(names, { ...spec, hour: 14 }).ok, false);
    assert.equal(fake.has(TASK), false);
  });

  it("a refused create leaves no task and no file", () => {
    fake.setMode({ createFail: "ERREUR : Acces refuse.\n" });
    const out = createScheduleBackend().install(names, spec);
    assert.ok(!out.ok && /Group Policy/.test(out.reason) && /Acces refuse/.test(out.reason));
    assert.equal(fake.has(TASK), false);
    assert.equal(verbs().at(-1), "/Delete");
  });

  it("an absent schtasks is the unavailable refusal", () => {
    setExecutableOverride("schtasks", "/nonexistent/schtasks");
    const backend = createScheduleBackend();
    const out = backend.install(names, spec);
    assert.ok(
      !out.ok &&
        /^Windows Task Scheduler \(schtasks\.exe\) is unavailable: .*Group Policy/.test(out.reason),
    );
    const probe = backend.probe();
    assert.ok(!probe.ok && probe.capability === "schtasks.exe");
  });

  it("probe is ok when schtasks answers", () => {
    assert.deepEqual(createScheduleBackend().probe(), { ok: true });
  });

  it("uninstall: absent, own and foreign", () => {
    const backend = createScheduleBackend();
    assert.deepEqual(backend.uninstall(names), { ok: true, absent: true });
    fake.seed(TASK, "<Task><Description>Not ours</Description></Task>");
    assert.equal(backend.uninstall(names).ok, false);
    assert.equal(fake.has(TASK), true);
    fake.seed(TASK, renderCalendarTaskXml(names, spec, "dev"));
    assert.deepEqual(backend.uninstall(names), { ok: true, removedPath: TASK });
    assert.equal(fake.has(TASK), false);
    assert.equal(verbs().includes("/Run"), false);
  });

  it("render returns the XML text under the task path", () => {
    const [file] = createScheduleBackend().render(names, spec);
    assert.equal(file?.label, TASK);
    assert.match(file?.text ?? "", /crewrig:service-task/);
    assert.deepEqual(fake.calls(), []);
  });
});
