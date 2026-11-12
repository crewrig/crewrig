// skill-evals-attestation.test.ts — results file and attestation check (spec 0290 R36-R39, R25).

/* oxlint-disable typescript/no-unsafe-assignment, typescript/no-unsafe-member-access, typescript/no-unsafe-call, typescript/no-unsafe-argument, typescript/no-unsafe-return -- the runner output files are read back as untyped JSON */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { attestSelection } from "../lib/skill-evals/attest.ts";
import { attestMain } from "../lib/skill-evals/attest-cli.ts";
import { verifyResults, writeResults } from "../lib/skill-evals/results.ts";
import type { ResultsRecord } from "../lib/skill-evals/results.ts";
import { selectChanged } from "../lib/skill-evals/select.ts";
import type { Selection } from "../lib/skill-evals/select.ts";
import {
  cleanEnv,
  commitAll,
  makeRepo,
  markOrigin,
  selectionOf,
  sink,
  skillRel,
  writeSkill,
} from "./lib/skill-evals-fixtures.ts";
import type { Repo } from "./lib/skill-evals-fixtures.ts";

const record = (sel: Selection, over: Partial<ResultsRecord> = {}): ResultsRecord => ({
  skill_name: sel.skill.name,
  content_hash: sel.headHash as string,
  runner_version: "2.0.0",
  executor_model: "m",
  judge_model: "j",
  date: "2026-01-01T00:00:00.000Z",
  status: "pass",
  effort: "medium",
  eval_pass_rate: 1,
  probe_pass_rate: null,
  base_eval_pass_rate: null,
  threshold: 0.8,
  tolerance: 0.05,
  evals_passed: 2,
  evals_total: 2,
  probes_passed: 0,
  probes_total: 0,
  executor_runs: 4,
  judge_calls: 6,
  cost_usd: 0.4,
  ...over,
});

function changedSkill(f: (repo: Repo, name: string) => void): void {
  const repo = makeRepo();
  try {
    writeSkill(repo, "demo");
    commitAll(repo, "base");
    markOrigin(repo);
    fs.appendFileSync(path.join(repo.root, skillRel("demo"), "SKILL.md"), "edit\n");
    commitAll(repo, "edit");
    f(repo, "demo");
  } finally {
    repo.cleanup();
  }
}

test("the writer fixes the key order and the verifier accepts a fresh file", () => {
  changedSkill((repo) => {
    const sel = selectionOf(repo, "demo");
    writeResults(sel.skill.dirAbs, record(sel));
    const text = fs.readFileSync(path.join(sel.skill.dirAbs, "evals", "results.json"), "utf8");
    assert.deepEqual(Object.keys(JSON.parse(text)), [
      "skill_name",
      "content_hash",
      "runner_version",
      "executor_model",
      "judge_model",
      "effort",
      "date",
      "status",
      "eval_pass_rate",
      "probe_pass_rate",
      "base_eval_pass_rate",
      "threshold",
      "tolerance",
      "evals_passed",
      "evals_total",
      "probes_passed",
      "probes_total",
      "executor_runs",
      "judge_calls",
      "cost_usd",
    ]);
    assert.equal(verifyResults(text, "demo", sel.headHash as string).ok, true);
    assert.equal(
      fs.readdirSync(path.join(sel.skill.dirAbs, "evals")).some((f) => f.endsWith(".tmp")),
      false,
    );
  });
});

test("fresh attestation passes with no credential variable set", () => {
  changedSkill((repo) => {
    const sel = selectionOf(repo, "demo");
    writeResults(sel.skill.dirAbs, record(sel));
    repo.git("add", "-A");
    const s = sink();
    const code = attestMain([], cleanEnv(), repo.root, s.io);
    assert.equal(code, 0, s.out + s.err);
    assert.match(s.out, /^demo: pass/m);
  });
});

test("stale attestation blocks: scripts changed after the results file was written", () => {
  changedSkill((repo) => {
    const sel = selectionOf(repo, "demo");
    writeResults(sel.skill.dirAbs, record(sel));
    commitAll(repo, "results");
    fs.appendFileSync(path.join(repo.root, skillRel("demo"), "scripts", "run.sh"), "echo later\n");
    commitAll(repo, "scripts");
    const s = sink();
    assert.equal(attestMain([], cleanEnv(), repo.root, s.io), 1);
    assert.match(s.out, /demo: stale: recorded content_hash .* differs from the current/);
  });
});

test("an evals.json change requires a fresh attestation", () => {
  const repo = makeRepo();
  try {
    writeSkill(repo, "demo");
    commitAll(repo, "base");
    markOrigin(repo);
    let sel = selectionOf(repo, "demo");
    writeResults(sel.skill.dirAbs, record(sel));
    commitAll(repo, "results");
    markOrigin(repo);
    // only evals.json changes now
    const f = path.join(repo.root, skillRel("demo"), "evals", "evals.json");
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("Do the thing", "Do another thing"));
    commitAll(repo, "evals edit");
    assert.equal(selectChanged(repo.root, "origin/main").hasOwnProperty("selections"), true);
    const s = sink();
    assert.equal(attestMain([], cleanEnv(), repo.root, s.io), 1);
    assert.match(s.out, /demo: stale/);
    sel = selectionOf(repo, "demo");
    assert.equal(attestSelection(sel).status, "stale");
  } finally {
    repo.cleanup();
  }
});

test("mock results, an unrecognised status, a wrong skill and missing keys are stale", () => {
  changedSkill((repo) => {
    const sel = selectionOf(repo, "demo");
    const h = sel.headHash as string;
    const text = (o: Record<string, unknown>) => JSON.stringify({ ...record(sel), ...o });
    assert.equal(verifyResults(text({ mock: true }), "demo", h).ok, false);
    assert.match(
      (verifyResults(text({ status: "error" }), "demo", h) as { reason: string }).reason,
      /status "error"/,
    );
    assert.match(
      (verifyResults(text({ skill_name: "other" }), "demo", h) as { reason: string }).reason,
      /another skill/,
    );
    const broken = JSON.parse(text({})) as Record<string, unknown>;
    delete broken["judge_calls"];
    assert.match(
      (verifyResults(JSON.stringify(broken), "demo", h) as { reason: string }).reason,
      /judge_calls/,
    );
    assert.match((verifyResults("{nope", "demo", h) as { reason: string }).reason, /parsed/);
    assert.match((verifyResults(undefined, "demo", h) as { reason: string }).reason, /absent/);
    fs.writeFileSync(path.join(sel.skill.dirAbs, "evals", "results.json"), text({ mock: true }));
    repo.git("add", "-A");
    assert.equal(attestSelection(selectionOf(repo, "demo")).status, "stale");
    fs.writeFileSync(
      path.join(sel.skill.dirAbs, "evals", "results.json"),
      text({ status: "error" }),
    );
    assert.equal(attestSelection(selectionOf(repo, "demo")).status, "stale");
  });
});

test("recorded regression is reported and blocks only under regression-blocking", () => {
  changedSkill((repo) => {
    const sel = selectionOf(repo, "demo");
    writeResults(
      sel.skill.dirAbs,
      record(sel, {
        status: "regression",
        eval_pass_rate: 0.8,
        base_eval_pass_rate: 0.9,
      }),
    );
    repo.git("add", "-A");
    const off = attestSelection(selectionOf(repo, "demo"), {
      regressionBlocking: false,
      failBlocking: false,
      missingEvalsBlocking: false,
    });
    assert.equal(off.status, "regression");
    assert.equal(off.blocking, false);
    assert.match(off.reason, /base eval pass rate 0\.9, eval pass rate 0\.8, tolerance 0\.05/);
    const on = attestSelection(selectionOf(repo, "demo"), {
      regressionBlocking: true,
      failBlocking: false,
      missingEvalsBlocking: false,
    });
    assert.equal(on.blocking, true);
    const s = sink();
    assert.equal(
      attestMain([], cleanEnv(), repo.root, s.io, {
        regressionBlocking: true,
        failBlocking: false,
        missingEvalsBlocking: false,
      }),
      1,
    );
    assert.match(
      s.out,
      /demo: regression: base eval pass rate 0\.9, eval pass rate 0\.8, tolerance 0\.05 \[blocking\]/,
    );
  });
});

test("a file of the former shape (a benchmark key, the status new) is stale and one run regenerates it", () => {
  changedSkill((repo) => {
    const sel = selectionOf(repo, "demo");
    const h = sel.headHash as string;
    const former = { ...record(sel), benchmark: { with_skill_mean: 1 } } as Record<string, unknown>;
    for (const k of ["effort", "eval_pass_rate", "probe_pass_rate", "base_eval_pass_rate"])
      delete former[k];
    assert.match(
      (verifyResults(JSON.stringify(former), "demo", h) as { reason: string }).reason,
      /lacks the key/,
    );
    // even with every new key present, `new` is no longer a status
    assert.match(
      (
        verifyResults(JSON.stringify({ ...record(sel), status: "new" }), "demo", h) as {
          reason: string;
        }
      ).reason,
      /status "new".*not pass, fail or regression/,
    );
    fs.writeFileSync(
      path.join(sel.skill.dirAbs, "evals", "results.json"),
      JSON.stringify({ ...record(sel), status: "new" }),
    );
    repo.git("add", "-A");
    const a = attestSelection(selectionOf(repo, "demo"));
    assert.equal(a.status, "stale");
    assert.equal(a.blocking, true);
  });
});

test("a recorded fail is reported with both rates and the threshold, and blocks only under fail-blocking", () => {
  changedSkill((repo) => {
    const sel = selectionOf(repo, "demo");
    writeResults(
      sel.skill.dirAbs,
      record(sel, {
        status: "fail",
        eval_pass_rate: 0.75,
        probe_pass_rate: 0.6,
        evals_passed: 3,
        evals_total: 4,
        probes_passed: 3,
        probes_total: 5,
      }),
    );
    repo.git("add", "-A");
    const settings = {
      regressionBlocking: false,
      failBlocking: false,
      missingEvalsBlocking: false,
    };
    const off = attestSelection(selectionOf(repo, "demo"), settings);
    assert.equal(off.status, "fail");
    assert.equal(off.blocking, false);
    assert.match(off.reason, /eval pass rate 0\.75, probe pass rate 0\.6, threshold 0\.8/);
    const s = sink();
    assert.equal(attestMain([], cleanEnv(), repo.root, s.io, settings), 0, s.out);
    assert.match(
      s.out,
      /^demo: fail: eval pass rate 0\.75, probe pass rate 0\.6, threshold 0\.8$/m,
    );
    const on = sink();
    assert.equal(
      attestMain([], cleanEnv(), repo.root, on.io, { ...settings, failBlocking: true }),
      1,
    );
    assert.match(on.out, /demo: fail: .*\[blocking\]/);
    // a fail does not block under regression-blocking alone
    assert.equal(
      attestSelection(selectionOf(repo, "demo"), { ...settings, regressionBlocking: true })
        .blocking,
      false,
    );
  });
});

test("the attestation decides from the recorded figures with the same decide() as the runner", () => {
  changedSkill((repo) => {
    const sel = selectionOf(repo, "demo");
    // the recorded status says pass, the recorded figures say fail: the figures decide the block
    writeResults(sel.skill.dirAbs, record(sel, { status: "pass", eval_pass_rate: 0.5 }));
    repo.git("add", "-A");
    const settings = { regressionBlocking: false, failBlocking: true, missingEvalsBlocking: false };
    assert.equal(attestSelection(selectionOf(repo, "demo"), settings).blocking, true);
    // and the other way: a figure at the boundary (4/5 = 0.8 = threshold) is not a fail
    writeResults(sel.skill.dirAbs, record(sel, { status: "fail", eval_pass_rate: 0.8 }));
    repo.git("add", "-A");
    assert.equal(attestSelection(selectionOf(repo, "demo"), settings).blocking, false);
  });
});

test("no-evals warns and blocks only under missing-evals-blocking; invalid always blocks", () => {
  const repo = makeRepo();
  try {
    writeSkill(repo, "plain", {}, { evals: false });
    writeSkill(repo, "broken", { "evals/evals.json": "{}" });
    commitAll(repo, "base");
    markOrigin(repo);
    fs.appendFileSync(path.join(repo.root, skillRel("plain"), "SKILL.md"), "x\n");
    fs.appendFileSync(path.join(repo.root, skillRel("broken"), "SKILL.md"), "x\n");
    commitAll(repo, "edit");
    const plain = attestSelection(selectionOf(repo, "plain"));
    assert.equal(plain.status, "no-evals");
    assert.equal(plain.blocking, false);
    assert.equal(
      attestSelection(selectionOf(repo, "plain"), {
        regressionBlocking: false,
        failBlocking: false,
        missingEvalsBlocking: true,
      }).blocking,
      true,
    );
    const broken = attestSelection(selectionOf(repo, "broken"), {
      regressionBlocking: false,
      failBlocking: false,
      missingEvalsBlocking: false,
    });
    assert.equal(broken.status, "invalid");
    assert.equal(broken.blocking, true);
    // an evals/ directory without evals.json is invalid
    fs.rmSync(path.join(repo.root, skillRel("broken"), "evals", "evals.json"));
    assert.match(attestSelection(selectionOf(repo, "broken")).reason, /evals\.json is missing/);
  } finally {
    repo.cleanup();
  }
});

test("a symlink or an untracked non-ignored file makes the attestation invalid naming the path", () => {
  changedSkill((repo) => {
    fs.symlinkSync("run.sh", path.join(repo.root, skillRel("demo"), "scripts", "l.sh"));
    repo.git("add", "-A");
    const a = attestSelection(selectionOf(repo, "demo"));
    assert.equal(a.status, "invalid");
    assert.match(a.reason, /scripts\/l\.sh/);
    repo.git("rm", "-q", "-f", `${skillRel("demo")}/scripts/l.sh`);
    fs.writeFileSync(path.join(repo.root, skillRel("demo"), "scripts", "helper.sh"), "#!/bin/sh\n");
    const b = attestSelection(selectionOf(repo, "demo"));
    assert.equal(b.status, "invalid");
    assert.match(b.reason, /scripts\/helper\.sh.*git add/);
  });
});

test("the entry script runs without credentials, prints a line per skill and appends to the job summary", () => {
  changedSkill((repo) => {
    const sel = selectionOf(repo, "demo");
    writeResults(sel.skill.dirAbs, record(sel));
    repo.git("add", "-A");
    const summary = path.join(repo.root, "summary.md");
    const entry = path.resolve(import.meta.dirname, "..", "skill-evals-attestation.ts");
    const r = spawnSync(process.execPath, [entry], {
      cwd: repo.root,
      encoding: "utf8",
      env: {
        PATH: process.env["PATH"] ?? "",
        CREWRIG_REPO_DIR: repo.root,
        BASE_REF: "origin/main",
        GITHUB_STEP_SUMMARY: summary,
      },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^demo: pass/m);
    assert.match(fs.readFileSync(summary, "utf8"), /- demo: pass/);
    assert.equal(r.stderr, "", "the entry form prints no Node.js warning");
  });
});

test("the attestation check never reads a credential variable and makes no model call", () => {
  const src =
    fs.readFileSync(path.resolve(import.meta.dirname, "../lib/skill-evals/attest-cli.ts"), "utf8") +
    fs.readFileSync(path.resolve(import.meta.dirname, "../lib/skill-evals/attest.ts"), "utf8");
  for (const name of ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "fetch(", "spawn("])
    assert.equal(src.includes(name), false, name);
});
