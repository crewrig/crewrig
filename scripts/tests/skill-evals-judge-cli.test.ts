// skill-evals-judge-cli.test.ts — the headless `claude -p` judge driver (spec 0290 R15, R33 and delta-03
// R40, R41, R42). A stub `claude` records argv, environment and stdin and answers `auth status --json`
// with decoy account fields; `fetch` throws. No model call.

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { llmJudge, llmJudgeEvidence } from "../../tests/e2e/lib/llm_judge.ts";
import type { JudgeDeps } from "../../tests/e2e/lib/llm_judge.ts";
import {
  buildJudgeArgs,
  claudeCliDriver,
} from "../../tests/e2e/lib/llm_judge_drivers/claude-cli.ts";
import { ISOLATION_FLAGS, resetLoginProbe } from "../lib/skill-evals/claude-child.ts";
import { JUDGE_MODEL } from "../lib/skill-evals/settings.ts";
import { readCalls, tmpDir, writeStubClaude } from "./lib/skill-evals-fixtures.ts";
import type { AuthStub } from "./lib/skill-evals-fixtures.ts";

const throwing = (() => {
  throw new Error("the Messages API must not be reached");
}) as unknown as typeof fetch;

const FAKE_HOME = "/contributor/home";

function setup(stubBody: string, auth: AuthStub = { loggedIn: true }) {
  resetLoginProbe();
  const dir = tmpDir();
  const log = path.join(dir, "log.json");
  const report = path.join(dir, "report");
  fs.mkdirSync(report);
  fs.writeFileSync(
    path.join(report, "effective.json"),
    JSON.stringify({ judge: { backend: "claude-cli", model: JUDGE_MODEL, max_calls: 50 } }),
  );
  const bin = writeStubClaude(
    dir,
    `let input = "";\nprocess.stdin.on("data", (d) => (input += d));\nprocess.stdin.on("end", () => {\n${stubBody.replaceAll("LOG", JSON.stringify(log))}\n});\n`,
    "claude-stub.js",
    auth,
  );
  const deps = (env: Record<string, string> = {}): JudgeDeps => ({
    env: {
      E2E_REPORT_DIR: report,
      SKILL_EVALS_CLAUDE_BIN: bin,
      PATH: process.env["PATH"] ?? "",
      HOME: FAKE_HOME,
      USER: "contributor",
      ...env,
    },
    now: () => 0,
    sleep: async () => undefined,
    fetch: throwing,
  });
  return { dir, log, bin, deps };
}

test("R15, R40, R42: the token reaches the child through its environment only; the prompt arrives on stdin; the request is a no-tools single turn under the isolation flags and the contributor's HOME", async () => {
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
    assert.equal(seen.env.HOME, FAKE_HOME, "the contributor's HOME, not a temporary directory");
    assert.equal(seen.env.CLAUDE_CONFIG_DIR, undefined, "none set, none invented");
    assert.equal(seen.env.USER, "contributor");
    const a: string[] = seen.argv;
    assert.equal(a.join(" ").includes("tok-judge"), false, "never on argv");
    assert.equal(a[a.indexOf("--tools") + 1], "", "no tools");
    assert.ok(a.includes("-p") && a.includes("--disable-slash-commands"));
    assert.equal(a[a.indexOf("--setting-sources") + 1], "project");
    assert.ok(a.includes("--strict-mcp-config") && a.includes("--no-session-persistence"));
    assert.equal(a.includes("--bare"), false);
    assert.equal(a[a.indexOf("--model") + 1], "claude-sonnet-5-5");
    assert.equal(
      a.includes("--max-turns"),
      false,
      "flag unverified: single turn is inherent with no tools",
    );
    assert.equal(readCalls(s.bin, "auth").length, 0, "a token needs no login probe");
  } finally {
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test("buildJudgeArgs: the no-tools request plus ISOLATION_FLAGS, once, and no --bare", () => {
  const a = buildJudgeArgs("claude-sonnet-5-5");
  assert.deepEqual(a, [
    "-p",
    "--output-format",
    "text",
    "--model",
    "claude-sonnet-5-5",
    "--tools",
    "",
    "--disable-slash-commands",
    ...ISOLATION_FLAGS,
  ]);
  assert.deepEqual(a.slice(-4), [
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    "--no-session-persistence",
  ]);
  assert.equal(a.filter((x) => x === "--no-session-persistence").length, 1);
  assert.equal(a.includes("--bare"), false);
});

test("no token and not logged in means auth-missing before any model call; a failing child is a failed call, not a verdict", async () => {
  const s = setup(`require("fs").writeFileSync(LOG, "spawned");\nprocess.exit(1);`, {
    loggedIn: false,
  });
  try {
    assert.deepEqual(await llmJudgeEvidence(s.deps(), "m"), {
      kind: "auth-missing",
      backend: "claude-cli",
    });
    assert.equal(fs.existsSync(s.log), false, "the model entry is never reached when logged out");
    assert.deepEqual(
      readCalls(s.bin).map((c) => c.kind),
      ["auth"],
      "only the login probe ran",
    );
    const r = await llmJudgeEvidence(s.deps({ CLAUDE_CODE_OAUTH_TOKEN: "t" }), "m");
    assert.ok(r.kind === "verdict" && r.texts.every((t) => t === undefined));
  } finally {
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test("R33, R41: without a token the preflight is the login probe; a logged-in session judges with no credential variable, an unrequested key kept out, the probe run once for many calls", async () => {
  const s = setup(
    `require("fs").appendFileSync(LOG, JSON.stringify({ env: process.env, cwd: process.cwd() }) + "\\n");\nprocess.stdout.write('VERDICT=PASS CONF=0.85\\nEVIDENCE="an excerpt"\\n');`,
  );
  try {
    const deps = s.deps({ ANTHROPIC_API_KEY: "key-not-requested" });
    for (let i = 0; i < 4; i++) {
      const r = await llmJudgeEvidence(deps, `message ${i}`);
      assert.equal(r.kind, "verdict");
      if (r.kind === "verdict") assert.equal(r.verdict, "PASS");
    }
    const seen = fs
      .readFileSync(s.log, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    assert.ok(seen.length >= 4);
    for (const c of seen) {
      assert.equal(c.env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
      assert.equal(c.env.ANTHROPIC_API_KEY, undefined);
      assert.equal(c.env.HOME, FAKE_HOME);
    }
    const probes = readCalls(s.bin, "auth");
    assert.equal(probes.length, 1, "memoised: one probe per invocation, not one per judge call");
    assert.deepEqual(probes[0]?.argv, ["auth", "status", "--json"]);
    assert.equal(probes[0]?.env["ANTHROPIC_API_KEY"], undefined, "the probe never sees the key");
    assert.equal(probes[0]?.env["HOME"], FAKE_HOME);
  } finally {
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test("F2: the judge call's working directory is outside HOME and outside any git work tree", async () => {
  const s = setup(
    `require("fs").writeFileSync(LOG, JSON.stringify({ cwd: process.cwd() }));\nprocess.stdout.write('VERDICT=PASS CONF=0.85\\nEVIDENCE="an excerpt"\\n');`,
  );
  try {
    await llmJudgeEvidence(s.deps({ HOME: process.env["HOME"] ?? FAKE_HOME }), "m");
    const { cwd } = JSON.parse(fs.readFileSync(s.log, "utf8")) as { cwd: string };
    const rel = path.relative(fs.realpathSync(process.env["HOME"] ?? FAKE_HOME), cwd);
    assert.ok(rel.startsWith(".."), `${cwd} is inside HOME`);
    assert.equal(
      path.relative(path.resolve(import.meta.dirname, "..", ".."), cwd).startsWith(".."),
      true,
      "outside the repository checkout",
    );
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
