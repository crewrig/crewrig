// skill-evals-credentials.test.ts — local credentials and the judge configuration
// (spec 0290 R33, R39, R25). No model call: a stub `claude` that exits 99, a recording `fetch`.

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { planCredentials, MISSING_MESSAGE } from "../lib/skill-evals/credentials.ts";
import { skillRel, tmpDir, writeStubClaude } from "./lib/skill-evals-fixtures.ts";
import { judgeFetch, makeRig, plainEvals } from "./lib/skill-evals-run-rig.ts";
import type { MockScript } from "../lib/skill-evals/executor/mock.ts";

const fox: MockScript = () => ({
  files: { "answer.md": "x" },
  transcript: "Assistant: the quick brown fox",
});
const evalsOnly = (repo: { root: string }) =>
  fs.writeFileSync(
    path.join(repo.root, skillRel("demo"), "evals", "evals.json"),
    plainEvals("demo", 1),
  );
const judgeCfg = (out: string) =>
  JSON.parse(fs.readFileSync(path.join(out, "demo", ".judge", "effective.json"), "utf8")).judge;

test("neither variable and no mock: exit 3, both variables named, no model call, no results file", async () => {
  const rig = makeRig({ mock: false, env: {} });
  try {
    const r = await rig.run();
    assert.equal(r.exitCode, 3);
    assert.match(r.stderr, /CLAUDE_CODE_OAUTH_TOKEN/);
    assert.match(r.stderr, /ANTHROPIC_API_KEY/);
    assert.match(r.stderr, /claude setup-token/);
    assert.equal(rig.executor.calls.length, 0);
    assert.equal(
      fs.existsSync(path.join(rig.repo.root, skillRel("demo"), "evals", "results.json")),
      false,
    );
    assert.equal(MISSING_MESSAGE.includes("No model call"), true);
  } finally {
    rig.cleanup();
  }
});

test("only ANTHROPIC_API_KEY: planning proceeds, the judge uses the anthropic driver with that key and no judge-specific variable", async () => {
  const rig = makeRig({
    mock: false,
    env: { ANTHROPIC_API_KEY: "sk-key" },
    change: evalsOnly,
    script: fox,
  });
  try {
    const j = judgeFetch();
    const r = await rig.run({ fetchImpl: j.fetch });
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    assert.equal(rig.executor.calls[0]?.credential?.name, "ANTHROPIC_API_KEY");
    const cfg = judgeCfg(rig.out);
    assert.equal(cfg.backend, "anthropic");
    assert.equal(cfg.api_key_env, "ANTHROPIC_API_KEY");
    assert.equal(cfg.max_calls, 300);
    assert.ok(j.requests.length > 0);
    assert.ok(
      j.requests.every(
        (q) =>
          q.url === "https://api.anthropic.com/v1/messages" && q.headers["x-api-key"] === "sk-key",
      ),
    );
  } finally {
    rig.cleanup();
  }
});

test("both set: the token is the one given to the executor, and the judge follows it through headless claude -p, never the Messages API", async () => {
  const dir = tmpDir();
  const log = path.join(dir, "log.jsonl");
  const stub = writeStubClaude(
    dir,
    `#!/usr/bin/env node
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  require("fs").appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), token: process.env.CLAUDE_CODE_OAUTH_TOKEN, envKeys: Object.keys(process.env).sort(), cwd: process.cwd(), home: process.env.HOME, hasExpectation: input.includes("EXPECTATION:") }) + "\\n");
  process.stdout.write('VERDICT=PASS CONF=0.90\\nEVIDENCE="the quick brown fox"\\n');
});
`,
  );
  const rig = makeRig({
    mock: false,
    env: {
      CLAUDE_CODE_OAUTH_TOKEN: "tok-secret",
      ANTHROPIC_API_KEY: "sk-key",
      SKILL_EVALS_CLAUDE_BIN: stub,
    },
    change: evalsOnly,
    script: fox,
  });
  try {
    const r = await rig.run(); // fetch is the throwing stub: any Messages API request would fail the run
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    assert.equal(rig.executor.calls[0]?.credential?.name, "CLAUDE_CODE_OAUTH_TOKEN");
    assert.equal(rig.executor.calls[0]?.credential?.value, "tok-secret");
    assert.equal(judgeCfg(rig.out).backend, "claude-cli");
    const calls = fs
      .readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    assert.ok(calls.length >= 2);
    for (const c of calls) {
      assert.deepEqual(c.argv.filter((a: string) => a === "-p").length, 1);
      assert.ok(c.argv.includes("--tools") && c.argv[c.argv.indexOf("--tools") + 1] === "");
      assert.ok(
        c.argv.includes("--no-session-persistence") && c.argv.includes("--disable-slash-commands"),
      );
      assert.equal(c.argv.includes("tok-secret"), false, "the token is never on argv");
      assert.equal(c.token, "tok-secret");
      assert.equal(c.hasExpectation, true, "the judge prompt arrives on stdin");
      assert.ok(
        !c.envKeys.includes("ANTHROPIC_API_KEY") && !c.envKeys.includes("SKILL_EVALS_CLAUDE_BIN"),
        c.envKeys.join(","),
      );
      assert.notEqual(c.home, process.env["HOME"]);
    }
    assert.doesNotMatch(
      fs.readFileSync(path.join(rig.out, "demo", "eval-1", "with_skill", "grading.json"), "utf8"),
      /tok-secret/,
    );
  } finally {
    rig.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a judge override is honoured; one that would send the subscription credential is refused with exit 3", async () => {
  const dir = tmpDir();
  const cfg = (judge: object) => {
    const f = path.join(dir, `judge-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(f, JSON.stringify({ judge }));
    return f;
  };
  const rig = makeRig({
    mock: false,
    env: { ANTHROPIC_API_KEY: "sk-key", CLAUDE_CODE_OAUTH_TOKEN: "tok" },
    change: evalsOnly,
    script: fox,
  });
  try {
    for (const [judge, what] of [
      [{ backend: "claude-code", auth_mode: "oauth" }, /claude-code/],
      [{ backend: "claude-code", auth_mode: "api_key" }, /claude-code/],
      [{ api_key_env: "CLAUDE_CODE_OAUTH_TOKEN" }, /api_key_env CLAUDE_CODE_OAUTH_TOKEN/],
      [
        { backend: "anthropic", api_key_env: "CLAUDE_CODE_OAUTH_TOKEN" },
        /api_key_env CLAUDE_CODE_OAUTH_TOKEN/,
      ],
    ] as const) {
      const r = await rig.run({ judgeConfigFile: cfg(judge) });
      assert.equal(r.exitCode, 3, JSON.stringify(judge));
      assert.match(r.stderr, what);
      assert.match(r.stderr, /subscription credential to the Messages API/);
      assert.match(r.stderr, /No model call was made/);
    }
    assert.equal(rig.executor.calls.length, 0);
    const bad = await rig.run({ judgeConfigFile: cfg({ backend: "gemini" }) });
    assert.equal(bad.exitCode, 3);
    assert.match(bad.stderr, /not supported/);
    // a harmless override (model) is honoured
    const j = judgeFetch();
    const env2 = makeRig({
      mock: false,
      env: { ANTHROPIC_API_KEY: "sk-key" },
      change: evalsOnly,
      script: fox,
    });
    try {
      const ok = await env2.run({
        fetchImpl: j.fetch,
        judgeConfigFile: cfg({ model: "claude-haiku-x" }),
      });
      assert.equal(ok.exitCode, 0, ok.text + ok.stderr);
      assert.equal(judgeCfg(env2.out).model, "claude-haiku-x");
    } finally {
      env2.cleanup();
    }
  } finally {
    rig.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("planCredentials: the effective judge configuration follows the credential", () => {
  const p = (env: Record<string, string>, override = {}) =>
    planCredentials({ env, override, mock: false });
  const tok = p({ CLAUDE_CODE_OAUTH_TOKEN: "t" });
  assert.ok(
    tok.ok &&
      tok.judge.backend === "claude-cli" &&
      tok.credential?.name === "CLAUDE_CODE_OAUTH_TOKEN",
  );
  const key = p({ ANTHROPIC_API_KEY: "k" });
  assert.ok(
    key.ok && key.judge.backend === "anthropic" && key.judge.api_key_env === "ANTHROPIC_API_KEY",
  );
  assert.equal(p({}).ok, false);
  const mock = planCredentials({ env: {}, override: {}, mock: true });
  assert.ok(mock.ok && mock.credential === undefined);
  const refused = planCredentials({ env: {}, override: { backend: "claude-code" }, mock: true });
  assert.equal(refused.ok, false, "the refusal applies in mock mode too");
});

test("no executor or CI credential variable of the old design is read anywhere in the runner", () => {
  const dir = path.resolve(import.meta.dirname, "../lib/skill-evals");
  const all = [...fs.readdirSync(dir, { recursive: true, encoding: "utf8" })]
    .filter((f) => f.endsWith(".ts"))
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
    .join("\n");
  for (const gone of ["ANTHROPIC_EXECUTOR_API_KEY", "SKILL_EVALS_PR_NUMBER", "SKILL_EVALS_REPO"]) {
    // named only in comments that say they do not exist
    for (const line of all.split("\n").filter((l) => l.includes(gone)))
      assert.match(line, /^\s*\/\/|do not exist|never/, line);
  }
  assert.equal(/process\.env\[["']ANTHROPIC_EXECUTOR_API_KEY/.test(all), false);
});
