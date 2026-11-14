// skill-evals-cli.test.ts — the entry points (spec 0290 R16, R20, R21, R22 as modified by delta-04, R25 and the
// invalid / no-evals scenarios). Mock mode or failing preconditions only: no model call.

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { main, parseArgs, USAGE } from "../lib/skill-evals/cli.ts";
import {
  cleanEnv,
  commitAll,
  DECOY_EMAIL,
  DECOY_ORG,
  evalsJson,
  makeRepo,
  markOrigin,
  readCalls,
  sink,
  skillRel,
  tmpDir,
  writeSkill,
  writeStubClaude,
} from "./lib/skill-evals-fixtures.ts";
import type { Repo } from "./lib/skill-evals-fixtures.ts";
import { MockExecutor } from "../lib/skill-evals/executor/mock.ts";
import { judgeFetch } from "./lib/skill-evals-run-rig.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const ENTRY = path.join(REPO_ROOT, "scripts", "skill-evals.ts");

function withRepo(f: (repo: Repo, out: string) => Promise<void> | void) {
  return async () => {
    const repo = makeRepo();
    const out = tmpDir();
    try {
      writeSkill(repo, "demo");
      commitAll(repo, "base");
      markOrigin(repo);
      fs.appendFileSync(path.join(repo.root, skillRel("demo"), "SKILL.md"), "edit\n");
      commitAll(repo, "edit");
      await f(repo, out);
    } finally {
      repo.cleanup();
      fs.rmSync(out, { recursive: true, force: true });
    }
  };
}

test("parseArgs: one skill or --changed, --out, --mock, --ticket, --base, --use-api-key", () => {
  assert.deepEqual(parseArgs(["demo", "--mock", "--out", "o"]), {
    name: "demo",
    changed: false,
    out: "o",
    mock: true,
    base: "origin/main",
    useApiKey: false,
    dryRun: false,
  });
  assert.deepEqual(parseArgs(["--", "--changed", "--ticket", "12"]), {
    changed: true,
    out: ".skill-evals",
    mock: false,
    ticket: "12",
    base: "origin/main",
    useApiKey: false,
    dryRun: false,
  });
  // delta-03 R33: the explicit opt-in is a boolean flag that takes no value
  assert.deepEqual(parseArgs(["demo", "--use-api-key"]), {
    name: "demo",
    changed: false,
    out: ".skill-evals",
    mock: false,
    base: "origin/main",
    useApiKey: true,
    dryRun: false,
  });
  assert.equal(
    (parseArgs(["--use-api-key", "--changed"]) as { useApiKey: boolean }).useApiKey,
    true,
  );
  assert.ok(
    "error" in (parseArgs(["--use-api-key"]) as object),
    "still needs a skill or --changed",
  );
  assert.match(USAGE, /\[--use-api-key\]/);
  for (const bad of [[], ["a", "b"], ["--changed", "a"], ["--nope"], ["--out"]])
    assert.ok("error" in (parseArgs(bad) as object), bad.join(" "));
});

test(
  "an unknown skill name exits non-zero naming it",
  withRepo(async (repo, out) => {
    const s = sink();
    const code = await main(["nope", "--out", out], cleanEnv(), repo.root, s.io);
    assert.equal(code, 2);
    assert.match(s.err, /unknown skill: nope/);
  }),
);

test(
  "a mock run of one skill prints the R22 per-skill line with status mock, writes the eval-<id>/ and probe-<n>/ layout and exits 0",
  withRepo(async (repo, out) => {
    const s = sink();
    const code = await main(["demo", "--mock", "--out", out], cleanEnv(), repo.root, s.io, {
      executor: new MockExecutor(),
    });
    assert.equal(code, 0, s.out + s.err);
    // 0304 R24: the plan figures replace threshold, base and diff
    assert.match(
      s.out,
      /^demo: status=mock eval_pass_rate=1\.00 \(2\/2, stage 1\) probe_pass_rate=0\.00 \(0\/1, stage 1\) base=n\/a drop=n\/a p_value=n\/a skill_loaded=0\/2 executor_runs=3 judge_calls=2 cost_usd=0\.03 judge_cost_usd=assumed/m,
    );
    assert.match(s.out, /^  measurements on this branch: 1$/m);
    assert.match(s.out, /^  evidence_reask: 0 of 2$/m);
    assert.match(s.out, /^  eval runs: 1=2\/2$/m);
    assert.match(s.out, /^  not compared: no usable evals\/results\.json at the merge-base$/m);
    assert.match(s.out, /^invocation: skills=1 executor_runs=3 judge_calls=2 cost_usd=0\.03$/m);
    for (const f of [
      "eval-1/run-1/grading.json",
      "eval-1/run-2/grading.json",
      "eval-1/run-1/metrics.json",
      "eval-1/run-1/transcript.md",
      "probe-1/run-1/probe.json",
    ])
      assert.ok(fs.existsSync(path.join(out, "demo", f)), f);
    for (const gone of ["benchmark.json", "base", "eval-1/with_skill", "eval-1/without_skill"])
      assert.equal(fs.existsSync(path.join(out, "demo", gone)), false, `${gone} no longer exists`);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(out, "demo", "eval-1", "run-1", "grading.json"), "utf8"))
        .mock,
      true,
    );
  }),
);

test(
  "--changed selects the changed skill and says so when nothing changed",
  withRepo(async (repo, out) => {
    const s = sink();
    assert.equal(await main(["--changed", "--mock", "--out", out], cleanEnv(), repo.root, s.io), 0);
    assert.match(s.out, /^demo: status=mock/m);
    markOrigin(repo);
    const none = sink();
    assert.equal(
      await main(["--changed", "--mock", "--out", out], cleanEnv(), repo.root, none.io),
      0,
    );
    assert.match(none.out, /nothing to run/);
  }),
);

test("invalid evals.json blocks before any model call and reports both violations with file and JSON path", async () => {
  const repo = makeRepo();
  const out = tmpDir();
  try {
    const doc = JSON.parse(evalsJson("other")) as { evals: Record<string, unknown>[] };
    doc.evals.push({ ...doc.evals[0] });
    writeSkill(repo, "demo", { "evals/evals.json": JSON.stringify(doc) });
    commitAll(repo, "base");
    markOrigin(repo);
    fs.appendFileSync(path.join(repo.root, skillRel("demo"), "SKILL.md"), "x\n");
    commitAll(repo, "edit");
    const executor = new MockExecutor();
    const s = sink();
    const code = await main(
      ["demo", "--out", out, "--use-api-key"],
      cleanEnv({ ANTHROPIC_API_KEY: "k" }),
      repo.root,
      s.io,
      {
        executor,
        fetchImpl: (() => {
          throw new Error("network");
        }) as unknown as typeof fetch,
      },
    );
    assert.equal(code, 1);
    assert.match(s.out, /^demo: status=invalid/m);
    assert.match(s.out, /evals\.json: \$\.skill_name: R6/);
    assert.match(s.out, /evals\.json: \$\.evals\[1\]\.id: R3/);
    assert.equal(executor.calls.length, 0, "no model call");
    assert.equal(fs.existsSync(path.join(out, "demo")), false);
  } finally {
    repo.cleanup();
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("a skill without evals/ warns and exits 0; missing-evals-blocking flips the same condition; an evals/ dir with no evals.json is invalid", async () => {
  const repo = makeRepo();
  const out = tmpDir();
  try {
    writeSkill(repo, "plain", {}, { evals: false });
    writeSkill(repo, "hollow", { "evals/results.json": "{}\n" }, { evals: false });
    commitAll(repo, "base");
    markOrigin(repo);
    for (const n of ["plain", "hollow"])
      fs.appendFileSync(path.join(repo.root, skillRel(n), "SKILL.md"), "x\n");
    commitAll(repo, "edit");
    const s = sink();
    assert.equal(await main(["plain", "--mock", "--out", out], cleanEnv(), repo.root, s.io), 0);
    assert.match(s.out, /^plain: status=no-evals/m);
    assert.match(s.out, /warning: plain has no evals\/ directory/);
    const blocked = sink();
    assert.equal(
      await main(["plain", "--mock", "--out", out], cleanEnv(), repo.root, blocked.io, {
        settings: { missingEvalsBlocking: true },
      }),
      1,
    );
    const hollow = sink();
    assert.equal(
      await main(["hollow", "--mock", "--out", out], cleanEnv(), repo.root, hollow.io),
      1,
    );
    assert.match(hollow.out, /status=invalid[\s\S]*evals\.json is missing/);
  } finally {
    repo.cleanup();
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test(
  "a symlink or an untracked non-ignored file makes the run invalid before any model call",
  withRepo(async (repo, out) => {
    fs.writeFileSync(path.join(repo.root, skillRel("demo"), "scripts", "helper.sh"), "#!/bin/sh\n");
    const executor = new MockExecutor();
    const s = sink();
    assert.equal(
      await main(["demo", "--mock", "--out", out], cleanEnv(), repo.root, s.io, { executor }),
      1,
    );
    assert.match(s.out, /status=invalid/);
    assert.match(s.out, /scripts\/helper\.sh.*git add/);
    assert.equal(executor.calls.length, 0);
  }),
);

test(
  "the task entry: a contributor who is not logged in exits 3 with the login message, no model call, no results file, nothing written, no account field printed",
  withRepo(async (repo) => {
    const dir = tmpDir();
    const bin = writeStubClaude(dir, undefined, "claude-stub.js", { loggedIn: false });
    try {
      const run = (extra: string[], env: Record<string, string> = {}) =>
        spawnSync(
          process.execPath,
          ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", ENTRY, "demo", ...extra],
          {
            cwd: repo.root,
            encoding: "utf8",
            env: {
              PATH: process.env["PATH"] ?? "",
              CREWRIG_REPO_DIR: repo.root,
              SKILL_EVALS_CLAUDE_BIN: bin,
              ...env,
            },
          },
        );
      const r = run([]);
      assert.equal(r.status, 3, r.stdout + r.stderr);
      assert.match(r.stderr, /not logged in/i);
      assert.match(r.stderr, /Run `claude` and log in/);
      assert.match(r.stderr, /CLAUDE_CODE_OAUTH_TOKEN/);
      assert.match(r.stderr, /--use-api-key/);
      assert.doesNotMatch(r.stdout + r.stderr, new RegExp(`${DECOY_EMAIL}|${DECOY_ORG}`));
      assert.deepEqual(
        readCalls(bin).map((c) => c.kind),
        ["auth"],
        "the probe ran, the model entry never",
      );
      assert.equal(
        fs.existsSync(path.join(repo.root, skillRel("demo"), "evals", "results.json")),
        false,
      );
      assert.equal(fs.existsSync(path.join(repo.root, ".skill-evals")), false);
      // the key exists but was not requested: said so, and not used
      const keyed = run([], { ANTHROPIC_API_KEY: "sk-not-requested" });
      assert.equal(keyed.status, 3);
      assert.match(keyed.stderr, /was not requested/);
      assert.match(keyed.stderr, /--use-api-key/);
      assert.doesNotMatch(keyed.stdout + keyed.stderr, /sk-not-requested/);
      // --use-api-key with no key: exit 3 naming the variable, no probe
      const before = readCalls(bin).length;
      const noKey = run(["--use-api-key"]);
      assert.equal(noKey.status, 3);
      assert.match(noKey.stderr, /ANTHROPIC_API_KEY/);
      assert.equal(readCalls(bin).length, before, "no probe, no model call");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }),
);

test(
  "--use-api-key reaches the runner through the entry: the report names the key source, the judge uses the Messages stub, the executor and the login probe are never started",
  withRepo(async (repo, out) => {
    const dir = tmpDir();
    const bin = writeStubClaude(dir, undefined, "claude-stub.js", { loggedIn: true });
    try {
      const j = judgeFetch();
      const s = sink();
      const code = await main(
        ["demo", "--use-api-key", "--out", out],
        cleanEnv({ ANTHROPIC_API_KEY: "sk-requested", SKILL_EVALS_CLAUDE_BIN: bin }),
        repo.root,
        s.io,
        {
          executor: new MockExecutor(() => ({
            files: { "answer.md": "x" },
            transcript: "Assistant: the quick brown fox",
          })),
          fetchImpl: j.fetch,
          ticket: "1849",
          declare: () => ({ ok: true }),
          sleep: async () => undefined,
        },
      );
      assert.equal(code, 0, s.out + s.err);
      assert.match(s.out, /^credential_source: ANTHROPIC_API_KEY \(--use-api-key\)$/m);
      assert.doesNotMatch(s.out + s.err, /sk-requested/);
      assert.ok(j.requests.length > 0);
      assert.equal(readCalls(bin).length, 0, "no claude child at all");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }),
);

test(
  "the task entry in mock mode runs end to end, prints no Node.js warning, and exits 0",
  withRepo(async (repo, out) => {
    const r = spawnSync(process.execPath, [ENTRY, "demo", "--mock", "--out", out], {
      cwd: repo.root,
      encoding: "utf8",
      env: { PATH: process.env["PATH"] ?? "", CREWRIG_REPO_DIR: repo.root },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /status=mock/);
    assert.equal(r.stderr, "");
    const bad = spawnSync(process.execPath, [ENTRY, "missing", "--mock"], {
      cwd: repo.root,
      encoding: "utf8",
      env: { PATH: process.env["PATH"] ?? "", CREWRIG_REPO_DIR: repo.root },
    });
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /unknown skill: missing/);
  }),
);

test(
  "the runner tests need no key and make no model call: the real claude binary is never used by mock runs",
  withRepo(async (repo, out) => {
    const dir = tmpDir();
    const marker = path.join(dir, "called");
    const stub = path.join(dir, "claude");
    fs.writeFileSync(stub, `#!/bin/sh\necho called > ${marker}\nexit 99\n`, { mode: 0o755 });
    try {
      const s = sink();
      const code = await main(
        ["demo", "--mock", "--out", out],
        cleanEnv({ SKILL_EVALS_CLAUDE_BIN: stub }),
        repo.root,
        s.io,
      );
      assert.equal(code, 0, s.out + s.err);
      assert.equal(fs.existsSync(marker), false, "mock mode never spawns claude");
      assert.equal(
        JSON.parse(
          fs.readFileSync(path.join(out, "demo", "eval-1", "run-1", "grading.json"), "utf8"),
        ).mock,
        true,
      );
      assert.equal(
        JSON.parse(
          fs.readFileSync(path.join(out, "demo", "probe-1", "run-1", "probe.json"), "utf8"),
        ).mock,
        true,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }),
);
