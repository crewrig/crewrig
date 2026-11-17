// model-ci-tooling-build-ci-input-gaps.test.ts — inputs the shared yq reader cannot represent
// (spec 0262 delta-02 item (g)): the twin exits 1 with the reader's `FAILED:` block naming the
// reference file (spec 0309 R3), no stack trace and nothing on standard output; the shell exits 0
// with accidental output, so these cases assert the twin directly and are not compared with it.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { run } from "./lib/build-ci-diff.ts";

const GAPS: Record<string, string> = {
  "a bare scalar reference": "foo\n",
  "an unterminated flow collection": "capabilities: [a, b\n",
  "a multi-document reference": "capabilities: []\n---\ncapabilities: []\n",
};

describe("build-ci twin: reference inputs outside the reader", () => {
  for (const [name, reference] of Object.entries(GAPS)) {
    test(`${name} gives the reader's FAILED block and status 1`, () => {
      const ts = run("ts", [], reference);
      assert.equal(ts.status, 1, ts.stderr);
      assert.equal(ts.stdout, "");
      assert.match(
        ts.stderr,
        /^FAILED: 1 reference-validity violation\(s\) in .*ci\/capabilities\/:\n/,
      );
      assert.match(ts.stderr, /\n {2}- ci\/capabilities\/gate\.yml: not valid reference content: /);
      assert.doesNotMatch(ts.stderr, /\n\s+at /);
    });
  }
});
