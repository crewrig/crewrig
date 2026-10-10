// setup-prompt-inventory.test.ts — the static half of the prompt inventory (spec 0256 requirement
// 12, plan v2 step A8): the R12 table (lib/setup-prompt-inventory-r12.ts) row by row against the
// committed `fixtures/setup-golden/prompt-inventory.json.golden` that the original shell setups were
// observed to produce (id, options, setups, cancel class, condition), with no golden row outside the
// table but the one-key `link-confirm`. The shell no longer holds logic (its scripts forward to the
// TypeScript entries), so nothing is observed any more; setup-prompt-table.test.ts pins the
// TypeScript table against the same golden. Host-runnable, no setup is run.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import { R12 } from "./lib/setup-prompt-inventory-r12.ts";
import type { Cancel, Row } from "./lib/setup-prompt-inventory-r12.ts";

interface GoldenRow {
  readonly id: string;
  readonly options: readonly string[];
  readonly clis: readonly string[];
  readonly condition: string;
  readonly cancel: Readonly<Record<string, string>>;
}

const GOLDEN = path.join(REPO, "scripts/tests/fixtures/setup-golden/prompt-inventory.json.golden");
const golden = (): GoldenRow[] => {
  const raw: unknown = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
  assert.ok(Array.isArray(raw), "the golden is an array of rows");
  return raw as GoldenRow[];
};

const cancelOf = (r: Row, cli: string): Cancel | undefined =>
  typeof r.cancel === "string" ? r.cancel : r.cancel[cli as keyof typeof r.cancel];

describe("setup prompt inventory: the R12 table against the recorded golden", () => {
  const rows = golden();

  test("no golden row outside the table, but the one-key link-confirm", () => {
    const known = new Set([...R12.map((r) => r.id), "link-confirm"]);
    assert.deepEqual(
      rows.map((r) => r.id).filter((id) => !known.has(id)),
      [],
    );
  });

  for (const r of R12) {
    test(`${r.id}: options, setups, cancel class and condition`, () => {
      const g = rows.find((x) => x.id === r.id);
      assert.ok(g !== undefined, `${r.id} is missing from the golden`);
      assert.deepEqual(g.options, r.options, `${r.id} options`);
      assert.deepEqual([...g.clis].sort(), [...r.clis].sort(), `${r.id} setups`);
      assert.equal(g.condition, r.when, `${r.id} condition`);
      for (const cli of r.clis) assert.equal(g.cancel[cli], cancelOf(r, cli), `${cli}/${r.id}`);
    });
  }
});
