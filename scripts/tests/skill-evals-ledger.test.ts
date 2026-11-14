// skill-evals-ledger.test.ts — the ledger of earlier measurements and the history it is rebuilt from
// (spec 0304 R8(e), R10, R22(c), R25): entries, spend counting with assumed costs, the union of the
// working-tree file, the merge-base copy and every committed revision of the range, and the
// anti-gaming cases (restore then edit, committed restore then edit). Temporary git repositories.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  branchEntries,
  branchSpendOf,
  entryId,
  entryOfRecord,
  entrySpend,
  ledgerProblem,
  mergeBaseSet,
  readHistory,
  spendOf,
  unionEntries,
  v2Docs,
} from "../lib/skill-evals/ledger.ts";
import { decideStart } from "../lib/skill-evals/measure.ts";
import { commitAll } from "./lib/skill-evals-fixtures.ts";
import {
  allPass,
  buildRecord,
  entryOf,
  ledgerEntry,
  recompute,
  stagedRuns,
  writeRaw,
  writeRecord,
} from "./lib/skill-evals-record.ts";
import { sixRig, startInput } from "./lib/skill-evals-six.ts";

const H = (n: number) => `sha256:${String(n).repeat(64)}`.slice(0, 71);
const ids = (es: { content_hash: string }[]) => es.map((e) => e.content_hash);

test("an entry carries the R10 keys, an unfinished measurement is abandoned, and no cost means cost_assumed", () => {
  const r = sixRig({ edit: false });
  try {
    const rec = buildRecord(r.sel(), { evalRuns: allPass(6, 2), costUsd: null });
    const e = entryOfRecord(rec);
    assert.deepEqual(Object.keys(e), [
      "content_hash",
      "ticket",
      "declared_at",
      "status",
      "eval_pass_rate",
      "probe_pass_rate",
      "executor_runs",
      "judge_calls",
      "cost_usd",
      "judge_cost_usd",
      "cost_assumed",
    ]);
    assert.equal(e.cost_assumed, true, "no run reported a cost");
    assert.equal(entryOfRecord({ ...rec, status: "in-progress" }).status, "abandoned");
    assert.equal(entryOfRecord(buildRecord(r.sel(), { costUsd: 0.1 })).cost_assumed, false);
    assert.equal(entryId(e), `${rec.content_hash}|${rec.ticket}|${rec.declared_at}`);
  } finally {
    r.cleanup();
  }
});

test("R10 spend: an unknown cost counts at the assumed figures, deliberately conservative", () => {
  // 32 runs of an assumed measurement: 3.2 USD; a damaged entry of 10 runs without the assumption: 10 USD
  assert.equal(
    entrySpend(
      ledgerEntry({ cost_usd: null, cost_assumed: true, executor_runs: 32, judge_cost_usd: 0 }),
    ),
    3.2,
  );
  assert.equal(
    entrySpend(
      ledgerEntry({ cost_usd: null, cost_assumed: false, executor_runs: 10, judge_cost_usd: 0 }),
    ),
    10,
  );
  // a judge cost of null counts judge_calls x 0.03
  assert.ok(
    Math.abs(
      entrySpend(ledgerEntry({ cost_usd: 1, judge_cost_usd: null, judge_calls: 10 })) - 1.3,
    ) < 1e-9,
  );
  assert.equal(entrySpend(ledgerEntry({ cost_usd: 1.6, judge_cost_usd: 0.4 })), 2);
  assert.equal(
    spendOf([
      ledgerEntry({ cost_usd: 1, judge_cost_usd: 0 }),
      ledgerEntry({ cost_usd: 2, judge_cost_usd: 0 }),
    ]),
    3,
  );
});

test("the union is by identity, chronological, a final status beats abandoned, and the resumed identity is excluded", () => {
  const a = { content_hash: H(1), ticket: "9", declared_at: "2026-01-02T00:00:00.000Z" };
  const mk = (over: Record<string, unknown>) => ({ ledger: [], status: "fail", ...a, ...over });
  const docs = [
    {
      ...mk({
        status: "in-progress",
        ledger: [ledgerEntry({ content_hash: H(5), declared_at: "2025-12-01T00:00:00.000Z" })],
      }),
      executor_runs: 3,
      judge_calls: 1,
      evals: [],
    },
    { ...mk({}), executor_runs: 12, judge_calls: 12, evals: [] },
  ];
  const u = unionEntries(docs);
  assert.deepEqual(ids(u), [H(5), H(1)], "the older ledger entry first");
  assert.equal(u.find((e) => e.content_hash === H(1))?.status, "fail", "final wins over abandoned");
  assert.deepEqual(
    ids(unionEntries(docs, entryId(a))),
    [H(5)],
    "exclude drops the measurement being resumed",
  );
});

/** A repo with the merge-base file, then a committed measurement of H1 (fail, 1.6 USD) on the branch. */
function branchWithH1() {
  const r = sixRig({ base: { evalRuns: allPass(6, 4) }, edit: false });
  const baseText = fs.readFileSync(path.join(r.dir, "evals", "results.json"), "utf8");
  const mb = r.repo.git("rev-parse", "HEAD").trim();
  fs.appendFileSync(path.join(r.dir, "SKILL.md"), "first edit\n");
  const h1 = {
    ...recompute(
      r.head({ evalRuns: stagedRuns(6, [2], [6]), declaredAt: "2026-02-01T00:00:00.000Z" }),
      r.sel(),
    ),
    cost_usd: 1.6,
    judge_cost_usd: 0,
  };
  writeRecord(r.dir, h1);
  commitAll(r.repo, "measure H1");
  return { r, baseText, mb, h1 };
}

test("readHistory reads the merge-base copy and every revision committed in the range, a deletion hiding nothing", () => {
  const { r, baseText, h1 } = branchWithH1();
  try {
    fs.rmSync(path.join(r.dir, "evals", "results.json"));
    commitAll(r.repo, "delete the file");
    const hist = readHistory(r.repo.root, r.sel().mergeBase, r.sel().skill.dirRel);
    assert.equal(hist.mbText, baseText);
    assert.equal(hist.revisions.length, 1, "the deletion commit contributes nothing");
    assert.equal(
      (JSON.parse(hist.revisions[0]!) as { content_hash: string }).content_hash,
      h1.content_hash,
    );
    assert.equal(readHistory(r.repo.root, undefined, "x").revisions.length, 0);
  } finally {
    r.cleanup();
  }
});

test("restore then edit: the working file is the base copy, yet H1 enters the ledger, counts 1.6 USD and a later H1 is refused", () => {
  const { r, mb } = branchWithH1();
  try {
    r.repo.git("checkout", mb, "--", `${r.sel().skill.dirRel}/evals/results.json`);
    fs.appendFileSync(path.join(r.dir, "SKILL.md"), "second edit gives hash H2\n");
    const start = decideStart(startInput(r, { contentHash: H(2) }));
    assert.equal(start.kind, "new");
    if (start.kind !== "new") return;
    assert.ok(ids(start.record.ledger).includes(h1Hash(r)), "the H1 entry is in the new ledger");
    assert.equal(start.branchCount, 2, "H1 and the new measurement are the branch entries");
    assert.ok(
      Math.abs(start.branchSpend - 1.6) < 1e-9,
      `the per-skill cap counts the 1.6 USD (${start.branchSpend})`,
    );
    assert.ok(
      start.record.ledger.some((e) => e.status === "pass" || e.status === "fail"),
      "the merge-base entry is kept too",
    );
    const again = decideStart(startInput(r, { contentHash: h1Hash(r) }));
    assert.equal(again.kind, "refuse");
    if (again.kind === "refuse")
      assert.equal(again.message, `content already measured: ${h1Hash(r)}`);
  } finally {
    r.cleanup();
  }
});

const h1Hash = (r: ReturnType<typeof sixRig>) => {
  const sel = r.sel();
  const hist = readHistory(r.repo.root, sel.mergeBase, sel.skill.dirRel);
  const docs = hist.revisions.map((t) => JSON.parse(t) as { content_hash: string; status: string });
  return docs.find((d) => d.status === "fail")!.content_hash;
};

test("committed restore then edit: HEAD no longer holds H1 but an earlier commit does, so H1 is still counted and refused", () => {
  const { r, mb } = branchWithH1();
  try {
    r.repo.git("checkout", mb, "--", `${r.sel().skill.dirRel}/evals/results.json`);
    commitAll(r.repo, "restore the base file");
    fs.appendFileSync(path.join(r.dir, "SKILL.md"), "second edit gives hash H2\n");
    const sel = r.sel();
    const hist = readHistory(r.repo.root, sel.mergeBase, sel.skill.dirRel);
    assert.equal(hist.revisions.length, 2, "the restore and the measurement are both in the range");
    const start = decideStart(startInput(r, { contentHash: H(2) }));
    assert.equal(start.kind, "new");
    if (start.kind === "new") {
      assert.ok(ids(start.record.ledger).includes(h1Hash(r)));
      assert.ok(Math.abs(start.branchSpend - 1.6) < 1e-9);
    }
    assert.equal(decideStart(startInput(r, { contentHash: h1Hash(r) })).kind, "refuse");
    assert.ok(
      Math.abs(
        branchSpendOf(fs.readFileSync(path.join(r.dir, "evals", "results.json"), "utf8"), hist) -
          1.6,
      ) < 1e-9,
    );
  } finally {
    r.cleanup();
  }
});

test("the check reaches H1 through the history: a head file that lacks it is invalid naming it, and a complete head is accepted", () => {
  const { r, mb } = branchWithH1();
  try {
    r.repo.git("checkout", mb, "--", `${r.sel().skill.dirRel}/evals/results.json`);
    commitAll(r.repo, "restore the base file");
    fs.appendFileSync(path.join(r.dir, "SKILL.md"), "second edit\n");
    const sel = r.sel();
    const hist = readHistory(r.repo.root, sel.mergeBase, sel.skill.dirRel);
    const lacking = { ...r.head({ declaredAt: "2026-03-01T00:00:00.000Z" }), content_hash: H(2) };
    const msg = ledgerProblem(JSON.parse(JSON.stringify(lacking)) as Record<string, unknown>, hist);
    assert.match(msg ?? "", new RegExp(`lacks the entry ${h1Hash(r)}`));
    assert.match(msg ?? "", /a committed revision/);
    const start = decideStart(startInput(r, { contentHash: H(2) }));
    if (start.kind !== "new") throw new Error("expected a new measurement");
    const complete = { ...start.record, status: "pass" as const };
    assert.equal(
      ledgerProblem(JSON.parse(JSON.stringify(complete)) as Record<string, unknown>, hist),
      undefined,
    );
  } finally {
    r.cleanup();
  }
});

test("a head that drops a merge-base entry is invalid naming the first missing one", () => {
  const r = sixRig({ base: { evalRuns: allPass(6, 4) } });
  try {
    const sel = r.sel();
    const hist = readHistory(r.repo.root, sel.mergeBase, sel.skill.dirRel);
    const noLedger = JSON.parse(
      JSON.stringify(buildRecord(sel, { declaredAt: "2026-02-01T00:00:00.000Z", ledger: [] })),
    ) as Record<string, unknown>;
    const msg = ledgerProblem(noLedger, hist) ?? "";
    assert.match(
      msg,
      /the file lacks the entry sha256:[0-9a-f]{64} \(ticket 1958, declared 2026-01-01T00:00:00\.000Z\) of the merge-base file/,
    );
    const withMb = JSON.parse(JSON.stringify(r.head())) as Record<string, unknown>;
    assert.equal(ledgerProblem(withMb, hist), undefined);
    // restoring the merge-base file itself is also detected: it is an entry-for-entry copy, with no new own measurement
    assert.equal(
      ledgerProblem(
        JSON.parse(fs.readFileSync(path.join(r.dir, "evals", "results.json"), "utf8")) as Record<
          string,
          unknown
        >,
        hist,
      ),
      undefined,
    );
  } finally {
    r.cleanup();
  }
});

test("a head that records less spend than the merge-base set is invalid", () => {
  const r = sixRig({ base: { evalRuns: allPass(6, 4), costUsd: 0.5 } });
  try {
    const sel = r.sel();
    const hist = readHistory(r.repo.root, sel.mergeBase, sel.skill.dirRel);
    const head = r.head();
    const cheaper = {
      ...head,
      ledger: head.ledger.map((e) => ({ ...e, cost_usd: 0, judge_cost_usd: 0 })),
    };
    const msg =
      ledgerProblem(JSON.parse(JSON.stringify(cheaper)) as Record<string, unknown>, hist) ?? "";
    assert.match(msg, /records [\d.]+ USD, less than the [\d.]+ USD of the merge-base file/);
  } finally {
    r.cleanup();
  }
});

test("the merge-base set and the branch entries: a schema-1 or absent merge-base file gives none", () => {
  const withMb = sixRig({ base: { evalRuns: allPass(6, 4) } });
  const legacy = sixRig({
    base: { raw: { skill_name: "demo", status: "pass", evals_passed: 6, evals_total: 6 } },
  });
  const absent = sixRig();
  try {
    const hist = (x: typeof withMb) =>
      readHistory(x.repo.root, x.sel().mergeBase, x.sel().skill.dirRel);
    assert.equal(mergeBaseSet(hist(withMb)).length, 1);
    assert.equal(mergeBaseSet(hist(legacy)).length, 0);
    assert.equal(mergeBaseSet(hist(absent)).length, 0);
    const all = unionEntries(
      v2Docs([fs.readFileSync(path.join(withMb.dir, "evals", "results.json"), "utf8")]),
    );
    assert.equal(
      branchEntries(all, mergeBaseSet(hist(withMb))).length,
      0,
      "an unchanged file adds no branch entry",
    );
    assert.equal(branchSpendOf(undefined, hist(absent)), 0);
    writeRaw(absent.dir, "{broken");
    assert.equal(
      branchSpendOf("{broken", hist(absent)),
      0,
      "an unparseable file contributes nothing",
    );
    assert.equal(entryOf(buildRecord(withMb.sel())).status, "pass");
  } finally {
    withMb.cleanup();
    legacy.cleanup();
    absent.cleanup();
  }
});
