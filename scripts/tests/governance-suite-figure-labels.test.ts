// governance-suite-figure-labels.test.ts — Replaces scripts/tests/test-check-figure-labels.sh
// (case-1: the check passes on the repository figures). Runs the TypeScript entry directly, with
// the PATH as given: the result depends on the host's `tesseract` by design (real OCR when
// installed, the [SKIP] note otherwise); no sentinel for its presence. A second test carries the
// skip leg through an empty PATH directory, so the Linux glob also covers it (the sibling
// windows-governance-figure-labels file only runs on the Windows job).

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { makeSandbox, REPO, runEntry } from "./lib/governance-sandbox.ts";

const ENTRY = path.join(REPO, "scripts", "check-figure-labels.ts");
const SKIP_LINE = "[SKIP] tesseract is not installed. Skipping figure label OCR check.\n";

describe("check-figure-labels on the repository", () => {
  it("case-1: check-figure-labels passes on repository figures", () => {
    const res = runEntry(ENTRY);
    const shown = `${res.stdout}${res.stderr}`;
    assert.equal(res.status, 0, `expected exit 0, got ${res.status}\noutput: ${shown}`);
    assert.ok(!res.stdout.includes("[FAIL]"), `unexpected [FAIL] verdict\noutput: ${shown}`);
  });

  it("case-2: skips with the note and exit 0 when tesseract is absent from PATH", () => {
    const res = runEntry(ENTRY, { env: { PATH: makeSandbox("governance-nopath-") } });
    assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    assert.equal(res.stdout, SKIP_LINE);
    assert.equal(res.stderr, "");
  });
});
