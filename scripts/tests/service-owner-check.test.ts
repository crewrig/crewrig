// service-owner-check.test.ts — the owner verdict (spec 0158; spec 0252
// requirement 16 and delta-01; PLAN v3 D8): VERIFIED, VERIFIED for a descendant,
// USURPED, and UNVERIFIABLE on every undeterminable input, never USURPED.
//
// Run: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/service-owner-check.test.ts

import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { setInspectRunnerForTests } from "../lib/service/os-inspect.ts";
import { ownerCheck, ownerVerdict } from "../lib/service/owner-check.ts";
import type { OwnerInput } from "../lib/service/owner-check.ts";

afterEach(() => setInspectRunnerForTests(undefined));

const TABLE = new Map([
  [1, 0],
  [100, 1],
  [101, 100],
  [102, 101],
  [500, 1],
]);
const base: OwnerInput = {
  listenerPid: 100,
  expectedPid: 100,
  parents: TABLE,
  host: "127.0.0.1",
  port: 8001,
};

describe("owner-check: verdict", () => {
  test("VERIFIED when the listener is the supervised PID", () => {
    const v = ownerVerdict(base);
    assert.equal(v.kind, "VERIFIED");
    assert.equal(v.exitCode, 0);
    assert.deepEqual(v.lines, ["  owner:    VERIFIED (listener PID 100 is the supervised daemon)"]);
  });

  test("equal PIDs are VERIFIED even when the process table is unavailable", () => {
    assert.equal(ownerVerdict({ ...base, parents: null }).kind, "VERIFIED");
  });

  test("VERIFIED when the listener descends from the supervised PID (launcher then daemon)", () => {
    const v = ownerVerdict({ ...base, listenerPid: 102 });
    assert.equal(v.kind, "VERIFIED");
    assert.equal(v.exitCode, 0);
    assert.match(v.lines[0] as string, /listener PID 102 descends from .* PID 100/);
  });

  test("USURPED only when both PIDs are known and neither relation holds", () => {
    const v = ownerVerdict({ ...base, listenerPid: 500 });
    assert.equal(v.kind, "USURPED");
    assert.equal(v.exitCode, 1);
    assert.deepEqual(v.lines, [
      "  owner:    *** USURPED LISTENER ***",
      "            PID 500 is answering on 127.0.0.1:8001, but the",
      "            supervisor runs PID 100. A process that claimed",
      "            the port first may have received the bearer token.",
      "            Rotate the token: task mempalace:rotate-token",
      "            (or: bash scripts/switch-mempalace-http.sh --rotate)",
    ]);
  });

  test("an ancestor of the supervised PID is not VERIFIED (the relation is one way)", () => {
    assert.equal(ownerVerdict({ ...base, listenerPid: 1 }).kind, "USURPED");
  });

  test("UNVERIFIABLE, never USURPED, when any input could not be obtained", () => {
    const cases: [string, Partial<OwnerInput>, string][] = [
      [
        "listener",
        { listenerPid: null, expectedPid: 100 },
        "listener PID unknown, expected PID 100)",
      ],
      [
        "supervised",
        { listenerPid: 500, expectedPid: null },
        "listener PID 500, expected PID unknown)",
      ],
      [
        "both",
        { listenerPid: null, expectedPid: null },
        "listener PID unknown, expected PID unknown)",
      ],
      [
        "table",
        { listenerPid: 500, parents: null },
        "listener PID 500, expected PID 100, process table unavailable)",
      ],
    ];
    for (const [name, patch, tail] of cases) {
      const v = ownerVerdict({ ...base, ...patch });
      assert.equal(v.kind, "UNVERIFIABLE", name);
      assert.equal(v.exitCode, 1, name);
      assert.equal(v.lines.length, 1, name);
      assert.ok(
        v.lines[0]?.startsWith("  owner:    UNVERIFIABLE (") && v.lines[0].endsWith(tail),
        `${name}: ${v.lines[0]}`,
      );
    }
  });
});

describe("owner-check: collection with seams", () => {
  const o = { host: "127.0.0.1", port: 8001, platform: "darwin" } as const;
  const ps = "  1 0\n  100 1\n  101 100\n";

  test("both seams set: no lookup, the table comes from ps", () => {
    setInspectRunnerForTests(() => ({ ok: true, stdout: ps }));
    const env = { MEMPALACE_MCP_LISTENER_PID: "101", MEMPALACE_MCP_EXPECTED_PID: "100" };
    let looked = false;
    const v = ownerCheck({ ...o, env, lookupExpected: () => ((looked = true), 7) });
    assert.equal(v.kind, "VERIFIED");
    assert.equal(looked, false);
  });

  test("set-but-empty EXPECTED_PID is undeterminable even when the supervisor knows", () => {
    setInspectRunnerForTests(() => ({ ok: true, stdout: ps }));
    const env = { MEMPALACE_MCP_LISTENER_PID: "101", MEMPALACE_MCP_EXPECTED_PID: "" };
    assert.equal(ownerCheck({ ...o, env, lookupExpected: () => 100 }).kind, "UNVERIFIABLE");
  });

  test("unset EXPECTED_PID falls through to the supervisor lookup", () => {
    setInspectRunnerForTests(() => ({ ok: true, stdout: ps }));
    const env = { MEMPALACE_MCP_LISTENER_PID: "101" };
    assert.equal(ownerCheck({ ...o, env, lookupExpected: () => 100 }).kind, "VERIFIED");
    assert.equal(ownerCheck({ ...o, env, lookupExpected: () => 1 }).kind, "VERIFIED");
    assert.equal(ownerCheck({ ...o, env, lookupExpected: () => 555 }).kind, "USURPED");
    assert.equal(ownerCheck({ ...o, env, lookupExpected: () => null }).kind, "UNVERIFIABLE");
  });

  test("a failing os-inspect (ps refused) makes the verdict UNVERIFIABLE, not USURPED", () => {
    setInspectRunnerForTests(() => ({ ok: false, reason: "refused" }));
    const env = { MEMPALACE_MCP_LISTENER_PID: "500", MEMPALACE_MCP_EXPECTED_PID: "100" };
    assert.equal(ownerCheck({ ...o, env, lookupExpected: () => 100 }).kind, "UNVERIFIABLE");
  });

  test("every os-inspect call failing on Windows (netstat and PowerShell) is UNVERIFIABLE", () => {
    setInspectRunnerForTests(() => ({ ok: false, reason: "timeout" }));
    const v = ownerCheck({ ...o, platform: "win32", env: {}, lookupExpected: () => 100 });
    assert.equal(v.kind, "UNVERIFIABLE");
  });
});
