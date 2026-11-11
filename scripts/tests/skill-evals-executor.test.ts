// skill-evals-executor.test.ts — the headless Claude Code executor against a stub `claude`
// (spec 0290 R9, R27, R30, R32, R33, R25 and delta-03 R40, R42). The stub is a Node script: no model, no
// network.

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
import {
  cleanEnv,
  isolatedDirs,
  readCalls,
  skillRel,
  tmpDir,
  writeSessionStub,
  writeStubClaude,
} from "./lib/skill-evals-fixtures.ts";

/** The R42 allowlist members this suite sets; everything else of the runner's environment must not reach the child. */
const SET_ALLOWLIST = {
  HOME: "/contributor/home",
  USER: "contributor",
  LANG: "C",
  LC_ALL: "C",
  TMPDIR: "/contributor/tmp",
  CLAUDE_CONFIG_DIR: "/contributor/claude-config",
  NODE_EXTRA_CA_CERTS: "/ca/extra.pem",
  SSL_CERT_FILE: "/ca/cert.pem",
  SSL_CERT_DIR: "/ca/certs",
  HTTPS_PROXY: "http://proxy.invalid:3128",
  https_proxy: "http://proxy-lower.invalid:3128",
  HTTP_PROXY: "http://proxy.invalid:3128",
  http_proxy: "http://proxy-lower.invalid:3128",
  NO_PROXY: "localhost",
  no_proxy: "localhost,127.0.0.1",
} as const;

function request(over: Partial<ExecRequest> & { bin: string }): { req: ExecRequest; root: string } {
  const root = tmpDir("skill-evals-exec-");
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  const { bin, ...rest } = over;
  return {
    root,
    req: {
      prompt: "Do the task",
      workspaceDir: workspace,
      model: "claude-sonnet-5-5",
      limits: { turns: 25, seconds: 30, usd: 1 },
      credential: { name: "CLAUDE_CODE_OAUTH_TOKEN", value: "tok-secret-value" },
      signal: new AbortController().signal,
      baseEnv: {
        ...cleanEnv(),
        SKILL_EVALS_CLAUDE_BIN: bin,
        ANTHROPIC_API_KEY: "must-not-leak",
        SOME_OTHER: "x",
        ...SET_ALLOWLIST,
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

test("argv and environment: the pinned model, tool allowlist, limits, the isolation flags, one credential, never the credential on argv (R40, R42)", async () => {
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
    assert.equal(opt("--model"), "claude-sonnet-5-5");
    assert.equal(opt("--tools"), "Bash,Read,Write,Edit,Skill");
    assert.equal(opt("--allowedTools"), "Bash Read Write Edit Skill");
    assert.equal(opt("--max-turns"), "25");
    assert.equal(opt("--max-budget-usd"), "1");
    assert.equal(opt("--permission-mode"), "dontAsk");
    // R40: the isolation flags, once each, and never --bare
    assert.equal(opt("--setting-sources"), "project");
    assert.equal(a.filter((x) => x === "--setting-sources").length, 1);
    assert.equal(a.filter((x) => x === "--strict-mcp-config").length, 1);
    assert.equal(a.filter((x) => x === "--no-session-persistence").length, 1);
    assert.equal(a.includes("--bare"), false);
    assert.equal(a.join(" ").includes("tok-secret-value"), false);
    // R42: exactly the allowlist members that are set, plus the one credential; nothing else
    const keys = Object.keys(seen.env).filter((k) => !k.startsWith("__CF"));
    assert.deepEqual(
      keys.sort(),
      [...Object.keys(SET_ALLOWLIST), "CLAUDE_CODE_OAUTH_TOKEN", "PATH"].sort(),
      "only the allowlist plus one credential",
    );
    for (const [k, v] of Object.entries(SET_ALLOWLIST)) assert.equal(seen.env[k], v, k);
    assert.equal(seen.env.CLAUDE_CODE_OAUTH_TOKEN, "tok-secret-value");
    assert.equal(seen.env.ANTHROPIC_API_KEY, undefined);
    assert.equal(seen.env.SOME_OTHER, undefined);
    assert.equal(seen.env.SKILL_EVALS_CLAUDE_BIN, undefined);
    assert.equal(fs.realpathSync(seen.cwd), fs.realpathSync(req.workspaceDir));
    assert.equal(fs.readFileSync(path.join(req.workspaceDir, "answer.md"), "utf8"), "produced");
    assert.match(out.transcript, /Assistant: hello/);
    assert.deepEqual(
      Object.keys(buildEnv(req)).sort(),
      [...Object.keys(SET_ALLOWLIST), "CLAUDE_CODE_OAUTH_TOKEN", "PATH"].sort(),
    );
    assert.equal(buildArgs(req).includes("--bare"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("R42: session mode has no credential variable, a token adds only CLAUDE_CODE_OAUTH_TOKEN, --use-api-key adds only ANTHROPIC_API_KEY; the allowlist members that are unset are not passed", () => {
  const baseEnv = {
    PATH: "/bin",
    HOME: "/h",
    ANTHROPIC_API_KEY: "k",
    CLAUDE_CODE_OAUTH_TOKEN: "t",
  };
  const mk = (credential: ExecRequest["credential"]): ExecRequest => ({
    ...request({ bin: "/x" }).req,
    credential,
    baseEnv,
  });
  assert.deepEqual(buildEnv(mk(undefined)), { PATH: "/bin", HOME: "/h" });
  assert.deepEqual(buildEnv(mk({ name: "CLAUDE_CODE_OAUTH_TOKEN", value: "t" })), {
    PATH: "/bin",
    HOME: "/h",
    CLAUDE_CODE_OAUTH_TOKEN: "t",
  });
  assert.deepEqual(buildEnv(mk({ name: "ANTHROPIC_API_KEY", value: "k" })), {
    PATH: "/bin",
    HOME: "/h",
    ANTHROPIC_API_KEY: "k",
  });
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
  const { req, root } = request({ bin, limits: { turns: 25, seconds: 2, usd: 1 } });
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

test("a turn is one assistant message: events sharing a message.id count once", async () => {
  const dir = tmpDir();
  const ev = (id: string, text: string) => ({
    type: "assistant",
    message: { id, content: [{ type: "text", text }] },
  });
  const bin = stub(
    dir,
    `${stream(ev("m1", "a"), ev("m1", "b"), ev("m1", "c"), ev("m2", "d"), result())}`,
  );
  const split = request({ bin, limits: { turns: 2, seconds: 30, usd: 1 } });
  const bin2 = stub(
    dir,
    stream(ev("m1", "a"), ev("m2", "b"), ev("m3", "c")) + "\nsetInterval(() => {}, 1000);",
  );
  const over = request({ bin: bin2, limits: { turns: 2, seconds: 30, usd: 1 } });
  try {
    const ok = await new ClaudeCodeExecutor().run(split.req);
    assert.equal(ok.limit, undefined, "4 events but 2 messages: within the limit of 2");
    assert.equal(ok.turns, 2);
    const killed = await new ClaudeCodeExecutor().run(over.req);
    assert.equal(killed.limit, "turns", "a third distinct message exceeds the limit");
  } finally {
    for (const r of [split, over]) fs.rmSync(r.root, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
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

test("a with_skill run installs the skill at <workspace>/.claude/skills/<name> without evals/; without_skill has none; HOME is the contributor's and is left untouched (R32, R40)", async () => {
  const dir = tmpDir();
  const log = path.join(dir, "log.jsonl");
  const bin = stub(
    dir,
    `const path = require("path");
const skills = path.join(process.cwd(), ".claude", "skills");
const list = (d) => fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }).map(String).sort() : null;
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ cwd: process.cwd(), skills: list(skills), exec: fs.existsSync(path.join(skills, "demo", "scripts", "run.sh")) && (fs.statSync(path.join(skills, "demo", "scripts", "run.sh")).mode & 0o100) !== 0, home: process.env.HOME }) + "\\n");
fs.writeFileSync("answer.md", "x");
${stream(assistant("the quick brown fox"), result())}`,
  );
  const iso = isolatedDirs();
  const rig = makeRig({
    evalsCount: 1,
    mock: false,
    tempRoot: iso.tempRoot,
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
    const realHome = process.env["HOME"];
    const before = fs.existsSync(path.join(realHome ?? "", ".claude", "skills", "demo"));
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
          HOME: iso.home,
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
    assert.equal(without.length, 1, "a without_skill workspace has no .claude/skills");
    for (const c of calls) {
      assert.equal(c.home, iso.home, "the child keeps the contributor's HOME");
      // the recorded cwd is the OS's own (real) path of a workspace that no longer exists
      const rel = path.relative(fs.realpathSync(iso.home), c.cwd);
      assert.ok(rel.startsWith(".."), "the workspace is outside HOME");
    }
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
    assert.deepEqual(fs.readdirSync(iso.home), [], "nothing was written to the contributor's HOME");
    assert.equal(fs.existsSync(path.join(realHome ?? "", ".claude", "skills", "demo")), before);
  } finally {
    rig.cleanup();
    iso.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("R40, R42 end to end in session mode: the executor child of a real run holds the contributor's HOME, the isolation flags, no credential variable and, with an unrequested ANTHROPIC_API_KEY, no key", async () => {
  const dir = tmpDir();
  const bin = writeSessionStub(dir, { loggedIn: true });
  const iso = isolatedDirs();
  const rig = makeRig({
    evalsCount: 1,
    mock: false,
    tempRoot: iso.tempRoot,
    change: (repo) =>
      fs.writeFileSync(
        path.join(repo.root, skillRel("demo"), "evals", "evals.json"),
        plainEvals("demo", 1),
      ),
  });
  try {
    const r = await rig.run({
      executor: undefined,
      env: cleanEnv({
        SKILL_EVALS_CLAUDE_BIN: bin,
        ANTHROPIC_API_KEY: "sk-unrequested",
        SOME_OTHER: "x",
        ...SET_ALLOWLIST,
        HOME: iso.home,
      }),
    });
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    const calls = readCalls(bin, "executor");
    assert.equal(calls.length, 2);
    for (const c of calls) {
      assert.equal(c.env["HOME"], iso.home);
      assert.equal(c.env["USER"], "contributor");
      assert.equal(c.env["ANTHROPIC_API_KEY"], undefined);
      assert.equal(c.env["CLAUDE_CODE_OAUTH_TOKEN"], undefined);
      assert.equal(c.env["SOME_OTHER"], undefined);
      assert.equal(c.env["https_proxy"], SET_ALLOWLIST.https_proxy);
      assert.equal(c.env["HTTPS_PROXY"], SET_ALLOWLIST.HTTPS_PROXY);
      const a = c.argv;
      assert.equal(a[a.indexOf("--setting-sources") + 1], "project");
      assert.ok(a.includes("--strict-mcp-config") && a.includes("--no-session-persistence"));
      assert.equal(a.includes("--bare"), false);
    }
    assert.match(r.text, /^credential_source: logged-in Claude Code session$/m);
  } finally {
    rig.cleanup();
    iso.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
