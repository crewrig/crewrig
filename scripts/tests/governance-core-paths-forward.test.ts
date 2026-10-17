// governance-core-paths-forward.test.ts — Replaces scripts/tests/test-check-core-paths.sh
// (cases a, b, c, d: manifest to HEAD; n: phantom regenerable; o, p, q: org carve-outs).
// Spec 0265 (row J2): one sandbox repository per case, black-box on
// scripts/check-core-paths.ts through the shared governance helpers.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { scenario, STUB_NONE } from "./lib/governance-core-paths-fixtures.ts";

const OK2 = "OK: all 2 strict/adopt-on-edit/regenerable core-paths entries resolve at HEAD.";

describe("core-paths forward direction (manifest to HEAD)", () => {
  test("case-a: a phantom strict entry fails, named", () => {
    const r = scenario(STUB_NONE, "real.txt\tstrict\nphantom.txt\tstrict\n");
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes("FAIL phantom.txt (strict)"), r.stderr);
  });

  test("case-b: a phantom adopt-on-edit entry fails, named", () => {
    const r = scenario(STUB_NONE, "real.txt\tstrict\nphantom.txt\tadopt-on-edit\n");
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes("FAIL phantom.txt (adopt-on-edit)"), r.stderr);
  });

  test("case-c: a fully resolvable manifest passes with the checked count", () => {
    const r = scenario(STUB_NONE, "real.txt\tstrict\nother.txt\tadopt-on-edit\n", {
      "other.txt": "other tracked content",
    });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(OK2), r.stdout);
  });

  test("case-d: a phantom excluded entry is skipped and not counted", () => {
    const r = scenario(STUB_NONE, "real.txt\tstrict\nphantom-excluded.txt\texcluded\n");
    assert.equal(r.status, 0, r.stderr);
    assert.ok(
      r.stdout.includes("OK: all 1 strict/adopt-on-edit/regenerable core-paths entries resolve"),
      r.stdout,
    );
  });

  test("case-n: a phantom regenerable entry still fails the forward direction", () => {
    const r = scenario(STUB_NONE, "real.txt\tstrict\n.newcli/skills\tregenerable\n");
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes("FAIL .newcli/skills (regenerable)"), r.stderr);
  });
});

describe("core-paths org carve-outs", () => {
  const core = { "model-mappings/claude.yml": "core mapping content" };

  test("case-o: a target with no excluded org carve-out is named", () => {
    const r = scenario(STUB_NONE, "real.txt\tstrict\n", core);
    assert.equal(r.status, 1);
    assert.ok(
      r.stderr.includes("- claude (expected: model-mappings/claude.org.yml  excluded)"),
      r.stderr,
    );
  });

  test("case-p: a core mapping with its excluded org carve-out passes", () => {
    const r = scenario(STUB_NONE, "real.txt\tstrict\nmodel-mappings/claude.org.yml\texcluded\n", {
      ...core,
      "model-mappings/claude.org.yml": "org channel content",
    });
    assert.equal(r.status, 0, r.stderr);
  });

  test("case-q: an org-only target with no carve-out is named", () => {
    const r = scenario(STUB_NONE, "real.txt\tstrict\n", {
      "model-mappings/onlyorg.org.yml": "org-only channel content",
    });
    assert.equal(r.status, 1);
    assert.ok(
      r.stderr.includes("- onlyorg (expected: model-mappings/onlyorg.org.yml  excluded)"),
      r.stderr,
    );
  });

  test("case-p2: an org carve-out listed under a non-excluded policy does not count", () => {
    const r = scenario(STUB_NONE, "real.txt\tstrict\nmodel-mappings/claude.org.yml\tstrict\n", {
      ...core,
      "model-mappings/claude.org.yml": "org channel content",
    });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.ok(
      r.stderr.includes("- claude (expected: model-mappings/claude.org.yml  excluded)"),
      r.stderr,
    );
  });
});
