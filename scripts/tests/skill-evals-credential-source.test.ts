// skill-evals-credential-source.test.ts — the credential source of a real run, end to end
// (spec 0290 delta-03 R33, R40, R41, R42, R43 and the F2, F4 and s3-F1 findings). The real executor and
// judge driver run against a recording stub `claude` (see `stubRig`); a recording `fetch` stands in for
// the Messages API. No model call, no network.

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { readCalls } from "./lib/skill-evals-fixtures.ts";
import type { StubCall } from "./lib/skill-evals-fixtures.ts";
import {
  credentialVars,
  decoy,
  foreignVars,
  judgeCfg,
  noResults,
  stubRig,
} from "./lib/skill-evals-stub-rig.ts";
import { judgeFetch } from "./lib/skill-evals-run-rig.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

test("R33, R40, R41, R42, R43, F2, F4: a logged-in contributor needs no variable; the judge follows through headless claude -p, the unrequested key reaches no child, the probe runs once for many judge calls, the workspace and the judge's cwd are outside HOME and any work tree", async () => {
  const t = stubRig({ loggedIn: true }, { ANTHROPIC_API_KEY: "sk-not-requested" }, { evals: 3 });
  try {
    const r = await t.run(); // fetch is the throwing stub: any Messages API request would fail the run
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    assert.equal(r.exitCode, 0);
    assert.equal(r.credentialSource, "session");
    assert.match(r.text, /^credential_source: logged-in Claude Code session$/m);
    assert.doesNotMatch(r.text + r.stderr, /sk-not-requested|tok/);
    assert.doesNotMatch(r.text + r.stderr, decoy);
    assert.equal(judgeCfg(t.rig.out).backend, "claude-cli");
    const calls = readCalls(t.bin);
    const by = (k: StubCall["kind"]) => calls.filter((c) => c.kind === k);
    assert.equal(by("auth").length, 1, "F4: one probe per invocation");
    assert.equal(by("executor").length, 6, "3 evals x (with_skill, without_skill)");
    assert.ok(by("judge").length >= 4, "many judge calls, still one probe");
    assert.equal(by("model").length, 0);
    for (const c of calls) {
      assert.deepEqual(credentialVars(c), [], `${c.kind}: no credential variable, no key`);
      assert.deepEqual(foreignVars(c), [], `${c.kind}: only the allowlist`);
      assert.equal(c.env["HOME"], t.iso.home, `${c.kind}: the contributor's HOME`);
      assert.equal(c.env["USER"], "contributor");
      assert.equal(c.argv.includes("--bare"), false);
      if (c.kind !== "auth") assert.ok(c.argv.includes("--no-session-persistence"), c.kind);
    }
    // R32 / F2: executor workspaces live under the (guarded) temporary root; the judge's cwd is outside
    // HOME, the checkout and any work tree
    const realRoot = fs.realpathSync(t.iso.tempRoot);
    for (const c of by("executor")) assert.ok(c.cwd.startsWith(`${realRoot}${path.sep}`), c.cwd);
    const outside = (cwd: string, parent: string) =>
      path.relative(fs.realpathSync(parent), cwd).startsWith("..");
    const realHome = process.env["HOME"];
    for (const c of [...by("executor"), ...by("judge")]) {
      assert.ok(
        outside(c.cwd, t.iso.home),
        `${c.kind} cwd ${c.cwd} is inside the contributor's HOME`,
      );
      assert.ok(outside(c.cwd, REPO_ROOT), `${c.kind} cwd ${c.cwd} is inside the checkout`);
      if (realHome !== undefined)
        assert.ok(outside(c.cwd, realHome), `${c.kind} cwd ${c.cwd} is inside the real HOME`);
    }
    for (const c of by("judge")) {
      const probe = spawnSync(
        "git",
        ["-C", path.dirname(c.cwd), "rev-parse", "--is-inside-work-tree"],
        {
          encoding: "utf8",
        },
      );
      assert.notEqual(
        probe.stdout.trim(),
        "true",
        `the judge cwd ${c.cwd} is inside a git work tree`,
      );
    }
    assert.ok(path.dirname(by("judge")[0]?.cwd ?? "").startsWith(fs.realpathSync(os.tmpdir())));
    assert.equal(noResults(t.rig.repo.root), false, "a real pass writes results.json");
  } finally {
    t.cleanup();
  }
});

test("R33, R42: with a token the executor and judge hold only that token, the key is never used, and no login probe is made", async () => {
  const t = stubRig(
    { loggedIn: false },
    { CLAUDE_CODE_OAUTH_TOKEN: "tok-secret", ANTHROPIC_API_KEY: "sk-key" },
  );
  try {
    const r = await t.run();
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    assert.equal(r.credentialSource, "token");
    assert.match(r.text, /^credential_source: CLAUDE_CODE_OAUTH_TOKEN$/m);
    assert.doesNotMatch(r.text + r.stderr, /tok-secret|sk-key/);
    assert.equal(judgeCfg(t.rig.out).backend, "claude-cli");
    const calls = readCalls(t.bin);
    assert.equal(
      calls.filter((c) => c.kind === "auth").length,
      0,
      "a token is a presence check: no login probe",
    );
    assert.ok(calls.filter((c) => c.kind === "executor").length >= 2);
    assert.ok(calls.filter((c) => c.kind === "judge").length >= 2);
    for (const c of calls) {
      assert.deepEqual(credentialVars(c), ["CLAUDE_CODE_OAUTH_TOKEN"], c.kind);
      assert.equal(c.env["CLAUDE_CODE_OAUTH_TOKEN"], "tok-secret");
      assert.equal(c.argv.join(" ").includes("tok-secret"), false, "never on argv");
      assert.equal(c.env["HOME"], t.iso.home);
    }
    assert.doesNotMatch(
      fs.readFileSync(path.join(t.rig.out, "demo", "eval-1", "with_skill", "grading.json"), "utf8"),
      /tok-secret/,
    );
  } finally {
    t.cleanup();
  }
});

test("R33, R43: --use-api-key selects the key: the judge uses the anthropic driver against the Messages stub, the report names the source, and no login probe or judge child is made", async () => {
  const t = stubRig({ loggedIn: true }, { ANTHROPIC_API_KEY: "sk-key" }, { useApiKey: true });
  try {
    const j = judgeFetch();
    const r = await t.run({ fetchImpl: j.fetch });
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    assert.equal(r.credentialSource, "api-key");
    assert.match(r.text, /^credential_source: ANTHROPIC_API_KEY \(--use-api-key\)$/m);
    assert.doesNotMatch(r.text + r.stderr, /sk-key/);
    const cfg = judgeCfg(t.rig.out);
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
    const calls = readCalls(t.bin);
    assert.equal(calls.filter((c) => c.kind === "auth").length, 0, "the key needs no probe");
    assert.equal(
      calls.filter((c) => c.kind === "judge").length,
      0,
      "the judge is not headless claude",
    );
    for (const c of calls) assert.deepEqual(credentialVars(c), ["ANTHROPIC_API_KEY"], c.kind);
  } finally {
    t.cleanup();
  }
});

test("s3-F1: --use-api-key with the token and the key both set: the executor child holds ANTHROPIC_API_KEY and no CLAUDE_CODE_OAUTH_TOKEN", async () => {
  const t = stubRig(
    { loggedIn: true },
    { CLAUDE_CODE_OAUTH_TOKEN: "tok-secret", ANTHROPIC_API_KEY: "sk-key" },
    { useApiKey: true },
  );
  try {
    const r = await t.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    assert.equal(r.credentialSource, "api-key");
    const exec = readCalls(t.bin, "executor");
    assert.ok(exec.length >= 2);
    for (const c of exec) {
      assert.equal(c.env["ANTHROPIC_API_KEY"], "sk-key");
      assert.equal(c.env["CLAUDE_CODE_OAUTH_TOKEN"], undefined, "exactly one credential variable");
    }
    assert.equal(judgeCfg(t.rig.out).backend, "anthropic");
    assert.doesNotMatch(r.text + r.stderr, /tok-secret|sk-key/);
  } finally {
    t.cleanup();
  }
});

test("R33: --use-api-key with ANTHROPIC_API_KEY unset or empty exits 3 naming the variable, no model call and no probe", async () => {
  for (const env of [{}, { ANTHROPIC_API_KEY: "" }] as Record<string, string>[]) {
    const t = stubRig({ loggedIn: true }, env, { useApiKey: true });
    try {
      const r = await t.run();
      assert.equal(r.exitCode, 3);
      assert.match(r.stderr, /--use-api-key needs ANTHROPIC_API_KEY/);
      assert.match(r.stderr, /No model call was made/);
      assert.equal(readCalls(t.bin).length, 0, "no child of any kind");
      assert.equal(t.rig.executor.calls.length, 0);
      assert.equal(noResults(t.rig.repo.root), true);
    } finally {
      t.cleanup();
    }
  }
});
