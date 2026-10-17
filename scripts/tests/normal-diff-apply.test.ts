// normal-diff-apply.test.ts — unit test of the normal-format patch applier on hand-made diffs.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { applyNormalDiff } from "./lib/normal-diff-apply.ts";

describe("applyNormalDiff", () => {
  test("change, delete and add hunks", () => {
    const old = "a\nb\nc\nd\ne\n";
    const script = "2c2\n< b\n---\n> B\n4d3\n< d\n5a5\n> f\n> g\n";
    assert.equal(applyNormalDiff(old, script), "a\nB\nc\ne\nf\ng\n");
  });
  test("range change and an add at the top", () => {
    assert.equal(
      applyNormalDiff("x\ny\nz\n", "0a1\n> top\n2,3c3\n< y\n< z\n---\n> Y\n"),
      "top\nx\nY\n",
    );
  });
  test("an empty old file", () => {
    assert.equal(applyNormalDiff("", "0a1,2\n> a\n> b\n"), "a\nb\n");
  });
  test("a lost trailing newline in the new file", () => {
    assert.equal(
      applyNormalDiff("a\nb\n", "2c2\n< b\n---\n> b\n\\ No newline at end of file\n"),
      "a\nb",
    );
  });
  test("a gained trailing newline", () => {
    assert.equal(
      applyNormalDiff("a\nb", "2c2\n< b\n\\ No newline at end of file\n---\n> b\n"),
      "a\nb\n",
    );
  });
  test("an unchanged final line without newline stays so", () => {
    assert.equal(applyNormalDiff("a\nb\nc", "1c1\n< a\n---\n> A\n"), "A\nb\nc");
  });
  test("an append after a final line without newline", () => {
    assert.equal(
      applyNormalDiff("a\nb", "2c2,3\n< b\n\\ No newline at end of file\n---\n> b\n> c\n"),
      "a\nb\nc\n",
    );
  });
  test("an inconsistent hunk throws", () => {
    assert.throws(() => applyNormalDiff("a\nb\n", "2c2\n< zzz\n---\n> B\n"), /does not match/);
    assert.throws(() => applyNormalDiff("a\n", "junk\n"), /not a normal-diff hunk header/);
  });
});
