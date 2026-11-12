// skill-evals-evidence.test.ts — the evidence rule and the judge entry point
// (spec 0290 R12, R13, R15, R25 as modified by delta-04). No model call: mock mode and a scripted `fetch`.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { llmJudgeEvidence, judgeEvidencePreflight } from "../../tests/e2e/lib/llm_judge.ts";
import type { JudgeDeps } from "../../tests/e2e/lib/llm_judge.ts";
import { parseEvidence, validateEvidence } from "../lib/skill-evals/evidence.ts";
import { gradeRun, JudgeFailure } from "../lib/skill-evals/grade.ts";
import { createJudge, parseJudgeAnswer } from "../lib/skill-evals/judge.ts";
import { tmpDir } from "./lib/skill-evals-fixtures.ts";

const material = {
  transcript: "Assistant: The title is a single gitmoji.\r\nSecond line of the transcript.",
  files: [
    { rel: "pr-body.md", content: "## How to test this PR?\nrun the suite now\nthird line\n" },
  ],
};

test("parseEvidence reads a JSON string, falls back to the raw remainder, and is undefined without a line", () => {
  assert.equal(
    parseEvidence('VERDICT=PASS CONF=0.9\nEVIDENCE="a \\"quoted\\" excerpt"'),
    'a "quoted" excerpt',
  );
  assert.equal(parseEvidence("VERDICT=PASS CONF=0.9\nEVIDENCE=raw text here"), "raw text here");
  assert.equal(parseEvidence("VERDICT=PASS CONF=0.9"), undefined);
  assert.equal(parseEvidence("EVIDENCE="), undefined);
});

test("valid evidence: an exact substring of the transcript (line endings normalised) or of a produced file, or path:line", () => {
  const ok = (e: string | undefined) => validateEvidence(e, material).ok;
  assert.equal(ok("The title is a single gitmoji."), true);
  assert.equal(ok("gitmoji.\nSecond line of the transcript."), true, "CRLF normalised");
  assert.equal(ok("run the suite now"), true);
  assert.equal(ok("pr-body.md:2"), true);
  assert.equal(ok("outputs/pr-body.md:3"), true);
});

test("unsupported evidence: short, absent, not found, a path:line past the end or naming no produced file", () => {
  const why = (e: string | undefined) => {
    const r = validateEvidence(e, material);
    return r.ok ? "ok" : r.reason;
  };
  assert.match(why("ok"), /fewer than 12 non-whitespace/);
  assert.match(why("a b c d e f g h i j k"), /fewer than 12/);
  assert.equal(
    why("abcdefghijkl and nothing else"),
    "evidence occurs in neither the transcript nor a produced file, and is not a path:line of a produced file",
  );
  assert.match(why(undefined), /no evidence/);
  assert.match(why("pr-body.md:99"), /neither/);
  assert.match(why("other-file.md:1"), /neither/);
  // the 12 non-whitespace character boundary, with the text present in the transcript
  assert.equal(
    validateEvidence("twelve chars", { transcript: "twelve chars", files: [] }).ok,
    false,
    "11 non-whitespace characters",
  );
  assert.equal(
    validateEvidence("twelve chars!", { transcript: "twelve chars!", files: [] }).ok,
    true,
    "12 non-whitespace characters",
  );
});

const grade = (answer: { verdict: string; evidence: string | undefined }) =>
  gradeRun({
    evalCase: {
      id: 1,
      prompt: "p",
      expected_output: "o",
      files: [],
      expectations: ["The title is a gitmoji"],
      checks: [],
    },
    outputsDir: tmpDir(),
    skillDir: "/none",
    transcript: material.transcript,
    judge: async () => [answer],
  });

test("an unsupported PASS is recorded failed and counted as failed; UNCERTAIN is recorded failed with its word", async () => {
  const bad = await grade({ verdict: "PASS", evidence: "this excerpt does not occur anywhere" });
  assert.equal(bad.expectations[0]?.passed, false);
  assert.match(bad.expectations[0]?.evidence ?? "", /PASS verdict was unsupported/);
  assert.deepEqual(bad.summary, { passed: 0, failed: 1, total: 1, pass_rate: 0 });
  const short = await grade({ verdict: "PASS", evidence: "ok" });
  assert.equal(short.expectations[0]?.passed, false);
  assert.match(short.expectations[0]?.evidence ?? "", /unsupported/);
  const none = await grade({ verdict: "PASS", evidence: undefined });
  assert.match(none.expectations[0]?.evidence ?? "", /unsupported: no evidence/);
  const unsure = await grade({ verdict: "UNCERTAIN", evidence: "The title is a single gitmoji." });
  assert.equal(unsure.expectations[0]?.passed, false);
  assert.match(unsure.expectations[0]?.evidence ?? "", /verdict was UNCERTAIN/);
  const good = await grade({ verdict: "PASS", evidence: "The title is a single gitmoji." });
  assert.equal(good.expectations[0]?.passed, true);
  assert.equal(good.expectations[0]?.evidence, "The title is a single gitmoji.");
  assert.deepEqual(good.summary, { passed: 1, failed: 0, total: 1, pass_rate: 1 });
});

const mockDeps = (
  dir: string,
  response: string,
  extra: Record<string, string> = {},
): JudgeDeps => ({
  env: { E2E_JUDGE_MOCK: "1", E2E_JUDGE_MOCK_RESPONSE: response, E2E_REPORT_DIR: dir, ...extra },
  now: () => 0,
  sleep: async () => undefined,
});

test("llmJudgeEvidence in mock mode: one call, the raw text, counted", async () => {
  const dir = tmpDir();
  try {
    const text = '1 VERDICT=PASS EVIDENCE="The title is a single gitmoji."';
    const r = await llmJudgeEvidence(mockDeps(dir, text), "msg");
    assert.deepEqual(r, { kind: "answer", text });
    assert.equal(fs.readFileSync(path.join(dir, "judge.count"), "utf8").trim(), "1");
    const again = await llmJudgeEvidence(mockDeps(dir, "whatever"), "msg");
    assert.deepEqual(again, { kind: "answer", text: "whatever" });
    assert.equal(fs.readFileSync(path.join(dir, "judge.count"), "utf8").trim(), "2");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("llmJudgeEvidence checks the cap before its call: at max_calls no call is made", async () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(
      path.join(dir, "effective.json"),
      JSON.stringify({ judge: { backend: "anthropic", max_calls: 4 } }),
    );
    fs.writeFileSync(path.join(dir, "judge.count"), "3\n");
    const r = await llmJudgeEvidence(mockDeps(dir, "1 VERDICT=FAIL EVIDENCE=x"), "msg");
    assert.equal(r.kind, "answer");
    const again = await llmJudgeEvidence(mockDeps(dir, "1 VERDICT=FAIL EVIDENCE=x"), "msg");
    assert.deepEqual(again, { kind: "cap-exceeded", count: 4, maxCalls: 4 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the judge preflight reports missing credentials and unsupported backends without a model call", async () => {
  const dir = tmpDir();
  try {
    const env = (judge: object): JudgeDeps => {
      fs.writeFileSync(path.join(dir, "effective.json"), JSON.stringify({ judge }));
      return {
        env: { E2E_REPORT_DIR: dir },
        now: () => 0,
        sleep: async () => undefined,
        fetch: (() => {
          throw new Error("network");
        }) as unknown as typeof fetch,
      };
    };
    assert.deepEqual(
      await judgeEvidencePreflight(env({ backend: "anthropic", api_key_env: "ANTHROPIC_API_KEY" })),
      { kind: "auth-missing", backend: "anthropic" },
    );
    assert.deepEqual(await judgeEvidencePreflight(env({ backend: "claude-cli" })), {
      kind: "auth-missing",
      backend: "claude-cli",
    });
    const gem = await judgeEvidencePreflight(env({ backend: "gemini" }));
    assert.equal(gem.kind, "hard-failure");
    const r = await llmJudgeEvidence(env({ backend: "gemini" }), "m");
    assert.equal(r.kind, "hard-failure");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a numbered answer is graded per expectation: PASS with bad evidence is unsupported, a missing index has no verdict, UNCERTAIN fails", async () => {
  const dir = tmpDir();
  try {
    const answer = [
      '1 VERDICT=PASS EVIDENCE="not in the transcript at all"',
      '2 VERDICT=PASS EVIDENCE="The title is a single gitmoji."',
      '2 VERDICT=FAIL EVIDENCE="ignored: the first line wins"',
      "4 VERDICT=UNCERTAIN EVIDENCE=unsure",
    ].join("\n");
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: answer }] }), {
        status: 200,
      })) as unknown as typeof fetch;
    const judge = createJudge({
      dir,
      judge: {
        backend: "anthropic",
        model: "m",
        api_key_env: "ANTHROPIC_API_KEY",
        auth_mode: "api_key",
        max_tokens: 512,
        strict: false,
      },
      credential: { name: "ANTHROPIC_API_KEY", value: "k" },
      maxCalls: 300,
      baseEnv: { ANTHROPIC_API_KEY: "k" },
      mock: false,
      fetchImpl,
    });
    const g = await gradeRun({
      evalCase: {
        id: 1,
        prompt: "p",
        expected_output: "o",
        files: [],
        expectations: ["a", "b", "c", "d"],
        checks: [],
      },
      outputsDir: tmpDir(),
      skillDir: "/none",
      transcript: material.transcript,
      judge: judge.fn,
    });
    assert.deepEqual(
      g.expectations.map((e) => e.passed),
      [false, true, false, false],
    );
    assert.match(g.expectations[0]?.evidence ?? "", /unsupported/);
    assert.match(g.expectations[2]?.evidence ?? "", /no verdict/);
    assert.match(g.expectations[3]?.evidence ?? "", /UNCERTAIN/);
    assert.equal(judge.callsUsed(), 1, "one call for all four expectations");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a mock verdict with a valid and with an absent excerpt, end to end through the judge", async () => {
  const dir = tmpDir();
  try {
    const mk = (answer: string) =>
      createJudge({
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
    const run = (answer: string) =>
      gradeRun({
        evalCase: {
          id: 1,
          prompt: "p",
          expected_output: "o",
          files: [],
          expectations: ["x"],
          checks: [],
        },
        outputsDir: tmpDir(),
        skillDir: "/none",
        transcript: material.transcript,
        judge: mk(answer).fn,
        mock: true,
      });
    const good = await run('1 VERDICT=PASS EVIDENCE="Second line of the transcript."');
    assert.equal(good.expectations[0]?.passed, true);
    assert.equal(good.mock, true);
    const absent = await run('1 VERDICT=PASS EVIDENCE="an excerpt that is nowhere to be found"');
    assert.equal(absent.expectations[0]?.passed, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** A judge in mock mode that answers `answer` to the one call an eval makes. */
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

const gradeFour = (judge: ReturnType<typeof mockJudge>) =>
  gradeRun({
    evalCase: {
      id: 1,
      prompt: "p",
      expected_output: "o",
      files: [],
      expectations: ["a", "b", "c", "d"],
      checks: [],
    },
    outputsDir: tmpDir(),
    skillDir: "/none",
    transcript: material.transcript,
    judge: judge.fn,
    mock: true,
  });

test("one judge call holds PASS, FAIL, a missing entry and an UNCERTAIN word: each is graded on its own, in one call", async () => {
  const dir = tmpDir();
  try {
    const judge = mockJudge(
      dir,
      [
        '1 VERDICT=PASS EVIDENCE="The title is a single gitmoji."',
        '2 VERDICT=FAIL EVIDENCE="the body has no section"',
        // 3 is missing
        '4 VERDICT=UNCERTAIN EVIDENCE="cannot tell"',
      ].join("\n"),
    );
    const g = await gradeFour(judge);
    assert.deepEqual(
      g.expectations.map((e) => e.passed),
      [true, false, false, false],
    );
    assert.equal(g.expectations[0]?.evidence, "The title is a single gitmoji.");
    assert.match(g.expectations[1]?.evidence ?? "", /verdict was FAIL: the body has no section/);
    assert.match(g.expectations[2]?.evidence ?? "", /no verdict/);
    assert.match(g.expectations[3]?.evidence ?? "", /verdict was UNCERTAIN: cannot tell/);
    assert.deepEqual(g.summary, { passed: 1, failed: 3, total: 4, pass_rate: 0.25 });
    assert.equal(judge.callsUsed(), 1, "one call for the four expectations, not one each");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a repeated index: the first line wins, even when a later one says PASS; an index out of range is ignored", () => {
  const e = parseJudgeAnswer(
    [
      '2 VERDICT=FAIL EVIDENCE="first"',
      '2 VERDICT=PASS EVIDENCE="later"',
      '9 VERDICT=PASS EVIDENCE="outside"',
      "noise",
    ].join("\n"),
    3,
  );
  assert.equal(e[0], undefined);
  assert.deepEqual(e[1], { verdict: "FAIL", evidence: "first" });
  assert.equal(e[2], undefined);
});

test("an answer of UNCERTAIN lines only is a graded failure, never an error; an answer with no entry at all is the R13 error", async () => {
  const dir = tmpDir();
  try {
    const unsure = await gradeFour(
      mockJudge(
        dir,
        ["1", "2", "3", "4"].map((i) => `${i} VERDICT=UNCERTAIN EVIDENCE=unsure`).join("\n"),
      ),
    );
    assert.deepEqual(unsure.summary, { passed: 0, failed: 4, total: 4, pass_rate: 0 });
    for (const answer of ["", "I cannot grade this.", 'VERDICT=PASS EVIDENCE="no index"'])
      await assert.rejects(
        gradeFour(mockJudge(dir, answer)),
        (e: unknown) => e instanceof JudgeFailure && e.reason === "no-verdict",
        JSON.stringify(answer),
      );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
