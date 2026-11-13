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
  const mat = {
    transcript: "",
    files: [{ rel: "x", content: "a\ncommit (initial):\tfirst commit message\n" }],
  };
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
  const e = parseJudgeAnswer(
    '```text\n1 VERDICT=PASS EVIDENCE="a"\n2 VERDICT=FAIL EVIDENCE="b"\n```',
    2,
  );
  assert.deepEqual(e, [
    { verdict: "PASS", evidence: "a" },
    { verdict: "FAIL", evidence: "b" },
  ]);
});

test("judge.txt holds the raw answer on success and on a no-verdict JudgeFailure", async () => {
  const dir = tmpDir();
  const mk = (answer: string) => mockJudge(path.join(dir, ".judge"), answer);
  const input = (judge: ReturnType<typeof mockJudge>, rawFile: string) => ({
    evalCase: {
      id: 1,
      prompt: "p",
      expected_output: "o",
      files: [],
      expectations: ["a"],
      checks: [],
    },
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
    await assert.rejects(
      gradeRun(input(mk("I cannot grade this."), bad)),
      (e: unknown) => e instanceof JudgeFailure,
    );
    assert.equal(fs.readFileSync(bad, "utf8"), "I cannot grade this.");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("real eval-3 answer: bare PASS verdicts without the VERDICT= keyword", () => {
  const e = parseJudgeAnswer(
    [
      '1 PASS EVIDENCE="### 2026-11-12 — Bump undici-lite from 4.1.0 to 4.2.1\\n\\n**Writer:** pr-logbook"',
      '2 PASS EVIDENCE="**What was tried**: Bumped the dependency, then ran the install."',
    ].join("\n"),
    2,
  );
  assert.deepEqual(e, [
    {
      verdict: "PASS",
      evidence: "### 2026-11-12 — Bump undici-lite from 4.1.0 to 4.2.1\n\n**Writer:** pr-logbook",
    },
    {
      verdict: "PASS",
      evidence: "**What was tried**: Bumped the dependency, then ran the install.",
    },
  ]);
});

test("a bare word is a verdict only before EVIDENCE or when PASS/FAIL/UNCERTAIN", () => {
  assert.equal(parseJudgeAnswer('1 MAYBE EVIDENCE="x"', 1)[0]?.verdict, "MAYBE");
  assert.equal(parseJudgeAnswer("1 uncertain", 1)[0]?.verdict, "UNCERTAIN");
  assert.equal(parseJudgeAnswer("1 Pass the argument to the helper", 1)[0], undefined);
  assert.equal(parseJudgeAnswer("1 Something else", 1)[0], undefined);
});

test("real eval-4 answer: a raw TAB inside the JSON string is decoded, not kept with quotes", () => {
  const line =
    '1 VERDICT=PASS EVIDENCE="51ee63024ae64f5582185acb59dc89750b39a3e2 Fixture Author <fixture@example.invalid> 1794473618 +0100\tcommit: Mark spec 0007 as implemented"';
  const e = parseJudgeAnswer(line, 1)[0];
  assert.equal(e?.verdict, "PASS");
  assert.ok(e?.evidence?.includes("\t"));
  assert.ok(!e?.evidence?.startsWith('"'));
  const mat = {
    transcript: "",
    files: [
      {
        rel: ".git/logs/HEAD",
        content:
          "0000 51ee63024ae64f5582185acb59dc89750b39a3e2 Fixture Author <fixture@example.invalid> 1794473618 +0100\tcommit: Mark spec 0007 as implemented\n",
      },
    ],
  };
  assert.equal(validateEvidence(e?.evidence, mat).ok, true);
});

test("parseEvidence never keeps the quotes of an unparseable literal", () => {
  assert.equal(parseEvidence('EVIDENCE="bad \\q escape"'), "bad \\q escape");
});

// #1914: the verdict word comes from the structured VERDICT= field, never from inside EVIDENCE.
const REQ = '"## Verdict: REQUEST CHANGES"';
test("#1914 evidence quoting a Verdict line before the real VERDICT= does not hijack the verdict", () => {
  const e = parseJudgeAnswer(`1 EVIDENCE=${REQ} VERDICT=PASS`, 1);
  assert.equal(e[0]?.verdict, "PASS");
  assert.equal(e[0]?.evidence, "## Verdict: REQUEST CHANGES");
});

test("#1914 evidence quoting a Verdict line after the real VERDICT= keeps the real verdict", () => {
  for (const v of ["PASS", "FAIL", "UNCERTAIN"])
    assert.equal(parseJudgeAnswer(`1 VERDICT=${v} EVIDENCE=${REQ}`, 1)[0]?.verdict, v);
});

test("#1914 a quoted Verdict inside evidence is no verdict when the field is absent", () => {
  assert.equal(parseJudgeAnswer(`1 EVIDENCE=${REQ}`, 1)[0], undefined);
  assert.equal(parseJudgeAnswer(`1 EVIDENCE:${REQ}`, 1)[0], undefined);
});

test("#1914 only PASS, FAIL and UNCERTAIN are verdict words; a later valid line still wins", () => {
  const e = parseJudgeAnswer(`1 VERDICT=REQUEST EVIDENCE=${REQ}\n1 VERDICT=FAIL EVIDENCE="x"`, 1);
  assert.equal(e[0]?.verdict, "FAIL");
  assert.equal(parseJudgeAnswer('1 VERDICT=REQUEST EVIDENCE="x"', 1)[0], undefined);
});

test("#1914 markdown decorations and list markers around the structured field", () => {
  const e = parseJudgeAnswer(
    `- **1.** **VERDICT**=**PASS** **EVIDENCE**=${REQ}\n2) \`VERDICT: FAIL\` EVIDENCE: ${REQ}\n3. EVIDENCE=${REQ} **VERDICT:** UNCERTAIN`,
    3,
  );
  assert.deepEqual(
    e.map((x) => x?.verdict),
    ["PASS", "FAIL", "UNCERTAIN"],
  );
});

test("#1914 the recorded answer shape: the expectation is graded on PASS, not 'REQUEST'", async () => {
  const dir = tmpDir("judge1914");
  const answer = `1 EVIDENCE=${REQ} VERDICT=PASS`;
  const j = mockJudge(dir, answer);
  const entries = await j.fn(["The verdict is REQUEST CHANGES"], {
    transcript: "x",
    files: [{ rel: "v.md", content: "## Verdict: REQUEST CHANGES\n" }],
  });
  assert.equal(entries[0]?.verdict, "PASS");
});
