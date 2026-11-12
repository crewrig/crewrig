// skill-evals-judge-parse.test.ts — tolerant judge-answer parsing and the persisted raw answer (#1880).
// No model call: mock mode only.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { parseEvidence, validateEvidence } from "../lib/skill-evals/evidence.ts";
import { gradeRun, JudgeFailure } from "../lib/skill-evals/grade.ts";
import { createJudge, parseJudgeAnswer } from "../lib/skill-evals/judge.ts";
import { tmpDir } from "./lib/skill-evals-fixtures.ts";

const material = { transcript: "Assistant: hello there." };

function mockJudge(dir: string, answer: string) {
  return createJudge({
    dir,
    judge: {
      backend: "claude-cli",
      model: "m",
      api_key_env: "X",
      auth_mode: "api_key",
      max_tokens: 512,
      strict: false,
    },
    credential: undefined,
    maxCalls: 300,
    baseEnv: {},
    mock: true,
    mockAnswer: () => answer,
  });
}

test("parseEvidence takes the first JSON string and ignores trailing text; accepts ':' and spaces", () => {
  assert.equal(parseEvidence('EVIDENCE="tab\\there and more" (see above)'), "tab\there and more");
  assert.equal(parseEvidence('EVIDENCE : "x y z" "second"'), "x y z");
  assert.equal(parseEvidence("EVIDENCE: not quoted  "), "not quoted");
});

test("the eval-4 case: evidence with an escaped tab followed by trailing text matches a file with a real tab", () => {
  const e = parseJudgeAnswer(
    '1 VERDICT=PASS EVIDENCE="commit (initial):\\tfirst commit message" -- from .git/logs/HEAD',
    1,
  );
  const mat = { transcript: "", files: [{ rel: "x", content: "a\ncommit (initial):\tfirst commit message\n" }] };
  assert.equal(validateEvidence(e[0]?.evidence, mat).ok, true);
});

test("parseJudgeAnswer tolerates common formatting of a numbered line", () => {
  const forms = [
    '  1 VERDICT=PASS EVIDENCE="e1"',
    '- 1. VERDICT=PASS EVIDENCE="e1"',
    '* 1) verdict: pass EVIDENCE: "e1"',
    '+ #1 VERDICT = PASS EVIDENCE="e1"',
    '> [1] VERDICT=PASS EVIDENCE="e1"',
    '**1** VERDICT=PASS EVIDENCE="e1"',
    '`1` VERDICT=`PASS` EVIDENCE="e1"',
    '1: **VERDICT**=**PASS** EVIDENCE="e1"',
    '**1.** `VERDICT`: **PASS** EVIDENCE="e1"',
  ];
  for (const f of forms) {
    const e = parseJudgeAnswer(f, 2);
    assert.deepEqual(e[0], { verdict: "PASS", evidence: "e1" }, f);
    assert.equal(e[1], undefined, f);
  }
});

test("parseJudgeAnswer reads an answer wrapped in a fenced code block", () => {
  const e = parseJudgeAnswer('```text\n1 VERDICT=PASS EVIDENCE="a"\n2 VERDICT=FAIL EVIDENCE="b"\n```', 2);
  assert.deepEqual(e, [
    { verdict: "PASS", evidence: "a" },
    { verdict: "FAIL", evidence: "b" },
  ]);
});

test("judge.txt holds the raw answer on success and on a no-verdict JudgeFailure", async () => {
  const dir = tmpDir();
  const mk = (answer: string) => mockJudge(path.join(dir, ".judge"), answer);
  const input = (judge: ReturnType<typeof mockJudge>, rawFile: string) => ({
    evalCase: { id: 1, prompt: "p", expected_output: "o", files: [], expectations: ["a"], checks: [] },
    outputsDir: tmpDir(),
    skillDir: "/none",
    transcript: material.transcript,
    judge: judge.fn,
    judgeRawFile: rawFile,
    mock: true,
  });
  try {
    const ok = path.join(dir, "eval-1", "judge.txt");
    await gradeRun(input(mk('1 VERDICT=FAIL EVIDENCE="nope"'), ok));
    assert.equal(fs.readFileSync(ok, "utf8"), '1 VERDICT=FAIL EVIDENCE="nope"');
    const bad = path.join(dir, "eval-2", "judge.txt");
    await assert.rejects(gradeRun(input(mk("I cannot grade this."), bad)), (e: unknown) => e instanceof JudgeFailure);
    assert.equal(fs.readFileSync(bad, "utf8"), "I cannot grade this.");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
