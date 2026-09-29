// node-floor-guard.test.ts — tests for scripts/lib/node-floor-guard.js (spec 0240 R1-R3).
//
// The pre-24 failure path itself runs in the `node-floor-guard` CI capability
// on a real Node.js 20; here `evaluate` is exercised directly for the version
// matrix, and the file is executed on the running (>= 24) Node.js.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUARD = path.join(REPO, "scripts", "lib", "node-floor-guard.js");

interface Guard {
  FLOOR: number;
  evaluate: (versionString: string) => { ok: boolean; message: string };
}

const guard = createRequire(import.meta.url)(GUARD) as Guard;

describe("evaluate", () => {
  test("the floor is 24", () => {
    assert.equal(guard.FLOOR, 24);
  });

  for (const version of ["v24.0.0", "v26.1.0"]) {
    test(`accepts ${version}`, () => {
      assert.deepEqual(guard.evaluate(version), { ok: true, message: "" });
    });
  }

  for (const version of ["v20.19.5", "v20.19.24", "v22.12.0", "v0.12.18"]) {
    test(`rejects ${version} with the stable diagnostic`, () => {
      const verdict = guard.evaluate(version);
      assert.equal(verdict.ok, false);
      assert.ok(verdict.message.includes("requires Node.js >= 24"), verdict.message);
      assert.ok(verdict.message.includes(`${version} detected`), verdict.message);
      assert.ok(verdict.message.includes("https://nodejs.org/en/download"), verdict.message);
    });
  }

  test("rejects an unparseable version string", () => {
    assert.equal(guard.evaluate("garbage").ok, false);
  });
});

describe("direct execution on the running Node.js", () => {
  test("exits 0 with empty stdout and stderr", () => {
    const res = spawnSync(process.execPath, [GUARD], { encoding: "utf8" });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, "");
    assert.equal(res.stderr, "");
  });
});
