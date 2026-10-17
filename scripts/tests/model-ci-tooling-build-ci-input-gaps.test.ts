// model-ci-tooling-build-ci-input-gaps.test.ts — inputs the shared yq reader cannot represent
// (spec 0262 delta-02 item (g)): the twin prints ONE `Error:` line and exits 1, with no stack
// trace and nothing on standard output; the shell exits 0 with accidental output, so these
// cases assert the twin directly and are not compared with the shell.

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
    test(`${name} gives one Error line and status 1`, () => {
      const ts = run("ts", [], reference);
      const lines = ts.stderr.trimEnd().split("\n");
      assert.equal(ts.status, 1, ts.stderr);
      assert.equal(ts.stdout, "");
      assert.equal(lines.length, 1, ts.stderr);
      assert.match(lines[0] ?? "", /^Error: /);
      assert.doesNotMatch(ts.stderr, /\n\s+at /);
    });
  }
});
