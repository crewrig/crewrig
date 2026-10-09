// service-task-state.test.ts — the locale and constancy guard of plan v3 D5
// *State source* (5): no localized text is parsed, no `/V` and no `/FO` is ever
// passed, and the PowerShell text handed to the runner is byte-identical across
// leaf names, the leaf travelling only in the environment.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { setInspectRunnerForTests, type InspectSpec } from "../lib/service/os-inspect.ts";
import { createBackend } from "../lib/service/schtasks.ts";
import { mcpChain, renderTaskFile } from "../lib/service/windows-task-xml.ts";
import { installFakeSchtasks, type FakeSchtasks } from "./lib/fake-schtasks.ts";

const skip = process.platform === "win32";
const LEAVES = ["mempalace-mcp-server", "mempalace-test-mcp-111", "x-9.z_"];

let fake: FakeSchtasks;
let dir: string;
let specs: InspectSpec[];
beforeEach(() => {
  fake = installFakeSchtasks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "task-state-"));
  specs = [];
  setInspectRunnerForTests((spec) => {
    specs.push(spec);
    const task = { present: true, hresult: 0, state: 4, lastResult: 0x41301, enginePid: 77 };
    return { ok: true, stdout: JSON.stringify({ task, processes: [{ pid: 77, ppid: 1 }] }) };
  });
});
afterEach(() => {
  fake.cleanup();
  setInspectRunnerForTests(undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

function install(leaf: string): ReturnType<ReturnType<typeof createBackend>["install"]> {
  const uri = `\\CrewRig\\${leaf}`;
  const definitionPath = path.join(dir, "task.xml");
  fs.writeFileSync(
    definitionPath,
    renderTaskFile({ chain: mcpChain("n", "C:\\h\\l.ts"), taskUri: uri, userId: "H\\d" }),
  );
  return createBackend().install({ kind: "mcp", label: "x", unit: leaf }, { definitionPath });
}

test(
  "the PowerShell text is byte-identical across three leaf names; the leaf is in the environment only",
  { skip },
  () => {
    for (const leaf of LEAVES) {
      assert.equal(install(leaf).ok, true);
      createBackend().status({ kind: "mcp", label: "x", unit: leaf });
    }
    assert.equal(specs.length, 3);
    const texts = new Set(specs.map((s) => s.args.join("\u0000")));
    assert.equal(texts.size, 1, "one constant script text");
    for (const [i, leaf] of LEAVES.entries()) {
      assert.equal(specs[i]?.env["CREWRIG_TASK_PATH"], `\\CrewRig\\${leaf}`);
      for (const l of LEAVES) assert.equal((specs[i]?.args.join(" ") ?? "").includes(l), false);
    }
  },
);

test("no call carries /V or /FO, and translated output changes nothing", { skip }, () => {
  const leaf = LEAVES[1] ?? "";
  for (const noText of [
    "ERREUR : Le fichier specifie est introuvable.\n",
    "FEHLER: Das System kann die angegebene Datei nicht finden.\n",
  ]) {
    fake.setMode({ noText });
    const names = { kind: "mcp", label: "x", unit: leaf } as const;
    assert.equal(
      createBackend().status(names).registered,
      false,
      "absent by exit status, whatever the language",
    );
    assert.equal(install(leaf).ok, true);
    const status = createBackend().status(names);
    assert.equal(status.registered, true);
    assert.equal(status.running, true);
    assert.equal(createBackend().stop(names).ok, true);
    assert.equal(createBackend().uninstall(names).ok, true);
  }
  for (const call of fake.calls()) {
    assert.equal(call.includes("/V"), false, call.join(" "));
    assert.equal(call.includes("/FO"), false, call.join(" "));
    assert.ok(["/Query", "/Create", "/Change", "/Delete", "/Run", "/End"].includes(call[0] ?? ""));
  }
  assert.ok(fake.calls().length > 10);
});
