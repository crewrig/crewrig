// governance-suite-feedback-routing.test.ts — Replaces scripts/tests/test-check-feedback-routing.sh
// Pins spec 0030: an upstream-owned source MUST declare metadata.provenance.feedback equal to
// metadata.provenance.canonical, compared as RAW unresolved strings (a "${FEEDBACK_REPO}"
// declaration fails although both placeholders resolve to one URL). The placeholders below are
// plain strings, never interpolated. Every tree holds an empty artifacts/core/skills/example dir.
// cwd = the tree root; the entry (and js-yaml) resolve from the repository.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { makeSandbox, REPO, runEntry } from "./lib/governance-sandbox.ts";

const ENTRY = path.join(REPO, "scripts", "check-feedback-routing.ts");
const CANON = "${CANONICAL_REPO}";
const FEED = "${FEEDBACK_REPO}";

function source(kind: "skill" | "command", feedback: string | null): string {
  const prov =
    feedback === null
      ? ""
      : `metadata:\n  provenance:\n    canonical: "${CANON}"\n    feedback: "${feedback}"\n    version: "1.0.0"\n`;
  return `---\nname: example\ndescription: Example ${kind} used as a test fixture.\ntype: ${kind}\n${prov}---\n\n# Example\n\nBody.\n`;
}

function run(files: Record<string, string>) {
  const dir = makeSandbox("feedback-routing-");
  fs.mkdirSync(path.join(dir, "artifacts/core/skills/example"), { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return runEntry(ENTRY, { cwd: dir });
}

const CORE = "artifacts/core/skills/example/SKILL.md";
const COMM = "artifacts/community/skills/adopter/SKILL.md";
const CMD = "artifacts/core/commands/example-cmd.md";
const okLine = (n: number, skipped = 0): string =>
  `OK: ${n} upstream-owned source(s) route feedback to canonical (${skipped} without a feedback declaration skipped).`;

describe("check-feedback-routing", () => {
  it("Case 1 - feedback == canonical passes", () => {
    const r = run({ [CORE]: source("skill", CANON) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes(`  OK   ${CORE}`));
    assert.ok(r.stdout.includes(okLine(1)), r.stdout);
  });

  it("Case 2 - feedback != canonical fails (raw placeholder strings)", () => {
    const r = run({ [CORE]: source("skill", FEED) });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.ok(r.stdout.includes(`  FAIL ${CORE} — feedback '${FEED}' != canonical '${CANON}'`));
  });

  it("Case 3 - source without provenance is a no-op (counted as skipped)", () => {
    const r = run({ [CORE]: source("skill", null) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes(okLine(0, 1)), r.stdout);
  });

  it("Case 4 - adopter-owned tier is exempt", () => {
    const r = run({ [CORE]: source("skill", CANON), [COMM]: source("skill", FEED) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(!r.stdout.includes(COMM));
  });

  it("Case 4 twin - the same divergent file under artifacts/core fails", () => {
    const r = run({
      [CORE]: source("skill", CANON),
      "artifacts/core/skills/adopter/SKILL.md": source("skill", FEED),
    });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.ok(r.stdout.includes("  FAIL artifacts/core/skills/adopter/SKILL.md"));
  });

  it("Case 5 - upstream command feedback == canonical passes (command scanned)", () => {
    const r = run({ [CMD]: source("command", CANON) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(r.stdout.includes(`  OK   ${CMD}`));
    assert.ok(r.stdout.includes(okLine(1)), r.stdout);
  });

  it("Case 6 - upstream command feedback != canonical fails", () => {
    const r = run({ [CMD]: source("command", FEED) });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.ok(r.stdout.includes(`  FAIL ${CMD} — feedback '${FEED}' != canonical '${CANON}'`));
  });
});
