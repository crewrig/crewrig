// service-listener-pid.test.ts — the listener PID lookup (spec 0252 requirement
// 16; PLAN v3 D8, step 8): a real loopback listener through /proc on Linux, a
// fixture /proc tree everywhere, macOS `netstat -anv` and Windows `netstat -ano`
// fixtures with header parsing, and the seam semantics.
//
// Run: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/service-listener-pid.test.ts

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  listenerPid,
  parseNetstatDarwin,
  parseNetstatWindows,
  parseProcNetTcp,
  pidSeam,
} from "../lib/service/listener-pid.ts";
import { setInspectRunnerForTests } from "../lib/service/os-inspect.ts";

afterEach(() => setInspectRunnerForTests(undefined));

const DARWIN = `Active Internet connections (including servers)
Proto Recv-Q Send-Q  Local Address                                 Foreign Address                               (state)          rxbytes      txbytes  rhiwat  shiwat          process:pid    state  options           gencnt    flags   flags1 usecnt rtncnt fltrs
tcp4       0      0  127.0.0.1.8001         127.0.0.1.60212        ESTABLISHED        95762        26551  364032  146988           Python:759    00102 00000004 00000000000763af 00000081 01000800      2      0 000000
tcp4       0      0  127.0.0.1.8001         *.*                    LISTEN                 0            0  131072  131072           Python:759    00100 00000004 00000000000763b0 00000081 01000900      1      0 000000
tcp6       0      0  ::1.9000               *.*                    LISTEN                 0            0  131072  131072           Google Chrome H:4242    00100 00000004 00000000000763b1 00000081 01000900      1      0 000000
tcp4       0      0  *.9100                 *.*                    LISTEN                 0            0  131072  131072           node:77     00100 00000004 00000000000763b2 00000081 01000900      1      0 000000
`;

const WINDOWS_TCP = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1032
  TCP    127.0.0.1:8001         0.0.0.0:0              LISTENING       4812
  TCP    127.0.0.1:8001         127.0.0.1:50321        ESTABLISHED     4812
`;
const WINDOWS_TCP6 = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    [::]:445               [::]:0                 LISTENING       4
  TCP    [::1]:9443             [::]:0                 À L’ÉCOUTE        5150
`;

describe("listener-pid: macOS netstat -anv", () => {
  test("finds the LISTEN row by header columns, not the ESTABLISHED one", () => {
    assert.equal(parseNetstatDarwin(DARWIN, 8001), 759);
    assert.equal(parseNetstatDarwin(DARWIN, 9100), 77);
  });
  test("IPv6 row and a process name with spaces", () => {
    assert.equal(parseNetstatDarwin(DARWIN, 9000), 4242);
  });
  test("no listener, no header, or no process:pid column is undeterminable", () => {
    assert.equal(parseNetstatDarwin(DARWIN, 1234), null);
    assert.equal(parseNetstatDarwin(DARWIN.split("\n").slice(2).join("\n"), 8001), null);
    assert.equal(parseNetstatDarwin(DARWIN.replace("process:pid", "other"), 8001), null);
  });
  test("listenerPid asks os-inspect for the macOS table through the seam", () => {
    setInspectRunnerForTests(() => ({ ok: true, stdout: DARWIN }));
    assert.equal(listenerPid(8001, { platform: "darwin", env: {} }), 759);
    setInspectRunnerForTests(() => ({ ok: false, reason: "refused" }));
    assert.equal(listenerPid(8001, { platform: "darwin", env: {} }), null);
  });
});

describe("listener-pid: Windows netstat -ano", () => {
  test("TCP and TCPv6 rows, PID in the last column", () => {
    const text = `${WINDOWS_TCP}\n${WINDOWS_TCP6}`;
    assert.equal(parseNetstatWindows(text, 8001), 4812);
    assert.equal(parseNetstatWindows(text, 445), 4);
  });
  test("a localized state word does not matter: the foreign port 0 marks a listener", () => {
    assert.equal(parseNetstatWindows(`${WINDOWS_TCP}\n${WINDOWS_TCP6}`, 9443), 5150);
  });
  test("an established connection alone is not a listener", () => {
    assert.equal(
      parseNetstatWindows(
        WINDOWS_TCP.replace("0.0.0.0:0              LISTENING       4812", "x"),
        8001,
      ),
      null,
    );
    assert.equal(parseNetstatWindows(WINDOWS_TCP, 50321), null);
  });
  test("listenerPid concatenates both protocols through the seam", () => {
    const seen: string[] = [];
    setInspectRunnerForTests((spec) => {
      seen.push(spec.args.join(" "));
      return { ok: true, stdout: spec.args.includes("TCPv6") ? WINDOWS_TCP6 : WINDOWS_TCP };
    });
    assert.equal(listenerPid(9443, { platform: "win32", env: {} }), 5150);
    assert.deepEqual(seen, ["-ano -p TCP", "-ano -p TCPv6"]);
  });
});

describe("listener-pid: Linux /proc", () => {
  const TABLE = `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:1F41 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 55501 1 0000 100 0 0 10 0
   1: 0100007F:1F41 0100007F:EA0C 01 00000000:00000000 00:00000000 00000000  1000        0 55502 1 0000 100 0 0 10 0
   2: 00000000:2329 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 55503 1 0000 100 0 0 10 0
`;
  test("parseProcNetTcp keeps state 0A rows of the port only", () => {
    assert.deepEqual(parseProcNetTcp(TABLE, 8001), ["55501"]);
    assert.deepEqual(parseProcNetTcp(TABLE, 9001), ["55503"]);
    assert.deepEqual(parseProcNetTcp(TABLE, 1), []);
  });

  test("a fixture /proc tree resolves the inode to the lowest owning PID", () => {
    const root = mkdtempSync(join(tmpdir(), "crewrig-proc-"));
    try {
      mkdirSync(join(root, "net"));
      writeFileSync(join(root, "net", "tcp"), TABLE);
      writeFileSync(join(root, "net", "tcp6"), "  sl local_address\n");
      for (const [pid, inode] of [
        ["300", "55501"],
        ["200", "99999"],
        ["250", "55501"],
      ] as const) {
        mkdirSync(join(root, pid, "fd"), { recursive: true });
        symlinkSync(`socket:[${inode}]`, join(root, pid, "fd", "3"));
      }
      const o = { platform: "linux", env: {}, procRoot: root } as const;
      assert.equal(listenerPid(8001, o), 250);
      assert.equal(listenerPid(7777, o), null);
      assert.equal(listenerPid(8001, { ...o, procRoot: join(root, "missing") }), null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test(
    "a real loopback listener is found by its port",
    { skip: process.platform !== "linux" },
    async () => {
      const server = createServer();
      await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
      try {
        const addr = server.address();
        assert.ok(addr !== null && typeof addr === "object");
        assert.equal(listenerPid(addr.port, { env: {} }), process.pid);
      } finally {
        server.close();
      }
    },
  );
});

describe("listener-pid: seam MEMPALACE_MCP_LISTENER_PID", () => {
  test("set value wins, set-but-empty is undeterminable, unset looks up", () => {
    setInspectRunnerForTests(() => ({ ok: true, stdout: DARWIN }));
    const base = { platform: "darwin" } as const;
    assert.equal(
      listenerPid(8001, { ...base, env: { MEMPALACE_MCP_LISTENER_PID: "31337" } }),
      31337,
    );
    assert.equal(listenerPid(8001, { ...base, env: { MEMPALACE_MCP_LISTENER_PID: "" } }), null);
    assert.equal(listenerPid(8001, { ...base, env: { MEMPALACE_MCP_LISTENER_PID: "abc" } }), null);
    assert.equal(listenerPid(8001, { ...base, env: {} }), 759);
  });
  test("a seam never reaches os-inspect", () => {
    let called = false;
    setInspectRunnerForTests(() => ((called = true), { ok: false, reason: "absent" }));
    listenerPid(8001, { platform: "darwin", env: { MEMPALACE_MCP_LISTENER_PID: "" } });
    assert.equal(called, false);
  });
  test("pidSeam distinguishes unset from empty", () => {
    assert.deepEqual(pidSeam({}, "X"), { set: false });
    assert.deepEqual(pidSeam({ X: "" }, "X"), { set: true, pid: null });
    assert.deepEqual(pidSeam({ X: " 12 " }, "X"), { set: true, pid: 12 });
  });
});
