// skill-evals-credentials.test.ts — local credentials and the judge configuration
// (spec 0290 R33, R39, R25 and delta-03 R33, R41, R42, R43). No model call: a stub `claude` that
// answers `auth status --json` with decoy account fields and fails any model call or plays the
// executor and judge, a recording `fetch`.

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import * as credentials from "../lib/skill-evals/credentials.ts";
import { planCredentials } from "../lib/skill-evals/credentials.ts";
import { CREDENTIAL_LABELS, formatReport } from "../lib/skill-evals/report.ts";
import { readCalls, tmpDir, writeSessionStub } from "./lib/skill-evals-fixtures.ts";
import { decoy, evalsOnly, judgeCfg, noResults, stubRig } from "./lib/skill-evals-stub-rig.ts";
import { judgeFetch, makeRig } from "./lib/skill-evals-run-rig.ts";
import type { MockScript } from "../lib/skill-evals/executor/mock.ts";

const fox: MockScript = () => ({
  files: { "answer.md": "x" },
  transcript: "Assistant: the quick brown fox",
});

test("R41: not logged in (no token, no --use-api-key, no mock): exit 3, the login message, no model call, no results file, no account field in any output", async () => {
  const t = stubRig({ loggedIn: false }, {});
  try {
    const r = await t.run();
    assert.equal(r.exitCode, 3);
    assert.match(r.stderr, /not logged in/i);
    assert.match(r.stderr, /Run `claude` and log in/);
    assert.match(r.stderr, /CLAUDE_CODE_OAUTH_TOKEN/);
    assert.match(r.stderr, /--use-api-key/);
    assert.doesNotMatch(r.stderr, /was not requested/, "no key was set: nothing to say about it");
    assert.match(r.stderr, /No model call was made/);
    assert.equal(r.credentialSource, undefined);
    assert.doesNotMatch(r.text + r.stderr, decoy);
    assert.deepEqual(
      readCalls(t.bin).map((c) => c.kind),
      ["auth"],
      "the probe ran; the model entry point was never reached",
    );
    assert.equal(t.rig.executor.calls.length, 0);
    assert.equal(noResults(t.rig.repo.root), true);
    assert.equal(fs.existsSync(path.join(t.rig.out, "demo")), false, "nothing written");
  } finally {
    t.cleanup();
  }
});

test("R41, R42: an ANTHROPIC_API_KEY that was not requested is named in the refusal and never reaches the probe", async () => {
  const t = stubRig({ loggedIn: false }, { ANTHROPIC_API_KEY: "sk-not-requested" });
  try {
    const r = await t.run();
    assert.equal(r.exitCode, 3);
    assert.match(r.stderr, /ANTHROPIC_API_KEY is set but was not requested/);
    assert.match(r.stderr, /--use-api-key/);
    assert.doesNotMatch(r.stderr + r.text, /sk-not-requested/);
    const probes = readCalls(t.bin, "auth");
    assert.equal(probes.length, 1);
    assert.equal(probes[0]?.env["ANTHROPIC_API_KEY"], undefined);
    assert.equal(t.rig.executor.calls.length, 0);
    assert.equal(noResults(t.rig.repo.root), true);
  } finally {
    t.cleanup();
  }
});

test("R41: a `claude` that cannot be started exits 3 with the install hint and no model call", async () => {
  const rig = makeRig({
    mock: false,
    env: { SKILL_EVALS_CLAUDE_BIN: "/nonexistent/claude" },
    change: evalsOnly(),
  });
  try {
    const r = await rig.run();
    assert.equal(r.exitCode, 3);
    assert.match(r.stderr, /cannot start `\/nonexistent\/claude`/);
    assert.match(r.stderr, /install Claude Code/);
    assert.equal(rig.executor.calls.length, 0);
    assert.equal(noResults(rig.repo.root), true);
  } finally {
    rig.cleanup();
  }
});

test("mock mode makes no login probe and prints no credential_source, even with a stub that is not logged in", async () => {
  const dir = tmpDir();
  const bin = writeSessionStub(dir, { loggedIn: false });
  const rig = makeRig({ mock: true, env: { SKILL_EVALS_CLAUDE_BIN: bin }, change: evalsOnly() });
  try {
    const r = await rig.run();
    assert.equal(r.exitCode, 0, r.stderr);
    assert.equal(r.results[0]?.status, "mock");
    assert.equal(r.credentialSource, undefined);
    assert.doesNotMatch(r.text, /credential_source/);
    assert.equal(readCalls(bin).length, 0, "mock mode never starts claude");
  } finally {
    rig.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a judge override is honoured; one that would send the subscription credential, or use the key without --use-api-key, is refused with exit 3 before any model call (F1)", async () => {
  const dir = tmpDir();
  const stub = writeSessionStub(dir, { loggedIn: true });
  const cfg = (judge: object) => {
    const f = path.join(dir, `judge-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(f, JSON.stringify({ judge }));
    return f;
  };
  const rig = makeRig({
    mock: false,
    env: {
      ANTHROPIC_API_KEY: "sk-key",
      CLAUDE_CODE_OAUTH_TOKEN: "tok",
      SKILL_EVALS_CLAUDE_BIN: stub,
    },
    change: evalsOnly(),
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
    // F1: an anthropic judge naming ANTHROPIC_API_KEY without --use-api-key would use an unrequested key
    for (const env of [
      { ANTHROPIC_API_KEY: "sk-key" },
      { ANTHROPIC_API_KEY: "sk-key", CLAUDE_CODE_OAUTH_TOKEN: "tok" },
    ]) {
      const f = makeRig({
        mock: false,
        env: { ...env, SKILL_EVALS_CLAUDE_BIN: stub },
        change: evalsOnly(),
        script: fox,
      });
      try {
        const r = await f.run({
          judgeConfigFile: cfg({ backend: "anthropic", api_key_env: "ANTHROPIC_API_KEY" }),
          fetchImpl: judgeFetch().fetch,
        });
        assert.equal(r.exitCode, 3, r.stderr);
        assert.match(r.stderr, /only with --use-api-key/);
        assert.match(r.stderr, /No model call was made/);
        assert.equal(f.executor.calls.length, 0);
        assert.equal(noResults(f.repo.root), true);
      } finally {
        f.cleanup();
      }
    }
    assert.equal(rig.executor.calls.length, 0);
    assert.equal(readCalls(stub).length, 0, "no child of any kind in any refused case");
    const bad = await rig.run({ judgeConfigFile: cfg({ backend: "gemini" }) });
    assert.equal(bad.exitCode, 3);
    assert.match(bad.stderr, /not supported/);
    // a harmless override (model) is honoured, under --use-api-key with the anthropic driver
    const j = judgeFetch();
    const env2 = makeRig({
      mock: false,
      useApiKey: true,
      env: { ANTHROPIC_API_KEY: "sk-key" },
      change: evalsOnly(),
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

test("planCredentials: the source is the key under --use-api-key, else the token, else the session; the judge follows it", () => {
  const p = (
    env: Record<string, string>,
    over: { override?: Record<string, unknown>; useApiKey?: boolean; mock?: boolean } = {},
  ) =>
    planCredentials({
      env,
      override: over.override ?? {},
      mock: over.mock ?? false,
      useApiKey: over.useApiKey ?? false,
    });
  const tok = p({ CLAUDE_CODE_OAUTH_TOKEN: "t" });
  assert.ok(tok.ok && tok.source === "token" && tok.judge.backend === "claude-cli");
  assert.ok(tok.ok && tok.credential?.name === "CLAUDE_CODE_OAUTH_TOKEN");
  const session = p({});
  assert.ok(session.ok && session.source === "session" && session.credential === undefined);
  assert.ok(session.ok && session.judge.backend === "claude-cli");
  // the key without the flag is never used
  const unrequested = p({ ANTHROPIC_API_KEY: "k" });
  assert.ok(
    unrequested.ok && unrequested.source === "session" && unrequested.credential === undefined,
  );
  assert.ok(unrequested.ok && unrequested.judge.backend === "claude-cli");
  const withToken = p({ ANTHROPIC_API_KEY: "k", CLAUDE_CODE_OAUTH_TOKEN: "t" });
  assert.ok(withToken.ok && withToken.source === "token");
  // the flag selects the key over the token
  const key = p({ ANTHROPIC_API_KEY: "k", CLAUDE_CODE_OAUTH_TOKEN: "t" }, { useApiKey: true });
  assert.ok(key.ok && key.source === "api-key" && key.credential?.name === "ANTHROPIC_API_KEY");
  assert.ok(key.ok && key.credential?.value === "k");
  assert.ok(
    key.ok && key.judge.backend === "anthropic" && key.judge.api_key_env === "ANTHROPIC_API_KEY",
  );
  // the flag with no key
  for (const env of [{}, { ANTHROPIC_API_KEY: "" }] as Record<string, string>[]) {
    const none = p(env, { useApiKey: true });
    assert.ok(
      !none.ok &&
        /ANTHROPIC_API_KEY/.test(none.message) &&
        /No model call was made/.test(none.message),
    );
  }
  assert.ok(p({}, { useApiKey: true, mock: true }).ok, "mock mode needs no key");
  const mock = p({}, { mock: true });
  assert.ok(mock.ok && mock.credential === undefined);
  const refused = p({}, { override: { backend: "claude-code" }, mock: true });
  assert.equal(refused.ok, false, "the refusal applies in mock mode too");
  assert.equal(p({}, { override: { api_key_env: "CLAUDE_CODE_OAUTH_TOKEN" } }).ok, false);
  const keyOverride = p(
    { ANTHROPIC_API_KEY: "k" },
    { override: { backend: "anthropic", api_key_env: "ANTHROPIC_API_KEY" } },
  );
  assert.ok(!keyOverride.ok && /--use-api-key/.test(keyOverride.message), "F1");
  assert.equal(
    p(
      { ANTHROPIC_API_KEY: "k" },
      { override: { backend: "anthropic", api_key_env: "ANTHROPIC_API_KEY" }, useApiKey: true },
    ).ok,
    true,
  );
  assert.equal("MISSING_MESSAGE" in credentials, false, "the neither-variable message is gone");
});

test("R43: the report names each credential source by its label and ends there; no source in mock mode", () => {
  assert.deepEqual(CREDENTIAL_LABELS, {
    session: "logged-in Claude Code session",
    token: "CLAUDE_CODE_OAUTH_TOKEN",
    "api-key": "ANTHROPIC_API_KEY (--use-api-key)",
  });
  for (const [source, label] of Object.entries(CREDENTIAL_LABELS)) {
    const text = formatReport([], source as keyof typeof CREDENTIAL_LABELS);
    assert.ok(text.trimEnd().endsWith(`credential_source: ${label}`), text);
  }
  assert.doesNotMatch(formatReport([]), /credential_source/);
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
