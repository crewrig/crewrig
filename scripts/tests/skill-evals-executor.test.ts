// skill-evals-executor.test.ts — the headless Claude Code executor against a stub `claude`
// (spec 0290 R9, R27, R30, R32, R33, R25). The stub is a Node script: no model, no network.

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  buildArgs,
  buildEnv,
  ClaudeCodeExecutor,
} from "../lib/skill-evals/executor/claude-code.ts";
import type { ExecRequest } from "../lib/skill-evals/executor/types.ts";
import { judgeFetch, makeRig, plainEvals } from "./lib/skill-evals-run-rig.ts";
import { cleanEnv, skillRel, tmpDir, writeStubClaude } from "./lib/skill-evals-fixtures.ts";

function request(over: Partial<ExecRequest> & { bin: string }): { req: ExecRequest; root: string } {
  const root = tmpDir("skill-evals-exec-");
  const workspace = path.join(root, "workspace");
  const home = path.join(root, "home");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  const { bin, ...rest } = over;
  return {
    root,
    req: {
      prompt: "Do the task",
      workspaceDir: workspace,
      homeDir: home,
      model: "claude-sonnet-4-6",
      limits: { turns: 25, seconds: 30, usd: 1 },
      credential: { name: "CLAUDE_CODE_OAUTH_TOKEN", value: "tok-secret-value" },
      signal: new AbortController().signal,
      baseEnv: {
        ...cleanEnv(),
        SKILL_EVALS_CLAUDE_BIN: bin,
        ANTHROPIC_API_KEY: "must-not-leak",
        SOME_OTHER: "x",
      },
      label: "t",
      ...rest,
    },
  };
}

const stream = (...events: object[]) =>
  events
    .map((e) => `process.stdout.write(${JSON.stringify(`${JSON.stringify(e)}\n`)});`)
    .join("\n");
const assistant = (text: string) => ({
  type: "assistant",
  message: { content: [{ type: "text", text }] },
});
const result = (extra: object = {}) => ({
  type: "result",
  subtype: "success",
  is_error: false,
  total_cost_usd: 0.4,
  usage: { input_tokens: 10, output_tokens: 5 },
  num_turns: 1,
  result: "done",
  ...extra,
});
let stubCount = 0;
const stub = (dir: string, body: string) =>
  writeStubClaude(
    dir,
    `#!/usr/bin/env node\nconst fs = require("fs");\n${body}\n`,
    `claude-stub-${stubCount++}.js`,
  );

test("argv and environment: the pinned model, tool allowlist, limits, one credential, never the credential on argv", async () => {
  const dir = tmpDir();
  const log = path.join(dir, "log.json");
  const bin = stub(
    dir,
    `fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify({ argv: process.argv.slice(2), env: process.env, cwd: process.cwd() }));
fs.writeFileSync("answer.md", "produced");
${stream(assistant("hello"), result())}`,
  );
  const { req, root } = request({ bin });
  try {
    const out = await new ClaudeCodeExecutor().run(req);
    assert.equal(out.failure, undefined);
    assert.equal(out.limit, undefined);
    assert.equal(out.costUsd, 0.4);
    assert.deepEqual(out.usage, { input_tokens: 10, output_tokens: 5 });
    const seen = JSON.parse(fs.readFileSync(log, "utf8"));
    const a: string[] = seen.argv;
    assert.deepEqual(a.slice(0, 2), ["-p", "Do the task"]);
    const opt = (k: string) => a[a.indexOf(k) + 1];
    assert.equal(opt("--output-format"), "stream-json");
    assert.equal(opt("--model"), "claude-sonnet-4-6");
    assert.equal(opt("--tools"), "Bash,Read,Write,Edit,Skill");
    assert.equal(opt("--allowedTools"), "Bash Read Write Edit Skill");
    assert.equal(opt("--max-turns"), "25");
    assert.equal(opt("--max-budget-usd"), "1");
    assert.equal(opt("--permission-mode"), "dontAsk");
    assert.ok(a.includes("--no-session-persistence"));
    assert.equal(a.join(" ").includes("tok-secret-value"), false);
    assert.deepEqual(
      Object.keys(seen.env).filter(
        (k) =>
          !k.startsWith("__CF") &&
          ![
            "PATH",
            "HOME",
            "CLAUDE_CONFIG_DIR",
            "LANG",
            "LC_ALL",
            "TMPDIR",
            "CLAUDE_CODE_OAUTH_TOKEN",
          ].includes(k),
      ),
      [],
      "only the allowlist plus one credential",
    );
    assert.equal(seen.env.CLAUDE_CODE_OAUTH_TOKEN, "tok-secret-value");
    assert.equal(seen.env.HOME, req.homeDir);
    assert.equal(seen.env.CLAUDE_CONFIG_DIR, path.join(req.homeDir, ".claude"));
    assert.equal(fs.realpathSync(seen.cwd), fs.realpathSync(req.workspaceDir));
    assert.equal(fs.readFileSync(path.join(req.workspaceDir, "answer.md"), "utf8"), "produced");
    assert.match(out.transcript, /Assistant: hello/);
    assert.deepEqual(Object.keys(buildEnv(req)).sort(), [
      "CLAUDE_CODE_OAUTH_TOKEN",
      "CLAUDE_CONFIG_DIR",
      "HOME",
      "LANG",
      "PATH",
    ]);
    assert.equal(buildArgs(req).includes("--bare"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the credential is scrubbed from the transcript", async () => {
  const dir = tmpDir();
  const bin = stub(dir, stream(assistant("my token is tok-secret-value, honest"), result()));
  const { req, root } = request({ bin });
  try {
    const out = await new ClaudeCodeExecutor().run(req);
    assert.doesNotMatch(out.transcript, /tok-secret-value/);
    assert.match(out.transcript, /\[redacted\]/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a run killed at the wall-clock limit leaves no result record: limit tagged, partial output kept, cost unknown, process group gone", async () => {
  const dir = tmpDir();
  const pidFile = path.join(dir, "pid");
  const bin = stub(
    dir,
    `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
fs.writeFileSync("partial.md", "so far");
${stream(assistant("working"))}
setInterval(() => {}, 1000);`,
  );
  const { req, root } = request({ bin, limits: { turns: 25, seconds: 0.5, usd: 1 } });
  try {
    const out = await new ClaudeCodeExecutor().run(req);
    assert.equal(out.limit, "wall-clock");
    assert.equal(out.failure, undefined);
    assert.equal(out.costUsd, null);
    assert.equal(fs.readFileSync(path.join(req.workspaceDir, "partial.md"), "utf8"), "so far");
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    await new Promise((r) => setTimeout(r, 100));
    assert.throws(() => process.kill(pid, 0), /ESRCH/, "the stub is dead");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a run past the turn limit is killed on the first turn beyond it and tagged turns", async () => {
  const dir = tmpDir();
  const bin = stub(
    dir,
    `${stream(assistant("one"), assistant("two"), assistant("three"))}\nsetInterval(() => {}, 1000);`,
  );
  const { req, root } = request({ bin, limits: { turns: 2, seconds: 30, usd: 1 } });
  try {
    const out = await new ClaudeCodeExecutor().run(req);
    assert.equal(out.limit, "turns");
    assert.equal(out.failure, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a result record that reports a turn or budget limit is a limit, with its measured cost", async () => {
  for (const [subtype, limit] of [
    ["error_max_turns", "turns"],
    ["error_max_budget_usd", "budget"],
  ] as const) {
    const dir = tmpDir();
    const bin = stub(
      dir,
      stream(assistant("x"), result({ subtype, is_error: true, total_cost_usd: 0.99 })),
    );
    const { req, root } = request({ bin });
    try {
      const out = await new ClaudeCodeExecutor().run(req);
      assert.equal(out.limit, limit);
      assert.equal(out.failure, undefined);
      assert.equal(out.costUsd, 0.99);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("an abnormal exit with no limit and no result record is an executor failure; so is a missing binary", async () => {
  const dir = tmpDir();
  const bin = stub(dir, `${stream(assistant("x"))}\nprocess.exit(1);`);
  const a = request({ bin });
  const b = request({ bin: "/nonexistent/claude" });
  const c = request({
    bin: stub(
      dir,
      stream(assistant("x"), result({ subtype: "error_during_execution", is_error: true })),
    ),
  });
  try {
    const out = await new ClaudeCodeExecutor().run(a.req);
    assert.match(out.failure ?? "", /without a result record \(exit code 1\)/);
    assert.equal(out.limit, undefined);
    const missing = await new ClaudeCodeExecutor().run(b.req);
    assert.match(missing.failure ?? "", /not found on PATH \(install Claude Code/);
    const errored = await new ClaudeCodeExecutor().run(c.req);
    assert.match(errored.failure ?? "", /error_during_execution/);
  } finally {
    for (const r of [a, b, c]) fs.rmSync(r.root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an aborted run is reported aborted, not failed", async () => {
  const dir = tmpDir();
  const bin = stub(dir, "setInterval(() => {}, 1000);");
  const ac = new AbortController();
  const { req, root } = request({ bin, signal: ac.signal });
  try {
    setTimeout(() => ac.abort(), 150);
    const out = await new ClaudeCodeExecutor().run(req);
    assert.equal(out.aborted, true);
    assert.equal(out.failure, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a with_skill run installs the skill without evals/ into the throwaway config; without_skill has no skill; the user config is untouched", async () => {
  const dir = tmpDir();
  const log = path.join(dir, "log.jsonl");
  const bin = stub(
    dir,
    `const skills = path.join(process.env.CLAUDE_CONFIG_DIR, "skills");
const list = (d) => fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }).map(String).sort() : null;
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ prompt: process.argv[3], skills: list(skills), exec: fs.existsSync(path.join(skills, "demo", "scripts", "run.sh")) && (fs.statSync(path.join(skills, "demo", "scripts", "run.sh")).mode & 0o100) !== 0, home: process.env.HOME }) + "\\n");
fs.writeFileSync("answer.md", "x");
${stream(assistant("the quick brown fox"), result())}`.replace(
      "const skills",
      'const path = require("path");\nconst skills',
    ),
  );
  const rig = makeRig({
    evalsCount: 1,
    mock: false,
    env: { CLAUDE_CODE_OAUTH_TOKEN: "tok", SKILL_EVALS_CLAUDE_BIN: bin },
    change: (repo) => {
      fs.writeFileSync(
        path.join(repo.root, skillRel("demo"), "evals", "evals.json"),
        plainEvals("demo", 1),
      );
      fs.writeFileSync(path.join(repo.root, skillRel("demo"), "notes.md"), "stray");
    },
  });
  try {
    const home = process.env["HOME"];
    const before = fs.existsSync(path.join(home ?? "", ".claude", "skills", "demo"));
    const j = judgeFetch();
    // the judge goes through the Messages stub of an API-key judge override so that the claude stub only plays the executor
    const judgeCfg = path.join(dir, "judge.json");
    fs.writeFileSync(
      judgeCfg,
      JSON.stringify({ judge: { backend: "anthropic", api_key_env: "JUDGE_TEST_KEY" } }),
    );
    const r = await rig.run({
      executor: undefined,
      fetchImpl: j.fetch,
      judgeConfigFile: judgeCfg,
      env: {
        ...cleanEnv({
          CLAUDE_CODE_OAUTH_TOKEN: "tok",
          SKILL_EVALS_CLAUDE_BIN: bin,
          JUDGE_TEST_KEY: "jk",
        }),
      },
    });
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    const calls = fs
      .readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    assert.equal(
      calls.length,
      2,
      "only evals.json changed: with_skill and without_skill, no base replay",
    );
    const withSkill = calls.filter((c) => c.skills !== null);
    const without = calls.filter((c) => c.skills === null);
    assert.equal(withSkill.length, 1);
    assert.equal(without.length, 1);
    for (const c of withSkill) {
      assert.deepEqual(
        c.skills.filter((p: string) => !p.includes("/")),
        ["demo"],
      );
      assert.ok(
        c.skills.includes("demo/SKILL.md") &&
          c.skills.includes("demo/scripts/run.sh") &&
          c.skills.includes("demo/references/ref.md"),
      );
      assert.equal(
        c.skills.some((p: string) => p.includes("evals") || p.includes("notes.md")),
        false,
        c.skills.join(","),
      );
      assert.equal(c.exec, true);
    }
    assert.equal(fs.existsSync(path.join(home ?? "", ".claude", "skills", "demo")), before);
  } finally {
    rig.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
