// service-os-inspect.test.ts — the single inspection module (spec 0215 delta-05
// requirement 23; spec 0252 requirement 16; PLAN v3 D1, D5, step 8): absolute
// tool paths, argument arrays, one constant PowerShell text, the failure
// mapping, and a scan that no other file of scripts/lib/service/ spawns the tools.
//
// Run: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/service-os-inspect.test.ts

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  listenerTable,
  processTable,
  setInspectRunnerForTests,
  spawnRunner,
  taskSnapshot,
  windowsToolPaths,
} from "../lib/service/os-inspect.ts";
import type { InspectResult, InspectSpec } from "../lib/service/os-inspect.ts";

const SERVICE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "service");

function record(answer: InspectResult = { ok: true, stdout: "out" }): InspectSpec[] {
  const calls: InspectSpec[] = [];
  setInspectRunnerForTests((spec) => (calls.push(spec), answer));
  return calls;
}

afterEach(() => setInspectRunnerForTests(undefined));

describe("os-inspect: absolute paths and argument arrays", () => {
  test("macOS resolves netstat and ps at their own absolute paths", () => {
    const calls = record();
    listenerTable("darwin");
    processTable("darwin");
    assert.deepEqual(
      calls.map((c) => [c.file, c.args]),
      [
        ["/usr/sbin/netstat", ["-anv", "-p", "tcp"]],
        ["/bin/ps", ["-axo", "pid=,ppid="]],
      ],
    );
  });

  test("Windows resolves under %SystemRoot%\\System32 and asks TCP then TCPv6", () => {
    const calls = record();
    const { netstat, powershell } = windowsToolPaths();
    assert.match(netstat, /^[A-Za-z]:\\.+\\System32\\netstat\.exe$/);
    assert.match(powershell, /\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/);
    listenerTable("win32");
    assert.deepEqual(
      calls.map((c) => [c.file, c.args]),
      [
        [netstat, ["-ano", "-p", "TCP"]],
        [netstat, ["-ano", "-p", "TCPv6"]],
      ],
    );
  });

  test("Linux and other platforms spawn nothing", () => {
    const calls = record();
    assert.deepEqual(listenerTable("linux"), { ok: false, reason: "absent" });
    assert.deepEqual(processTable("linux"), { ok: false, reason: "absent" });
    assert.deepEqual(processTable("freebsd"), { ok: false, reason: "absent" });
    assert.equal(calls.length, 0);
  });

  test("every spec has an absolute file, no shell word, and a bounded time", () => {
    const calls = record();
    listenerTable("darwin");
    listenerTable("win32");
    processTable("darwin");
    processTable("win32");
    taskSnapshot("\\CrewRig\\x");
    for (const c of calls) {
      assert.ok(/^(\/|[A-Za-z]:\\)/.test(c.file), c.file);
      assert.ok(c.timeoutMs > 0 && c.timeoutMs <= 60_000);
      assert.ok(!c.args.some((a) => /^(cmd|sh|bash)(\.exe)?$/i.test(a)));
    }
  });

  test("a failed first Windows netstat call stops the sequence", () => {
    const calls = record({ ok: false, reason: "refused" });
    assert.deepEqual(listenerTable("win32"), { ok: false, reason: "refused" });
    assert.equal(calls.length, 1);
  });
});

describe("os-inspect: the constant PowerShell text", () => {
  test("is byte-identical across leaf names; the leaf lives only in the environment", () => {
    const calls = record();
    const leaves = ["mempalace-mcp-server", "mempalace-chroma-server", "mempalace-test-mcp-42"];
    for (const leaf of leaves) taskSnapshot(`\\CrewRig\\${leaf}`, [123, 456]);
    const texts = calls.map((c) => c.args[c.args.length - 1]);
    assert.equal(new Set(texts).size, 1);
    for (const [i, leaf] of leaves.entries()) {
      const c = calls[i] as InspectSpec;
      assert.deepEqual(c.args.slice(0, 3), ["-NoProfile", "-NonInteractive", "-Command"]);
      assert.equal(c.args.length, 4);
      assert.equal(c.env.CREWRIG_TASK_PATH, `\\CrewRig\\${leaf}`);
      assert.equal(c.env.CREWRIG_PID_LIST, "123,456");
      assert.ok(!c.args.join(" ").includes(leaf));
      assert.ok(!(texts[i] as string).includes("mempalace"));
    }
  });

  test("reads both inputs from the environment and carries no credential", () => {
    const calls = record();
    const saved = process.env.MEMPALACE_MCP_TOKEN;
    process.env.MEMPALACE_MCP_TOKEN = "secret-token-value";
    try {
      taskSnapshot("\\CrewRig\\x");
      processTable("win32");
    } finally {
      if (saved === undefined) delete process.env.MEMPALACE_MCP_TOKEN;
      else process.env.MEMPALACE_MCP_TOKEN = saved;
    }
    for (const c of calls) {
      assert.match(c.args[3] as string, /\$env:CREWRIG_TASK_PATH/);
      assert.match(c.args[3] as string, /\$env:CREWRIG_PID_LIST/);
      assert.ok(!JSON.stringify(c).includes("secret-token-value"));
      assert.ok(!Object.keys(c.env).some((k) => /TOKEN|SECRET|KEY|PASSWORD/i.test(k)));
    }
    assert.equal(calls[1]?.env.CREWRIG_TASK_PATH, "");
  });

  test("refuses a task path with a NUL or a PID list that is not positive integers", () => {
    const calls = record();
    assert.deepEqual(taskSnapshot("a\0b"), { ok: false, reason: "refused" });
    assert.deepEqual(taskSnapshot("\\x", [1, -2]), { ok: false, reason: "refused" });
    assert.deepEqual(taskSnapshot("\\x", [Number.NaN]), { ok: false, reason: "refused" });
    assert.equal(calls.length, 0);
  });
});

describe("os-inspect: failure mapping of the real runner", () => {
  const spec = (file: string, args: string[], timeoutMs = 5_000): InspectSpec => ({
    file,
    args,
    env: {},
    timeoutMs,
  });

  test("a missing executable is absent", () => {
    assert.deepEqual(spawnRunner(spec("/nonexistent/crewrig-tool", [])), {
      ok: false,
      reason: "absent",
    });
  });

  test("a non-zero exit is refused, a zero exit returns stdout", () => {
    assert.deepEqual(spawnRunner(spec(process.execPath, ["-e", "process.exit(3)"])), {
      ok: false,
      reason: "refused",
    });
    assert.deepEqual(spawnRunner(spec(process.execPath, ["-e", "process.stdout.write('hi')"])), {
      ok: true,
      stdout: "hi",
    });
  });

  test("a run past its bound is timeout", () => {
    const r = spawnRunner(spec(process.execPath, ["-e", "setTimeout(()=>{},20000)"], 300));
    assert.deepEqual(r, { ok: false, reason: "timeout" });
  });

  test("a file that is not executable is refused", { skip: process.platform === "win32" }, () => {
    assert.deepEqual(spawnRunner(spec("/etc/hosts", [])), { ok: false, reason: "refused" });
  });
});

describe("os-inspect: the only spawner", () => {
  const others = readdirSync(SERVICE_DIR)
    .filter((f) => f.endsWith(".ts") && f !== "os-inspect.ts")
    .map((f) => [f, readFileSync(join(SERVICE_DIR, f), "utf8")] as const);

  test("no other file imports node:child_process while naming netstat, ps or powershell", () => {
    for (const [name, text] of others) {
      if (!/node:child_process|["']child_process["']/.test(text)) continue;
      assert.doesNotMatch(
        text,
        /["'`/\\][^"'`\n]*\b(netstat|powershell|ps)(\.exe)?["'`]/i,
        `${name} spawns an inspection tool`,
      );
    }
  });

  test("a file that names the tools never imports node:child_process", () => {
    for (const [name, text] of others) {
      if (!/\b(netstat|powershell)\b/i.test(text.replace(/^\s*\/\/.*$/gm, ""))) continue;
      assert.doesNotMatch(text, /node:child_process/, `${name} must call os-inspect.ts instead`);
    }
  });

  test("lsof and ss appear nowhere under scripts/lib/service/", () => {
    for (const f of readdirSync(SERVICE_DIR).filter((n) => n.endsWith(".ts"))) {
      const text = readFileSync(join(SERVICE_DIR, f), "utf8");
      assert.doesNotMatch(text, /\blsof\b/, `${f} names lsof`);
      assert.doesNotMatch(text, /["'`]ss["'`]/, `${f} names ss`);
    }
  });

  test("os-inspect.ts stays within the 300-line cap", () => {
    const n = readFileSync(join(SERVICE_DIR, "os-inspect.ts"), "utf8").split("\n").length;
    assert.ok(n <= 300, `${n} lines`);
  });
});
