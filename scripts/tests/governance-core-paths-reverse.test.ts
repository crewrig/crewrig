// governance-core-paths-reverse.test.ts — Replaces scripts/tests/test-check-core-paths.sh
// (cases e, f, g, h, j, k, l, m: built-output directories to manifest). Case i, which
// copies the real builder, lives in governance-core-paths-builder.test.ts. Case n moved to
// the forward file (it is a forward-direction failure). Spec 0265 (row J2).
//
// Cases j and l pin a shell call-site matcher that no longer exists: the check asks the
// builder for `--list-output-dirs` only. They stay as stub-list tests that protect the
// exit 1 versus exit 2 split; the call-site property belongs to the builder's own test.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  scenario,
  STUB_INDENTED_COMMENT,
  STUB_NESTED_CALL,
  STUB_NEWCLI,
  STUB_UNCLASSIFIABLE,
} from "./lib/governance-core-paths-fixtures.ts";

const BUILT = { ".newcli/skills/demo/SKILL.md": "built output" };
const NAMED = "- .newcli/skills";

describe("core-paths reverse direction (built output to manifest)", () => {
  test("case-e: a built-output directory absent from the manifest fails, named", () => {
    const r = scenario(STUB_NEWCLI, "real.txt\tstrict\n", BUILT);
    assert.equal(r.status, 1, r.stderr);
    assert.ok(r.stderr.includes(NAMED), r.stderr);
  });

  test("case-f: the same tree passes once the manifest lists it", () => {
    const r = scenario(STUB_NEWCLI, "real.txt\tstrict\n.newcli/skills\tstrict\n", BUILT);
    assert.equal(r.status, 0, r.stderr);
  });

  test("case-g: an unclassifiable query fails closed, naming the build script", () => {
    const r = scenario(STUB_UNCLASSIFIABLE, "real.txt\tstrict\n");
    assert.notEqual(r.status, 0);
    assert.ok(r.stderr.includes("build-components.sh"), r.stderr);
  });

  test("case-h: an excluded built-output directory is not a guarantee", () => {
    const r = scenario(
      STUB_NEWCLI,
      "real.txt\tstrict\n.newcli\tstrict\n.newcli/skills\texcluded\n",
      BUILT,
    );
    assert.equal(r.status, 1, r.stderr);
    assert.ok(r.stderr.includes(NAMED), r.stderr);
  });

  test("case-j: a directory listed by a nested-call builder is still derived", () => {
    const r = scenario(STUB_NESTED_CALL, "real.txt\tstrict\n", BUILT);
    assert.equal(r.status, 1, r.stderr);
    assert.ok(r.stderr.includes(NAMED), r.stderr);
  });

  test("case-k: an excluded ancestor does not disqualify a governed child", () => {
    const r = scenario(
      STUB_NEWCLI,
      "real.txt\tstrict\n.newcli\texcluded\n.newcli/skills\tstrict\n",
      BUILT,
    );
    assert.equal(r.status, 0, r.stderr);
  });

  test("case-l: a builder with comments naming a helper still exits 1, not 2", () => {
    const r = scenario(STUB_INDENTED_COMMENT, "real.txt\tstrict\n", BUILT);
    assert.equal(r.status, 1, r.stderr);
    assert.ok(r.stderr.includes(NAMED), r.stderr);
  });

  test("case-m: a regenerable entry passes the reverse direction", () => {
    const r = scenario(STUB_NEWCLI, "real.txt\tstrict\n.newcli/skills\tregenerable\n", BUILT);
    assert.equal(r.status, 0, r.stderr);
  });
});
