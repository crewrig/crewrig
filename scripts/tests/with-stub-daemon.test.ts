// with-stub-daemon.test.ts — tests for the --expect-requests option of
// scripts/tests/lib/with-stub-daemon.ts (exact count, <min>-<max> range, malformed).
//
// The command under the stub posts `count` requests to it, so the verdict is
// checked end to end against the real stub daemon.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { parseCli } from "./lib/with-stub-daemon.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WRAPPER = path.join(REPO, "scripts", "tests", "lib", "with-stub-daemon.ts");

const POST = (count: number): string =>
  `(async()=>{for(let i=0;i<${count};i++){await fetch("http://"+process.env.MEMPALACE_MCP_HOST+":"+process.env.MEMPALACE_MCP_PORT+"/mcp",{method:"POST",headers:{"content-type":"application/json"},body:"{}"}).then((r)=>r.arrayBuffer());}})()`;

function run(expect: string, count: number): { status: number | null; stderr: string } {
  const res = spawnSync(
    process.execPath,
    [
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      WRAPPER,
      "--expect-requests",
      expect,
      "--",
      "node",
      "-e",
      POST(count),
    ],
    { encoding: "utf8" },
  );
  return { status: res.status, stderr: res.stderr };
}

describe("--expect-requests", () => {
  test("an exact count parses and matches", () => {
    assert.deepEqual(parseCli(["--expect-requests", "10", "--", "x"]).expectRequests, {
      min: 10,
      max: 10,
    });
    assert.equal(run("2", 2).status, 0);
  });

  test("an exact count that differs fails with exit 1", () => {
    const res = run("2", 3);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /logged 3 request\(s\), expected 2/);
  });

  test("a range accepts both bounds and the middle", () => {
    assert.deepEqual(parseCli(["--expect-requests", "10-11", "--", "x"]).expectRequests, {
      min: 10,
      max: 11,
    });
    assert.equal(run("1-2", 1).status, 0);
    assert.equal(run("1-2", 2).status, 0);
  });

  test("a range rejects a count below and above", () => {
    const low = run("2-3", 1);
    assert.equal(low.status, 1);
    assert.match(low.stderr, /expected 2-3/);
    assert.equal(run("1-2", 3).status, 1);
  });

  test("a malformed value is a usage error, exit 2", () => {
    for (const bad of ["abc", "-1", "3-2", "1-", "-2", "1-2-3", "1.5", "1,2", ""]) {
      assert.throws(
        () => parseCli(["--expect-requests", bad, "--", "x"]),
        /expect-requests|needs a value/,
      );
    }
    assert.equal(run("3-2", 0).status, 2);
    assert.equal(run("x-y", 0).status, 2);
  });
});
