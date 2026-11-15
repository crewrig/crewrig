// The CI tools that read ci/capabilities/ print the shared reference-validity block for a malformed
// directory (spec 0309 R3), the block the parity guard prints and classify-ci-drift routes to
// reference-drift, instead of a generic "cannot read" line. One case per reader.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { loadCapabilities } from "../lib/ci-pre-push/select.ts";
import { writeReferenceDir } from "./lib/ci-reference-fixtures.ts";

const SCRIPTS = path.join(import.meta.dirname, "..");
const BLOCK = /FAILED: 1 reference-validity violation\(s\) in .*ci\/capabilities\/:\n/;
const ITEM = /\n {2}- ci\/capabilities\/gate\.yml: not valid reference content: /;

const roots: string[] = [];
function malformedRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ci-ref-validity-"));
  roots.push(root);
  writeReferenceDir(root, "capabilities: [unclosed\n  - x: : :\n");
  return root;
}
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

function run(script: string, args: string[], root: string, cwd = root) {
  return spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.join(SCRIPTS, script), ...args],
    { encoding: "utf8", cwd, env: { ...process.env, REPO_DIR: root } },
  );
}

describe("the reference-validity block on a malformed ci/capabilities/", () => {
  it("ci-paths-gate", () => {
    const r = run("ci-paths-gate.ts", ["--capability", "x", "--event", "push"], malformedRoot());
    assert.equal(r.status, 2);
    assert.match(r.stderr, BLOCK);
    assert.match(r.stderr, ITEM);
  });
  it("ci-cache-guard --capability", () => {
    const r = run(
      "ci-cache-guard.ts",
      ["--capability", "x", "--print-key", "--", "true"],
      malformedRoot(),
    );
    assert.equal(r.status, 2);
    assert.match(r.stderr, BLOCK);
    assert.match(r.stderr, ITEM);
  });
  it("ci-pre-push selection (loadCapabilities)", () => {
    assert.throws(
      () => loadCapabilities(malformedRoot()),
      (e: Error) => BLOCK.test(e.message) && ITEM.test(e.message),
    );
  });
  it("check-ci-pre-push-parity", () => {
    const root = malformedRoot();
    const r = run("check-ci-pre-push-parity.ts", ["--root", root], root);
    assert.equal(r.status, 2);
    assert.match(
      r.stderr,
      /^FAILED: 1 reference-validity violation\(s\) in .*ci\/capabilities\/:\n/m,
    );
    assert.match(r.stderr, ITEM);
  });
  it("convert-ci-paths", () => {
    const r = run("convert-ci-paths.ts", [], malformedRoot());
    assert.equal(r.status, 2);
    assert.match(r.stderr, BLOCK);
    assert.match(r.stderr, ITEM);
  });
});
