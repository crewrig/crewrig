// skill-evals-measure.test.ts — how a measurement starts: resume, refuse or restart (spec 0304 R8
// (a)-(f), R10, R22 resume rules, R26). `decideStart` is exercised on real files and histories of
// temporary git repositories, then through the runner for the refusals a contributor sees: no model
// call, exit 1, the file byte-identical. Offline.

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { decideStart } from "../lib/skill-evals/measure.ts";
import type { Start } from "../lib/skill-evals/measure.ts";
import { planCopy } from "../lib/skill-evals/results.ts";
import { commitAll, skillRel } from "./lib/skill-evals-fixtures.ts";
import { allPass, buildRecord, ledgerEntry } from "./lib/skill-evals-record.ts";
import { sixRig, startInput } from "./lib/skill-evals-six.ts";
import { judgeFetch, makeRig, plainEvals } from "./lib/skill-evals-run-rig.ts";

type Rig = ReturnType<typeof sixRig>;
const text = (r: Rig, over: Record<string, unknown>, base = {}) =>
  `${JSON.stringify({ ...buildRecord(r.sel(), { evalRuns: [[true]], ...base }), ...over }, null, 2)}\n`;
const kind = (s: Start) => s.kind;
const refusal = (s: Start) => (s.kind === "refuse" ? s.message : "");
const HASH = "sha256:" + "e".repeat(64);

/** One measurement of the rig's skill, with the working file as given. */
function start(r: Rig, workingText: string | undefined, over = {}) {
  return decideStart(startInput(r, { workingText, ...over }));
}

test("(a) the same hash, in-progress, an equal plan and the same ticket is resumed: runs kept, worst case reduced by the recorded cost", () => {
  const r = sixRig({ edit: false });
  try {
    const partial = buildRecord(r.sel(), {
      evalRuns: [[true, true]],
      costUsd: 0.5,
      judgeCostUsd: 0,
    });
    const wt = text(r, { ...partial, status: "in-progress", cost_usd: 3, judge_cost_usd: 0 });
    const s = start(r, wt);
    assert.equal(kind(s), "resume");
    if (s.kind !== "resume") return;
    assert.equal(s.resumed, true);
    assert.equal(s.record.evals[0]?.runs.length, 2, "the recorded runs count");
    assert.equal(s.record.declared_at, partial.declared_at, "the declaration is kept");
    assert.ok(Math.abs(s.worst - 2) < 1e-9, "5 USD minus the 3 USD recorded");
    assert.equal(s.record.ledger.length, 0, "the resumed measurement is not in its own ledger");
  } finally {
    r.cleanup();
  }
});

test("(b) the same hash with a final status is complete: refused with the way forward, for pass, fail and regression", () => {
  const r = sixRig({ edit: false });
  try {
    for (const status of ["pass", "fail", "regression"]) {
      const s = start(r, text(r, { status }));
      assert.equal(kind(s), "refuse", status);
      assert.match(refusal(s), new RegExp(`^measurement complete for ${r.sel().headHash}`), status);
      assert.match(
        refusal(s),
        /change the skill content for a new measurement, or read the recorded status/,
        status,
      );
    }
  } finally {
    r.cleanup();
  }
});

test("(c) the same hash in-progress under another ticket is refused naming both tickets", () => {
  const r = sixRig({ edit: false });
  try {
    const s = start(r, text(r, { status: "in-progress", ticket: "1850" }), { ticket: "1958" });
    assert.equal(kind(s), "refuse");
    assert.match(refusal(s), /ticket 1850/);
    assert.match(refusal(s), /ticket 1958/);
  } finally {
    r.cleanup();
  }
});

test("(d) another hash starts a new measurement; the previous file moves into the ledger, abandoned when unfinished", () => {
  const r = sixRig({ edit: false });
  try {
    const done = text(r, { status: "fail", content_hash: HASH });
    const s = start(r, done);
    assert.equal(kind(s), "new");
    if (s.kind !== "new") return;
    assert.deepEqual(
      s.record.ledger.map((e) => [e.content_hash, e.status]),
      [[HASH, "fail"]],
    );
    assert.equal(s.record.status, "in-progress");
    assert.equal(s.record.declared_at, "2026-03-01T00:00:00.000Z");
    assert.deepEqual(s.record.plan, planCopy());
    assert.equal(s.branchCount, 2);
    const unfinished = start(r, text(r, { status: "in-progress", content_hash: HASH }));
    if (unfinished.kind !== "new") throw new Error("expected new");
    assert.equal(unfinished.record.ledger[0]?.status, "abandoned");
  } finally {
    r.cleanup();
  }
});

test("(d) an in-progress file of the same hash whose plan differs restarts, abandoned, under the current plan", () => {
  const r = sixRig({ edit: false });
  try {
    const old = { ...planCopy(), acceptFinal: 0.8 };
    const s = start(r, text(r, { status: "in-progress", plan: old }));
    assert.equal(kind(s), "new");
    if (s.kind !== "new") return;
    assert.deepEqual(s.record.plan, planCopy());
    assert.equal(s.record.ledger.length, 1);
    assert.equal(s.record.ledger[0]?.status, "abandoned");
    assert.equal(s.record.evals[0]?.runs.length, 0, "no run is carried over");
  } finally {
    r.cleanup();
  }
});

test("(e) no file, an unparseable one, a mock one and a schema-1 one start a new measurement; a schema-1 file never enters the ledger", () => {
  const r = sixRig({ edit: false });
  try {
    const v1 = JSON.stringify({
      skill_name: "demo",
      status: "pass",
      content_hash: "x",
      evals_passed: 2,
      evals_total: 2,
    });
    for (const [title, wt] of [
      ["absent", undefined],
      ["unparseable", "{broken"],
      ["mock", '{"mock":true}'],
      ["schema 1", v1],
    ] as const) {
      const s = start(r, wt);
      assert.equal(kind(s), "new", title);
      if (s.kind === "new") assert.deepEqual(s.record.ledger, [], title);
    }
  } finally {
    r.cleanup();
  }
});

test("(e) a schema-1 file whose content_hash equals the current one starts a new measurement and is not refused as complete (v1-F4)", () => {
  const r = sixRig({ edit: false });
  try {
    const hash = r.sel().headHash;
    const v1 = JSON.stringify({
      skill_name: "demo",
      status: "pass",
      content_hash: hash,
      evals_passed: 6,
      evals_total: 6,
    });
    const s = start(r, v1);
    assert.equal(kind(s), "new", refusal(s));
    if (s.kind === "new") {
      assert.deepEqual(s.record.ledger, [], "the legacy file is not carried into the ledger");
      assert.equal(s.record.content_hash, hash);
    }
  } finally {
    r.cleanup();
  }
});

test("(f) a hash with a final entry anywhere in the union is a reroll: refused whatever the ticket, no flag allows it", () => {
  const r = sixRig({ edit: false });
  try {
    const hash = r.sel().headHash as string;
    const ledgerOf = (status: string) => [ledgerEntry({ content_hash: hash, ticket: "1", status })];
    for (const status of ["pass", "fail", "regression"]) {
      const wt = text(r, { status: "fail", content_hash: HASH, ledger: ledgerOf(status) });
      for (const ticket of ["1958", "1", "424242"]) {
        const s = start(r, wt, { ticket });
        assert.equal(kind(s), "refuse", `${status} ${ticket}`);
        assert.equal(refusal(s), `content already measured: ${hash}`);
      }
    }
    const abandoned = start(
      r,
      text(r, { status: "fail", content_hash: HASH, ledger: ledgerOf("abandoned") }),
    );
    assert.equal(kind(abandoned), "new", "an abandoned entry does not block its hash");
  } finally {
    r.cleanup();
  }
});

test("(f) the entry that blocks may sit in the merge-base copy or in a committed revision, not only in the working file", () => {
  const r = sixRig({ base: { evalRuns: allPass(6, 4) }, edit: false });
  try {
    // the merge-base file measured the current content (identical tree): measuring it again is a reroll
    const s = start(r, undefined);
    assert.equal(kind(s), "refuse");
    assert.equal(refusal(s), `content already measured: ${r.sel().headHash}`);
  } finally {
    r.cleanup();
  }
});

test("R10 first measurement: a working file identical to the merge-base's enters the ledger once, as one entry", () => {
  const r = sixRig({ base: { evalRuns: allPass(6, 4) } });
  try {
    const s = start(r, fs.readFileSync(path.join(r.dir, "evals", "results.json"), "utf8"));
    assert.equal(kind(s), "new");
    if (s.kind !== "new") return;
    assert.equal(s.record.ledger.length, 1, "the file and the merge-base copy are one identity");
    assert.equal(s.branchCount, 1, "the merge-base entry is not a branch entry");
  } finally {
    r.cleanup();
  }
});

test("R8(a): a measurement being resumed with its recorded cost at the cap has a worst case of zero", () => {
  const r = sixRig({ edit: false });
  try {
    const rec = buildRecord(r.sel(), { evalRuns: [[true]], costUsd: 0.1, judgeCostUsd: 0 });
    const s = start(r, text(r, { ...rec, status: "in-progress", cost_usd: 5, judge_cost_usd: 0 }));
    assert.equal(kind(s), "resume");
    if (s.kind === "resume") assert.ok(s.worst <= 1e-9);
  } finally {
    r.cleanup();
  }
});

// ------------------------------------------------------------------------------------ the runner

const KEY = { mock: false as const, env: { ANTHROPIC_API_KEY: "sk-test" }, useApiKey: true };
const fox = () => ({
  files: { "answer.md": "x" },
  transcript: "Assistant: the quick brown fox",
  costUsd: 0.05,
});
const caps = { maxExecutorRuns: 100, judgeMaxCalls: 100, maxInvocationUsd: 1000 };
const evalsChange = (n: number) => (repo: { root: string }) =>
  fs.writeFileSync(
    path.join(repo.root, skillRel("demo"), "evals", "evals.json"),
    plainEvals("demo", n),
  );

test("R8(b), R8(d) through the runner: a finished measurement is not replaced; a content change starts the next and the report counts 2", async () => {
  const rig = makeRig({
    evalsCount: 1,
    ...KEY,
    script: fox,
    settings: caps,
    change: evalsChange(2),
  });
  const file = path.join(rig.repo.root, skillRel("demo"), "evals", "results.json");
  try {
    const first = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(first.results[0]?.status, "pass", first.text + first.stderr);
    assert.match(first.text, /measurements on this branch: 1$/m);
    const before = fs.readFileSync(file, "utf8");
    const calls = rig.executor.calls.length;
    const again = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(again.exitCode, 1);
    assert.equal(again.results[0]?.status, "error");
    assert.match(again.text, /measurement complete for sha256:[0-9a-f]{64}/);
    assert.equal(rig.executor.calls.length, calls, "no model call");
    assert.equal(fs.readFileSync(file, "utf8"), before, "the file is byte-identical");
    fs.appendFileSync(path.join(rig.repo.root, skillRel("demo"), "SKILL.md"), "another edit\n");
    commitAll(rig.repo, "edit the skill");
    const second = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(second.results[0]?.status, "pass", second.text + second.stderr);
    assert.match(second.text, /measurements on this branch: 2$/m);
    const rec = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(rec.ledger.length, 1);
    assert.equal(rec.ledger[0].content_hash, JSON.parse(before).content_hash);
    assert.equal(rec.ledger[0].status, "pass");
  } finally {
    rig.cleanup();
  }
});

test("R8: a mock run ignores every rule, reads no results file and changes nothing", async () => {
  const rig = makeRig({ evalsCount: 1, change: evalsChange(2) });
  const file = path.join(rig.repo.root, skillRel("demo"), "evals", "results.json");
  const finalFile = '{"status":"pass","skill_name":"demo"}\n';
  try {
    fs.writeFileSync(file, finalFile);
    const r = await rig.run();
    assert.equal(r.results[0]?.status, "mock");
    assert.equal(r.exitCode, 0);
    assert.equal(fs.readFileSync(file, "utf8"), finalFile);
  } finally {
    rig.cleanup();
  }
});
