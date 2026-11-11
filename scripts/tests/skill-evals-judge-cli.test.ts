// skill-evals-judge-cli.test.ts — the headless `claude -p` judge driver (spec 0290 R15, R33).
// A stub `claude` records argv, environment and stdin; `fetch` throws. No model call.

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { llmJudge, llmJudgeEvidence } from "../../tests/e2e/lib/llm_judge.ts";
import type { JudgeDeps } from "../../tests/e2e/lib/llm_judge.ts";
import { claudeCliDriver } from "../../tests/e2e/lib/llm_judge_drivers/claude-cli.ts";
import { tmpDir, writeStubClaude } from "./lib/skill-evals-fixtures.ts";

const throwing = (() => {
  throw new Error("the Messages API must not be reached");
}) as unknown as typeof fetch;

function setup(stubBody: string) {
  const dir = tmpDir();
  const log = path.join(dir, "log.json");
  const report = path.join(dir, "report");
  fs.mkdirSync(report);
  fs.writeFileSync(
    path.join(report, "effective.json"),
    JSON.stringify({ judge: { backend: "claude-cli", model: "claude-sonnet-4-6", max_calls: 50 } }),
  );
  const bin = writeStubClaude(
    dir,
    `#!/usr/bin/env node\nlet input = "";\nprocess.stdin.on("data", (d) => (input += d));\nprocess.stdin.on("end", () => {\n${stubBody.replaceAll("LOG", JSON.stringify(log))}\n});\n`,
  );
  const deps = (env: Record<string, string> = {}): JudgeDeps => ({
    env: {
      E2E_REPORT_DIR: report,
      SKILL_EVALS_CLAUDE_BIN: bin,
      PATH: process.env["PATH"] ?? "",
      ...env,
    },
    now: () => 0,
    sleep: async () => undefined,
    fetch: throwing,
  });
  return { dir, log, deps };
}

test("the token reaches the child through its environment only; the prompt arrives on stdin; the request shape is a no-tools single turn", async () => {
  const s = setup(
    `require("fs").writeFileSync(LOG, JSON.stringify({ argv: process.argv.slice(2), env: process.env, stdin: input }));\nprocess.stdout.write('VERDICT=PASS CONF=0.85\\nEVIDENCE="an excerpt of the transcript"\\n');`,
  );
  try {
    const r = await llmJudgeEvidence(
      s.deps({
        CLAUDE_CODE_OAUTH_TOKEN: "tok-judge",
        ANTHROPIC_API_KEY: "key-not-used",
        SOME_SECRET: "nope",
      }),
      "JUDGE MESSAGE BODY",
    );
    assert.equal(r.kind, "verdict");
    if (r.kind === "verdict") assert.equal(r.verdict, "PASS");
    const seen = JSON.parse(fs.readFileSync(s.log, "utf8"));
    assert.equal(seen.stdin, "JUDGE MESSAGE BODY");
    assert.equal(seen.env.CLAUDE_CODE_OAUTH_TOKEN, "tok-judge");
    assert.equal(seen.env.ANTHROPIC_API_KEY, undefined);
    assert.equal(seen.env.SOME_SECRET, undefined);
    assert.notEqual(seen.env.HOME, process.env["HOME"]);
    const a: string[] = seen.argv;
    assert.equal(a.join(" ").includes("tok-judge"), false, "never on argv");
    assert.equal(a[a.indexOf("--tools") + 1], "", "no tools");
    assert.ok(
      a.includes("-p") &&
        a.includes("--no-session-persistence") &&
        a.includes("--disable-slash-commands"),
    );
    assert.equal(a[a.indexOf("--model") + 1], "claude-sonnet-4-6");
    assert.equal(
      a.includes("--max-turns"),
      false,
      "flag unverified: single turn is inherent with no tools",
    );
  } finally {
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test("no token means auth-missing before any spawn; a failing child is a failed call, not a verdict", async () => {
  const s = setup(`require("fs").writeFileSync(LOG, "spawned");\nprocess.exit(1);`);
  try {
    assert.deepEqual(await llmJudgeEvidence(s.deps(), "m"), {
      kind: "auth-missing",
      backend: "claude-cli",
    });
    assert.equal(fs.existsSync(s.log), false, "no spawn without a token");
    const r = await llmJudgeEvidence(s.deps({ CLAUDE_CODE_OAUTH_TOKEN: "t" }), "m");
    assert.ok(r.kind === "verdict" && r.texts.every((t) => t === undefined));
  } finally {
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test("the existing llmJudge never resolves claude-cli: the driver provides complete() only", async () => {
  assert.equal(typeof claudeCliDriver.complete, "function");
  const s = setup("process.exit(0);");
  try {
    const prompt = path.join(s.dir, "p.txt");
    const subject = path.join(s.dir, "s.txt");
    fs.writeFileSync(prompt, "p");
    fs.writeFileSync(subject, "s");
    const r = await llmJudge(s.deps({ CLAUDE_CODE_OAUTH_TOKEN: "t" }), prompt, subject, "c");
    assert.equal(r.status, 1);
    assert.match(r.stderr, /driver for backend=claude-cli/);
  } finally {
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});
