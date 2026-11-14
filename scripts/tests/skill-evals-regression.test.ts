// skill-evals-regression.test.ts — the regression test against the committed base (spec 0304 R12,
// R13, R14, R24; 0290 R19-R21 as superseded). The runner measures a 6-eval skill against a base file
// committed at the merge-base: a schema-2 base (common evals by case_hash), a legacy schema-1 base
// (one run per figure), or no usable base. The Fisher figures themselves are in skill-evals-plan.
//
// Real (non-mock) runs with an injected mock executor and a recording judge endpoint: under
// `--use-api-key` the `anthropic` driver authenticates with ANTHROPIC_API_KEY against a stub `fetch`;
// nothing leaves the process and `claude` is never started.

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { attestSelection } from "../lib/skill-evals/attest.ts";
import type { MockScript } from "../lib/skill-evals/executor/mock.ts";
import { cleanEnv, selectionOf, skillRel } from "./lib/skill-evals-fixtures.ts";
import type { Repo } from "./lib/skill-evals-fixtures.ts";
import {
  allPass,
  buildRecord,
  stagedRuns,
  writeRaw,
  writeRecord,
} from "./lib/skill-evals-record.ts";
import { runEvals } from "../lib/skill-evals/run.ts";
import { judgeFetch, makeRig, plainEvals } from "./lib/skill-evals-run-rig.ts";

const resultsFile = (repo: string) => path.join(repo, skillRel("demo"), "evals", "results.json");
const dirOf = (repo: Repo) => path.join(repo.root, skillRel("demo"));

/** The caps are passed explicitly: no test follows the declared defaults. */
const EXPLICIT = { maxExecutorRuns: 100, judgeMaxCalls: 100, maxInvocationUsd: 1000 } as const;

/** Run r of eval i passes when `flags[i-1][r-1]`; a failing run's transcript lacks the quoted phrase. */
const script =
  (flags: boolean[][]): MockScript =>
  (req) => {
    const m = /eval-(\d+)\/run-(\d+)$/.exec(req.label);
    const ok = flags[Number(m?.[1]) - 1]?.[Number(m?.[2]) - 1] === true;
    return {
      files: { "answer.md": "x" },
      transcript: ok ? "Assistant: the quick brown fox answer" : "Assistant: BROKEN answer",
      costUsd: 0.1,
    };
  };

type BaseSetup = (repo: Repo) => void;
const schema2Base: BaseSetup = (repo) =>
  writeRecord(dirOf(repo), buildRecord(selectionOf(repo, "demo"), { evalRuns: allPass(6, 4) }));
const legacyBase =
  (passed: number, total: number): BaseSetup =>
  (repo) =>
    writeRaw(dirOf(repo), {
      skill_name: "demo",
      content_hash: "0".repeat(64),
      status: "pass",
      evals_passed: passed,
      evals_total: total,
    });

/** 6 evals; `base` is committed as the merge-base results file; the head only edits references/ref.md. */
async function measure(
  flags: boolean[][],
  base: BaseSetup | undefined,
  over: Record<string, unknown> = {},
) {
  const rig = makeRig({
    evalsCount: 6,
    mock: false,
    env: { ANTHROPIC_API_KEY: "sk-test" },
    useApiKey: true,
    script: script(flags),
    settings: { ...EXPLICIT, ...over },
    change: (repo) => {
      fs.writeFileSync(path.join(dirOf(repo), "evals", "evals.json"), plainEvals("demo", 6));
      base?.(repo);
      repo.git("add", "-A");
      repo.git("commit", "-q", "-m", "evals and base results");
      repo.git("update-ref", "refs/remotes/origin/main", "HEAD");
      fs.writeFileSync(path.join(dirOf(repo), "references", "ref.md"), "HEAD\n");
    },
  });
  try {
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    const rec = JSON.parse(fs.readFileSync(resultsFile(rig.repo.root), "utf8"));
    const attested = attestSelection(selectionOf(rig.repo, "demo"), undefined, rig.repo.root);
    let baseAfter = "";
    try {
      baseAfter = rig.repo.git("show", `origin/main:${skillRel("demo")}/evals/results.json`);
    } catch {
      // no base file at the merge-base in this scenario
    }
    return { r, s: r.results[0]!, rec, attested, baseAfter, calls: rig.executor.calls.length };
  } finally {
    rig.cleanup();
  }
}

test("against a schema-2 base of 24 of 24, a head of 20 of 24 is a regression: drop 0.167, p 0.055", async () => {
  const t = await measure(stagedRuns(6, [2, 2], [8, 12]), schema2Base);
  assert.equal(t.s.status, "regression", t.r.text);
  assert.deepEqual(t.rec.base, {
    ...t.rec.base,
    schema_version: 2,
    passes: 24,
    runs: 24,
    common_evals: 6,
  });
  assert.deepEqual(t.rec.regression, { drop: 0.166667, p_value: 0.05461 });
  assert.match(t.r.text, /base=24\/24 drop=0\.167 p_value=0\.055/);
  assert.match(t.r.text, /regression: demo base 24\/24, head 20\/24, drop 0\.167, p 0\.055/);
  assert.equal(t.r.exitCode, 0, "regression-blocking defaults to false");
  assert.equal(t.attested.status, "regression", "the attestation recomputes the same status");
});

test("the regression-blocking knob flips the same condition", async () => {
  const t = await measure(stagedRuns(6, [2, 2], [8, 12]), schema2Base, {
    regressionBlocking: true,
  });
  assert.equal(t.r.exitCode, 1);
  assert.equal(t.s.blocking, true);
  const fail = await measure(stagedRuns(6, [2], [6]), schema2Base, { regressionBlocking: true });
  assert.equal(fail.s.status, "fail");
  assert.equal(fail.r.exitCode, 0, "a fail is not a regression: its own knob gates it");
});

test("a drop under 0.10 is a pass whatever p is: 22 of 24 against 24 of 24", async () => {
  const t = await measure(stagedRuns(6, [2, 2], [10, 12]), schema2Base);
  assert.equal(t.s.status, "pass", t.r.text);
  assert.equal(t.rec.regression.drop < 0.1, true);
  assert.equal(t.attested.status, "pass");
});

test("a rejected pool is fail and the test is not evaluated: 15 of 24 against 24 of 24", async () => {
  const t = await measure(stagedRuns(6, [2, 2], [8, 7]), schema2Base);
  assert.equal(t.s.status, "fail");
  assert.equal(t.rec.regression, null);
  assert.equal(t.attested.status, "fail");
});

test("a legacy base of 6 of 6 reads as a smaller base: 20 of 24 is a pass (p 0.388) and the base file is untouched", async () => {
  const t = await measure(stagedRuns(6, [2, 2], [8, 12]), legacyBase(6, 6));
  assert.equal(t.s.status, "pass", t.r.text);
  assert.deepEqual(t.rec.base, {
    ...t.rec.base,
    schema_version: 1,
    passes: 6,
    runs: 6,
    common_evals: 6,
  });
  assert.equal(Math.round(t.rec.regression.p_value * 1000) / 1000, 0.388);
  assert.match(t.r.text, /base=6\/6 legacy drop=0\.167 p_value=0\.388/);
  assert.equal(
    JSON.parse(t.baseAfter).evals_total,
    6,
    "the schema-1 file at the merge-base is never rewritten",
  );
  assert.equal("schema_version" in JSON.parse(t.baseAfter), false);
  assert.equal(t.attested.status, "pass");
});

test("a legacy base never rescues a rejected pool: against 6 of 6, 17 of 24 is fail", async () => {
  const t = await measure(stagedRuns(6, [2, 2], [8, 9]), legacyBase(6, 6));
  assert.equal(t.s.status, "fail");
  assert.equal(t.rec.regression, null);
});

test("no base, an unparseable base and an in-progress base are not compared: base null, the pools decide", async () => {
  const cases: [string, BaseSetup | undefined][] = [
    ["absent", undefined],
    ["unparseable", (repo) => writeRaw(dirOf(repo), "{not json")],
    [
      "in-progress",
      (repo) =>
        writeRecord(dirOf(repo), {
          ...buildRecord(selectionOf(repo, "demo")),
          status: "in-progress",
        }),
    ],
  ];
  for (const [title, base] of cases) {
    const t = await measure(stagedRuns(6, [2, 2], [8, 12]), base);
    assert.equal(t.s.status, "pass", title);
    assert.equal(t.rec.base, null, title);
    assert.match(t.r.text, /base=n\/a/, title);
    assert.match(t.r.text, /not compared/, title);
  }
});

test("only the evals unchanged on both sides are compared: a changed prompt and a changed fixture drop out (R14)", async () => {
  const base: BaseSetup = (repo) => {
    const file = path.join(dirOf(repo), "evals", "evals.json");
    const doc = JSON.parse(fs.readFileSync(file, "utf8"));
    doc.evals[2].prompt = "Task 3 as the base worded it";
    doc.evals[4].files = ["evals/files/other.txt"];
    fs.writeFileSync(path.join(dirOf(repo), "evals", "files", "other.txt"), "other\n");
    fs.writeFileSync(file, JSON.stringify(doc));
    writeRecord(dirOf(repo), buildRecord(selectionOf(repo, "demo"), { evalRuns: allPass(6, 4) }));
    fs.writeFileSync(file, plainEvals("demo", 6));
  };
  const t = await measure(stagedRuns(6, [2, 2], [8, 12]), base);
  assert.equal(t.rec.base.common_evals, 4);
  assert.equal(t.rec.base.runs, 16, "only the four common evals count on the base side");
  assert.equal(t.rec.base.passes, 16);
});

test("no eval in common is not compared: base null", async () => {
  const base: BaseSetup = (repo) => {
    const file = path.join(dirOf(repo), "evals", "evals.json");
    const doc = JSON.parse(fs.readFileSync(file, "utf8"));
    doc.evals = doc.evals.map((e: { prompt: string }) => ({ ...e, prompt: `${e.prompt} (base)` }));
    fs.writeFileSync(file, JSON.stringify(doc));
    writeRecord(dirOf(repo), buildRecord(selectionOf(repo, "demo"), { evalRuns: allPass(6, 4) }));
    fs.writeFileSync(file, plainEvals("demo", 6));
  };
  const t = await measure(stagedRuns(6, [2, 2], [8, 12]), base);
  assert.equal(t.rec.base, null);
  assert.equal(t.s.status, "pass");
});

test("the report lists as a diagnostic the evals whose pass fraction fell by 0.5 or more against a schema-2 base", async () => {
  const flags = stagedRuns(6, [2, 2], [8, 12]).map((r, i) =>
    i === 5 ? [false, false, false, false] : r,
  );
  const t = await measure(flags, schema2Base);
  assert.match(
    t.r.text,
    /diagnostic: pass fraction fell by 0\.5 or more against the base on eval \d/,
  );
});

test("a mock run leaves results.json byte-identical and produces no regression or blocking outcome", async () => {
  const rig = makeRig({
    evalsCount: 2,
    settings: { regressionBlocking: true, failBlocking: true },
  });
  try {
    fs.writeFileSync(resultsFile(rig.repo.root), '{"kept":true}\n');
    const r = await rig.run();
    assert.equal(r.results[0]?.status, "mock");
    assert.equal(r.exitCode, 0);
    assert.equal(fs.readFileSync(resultsFile(rig.repo.root), "utf8"), '{"kept":true}\n');
  } finally {
    rig.cleanup();
  }
});

test("an eval run installs the head scripts, with the exec bit, and its exit_code check runs the head script", async () => {
  const seen: { script: string }[] = [];
  const rig = makeRig({
    evalsCount: 1,
    change: (repo) => {
      const dir = path.join(repo.root, skillRel("demo"));
      fs.writeFileSync(path.join(dir, "scripts", "run.sh"), "#!/bin/sh\necho head\nexit 5\n");
      fs.writeFileSync(
        path.join(dir, "evals", "evals.json"),
        JSON.stringify({
          skill_name: "demo",
          evals: [
            {
              id: 1,
              prompt: "Task 1",
              expected_output: "o",
              files: [],
              expectations: [],
              checks: [{ type: "exit_code", script: "scripts/run.sh", expected: 5 }],
            },
          ],
        }),
      );
    },
    mock: false,
    env: { ANTHROPIC_API_KEY: "sk-test" },
    useApiKey: true,
    settings: EXPLICIT,
    script: (req) => {
      const f = path.join(req.workspaceDir, ".claude", "skills", "demo", "scripts", "run.sh");
      seen.push({ script: fs.readFileSync(f, "utf8") });
      assert.equal(fs.statSync(f).mode & 0o100, 0o100, "the exec bit is restored on install");
      return { files: { "answer.md": "x" } };
    },
  });
  try {
    const r = await rig.run({ fetchImpl: judgeFetch().fetch });
    assert.equal(r.results[0]?.executorRuns, 2, "the two stage-1 runs: no base replay");
    assert.equal(seen.length, 2);
    assert.match(seen[0]?.script ?? "", /echo head/);
    const g = JSON.parse(
      fs.readFileSync(path.join(rig.out, "demo", "eval-1", "run-1", "grading.json"), "utf8"),
    );
    assert.equal(g.expectations[0].passed, true);
    assert.match(g.expectations[0].evidence, /exit code 5 \(expected 5\)/);
    assert.match(g.expectations[0].text, /scripts\/run\.sh/);
  } finally {
    rig.cleanup();
  }
});

test("evals.json is parsed from the single snapshot read: a change on disk after the snapshot is not observed", async () => {
  const rig = makeRig({
    evalsCount: 1,
    mock: false,
    env: { ANTHROPIC_API_KEY: "sk-test" },
    useApiKey: true,
    script: () => ({
      files: { "answer.md": "x" },
      transcript: "Assistant: the quick brown fox",
      skillsLoaded: ["demo"],
    }),
  });
  try {
    const sel = selectionOf(rig.repo, "demo"); // the snapshot is read here
    const file = path.join(rig.repo.root, skillRel("demo"), "evals", "evals.json");
    fs.writeFileSync(file, "{ not json at all");
    const r = await runEvals(
      {
        repoRoot: rig.repo.root,
        out: rig.out,
        mock: false,
        useApiKey: true,
        env: cleanEnv({ ANTHROPIC_API_KEY: "sk-test" }),
        fetchImpl: judgeFetch().fetch,
        settings: EXPLICIT,
        executor: rig.executor,
        sleep: async () => undefined,
        ticket: "1849",
        declare: () => ({ ok: true }),
      },
      [sel],
    );
    assert.equal(r.results[0]?.status, "pass", r.text + r.stderr);
    assert.ok(rig.executor.calls.length > 0, "the evals of the snapshot were run");
  } finally {
    rig.cleanup();
  }
});
