// service-schtasks.test.ts — scripts/lib/service/schtasks.ts driven through a
// fake schtasks behind the exec.ts executable seam (spec 0252 requirements 8
// and 33; plan v3 D5). The fake is a Node script with a shebang, so these run
// on macOS and Linux; the real Task Scheduler is the job of service-windows.test.ts.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { setInspectRunnerForTests } from "../lib/service/os-inspect.ts";
import type { ServiceNames } from "../lib/service/names.ts";
import {
  createBackend,
  DOCTOR_POINTER,
  GROUP_POLICY_SENTENCE,
  STDIO_ADVICE,
} from "../lib/service/schtasks.ts";
import { setExecutableOverride } from "../lib/service/exec.ts";
import {
  chromaChain,
  mcpChain,
  renderTaskFile,
  renderTaskXml,
  type RenderInput,
} from "../lib/service/windows-task-xml.ts";
import { installFakeSchtasks, type FakeSchtasks } from "./lib/fake-schtasks.ts";

const skip = process.platform === "win32";
const NODE = "C:\\node\\node.exe";
const names: ServiceNames = { kind: "mcp", label: "x", unit: "mempalace-test-mcp" };
const chromaNames: ServiceNames = { kind: "chroma", label: "y", unit: "mempalace-test-chroma" };
const TASK = "\\CrewRig\\mempalace-test-mcp";
const input = (uri = TASK, program = "C:\\h\\launcher.ts"): RenderInput => ({
  chain: mcpChain(NODE, program),
  taskUri: uri,
  userId: "H\\dev",
});

let fake: FakeSchtasks;
let work: string;
beforeEach(() => {
  fake = installFakeSchtasks();
  work = fs.mkdtempSync(path.join(os.tmpdir(), "schtasks-test-"));
  setInspectRunnerForTests(() => ({ ok: false, reason: "refused" }));
});
afterEach(() => {
  fake.cleanup();
  setInspectRunnerForTests(undefined);
  fs.rmSync(work, { recursive: true, force: true });
});

function definition(i: RenderInput): { definitionPath: string } {
  const definitionPath = path.join(work, "task.xml");
  fs.writeFileSync(definitionPath, renderTaskFile(i));
  return { definitionPath };
}
const verbs = (): string[] => fake.calls().map((c) => `${c[0]} ${c[2]}`);

test(
  "install of a new task: exact argument lists, a 0600 UTF-16 file, verified then run",
  { skip },
  () => {
    const out = createBackend().install(names, definition(input()));
    assert.equal(out.ok, true);
    const calls = fake.calls();
    assert.deepEqual(calls[0], ["/Query", "/TN", TASK, "/XML"]);
    assert.deepEqual(calls[1]?.slice(0, 4), ["/Create", "/TN", TASK, "/XML"]);
    assert.equal(calls[1]?.length, 5);
    assert.deepEqual(calls[2], ["/Query", "/TN", TASK]);
    assert.deepEqual(calls[3], ["/Run", "/TN", TASK]);
    assert.equal(calls.length, 4);
    assert.deepEqual(fake.creates(), [{ mode: 0o600, bom: true }]);
    assert.equal(fs.existsSync(calls[1]?.[4] ?? ""), false, "the temp file is removed");
  },
);

test("re-run on our own task: delete then create", { skip }, () => {
  fake.seed(TASK, renderTaskXml(input()));
  assert.equal(createBackend().install(names, definition(input())).ok, true);
  assert.deepEqual(verbs().slice(0, 3), [
    "/Query \\CrewRig\\mempalace-test-mcp",
    "/Delete \\CrewRig\\mempalace-test-mcp",
    "/Create \\CrewRig\\mempalace-test-mcp",
  ]);
  assert.deepEqual(fake.calls()[1], ["/Delete", "/TN", TASK, "/F"]);
});

test("a foreign task fails closed naming it; nothing is deleted or created", { skip }, () => {
  const files = [path.join(work, "installed.txt")];
  fs.writeFileSync(files[0] ?? "", "x");
  fake.seed(TASK, renderTaskXml(input()).replace(/<Description>[^<]*</, "<Description>Not ours<"));
  const out = createBackend({ cleanupFiles: () => files }).install(names, definition(input()));
  assert.equal(out.ok, false);
  assert.match(out.ok ? "" : out.reason, /mempalace-test-mcp.*not CrewRig's/);
  assert.deepEqual(verbs(), ["/Query \\CrewRig\\mempalace-test-mcp"]);
  assert.equal(fake.has(TASK), true, "the foreign task is intact");
  assert.equal(fs.existsSync(files[0] ?? ""), true, "nothing the install did not own is removed");
});

test("the MCP launcher path under the ChromaDB leaf (cross-leaf) is foreign", { skip }, () => {
  const chromaTask = "\\CrewRig\\mempalace-test-chroma";
  const chroma: RenderInput = {
    chain: chromaChain({
      nodePath: NODE,
      wrapper: "C:\\h\\tls.ts",
      python: "p",
      chroma: "c",
      palacePath: "d",
    }),
    taskUri: chromaTask,
    userId: "H\\dev",
  };
  fake.seed(chromaTask, renderTaskXml({ ...chroma, chain: mcpChain(NODE, "C:\\h\\launcher.ts") }));
  const out = createBackend().install(chromaNames, definition(chroma));
  assert.equal(out.ok, false);
  assert.equal(
    fake.calls().some((c) => c[0] === "/Create" || c[0] === "/Delete"),
    false,
  );
});

test("a refused /Create fails closed with the verbatim text and never falls back", { skip }, () => {
  const text = "ERROR: Access is denied.\n";
  fake.setMode({ createFail: text });
  const files = [path.join(work, "installed.txt")];
  fs.writeFileSync(files[0] ?? "", "x");
  const out = createBackend({ cleanupFiles: () => files }).install(names, definition(input()));
  assert.equal(out.ok, false);
  const reason = out.ok ? "" : out.reason;
  for (const part of [
    "ERROR: Access is denied.",
    GROUP_POLICY_SENTENCE,
    STDIO_ADVICE,
    DOCTOR_POINTER,
    "/Create",
  ]) {
    assert.ok(reason.includes(part), part);
  }
  assert.equal(
    fake.calls().some((c) => c[0] === "/Run"),
    false,
    "no fallback and no start",
  );
  assert.equal(fake.has(TASK), false);
  assert.equal(fs.existsSync(files[0] ?? ""), false, "the files the install put down are removed");
});

test(
  "a refused /Run rolls back: the task is deleted, installed files removed, and it says so",
  { skip },
  () => {
    fake.setMode({ runFail: true });
    const files = [path.join(work, "installed.txt")];
    fs.writeFileSync(files[0] ?? "", "x");
    const out = createBackend({ cleanupFiles: () => files }).install(names, definition(input()));
    assert.equal(out.ok, false);
    assert.match(
      out.ok ? "" : out.reason,
      /deleted the task it created and removed 1 installed file/,
    );
    assert.equal(fake.has(TASK), false);
    assert.equal(fs.existsSync(files[0] ?? ""), false);
  },
);

test(
  "the mechanism unavailable: capability named, text, stdio advice, doctor pointer",
  { skip },
  () => {
    setExecutableOverride("schtasks", path.join(work, "missing-schtasks.exe"));
    const out = createBackend().install(names, definition(input()));
    assert.equal(out.ok, false);
    const reason = out.ok ? "" : out.reason;
    assert.match(reason, /schtasks\.exe\) is unavailable/);
    assert.ok(reason.includes(STDIO_ADVICE) && reason.includes(DOCTOR_POINTER));
  },
);

test("a definition for another task URI is refused before any call", { skip }, () => {
  const out = createBackend().install(names, definition(input("\\CrewRig\\other")));
  assert.equal(out.ok, false);
  assert.equal(fake.calls().length, 0);
});

test("start runs the task", { skip }, () => {
  fake.seed(TASK, renderTaskXml(input()));
  assert.equal(createBackend().start(names).ok, true);
  assert.deepEqual(fake.calls().at(-1), ["/Run", "/TN", TASK]);
});

function snapshot(enginePid: number | null, rows: object[]): string {
  const task = {
    present: true,
    hresult: 0,
    state: enginePid === null ? 3 : 4,
    lastResult: 0x41301,
    enginePid,
  };
  return JSON.stringify({ task, processes: rows });
}

test("stop ends leftovers by pid AND start time, never a reused pid", { skip }, async () => {
  const ROOT = 2_000_000;
  const spawnSleeper = (): ReturnType<typeof spawn> =>
    spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  const mine = spawnSleeper();
  const reused = spawnSleeper();
  try {
    const a = mine.pid ?? 0;
    const b = reused.pid ?? 0;
    let call = 0;
    setInspectRunnerForTests((spec) => {
      call += 1;
      const list = spec.env["CREWRIG_PID_LIST"] ?? "";
      if (call === 1) {
        assert.equal(list, "");
        return {
          ok: true,
          stdout: snapshot(ROOT, [
            { pid: ROOT, ppid: 1 },
            { pid: a, ppid: ROOT },
            { pid: b, ppid: a },
          ]),
        };
      }
      const start = (n: number, plus = 0): number => n + plus;
      if (call === 2) {
        assert.deepEqual(list.split(",").map(Number).sort(), [ROOT, a, b].sort());
        return {
          ok: true,
          stdout: snapshot(ROOT, [
            { pid: a, ppid: ROOT, start: start(a) },
            { pid: b, ppid: a, start: start(b) },
            { pid: ROOT, ppid: 1, start: 1 },
          ]),
        };
      }
      return {
        ok: true,
        stdout: snapshot(null, [
          { pid: a, ppid: 1, start: start(a) },
          { pid: b, ppid: 1, start: start(b, 1) },
        ]),
      };
    });
    const out = createBackend().stop(names);
    assert.equal(out.ok, true);
    assert.match(out.ok ? (out.detail ?? "") : "", /1 leftover/);
    await new Promise((r) => mine.once("exit", r));
    assert.equal(reused.exitCode, null, "same pid, other start time: left alone");
    assert.deepEqual(fake.calls(), [["/End", "/TN", TASK]]);
  } finally {
    mine.kill();
    reused.kill();
  }
});

test(
  "stop with an unreadable process table still ends the task and says UNDETERMINED",
  { skip },
  () => {
    const lines: string[] = [];
    const out = createBackend({ report: (l) => lines.push(l) }).stop(names);
    assert.equal(out.ok, true);
    assert.deepEqual(fake.calls(), [["/End", "/TN", TASK]]);
    assert.match(lines.join("\n"), /UNDETERMINED/);
    assert.match(lines.join("\n"), /does not claim that no daemon process remains/);
  },
);
