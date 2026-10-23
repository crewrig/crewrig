// e2e-report.test.ts — migrated from test-e2e-report.sh (spec 0261 R19). Locks the v1 contract of
// the TAP aggregator tests/e2e/lib/report.ts: exit codes, glyphs, --dry-run, parity-*.md output.
// No Docker, no network, no shell: runs on every platform.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { report } from "../../tests/e2e/lib/report.ts";
import { loadTaskfileTree } from "../lib/taskfile-tree.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-report-"));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const NOW = new Date("2026-01-02T03:04:05Z");

function fixture(name: string, tap: string): { tapDir: string; outDir: string } {
  const tapDir = path.join(TMP, `${name}-tap`);
  const outDir = path.join(TMP, `${name}-out`);
  fs.mkdirSync(path.join(tapDir, "run-001"), { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(tapDir, "run-001", "run.tap"), `TAP version 13\n1..1\n${tap}\n`);
  return { tapDir, outDir };
}

function run(tapDir: string, outDir: string, dry: boolean) {
  const args = ["--tap-dir", tapDir, "--output-dir", outDir];
  if (dry) args.push("--dry-run");
  return report(args, TMP, NOW);
}

describe("e2e report aggregator", () => {
  it("empty TAP dir exits 2", () => {
    const empty = path.join(TMP, "empty-tap");
    fs.mkdirSync(empty, { recursive: true });
    assert.equal(run(empty, path.join(TMP, "out3"), true).rc, 2);
  });

  it("single ok line exits 0 and names the scenario on stdout", () => {
    const f = fixture("c4", "ok 1 - claude/01-layered-context");
    const r = run(f.tapDir, f.outDir, true);
    assert.equal(r.rc, 0, r.stderr);
    assert.match(r.stdout, /01-layered-context/);
  });

  it("single not-ok line exits 1", () => {
    const f = fixture("c5", "not ok 1 - claude/01-layered-context");
    assert.equal(run(f.tapDir, f.outDir, true).rc, 1);
  });

  it("# SKIP directive exits 0 with the warning glyph", () => {
    const f = fixture("c6", "ok 1 - copilot/01-layered-context # SKIP no auth");
    const r = run(f.tapDir, f.outDir, true);
    assert.equal(r.rc, 0, r.stderr);
    assert.ok(r.stdout.includes("⚠"));
  });

  it("--dry-run writes no markdown file", () => {
    const f = fixture("c7", "ok 1 - claude/01-layered-context");
    run(f.tapDir, f.outDir, true);
    assert.deepEqual(
      fs.readdirSync(f.outDir).filter((n) => n.endsWith(".md")),
      [],
    );
  });

  it("non-dry-run creates parity-*.md", () => {
    const f = fixture("c8", "ok 1 - claude/01-layered-context");
    const r = run(f.tapDir, f.outDir, false);
    assert.equal(r.rc, 0, r.stderr);
    const md = fs.readdirSync(f.outDir).filter((n) => /^parity-.*\.md$/.test(n));
    assert.ok(md.length >= 1);
  });

  it("the Taskfile tree carries an e2e:report task", () => {
    assert.ok(loadTaskfileTree(REPO).byName.has("e2e:report"));
  });

  it("tests/e2e/README.md is non-empty and mentions Prerequisites", () => {
    const text = fs.readFileSync(path.join(REPO, "tests/e2e/README.md"), "utf8");
    assert.ok(text.length > 0);
    assert.ok(text.includes("Prerequisites"));
  });
});
