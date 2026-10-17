// governance-manifest-version-cases.test.ts — Replaces scripts/tests/test-check-extension-manifest-version.sh
// (cases 1, 2b; cases 2, 3, 4 stay in governance-check-extension-manifest-version.test.ts).
// Spec 0265 (row J2): black-box on scripts/check-extension-manifest-version.ts in a temp tree.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { makeSandbox, REPO, runEntry } from "./lib/governance-sandbox.ts";

const ENTRY = path.join(REPO, "scripts", "check-extension-manifest-version.ts");

/** extensions/core/hello with a package.json and the given sibling versions. */
function build(pkg: string, ext: string, gemini: string): string {
  const root = makeSandbox("manifest-version-");
  const dir = path.join(root, "extensions", "core", "hello");
  fs.mkdirSync(dir, { recursive: true });
  const write = (file: string, version: string): void =>
    fs.writeFileSync(path.join(dir, file), `{"name":"hello","version":"${version}"}\n`);
  write("package.json", pkg);
  write("extension.json", ext);
  write("gemini-extension.json", gemini);
  return root;
}

describe("check-extension-manifest-version.ts cases", () => {
  test("Case 1 — package.json and extension.json agree", () => {
    const r = runEntry(ENTRY, { cwd: build("0.1.0", "0.1.0", "0.1.0") });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });

  // Pins a full-string compare: the first character (0) is shared, so a prefix-only comparison
  // would pass this divergence (Bash Case 2).
  test("Case 2 — divergent extension.json (0.1.0 vs 0.2.0) fails and names the extension", () => {
    const r = runEntry(ENTRY, { cwd: build("0.1.0", "0.2.0", "0.1.0") });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /extension\.json/);
  });

  // The arm is gone (0044 delta-01 R8): a divergent gemini-extension.json is no longer this
  // guard's concern. The catching check is scripts/tests/extension-check.test.ts (VERSION-DRIFT
  // on the same fixture), which is what makes this exit-0 safe rather than silent.
  test("Case 2b — divergent gemini-extension.json no longer fails this guard", () => {
    const r = runEntry(ENTRY, { cwd: build("0.1.0", "0.1.0", "0.2.0") });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  });
});
