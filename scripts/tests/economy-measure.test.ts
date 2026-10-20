// economy-measure.test.ts — the economy measure of spec 0275 R-H2, on the committed manifest of
// the real #1410 comment set. The floor assertion is the signal: if the measured saving misses
// MIN_SAVING, this test fails and the figure is reported; the transform is never tuned to pass
// and the floor is never lowered without a spec delta.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { snapshot, type Manifest } from "../economy-snapshot.ts";
import { COMMENT_BUDGET, MIN_SAVING, measure } from "../lib/economy-transform.ts";

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "economy-1410",
  "manifest.json",
);
const manifest = JSON.parse(readFileSync(FIXTURE, "utf8")) as Manifest;

describe("economy measure (#1410 fixture)", () => {
  it("reads the real comment set: 41 comments, real byte sizes", () => {
    assert.equal(manifest.comments.length, 41);
    const m = measure(manifest);
    assert.equal(m.old.comments, 41);
    assert.equal(
      m.old.postedBytes,
      manifest.comments.reduce((a, c) => a + c.bytes, 0),
    );
  });

  it("is deterministic", () => {
    assert.deepEqual(measure(manifest), measure(structuredClone(manifest)));
  });

  it("snapshot is a pure function of the comment bodies", () => {
    const raw = [
      { id: 1, body: "## Logbook — a\n\nx\n" },
      { id: 2, body: "## PLAN — issue #1\n\n### Approach\n\nA\n\n### Finding traceability\n\nT\n" },
    ];
    assert.deepEqual(snapshot("s", raw), snapshot("s", structuredClone(raw)));
    assert.equal(snapshot("s", raw).comments[1]?.planVersion, 1);
    assert.equal(snapshot("s", raw).comments[1]?.sections.length, 3);
  });

  it("merges logbook comments by stage and keeps verdict content (uncapped) untouched", () => {
    const m = measure(manifest);
    assert.ok(m.new.byKind.logbook.comments <= 5);
    assert.equal(m.uncapped.byKind.verdict.bytes, m.old.byKind.verdict.bytes);
    assert.equal(m.new.byKind.ledger.comments, 1);
  });

  it("applies the 12288-byte cap and discloses relocated and uncapped figures", () => {
    const m = measure(manifest);
    assert.ok(m.cappedComments > 0 && m.relocatedBytes > 0);
    assert.ok(m.new.byKind.plan.bytes < m.uncapped.byKind.plan.bytes);
    assert.ok(m.new.totalBytes < m.uncapped.totalBytes);
    for (const k of ["plan", "verdict"] as const)
      assert.ok(m.new.byKind[k].bytes <= m.new.byKind[k].comments * COMMENT_BUDGET);
  });

  it(`saves at least ${MIN_SAVING * 100}% of logbook-and-dossier bytes (capped total)`, () => {
    const m = measure(manifest);
    assert.ok(
      m.saving >= MIN_SAVING,
      `saving ${(m.saving * 100).toFixed(1)}% < ${MIN_SAVING * 100}% ` +
        `(old ${m.old.totalBytes} B / ${m.old.comments} comments, new ${m.new.totalBytes} B / ${m.new.comments} comments)`,
    );
  });
});
