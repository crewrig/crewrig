// provenance-carrying.test.ts — spec 0053 delta-01 R26: frontmatter-scoped provenance check.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import { isProvenanceCarrying, isProvenanceCarryingText } from "../lib/provenance-carrying.ts";

const prov = [
  "metadata:",
  "  provenance:",
  '    canonical: "https://example.test/o/r"',
  '    version: "1.0"',
];
const doc = (fm: string[], body = "Body.\n"): string => `---\n${fm.join("\n")}\n---\n${body}`;

describe("isProvenanceCarryingText", () => {
  test("accepts metadata.provenance.canonical in the frontmatter", () => {
    assert.equal(isProvenanceCarryingText(doc(["name: a", ...prov])), true);
  });
  test("rejects a body that only mentions provenance", () => {
    const body = "metadata:\n  provenance:\n    canonical: \"x\"\n";
    assert.equal(isProvenanceCarryingText(doc(["name: a"], body)), false);
  });
  test("rejects provenance without a canonical value", () => {
    assert.equal(
      isProvenanceCarryingText(doc(["name: a", "metadata:", "  provenance:", '    version: "1"'])),
      false,
    );
    assert.equal(
      isProvenanceCarryingText(doc(["name: a", "metadata:", "  provenance:", '    canonical: ""'])),
      false,
    );
  });
  test("rejects provenance that is not under a top-level metadata mapping", () => {
    assert.equal(
      isProvenanceCarryingText(doc(["name: a", "other:", "  provenance:", "    canonical: x"])),
      false,
    );
    assert.equal(
      isProvenanceCarryingText(doc(["name: a", "provenance:", "  canonical: x"])),
      false,
    );
  });
  test("rejects a file with no leading frontmatter fence", () => {
    assert.equal(isProvenanceCarryingText(`\n${doc(["name: a", ...prov])}`), false);
  });
});

describe("isProvenanceCarrying", () => {
  test("reads a file; an unreadable path is false", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prov-carry-"));
    try {
      const file = path.join(dir, "a.md");
      fs.writeFileSync(file, doc(["name: a", ...prov]));
      assert.equal(isProvenanceCarrying(file), true);
      assert.equal(isProvenanceCarrying(path.join(dir, "missing.md")), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
