// seat-ledger.test.ts — proves the ledger reconstruction equals a full read of the verdicts
// for each fixture ticket (spec 0275 R-F1, R-F2). Fixtures: fixtures/seat-ledger/<case>/
//   ledger.txt (optional), verdict-<n>.txt, dispositions.json (optional), expected.json.

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  LedgerError,
  compareIds,
  earlierRevision,
  formatLedger,
  parseLedger,
  parseVerdict,
  rebuildFromVerdicts,
  reconstructFromLedger,
  resolveSeat,
  type Disposition,
} from "../lib/seat-ledger.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "seat-ledger");

interface Expected {
  state: string;
  examined: string | null;
  mismatches: string[];
  findings: [string, string, boolean, string][];
  parseError?: string;
  seat?: string;
}

function load(name: string) {
  const dir = path.join(ROOT, name);
  const read = (f: string) => readFileSync(path.join(dir, f), "utf8");
  const verdicts = readdirSync(dir)
    .filter((f) => /^verdict-\d+\.txt$/.test(f))
    .sort()
    .map((f) => parseVerdict(read(f)));
  return {
    ledgerText: existsSync(path.join(dir, "ledger.txt")) ? read("ledger.txt") : null,
    verdicts,
    dispositions: (existsSync(path.join(dir, "dispositions.json"))
      ? JSON.parse(read("dispositions.json"))
      : []) as Disposition[],
    expected: JSON.parse(read("expected.json")) as Expected,
  };
}

const tuple = (f: { id: string; class: string; blocking: boolean; status: string }) => [
  f.id,
  f.class,
  f.blocking,
  f.status,
];

const cases = readdirSync(ROOT).sort();

describe("seat-ledger fixtures", () => {
  it("covers the R-F2 cases", () => {
    for (const c of [
      "nominal-multipass",
      "malformed-line",
      "duplicate-id",
      "voided-pass",
      "missing-ledger-with-verdicts",
      "missing-ledger-no-verdicts",
      "mismatch-verdicts-win",
      "wrong-examined",
      "id-scheme-specs",
      "id-scheme-review",
      "rebuild-all-open",
    ])
      assert.ok(cases.includes(c), `fixture ${c}`);
  });

  for (const name of cases) {
    it(`resolves ${name}`, () => {
      const f = load(name);
      const r = resolveSeat({ ...f, seat: f.expected.seat });
      assert.equal(r.state, f.expected.state);
      assert.equal(r.examined, f.expected.examined);
      assert.deepEqual(
        r.mismatches.map((m) => m.kind),
        f.expected.mismatches,
      );
      assert.deepEqual(r.findings.map(tuple), f.expected.findings);
    });
  }

  // R-F2: for a consistent ledger, ledger-only reconstruction equals the full verdict read.
  for (const name of cases.filter((c) => load(c).expected.state === "ledger")) {
    it(`ledger reconstruction equals the verdict read: ${name}`, () => {
      const f = load(name);
      const verdicts = f.verdicts.filter((v) => !f.expected.seat || v.seat === f.expected.seat);
      const fromLedger = reconstructFromLedger(f.ledgerText as string).map(tuple);
      const fromVerdicts = rebuildFromVerdicts(verdicts, f.dispositions).map(tuple);
      assert.deepEqual(fromLedger, fromVerdicts);
    });
  }

  // R-F2: rebuilding from verdicts (no ledger) yields every finding open, plus given dispositions.
  it("a rebuild yields status open unless a disposition is given", () => {
    const f = load("missing-ledger-with-verdicts");
    const none = rebuildFromVerdicts(f.verdicts);
    assert.ok(none.every((x) => x.status === "open"));
    const some = rebuildFromVerdicts(f.verdicts, f.dispositions);
    assert.equal(some.find((x) => x.id === "v1-F1")?.status, "addressed");
  });

  it("rejects malformed and duplicate ledgers with a located error", () => {
    for (const name of ["malformed-line", "duplicate-id"]) {
      const f = load(name);
      assert.throws(
        () => parseLedger(f.ledgerText as string),
        (e: unknown) =>
          e instanceof LedgerError && e.message.includes(f.expected.parseError as string),
      );
    }
  });

  it("a voided pass is absent from the rebuild", () => {
    const f = load("voided-pass");
    assert.deepEqual(
      rebuildFromVerdicts(f.verdicts).map((x) => x.id),
      ["v1-F1"],
    );
  });
});

describe("seat-ledger parser", () => {
  const head = "ledger: plan/9\nexamined: v1\nrev: 1\n";
  it("rejects each malformed shape", () => {
    const bad = [
      "examined: v1\nrev: 1\n",
      "ledger: nope/9\nexamined: v1\nrev: 1\n",
      "ledger: plan/9\nrev: 1\n",
      "ledger: plan/9\nexamined: v1\nrev: x\n",
      `${head}- v1-F1 | tech | yes | open | v1\n`,
      `${head}- v1-F1 | tech | maybe | open | v1 | -\n`,
      `${head}- v1-F1 | bug | yes | open | v1 | -\n`,
      `${head}- v1-F1 | tech | yes | done | v1 | -\n`,
      `${head}- v1-F1 | tech | yes | open | v1 | a | b\n`,
      `${head}- s1-F1 | tech | yes | open | v1 | -\n`,
      `${head}free text\n`,
    ];
    for (const b of bad) assert.throws(() => parseLedger(b), LedgerError, b);
  });

  it("round-trips through formatLedger", () => {
    const text = `${head}- v1-F1 | tech | yes | open | v1 | -\n- v1-F2a | arch | no | ledger | v1 | #961-3\n`;
    assert.equal(formatLedger(parseLedger(text)), text);
  });

  it("orders ids numerically and compares revisions", () => {
    assert.ok(compareIds("v1-F2", "v1-F10") < 0);
    assert.ok(compareIds("v2-F1", "v10-F1") < 0);
    assert.equal(earlierRevision("v3", "v2"), "v2");
    assert.equal(earlierRevision("abc", "def", ["abc", "def"]), "abc");
    assert.throws(() => earlierRevision("abc", "def"), LedgerError);
  });

  it("rejects a verdict finding without class and a verdict without a seat line", () => {
    assert.throws(
      () => parseVerdict("seat: plan/9\n\n**Finding 1 (v1-F1)**\n\nbody\n"),
      LedgerError,
    );
    assert.throws(() => parseVerdict("no seat here\n"), LedgerError);
  });
});
