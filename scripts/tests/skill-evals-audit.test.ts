// skill-evals-audit.test.ts — traceability gap-fillers of the skill eval runner (spec 0290 + delta-01).
//
// An independent audit of the suites against R1-R40 found requirements with no test: the usage
// declaration (R23), the documented settings and their defaults (R19, R23, R27-R29, R31), the R3
// input-file copy and the fresh-context guarantee (R9) and the runner-level symlink and ignored-file
// paths (R35). Mock executor, stub `fetch`, throwaway
// git repositories: no key, no network, no model call.

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { DEFAULT_SETTINGS } from "../lib/skill-evals/run.ts";
import * as S from "../lib/skill-evals/settings.ts";
import { declareUsage, resolveAsset } from "../lib/skill-evals/usage.ts";
import { skillRel, tmpDir, writeSkill } from "./lib/skill-evals-fixtures.ts";
import { foxScript, judgeFetch, makeRig, plainEvals } from "./lib/skill-evals-run-rig.ts";

const KEY_ENV = { ANTHROPIC_API_KEY: "sk-test" };
/** `--use-api-key` with the key: no `claude` is started, whatever the stub says. */
const KEY = { env: KEY_ENV, useApiKey: true } as const;

const onlyEvalsChange = (repo: { root: string }) =>
  fs.writeFileSync(
    path.join(repo.root, skillRel("demo"), "evals", "evals.json"),
    plainEvals("demo", 1),
  );

// ---------------------------------------------------------------------------------------- R23

test("usage declaration (R23): forge-issue asset, declared before the first executor run, from --ticket or the branch name", async () => {
  const rig = makeRig({ mock: false, ...KEY, change: onlyEvalsChange, script: foxScript });
  try {
    const seen: { asset: string; executorCallsAtDeclare: number }[] = [];
    const declare = (asset: string) => {
      seen.push({ asset, executorCallsAtDeclare: rig.executor.calls.length });
      return { ok: true as const };
    };
    const r = await rig.run({ fetchImpl: judgeFetch().fetch, declare });
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    assert.deepEqual(seen, [{ asset: "forge-issue:acme/widgets#1849", executorCallsAtDeclare: 0 }]);
    // no --ticket: the number of the branch name <prefix>/<NNNN>-<slug>
    rig.repo.git("checkout", "-q", "-b", "feat/0042-some-slug");
    const fromBranch = resolveAsset(rig.repo.root, undefined);
    assert.deepEqual(fromBranch, { asset: "forge-issue:acme/widgets#42" });
  } finally {
    rig.cleanup();
  }
});

test("usage declaration (R23): no ticket to attribute, or a failed declaration, exits 3 with no model call; mock mode declares nothing", async () => {
  const rig = makeRig({ mock: false, ...KEY, change: onlyEvalsChange });
  try {
    const noTicket = resolveAsset(rig.repo.root, undefined); // branch `main` carries no number
    assert.ok("error" in noTicket);
    const r1 = await rig.run({ ticket: undefined as unknown as string, declare: undefined });
    assert.equal(r1.exitCode, 3, r1.stderr);
    assert.match(r1.stderr, /--ticket/);
    const r2 = await rig.run({ declare: () => ({ ok: false, error: "usage declaration failed" }) });
    assert.equal(r2.exitCode, 3);
    assert.match(r2.stderr, /usage declaration failed/);
    assert.equal(rig.executor.calls.length, 0, "no executor run before a declared usage");
  } finally {
    rig.cleanup();
  }
  const mockRig = makeRig({ mock: true });
  try {
    let declared = 0;
    const r = await mockRig.run({
      declare: () => {
        declared++;
        return { ok: true };
      },
    });
    assert.equal(r.exitCode, 0);
    assert.equal(declared, 0, "a mock run is not attributed");
  } finally {
    mockRig.cleanup();
  }
});

test("declareUsage runs `usage-task.ts set --channel explicit --asset <asset>` in the repository", () => {
  const root = tmpDir("skill-evals-usage-");
  try {
    const log = path.join(root, "argv.json");
    fs.mkdirSync(path.join(root, "scripts"));
    fs.writeFileSync(
      path.join(root, "scripts", "usage-task.ts"),
      `require("node:fs").writeFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)));\n`,
    );
    assert.deepEqual(declareUsage(root, "forge-issue:acme/widgets#7"), { ok: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(log, "utf8")), [
      "set",
      "--channel",
      "explicit",
      "--asset",
      "forge-issue:acme/widgets#7",
    ]);
    fs.writeFileSync(path.join(root, "scripts", "usage-task.ts"), "process.exit(4);\n");
    const bad = declareUsage(root, "forge-issue:acme/widgets#7");
    assert.equal(bad.ok, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------- R19, R23, R27-R29, R31

test("declared defaults: each field of DEFAULT_SETTINGS is its settings.ts constant; only the non-provisional values are pinned as literals (#1882)", () => {
  // every field comes from its declared constant, so recalibrating a provisional value is a
  // one-line change in settings.ts that no test needs to follow
  assert.deepEqual(DEFAULT_SETTINGS, {
    regressionBlocking: S.REGRESSION_BLOCKING,
    missingEvalsBlocking: S.MISSING_EVALS_BLOCKING,
    maxExecutorRuns: S.MAX_EXECUTOR_RUNS,
    judgeMaxCalls: S.JUDGE_MAX_CALLS,
    maxInvocationUsd: S.MAX_INVOCATION_USD,
    maxMeasurementUsd: S.MAX_MEASUREMENT_USD,
    maxSkillUsd: S.MAX_SKILL_USD,
    maxTicketUsd: S.MAX_TICKET_USD,
    executorConcurrency: S.EXECUTOR_CONCURRENCY,
    perRunTurns: S.PER_RUN_TURNS,
    perRunSeconds: S.PER_RUN_SECONDS,
    perRunUsd: S.PER_RUN_USD,
    executorModel: S.EXECUTOR_MODEL,
    effort: S.EFFORT,
    failBlocking: S.FAIL_BLOCKING,
  });
  // the literals that are not provisional: the knobs, the threshold, the effort and the model (R20, R31, R46, R47)
  assert.equal(DEFAULT_SETTINGS.regressionBlocking, false);
  assert.equal(DEFAULT_SETTINGS.missingEvalsBlocking, false);
  assert.equal(DEFAULT_SETTINGS.failBlocking, false);
  // 0304 R1, R21: the declared plan and caps; the removed knobs are gone
  assert.equal(S.SAMPLING_PLAN.id, "two-stage-1");
  assert.equal(S.MAX_EXECUTOR_RUNS, 60);
  assert.equal(S.JUDGE_MAX_CALLS, 60);
  assert.equal(S.MAX_MEASUREMENT_USD, 5);
  assert.equal(S.MAX_SKILL_USD, 10);
  assert.equal(S.MAX_TICKET_USD, 25);
  assert.equal(S.MAX_INVOCATION_USD, 100);
  assert.equal(S.JUDGE_ASSUMED_USD, 0.03);
  assert.equal(S.RUN_ASSUMED_USD, 0.1);
  assert.equal(S.EVIDENCE_SHORT_MIN_CHARS, 6);
  assert.equal(S.EVIDENCE_MIN_CHARS, 12);
  assert.equal(S.RUNNER_VERSION, "3.0.0");
  assert.equal("TOLERANCE" in S, false);
  assert.equal("PASS_THRESHOLD" in S, false);
  assert.equal("tolerance" in DEFAULT_SETTINGS, false);
  assert.equal("passThreshold" in DEFAULT_SETTINGS, false);
  assert.equal(DEFAULT_SETTINGS.effort, "medium");
  assert.match(DEFAULT_SETTINGS.executorModel, /sonnet/i);
  assert.equal(DEFAULT_SETTINGS.executorModel, "claude-sonnet-5-5", "delta-03 model pin");
  assert.equal(S.JUDGE_MODEL, "claude-sonnet-5-5");
});

test("the executor model and the per-run limits come from the settings: every run, metrics.json and results.json carry them (R27, R31)", async () => {
  const rig = makeRig({
    mock: false,
    ...KEY,
    change: onlyEvalsChange,
    script: foxScript,
    settings: {
      executorModel: "claude-sonnet-test-9",
      perRunTurns: 7,
      perRunSeconds: 11,
      perRunUsd: 0.5,
    },
  });
  try {
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    assert.equal(rig.executor.calls.length, 2, "two runs of the one eval (stage 1), no probe");
    for (const c of rig.executor.calls) {
      assert.equal(c.model, "claude-sonnet-test-9");
      assert.deepEqual(c.limits, { turns: 7, seconds: 11, usd: 0.5 });
    }
    const dir = path.join(rig.out, "demo", "eval-1", "run-1");
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(dir, "metrics.json"), "utf8")).model,
      "claude-sonnet-test-9",
    );
    const rec = JSON.parse(
      fs.readFileSync(path.join(rig.repo.root, skillRel("demo"), "evals", "results.json"), "utf8"),
    );
    assert.equal(rec.executor_model, "claude-sonnet-test-9");
  } finally {
    rig.cleanup();
  }
});

// -------------------------------------------------------------------------------- R3 and R9

test("R3, R9 and R32: each run gets only the eval's files at the workspace root, in a fresh workspace of its own, with the skill at <workspace>/.claude/skills/<name>/; outputs/ never holds .claude/", async () => {
  const rig = makeRig({
    evalsCount: 2,
    script: (req) => {
      const skill = path.join(req.workspaceDir, ".claude", "skills", "demo");
      seen.push({
        label: req.label,
        workspace: req.workspaceDir,
        hasHomeDir: "homeDir" in req,
        listing: fs.readdirSync(req.workspaceDir).sort(),
        input: fs.existsSync(path.join(req.workspaceDir, "in.txt"))
          ? fs.readFileSync(path.join(req.workspaceDir, "in.txt"), "utf8")
          : null,
        skillFiles: fs.existsSync(skill)
          ? fs.readdirSync(skill, { recursive: true }).map(String).sort()
          : null,
      });
      return { files: { "answer.md": "x", "leftover.tmp": "state" } };
    },
  });
  const seen: {
    label: string;
    workspace: string;
    hasHomeDir: boolean;
    listing: string[];
    input: string | null;
    skillFiles: string[] | null;
  }[] = [];
  try {
    const r = await rig.run();
    assert.equal(r.exitCode, 0, r.text);
    assert.equal(seen.length, 5, "two runs of each of 2 evals (stage 1) and one run of the probe");
    for (const s of seen) {
      const probe = s.label.includes("probe");
      assert.equal(s.hasHomeDir, false, "no throwaway home any more");
      assert.deepEqual(
        s.listing.filter((p) => p !== ".claude"),
        probe ? [] : ["in.txt"],
        `${s.label}: nothing but the eval files at start`,
      );
      assert.ok(s.listing.includes(".claude"), `${s.label}: no run without the skill (R9)`);
      assert.equal(s.input, probe ? null : "input\n");
      assert.ok(s.skillFiles?.includes("SKILL.md"), s.label);
      assert.ok(
        s.skillFiles?.includes("scripts/run.sh") && s.skillFiles.includes("references/ref.md"),
      );
      assert.equal(
        s.skillFiles?.some((p) => p.includes("evals")),
        false,
        "no evals/ path is installed",
      );
      assert.equal(
        path.relative(rig.repo.root, s.workspace).startsWith(".."),
        true,
        "the workspace is outside the repository",
      );
    }
    assert.equal(new Set(seen.map((s) => s.workspace)).size, 5, "no workspace is shared");
    // the input file is not reported as a produced output; what the run produced is; .claude/ is never an output
    for (const [id, run] of [
      [1, 1],
      [1, 2],
      [2, 1],
      [2, 2],
    ] as const) {
      const outDir = path.join(rig.out, "demo", `eval-${id}`, `run-${run}`, "outputs");
      assert.deepEqual(fs.readdirSync(outDir, { recursive: true }).map(String).sort(), [
        "answer.md",
        "leftover.tmp",
      ]);
    }
    assert.equal(
      fs.existsSync(path.join(rig.out, "demo", "eval-1", "run-1", "outputs", ".claude")),
      false,
    );
  } finally {
    rig.cleanup();
  }
});

// --------------------------------------------------------------------------- R35 at the runner

test("a symlink under scripts/ makes the runner report invalid naming the path, with no executor run; ignored files are neither hashed nor installed", async () => {
  const rig = makeRig({
    change: (repo) => {
      fs.symlinkSync("run.sh", path.join(repo.root, skillRel("demo"), "scripts", "link.sh"));
    },
  });
  try {
    const r = await rig.run();
    assert.equal(r.results[0]?.status, "invalid");
    assert.equal(r.exitCode, 1);
    assert.match(r.results[0]?.messages.join("\n") ?? "", /scripts\/link\.sh/);
    assert.equal(rig.executor.calls.length, 0);
  } finally {
    rig.cleanup();
  }

  const installed: string[][] = [];
  const clean = makeRig({
    script: (req) => {
      const dir = path.join(req.workspaceDir, ".claude");
      installed.push(
        fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String) : [],
      );
      return { files: { "answer.md": "x" } };
    },
    change: (repo) => {
      const dir = path.join(repo.root, skillRel("demo"));
      fs.mkdirSync(path.join(dir, "scripts", "__pycache__"));
      fs.writeFileSync(path.join(dir, "scripts", "__pycache__", "x.pyc"), "junk");
      fs.writeFileSync(path.join(dir, ".DS_Store"), "junk");
      fs.appendFileSync(path.join(dir, "SKILL.md"), "edit\n");
    },
  });
  try {
    const r = await clean.run();
    assert.equal(r.results[0]?.status, "mock", r.text);
    const withSkill = installed.filter((l) => l.some((p) => p.endsWith("SKILL.md")));
    assert.ok(withSkill.length > 0);
    for (const l of withSkill)
      assert.equal(
        l.some((p) => /pyc|DS_Store|__pycache__/.test(p)),
        false,
        l.join(","),
      );
  } finally {
    clean.cleanup();
  }
});
