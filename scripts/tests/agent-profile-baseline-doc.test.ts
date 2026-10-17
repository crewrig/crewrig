// Replaces scripts/tests/test-agent-profile-migration.sh (part): group T7(e), the published
// R3 table of docs/agent-profile-migration.md checked against the 22-row baseline.
// The baseline is authoritative in this file (Decision 9): the document is checked AGAINST
// it, never parsed as the baseline. Reads the working tree; writes nothing.

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";

const MARKER = "<!-- crewrig-table: agent-profile-baseline -->";

const BASELINE = new Map<string, string>(
  `accessibility-auditor medium
accessibility-tester medium
architect xhigh
astro-developer high
ci-configurator high
ci-debugger high
ci-parity high
copywriter medium
designer high
developer high
doc-writer medium
frontend-developer high
pr-logbook medium
pr-reviewer high
regression-sentinel medium
scenario-author medium
security high
seo-specialist medium
spec-author high
tester high
visual-regression-tester medium
web-conformity-checker medium`
    .split("\n")
    .map((l) => l.split(" ") as [string, string]),
);

// Block after the marker: the header row and the separator row are skipped, every
// following "|" line is a data row, the first non-row line ends the block.
function publishedRows(text: string): string[] {
  const rows: string[] = [];
  let state = 0;
  for (const line of text.split("\n")) {
    if (state === 0) {
      if (line.includes(MARKER)) state = 1;
    } else if (state === 1) {
      if (line.startsWith("|")) state = 2;
    } else if (state === 2) {
      if (line.startsWith("|---")) state = 3;
    } else if (line.startsWith("|")) rows.push(line);
    else break;
  }
  return rows;
}

const strip = (s: string): string => s.replace(/[ `]/g, "");

describe("T7(e) — the published R3 table agrees with the baseline", () => {
  const rows = publishedRows(fs.readFileSync(`${REPO}/docs/agent-profile-migration.md`, "utf8"));
  const parsed = rows.map((r) => {
    const cells = r.split("|");
    return { name: strip(cells[1] ?? ""), rung: strip(cells[3] ?? "") };
  });

  test("T7(e) — exactly 23 rows parsed from docs/agent-profile-migration.md's baseline table", () => {
    assert.equal(rows.length, 23, rows.join("\n"));
  });

  test("T7(e) — the 22 rung-bearing rows agree with the baseline, and harness-curator's row declares no rung", () => {
    const curator = parsed.filter((p) => p.name === "harness-curator");
    assert.equal(curator.length, 1, "the published table carries a harness-curator row");
    assert.equal(curator[0]?.rung, "*(none)*", "harness-curator's published row declares no rung");
    const seen = new Set<string>();
    for (const { name, rung } of parsed) {
      if (name === "harness-curator") continue;
      const expected = BASELINE.get(name);
      assert.notEqual(
        expected,
        undefined,
        `${name} is present in the published table and the baseline`,
      );
      assert.equal(rung, expected, `${name}'s published rung agrees with the baseline`);
      seen.add(name);
    }
    assert.deepEqual([...seen].sort(), [...BASELINE.keys()].sort());
  });
});
