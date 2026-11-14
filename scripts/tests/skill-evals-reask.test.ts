// skill-evals-reask.test.ts — the one evidence re-ask (spec 0304 R17): a judge PASS refused for
// unsupported evidence is asked again once, alone, with the reason; a FAIL is never re-asked; the
// outcome is recorded as `reasked`; the runner reports `evidence_reask: <n> of <m>`. Offline.

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { gradeRun } from "../lib/skill-evals/grade.ts";
import type { JudgeAnswer, JudgeFn } from "../lib/skill-evals/grade.ts";
import { formatSkill } from "../lib/skill-evals/report.ts";
import { skillRel, tmpDir } from "./lib/skill-evals-fixtures.ts";
import { judgeAnswerFor, makeRig, plainEvals } from "./lib/skill-evals-run-rig.ts";

const FOX = "the quick brown fox";
const TRANSCRIPT = `Assistant: ${FOX} jumps over the lazy dog`;
const pass = (evidence: string): JudgeAnswer => ({ verdict: "PASS", evidence });
const fail = (evidence: string): JudgeAnswer => ({ verdict: "FAIL", evidence });

interface Call {
  texts: readonly string[];
  reasons: readonly string[] | undefined;
}
/** A judge that plays the given answer sets in order and records what it was asked. */
function scripted(...answers: (JudgeAnswer | undefined)[][]): { fn: JudgeFn; calls: Call[] } {
  const calls: Call[] = [];
  const fn: JudgeFn = async (texts, _m, opts) => {
    calls.push({ texts: [...texts], reasons: opts?.reasons });
    return answers[calls.length - 1] ?? [];
  };
  return { fn, calls };
}
const grade = (judge: JudgeFn, expectations: string[]) => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, "outputs"));
  return gradeRun({
    evalCase: { id: 1, prompt: "p", expected_output: "o", files: [], expectations, checks: [] },
    outputsDir: path.join(dir, "outputs"),
    skillDir: "/none",
    transcript: TRANSCRIPT,
    judge,
  });
};

test("one unsupported PASS is re-asked once, alone, with the reason; a valid PASS records reasked", async () => {
  const j = scripted(
    [pass(FOX), pass("a paraphrase that is nowhere in the output")],
    [pass(`${FOX} jumps over`)],
  );
  const g = await grade(j.fn, ["a", "b"]);
  assert.equal(j.calls.length, 2, "one further call, not one per expectation");
  assert.deepEqual(j.calls[1]?.texts, ["b"], "only the refused expectation");
  assert.equal(j.calls[1]?.reasons?.length, 1);
  assert.match(
    j.calls[1]?.reasons?.[0] ?? "",
    /occurs in neither the transcript nor a produced file/,
  );
  assert.deepEqual(
    g.expectations.map((e) => [e.passed, e.reasked]),
    [
      [true, undefined],
      [true, true],
    ],
  );
  assert.equal(g.reasked, true, "the run carries reasked");
});

test("a second unsupported PASS is recorded passed false, with the unsupported wording kept", async () => {
  const j = scripted([pass("not in the output, first time")], [pass("not in the output, again")]);
  const g = await grade(j.fn, ["a"]);
  assert.equal(j.calls.length, 2, "at most one re-ask per run");
  assert.equal(g.expectations[0]?.passed, false);
  assert.equal(g.expectations[0]?.reasked, true);
  assert.match(g.expectations[0]?.evidence ?? "", /the PASS verdict was unsupported/);
  assert.match(g.expectations[0]?.evidence ?? "", /after the re-ask/);
});

test("any other answer to the re-ask is passed false: a FAIL, a missing verdict", async () => {
  const f = await grade(scripted([pass("not in the output")], [fail("it is wrong")]).fn, ["a"]);
  assert.equal(f.expectations[0]?.passed, false);
  assert.match(f.expectations[0]?.evidence ?? "", /FAIL on the re-ask/);
  const none = await grade(scripted([pass("not in the output")], []).fn, ["a"]);
  assert.equal(none.expectations[0]?.passed, false);
  assert.match(none.expectations[0]?.evidence ?? "", /no verdict/);
});

test("a judge FAIL is never re-asked", async () => {
  const j = scripted([fail("the answer is wrong")]);
  const g = await grade(j.fn, ["a"]);
  assert.equal(j.calls.length, 1);
  assert.equal(g.expectations[0]?.passed, false);
  assert.equal(g.reasked, undefined);
  assert.equal(g.expectations[0]?.reasked, undefined);
});

test("several refused expectations share the single re-ask", async () => {
  const j = scripted(
    [pass("nope one is not here"), pass("nope two is not here"), pass(FOX)],
    [pass(FOX), pass(`${FOX} jumps`)],
  );
  const g = await grade(j.fn, ["a", "b", "c"]);
  assert.equal(j.calls.length, 2);
  assert.deepEqual(j.calls[1]?.texts, ["a", "b"]);
  assert.deepEqual(
    g.expectations.map((e) => e.passed),
    [true, true, true],
  );
});

test("a valid PASS with no refusal makes no re-ask", async () => {
  const j = scripted([pass(FOX)]);
  const g = await grade(j.fn, ["a"]);
  assert.equal(j.calls.length, 1);
  assert.equal(g.reasked, undefined);
});

test("the runner counts the re-ask as a judge call, records reasked and prints evidence_reask", async () => {
  // a recording endpoint: the first answer of every run is an unsupported PASS, the re-ask quotes the transcript
  const messages: string[] = [];
  const fetchImpl = (async (_u: string, init: { body: string }) => {
    const message =
      (JSON.parse(init.body) as { messages: { content: string }[] }).messages[0]?.content ?? "";
    messages.push(message);
    const text = message.includes("refused")
      ? judgeAnswerFor(message)
      : judgeAnswerFor(message).replace(FOX, "an invented excerpt nobody wrote");
    return new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const rig = makeRig({
    evalsCount: 1,
    mock: false,
    env: { ANTHROPIC_API_KEY: "sk-test" },
    useApiKey: true,
    script: () => ({ files: { "answer.md": "x" }, transcript: `Assistant: ${FOX}` }),
    change: (repo) =>
      fs.writeFileSync(
        path.join(repo.root, skillRel("demo"), "evals", "evals.json"),
        plainEvals("demo", 1),
      ),
  });
  try {
    const r = await rig.run({ fetchImpl });
    const s = r.results[0];
    assert.equal(s?.status, "pass", r.text + r.stderr);
    assert.equal(s?.judgeCalls, 4, "two eval runs, each judged once and re-asked once");
    assert.match(r.text, /evidence_reask: 2 of 2/);
    const rec = JSON.parse(
      fs.readFileSync(path.join(rig.repo.root, skillRel("demo"), "evals", "results.json"), "utf8"),
    );
    assert.deepEqual(
      rec.evals[0].runs.map((x: { reasked: boolean }) => x.reasked),
      [true, true],
    );
    const g = JSON.parse(
      fs.readFileSync(path.join(rig.out, "demo", "eval-1", "run-1", "grading.json"), "utf8"),
    );
    assert.equal(g.reasked, true);
    assert.equal(g.expectations[0].reasked, true);
  } finally {
    rig.cleanup();
  }
});

test("evidence_reask is printed even when no run was re-asked", () => {
  const base = {
    skill: "demo",
    status: "pass" as const,
    blocking: false,
    executorRuns: 2,
    judgeCalls: 2,
    costUsd: 0.1,
    messages: [],
  };
  assert.match(formatSkill({ ...base, judged: 2, reasked: 0 }), /evidence_reask: 0 of 2/);
  assert.match(formatSkill({ ...base, judged: 2 }), /evidence_reask: 0 of 2/);
});
