// service-process-tree.test.ts — the parent table (spec 0252 requirement 16;
// PLAN v3 D8 *Parent table*): /proc/<pid>/stat, macOS `ps -axo pid=,ppid=` and
// the Windows PowerShell JSON, plus the ancestor and descendant helpers.
//
// Run: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test scripts/tests/service-process-tree.test.ts

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { setInspectRunnerForTests } from "../lib/service/os-inspect.ts";
import {
  descendants,
  hasAncestor,
  parentTable,
  parseProcStat,
  parsePsTable,
  parseWindowsTable,
} from "../lib/service/process-tree.ts";

afterEach(() => setInspectRunnerForTests(undefined));

describe("process-tree: Linux /proc/<pid>/stat", () => {
  test("parses pid and ppid, even when the command name holds spaces and parentheses", () => {
    assert.deepEqual(parseProcStat("1234 (node) S 99 1234 1234 0 -1 4194560"), {
      pid: 1234,
      ppid: 99,
    });
    assert.deepEqual(parseProcStat("77 (a (b) c) R 12 77 77 0"), { pid: 77, ppid: 12 });
    assert.equal(parseProcStat("garbage"), null);
    assert.equal(parseProcStat("5 (x) S"), null);
  });
  test("reads a fixture tree and skips unreadable entries", () => {
    const root = mkdtempSync(join(tmpdir(), "crewrig-tree-"));
    try {
      for (const [pid, ppid] of [
        [1, 0],
        [10, 1],
        [11, 10],
      ]) {
        mkdirSync(join(root, String(pid)));
        writeFileSync(join(root, String(pid), "stat"), `${pid} (p) S ${ppid} 0 0`);
      }
      mkdirSync(join(root, "12")); // exited: no stat file
      mkdirSync(join(root, "self"));
      const table = parentTable({ platform: "linux", procRoot: root });
      assert.deepEqual(
        [...(table ?? [])],
        [
          [1, 0],
          [10, 1],
          [11, 10],
        ],
      );
      assert.equal(parentTable({ platform: "linux", procRoot: join(root, "none") }), null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("process-tree: macOS ps", () => {
  test("parses `pid=,ppid=` lines; a stray line makes the table undeterminable", () => {
    assert.deepEqual(
      [...(parsePsTable("    1     0\n  337     1\n  338   337\n") ?? [])],
      [
        [1, 0],
        [337, 1],
        [338, 337],
      ],
    );
    assert.equal(parsePsTable("  PID PPID\n    1     0\n"), null);
    assert.equal(parsePsTable(""), null);
  });
  test("parentTable calls os-inspect with the macOS platform", () => {
    setInspectRunnerForTests(
      (s) => ({ ok: s.file === "/bin/ps", stdout: "  5 1\n  6 5\n" }) as never,
    );
    assert.equal(parentTable({ platform: "darwin" })?.get(6), 5);
    setInspectRunnerForTests(() => ({ ok: false, reason: "timeout" }));
    assert.equal(parentTable({ platform: "darwin" }), null);
  });
});

describe("process-tree: Windows table", () => {
  const JSON_TEXT = JSON.stringify({
    task: null,
    processes: [
      { pid: 4, ppid: 0 },
      { pid: 700, ppid: 4 },
      { pid: 701, ppid: 700, start: 1760000000000 },
    ],
  });
  test("parses the processes array of the PowerShell JSON", () => {
    assert.equal(parseWindowsTable(JSON_TEXT)?.get(701), 700);
  });
  test("garbage, a missing array or a malformed row is undeterminable", () => {
    assert.equal(parseWindowsTable("not json"), null);
    assert.equal(parseWindowsTable("{}"), null);
    assert.equal(parseWindowsTable('{"processes":[{"pid":"x","ppid":1}]}'), null);
    assert.equal(parseWindowsTable('{"processes":[]}'), null);
  });
  test("parentTable goes through os-inspect and maps a failure to null", () => {
    setInspectRunnerForTests(() => ({ ok: true, stdout: JSON_TEXT }));
    assert.equal(parentTable({ platform: "win32" })?.size, 3);
    for (const reason of ["absent", "refused", "timeout"] as const) {
      setInspectRunnerForTests(() => ({ ok: false, reason }));
      assert.equal(parentTable({ platform: "win32" }), null);
    }
  });
});

describe("process-tree: ancestry", () => {
  const table = new Map([
    [1, 0],
    [10, 1],
    [11, 10],
    [12, 11],
    [20, 1],
    [30, 31],
    [31, 30],
  ]);
  test("hasAncestor is strict, transitive and cycle-safe", () => {
    assert.equal(hasAncestor(table, 12, 10), true);
    assert.equal(hasAncestor(table, 12, 1), true);
    assert.equal(hasAncestor(table, 12, 12), false);
    assert.equal(hasAncestor(table, 12, 20), false);
    assert.equal(hasAncestor(table, 30, 99), false);
    assert.equal(hasAncestor(table, 99, 1), false);
  });
  test("descendants lists the strict subtree, ascending", () => {
    assert.deepEqual(descendants(table, 10), [11, 12]);
    assert.deepEqual(descendants(table, 12), []);
  });
});
