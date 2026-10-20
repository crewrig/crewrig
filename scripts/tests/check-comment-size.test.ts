// check-comment-size.test.ts — black-box test of scripts/check-comment-size.ts (spec 0275 R-E2).
// Boundary: 12288 bytes passes, 12289 fails; by path and on stdin; UTF-8 bytes, not characters.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(SCRIPTS, "check-comment-size.ts");
const FIXTURES = path.join(SCRIPTS, "tests", "fixtures", "comment-size");
const tmp = mkdtempSync(path.join(tmpdir(), "comment-size-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const run = (args: string[], input?: string | Buffer) =>
  spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY, ...args], {
    cwd: tmp,
    encoding: "utf8",
    input,
  });

describe("check-comment-size", () => {
  it("accepts exactly 12288 bytes by path", () => {
    const r = run([path.join(tmp, "ok.md")].map((p) => (writeFileSync(p, "a".repeat(12288)), p)));
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "OK: 12288 bytes (budget: 12288 bytes)\n");
  });

  it("rejects 12289 bytes by path", () => {
    const p = path.join(tmp, "over.txt");
    writeFileSync(p, "a".repeat(12289));
    const r = run([p]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /ERROR: comment is 12289 bytes/);
  });

  it("reads stdin when no path is given, and for `-`", () => {
    assert.equal(run([], "a".repeat(12288)).status, 0);
    assert.equal(run(["-"], "a".repeat(12289)).status, 1);
    assert.equal(run([], "").stdout, "OK: 0 bytes (budget: 12288 bytes)\n");
  });

  it("counts UTF-8 bytes, not characters", () => {
    // 6145 two-byte characters = 12290 bytes over budget, though only 6145 characters.
    const r = run([], "é".repeat(6145));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /12290 bytes/);
  });

  it("exits non-zero on a missing path and on a directory", () => {
    const missing = run([path.join(tmp, "nope.md")]);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /Error: .*nope\.md: No such file or directory/);
    const dir = run([tmp]);
    assert.equal(dir.status, 1);
    assert.match(dir.stderr, /Is a directory/);
  });

  it("agrees with the committed fixtures (one under, one over budget)", () => {
    assert.equal(run([path.join(FIXTURES, "under.txt")]).status, 0);
    assert.equal(run([path.join(FIXTURES, "over.txt")]).status, 1);
  });
});
